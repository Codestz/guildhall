/**
 * Step 4 of the terrain-first island: each place of step 2 built as an organic district, not a ring
 * town (decisions.md "Target island + terrain-first pipeline": streets wander, follow the contours,
 * no circular walls).
 *
 * Streets: the island's roads already run through every place; side streets branch off them at
 * intervals, both sides, and wander outward along the contour (across the slope, never up it), with
 * a little drift; a street stops at the place's edge, on steep ground, or where it meets another
 * street (it joins it). Town streets branch again once.
 *
 * Buildings: walking every street on both sides, each slot takes the building its district builds
 * (tall town houses and shops near the square, cottages further out, warehouses on the harbour,
 * farmhouses in the hamlets), front to the street, set just back from it, kept wholly on the place's
 * flat ground, off every street and clear of every other building. The town's civic buildings face
 * its square first.
 */
import type { PrefabMeta } from "@guildhall/assets"
import type { Vec2 } from "../geom/vec.ts"
import { TERRA_WATER, type Terra, terraHeightAt } from "./island.ts"
import { hash2 } from "./noise.ts"
import type { AnchorKind, TerraPlan } from "./plan.ts"

export interface DistrictStreet {
  line: Vec2[]
  /** Half its width, metres. */
  half: number
}

export interface DistrictBuilding {
  prefab: string
  seed: number
  at: Vec2
  /** Turn about +y; the building's front (+z) faces its street. */
  rot: number
  /** Ground height under it. */
  y: number
  anchor: number
}

export interface TerraDistricts {
  streets: DistrictStreet[]
  squares: Vec2[][]
  buildings: DistrictBuilding[]
  /** Buildings per place, in anchor order. */
  counts: number[]
  ms: number
}

/** What each kind of place builds, by distance from its heart (near → far), and how it is spaced. */
const PLAN_OF: Record<
  AnchorKind,
  {
    civic: string[]
    near: string[]
    far: string[]
    gap: number
    branch: number
    reach: number
    square: number
  }
> = {
  town: {
    civic: ["guildhall", "market-hall", "chapel-spire", "inn-courtyard", "bakery"],
    near: ["narrow-city-house", "townhouse-shop", "corner-house", "merchant-hall", "timber-house"],
    far: ["timber-house", "stone-house", "cottage", "long-house", "smithy"],
    gap: 0.6,
    branch: 26,
    reach: 70,
    square: 12,
  },
  harbour: {
    civic: ["warehouse-row", "tavern"],
    near: ["warehouse", "warehouse-timber", "timber-house", "stone-house"],
    far: ["cottage", "timber-house"],
    gap: 1.5,
    branch: 30,
    reach: 40,
    square: 7,
  },
  crossing: {
    civic: ["watermill", "inn-courtyard"],
    near: ["timber-house", "stone-house", "tavern"],
    far: ["cottage", "long-house"],
    gap: 2,
    branch: 32,
    reach: 40,
    square: 7,
  },
  outpost: {
    civic: ["watch-tower"],
    near: ["stone-house"],
    far: ["cottage"],
    gap: 3,
    branch: 0,
    reach: 0,
    square: 0,
  },
  fishing: {
    civic: [],
    near: ["cottage", "long-house"],
    far: ["cottage"],
    gap: 4,
    branch: 0,
    reach: 0,
    square: 0,
  },
  farm: {
    civic: ["stables"],
    near: ["farmhouse", "long-house"],
    far: ["farmhouse", "cottage"],
    gap: 6,
    branch: 0,
    reach: 0,
    square: 0,
  },
}

interface Box {
  c: Vec2
  /** Unit axes: u along the frontage, v along the depth. */
  u: Vec2
  v: Vec2
  hu: number
  hv: number
}

function overlap(a: Box, b: Box): boolean {
  const axes = [a.u, a.v, b.u, b.v]
  const d: Vec2 = [b.c[0] - a.c[0], b.c[1] - a.c[1]]
  for (const ax of axes) {
    const ra =
      a.hu * Math.abs(a.u[0] * ax[0] + a.u[1] * ax[1]) + a.hv * Math.abs(a.v[0] * ax[0] + a.v[1] * ax[1])
    const rb =
      b.hu * Math.abs(b.u[0] * ax[0] + b.u[1] * ax[1]) + b.hv * Math.abs(b.v[0] * ax[0] + b.v[1] * ax[1])
    if (Math.abs(d[0] * ax[0] + d[1] * ax[1]) > ra + rb) return false
  }
  return true
}

const segDist = (p: Vec2, a: Vec2, b: Vec2): number => {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const l2 = dx * dx + dz * dz || 1
  const s = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2))
  return Math.hypot(p[0] - a[0] - s * dx, p[1] - a[1] - s * dz)
}

export function terraDistricts(t: Terra, plan: TerraPlan, prefabs: readonly PrefabMeta[]): TerraDistricts {
  const t0 = performance.now()
  const { w, h, cell, origin, water, slope, terraceLevel } = t
  const seed = t.spec.seed
  const meta = new Map(prefabs.map((p) => [p.id, p]))
  const cellAt = (p: Vec2): number => {
    const ix = Math.floor((p[0] - origin[0]) / cell)
    const iz = Math.floor((p[1] - origin[1]) / cell)
    return ix < 0 || iz < 0 || ix >= w || iz >= h ? -1 : iz * w + ix
  }
  const streets: DistrictStreet[] = []
  const squares: Vec2[][] = []
  const buildings: DistrictBuilding[] = []
  const boxes: Box[] = []
  const counts: number[] = []
  // the roads are streets too: buildings line them and side streets leave them
  const roadLines: DistrictStreet[] = plan.roads.map((r) => ({
    line: r.line,
    half: r.kind === "main" ? 2.2 : 1.5,
  }))
  const allStreets = (): DistrictStreet[] => [...roadLines, ...streets]
  const nearStreet = (p: Vec2, clear: number, skip?: DistrictStreet): boolean => {
    for (const s of allStreets()) {
      if (s === skip) continue
      for (let k = 1; k < s.line.length; k++)
        if (segDist(p, s.line[k - 1]!, s.line[k]!) < clear + s.half) return true
    }
    return false
  }

  plan.anchors.forEach((a, ai) => {
    const P = PLAN_OF[a.kind]
    const mine = (p: Vec2, flat = 0.28): boolean => {
      const i = cellAt(p)
      return (
        i >= 0 &&
        plan.claim[i] === ai + 1 &&
        terraceLevel[i] === a.level &&
        water[i] === TERRA_WATER.land &&
        slope[i]! <= flat
      )
    }
    const u = (k: number, x = 0, z = 0) =>
      hash2(seed + 9100 + ai * 37 + k, Math.round(x * 4), Math.round(z * 4))
    const before = buildings.length

    // ---- the square ----
    if (P.square > 0 && mine(a.at)) {
      const ring: Vec2[] = []
      for (let k = 0; k < 14; k++) {
        const ang = (k / 14) * Math.PI * 2
        const r = P.square * (1 + 0.15 * Math.sin(ang * 3 + ai))
        ring.push([a.at[0] + Math.cos(ang) * r, a.at[1] + Math.sin(ang) * r])
      }
      squares.push(ring)
    }

    // ---- side streets off the roads through the place ----
    const sideStreets: DistrictStreet[] = []
    const grow = (start: Vec2, dir: Vec2, depth: number): void => {
      const line: Vec2[] = [start]
      let d = dir
      let p = start
      const step = 4
      const street: DistrictStreet = { line, half: depth === 0 ? 2 : 1.6 }
      for (let n = 0; n < P.reach / step; n++) {
        // turn toward the contour: across the slope, whichever way is nearer the current heading
        const e = 1.5
        const gx = terraHeightAt(t, p[0] + e, p[1]) - terraHeightAt(t, p[0] - e, p[1])
        const gz = terraHeightAt(t, p[0], p[1] + e) - terraHeightAt(t, p[0], p[1] - e)
        const gl = Math.hypot(gx, gz)
        let cx = d[0]
        let cz = d[1]
        if (gl > 0.05) {
          let tx = -gz / gl
          let tz = gx / gl
          if (tx * d[0] + tz * d[1] < 0) {
            tx = -tx
            tz = -tz
          }
          const k = Math.min(0.5, gl * 0.6)
          cx = d[0] * (1 - k) + tx * k
          cz = d[1] * (1 - k) + tz * k
        }
        const drift = (u(n + 1, p[0], p[1]) - 0.5) * 0.35
        const nx = cx * Math.cos(drift) - cz * Math.sin(drift)
        const nz = cx * Math.sin(drift) + cz * Math.cos(drift)
        const nl = Math.hypot(nx, nz) || 1
        d = [nx / nl, nz / nl]
        const q: Vec2 = [p[0] + d[0] * step, p[1] + d[1] * step]
        if (!mine(q, 0.32)) break
        if (n > 1 && nearStreet(q, 5, street)) {
          line.push(q)
          break
        }
        line.push(q)
        p = q
        // a town street branches once, every so often
        if (depth === 0 && P.branch && n > 3 && n % Math.round(P.branch / step) === 0) {
          const side = u(90 + n, p[0], p[1]) < 0.5 ? 1 : -1
          sideStreets.push({ line: [p, [p[0] - d[1] * side, p[1] + d[0] * side]], half: -1 })
        }
      }
      if (line.length >= 4) streets.push(street)
    }
    if (P.branch > 0)
      for (const road of roadLines) {
        let run = 0
        for (let k = 1; k < road.line.length; k++) {
          const a0 = road.line[k - 1]!
          const b0 = road.line[k]!
          const len = Math.hypot(b0[0] - a0[0], b0[1] - a0[1])
          run += len
          if (run < P.branch || !mine(b0)) continue
          run = 0
          const dx = (b0[0] - a0[0]) / (len || 1)
          const dz = (b0[1] - a0[1]) / (len || 1)
          for (const side of [1, -1]) {
            const n: Vec2 = [-dz * side, dx * side]
            grow([b0[0] + n[0] * 3, b0[1] + n[1] * 3], n, 0)
          }
        }
      }
    for (const s of sideStreets) {
      const [p, q] = s.line as [Vec2, Vec2]
      grow(p, [q[0] - p[0], q[1] - p[1]], 1)
    }

    // ---- buildings ----
    const place = (id: string, p: Vec2, n: Vec2, streetHalf: number, setback: number): number => {
      const m = meta.get(id)
      if (!m) return 0
      const hu = m.frontage / 2
      const hv = m.depth / 2
      const c: Vec2 = [p[0] + n[0] * (streetHalf + setback + hv), p[1] + n[1] * (streetHalf + setback + hv)]
      const v: Vec2 = [-n[0], -n[1]] // the front faces the street
      const uu: Vec2 = [v[1], -v[0]]
      const box: Box = { c, u: uu, v, hu: hu + 0.25, hv: hv + 0.25 }
      const corners: Vec2[] = [
        [c[0] + uu[0] * hu + v[0] * hv, c[1] + uu[1] * hu + v[1] * hv],
        [c[0] - uu[0] * hu + v[0] * hv, c[1] - uu[1] * hu + v[1] * hv],
        [c[0] + uu[0] * hu - v[0] * hv, c[1] + uu[1] * hu - v[1] * hv],
        [c[0] - uu[0] * hu - v[0] * hv, c[1] - uu[1] * hu - v[1] * hv],
      ]
      if (!mine(c) || corners.some((q) => !mine(q, 0.4))) return 0
      if (boxes.some((b) => overlap(b, box))) return 0
      if (corners.some((q) => nearStreet(q, 0.6)) || nearStreet(c, 0.6)) return 0
      if (squares.some((sq) => sq.some((q) => Math.hypot(q[0] - c[0], q[1] - c[1]) < hv * 0.6))) return 0
      let y = Infinity
      for (const q of [c, ...corners]) y = Math.min(y, terraHeightAt(t, q[0], q[1]))
      boxes.push(box)
      buildings.push({
        prefab: id,
        seed: Math.floor(u(400, c[0], c[1]) * 1000),
        at: c,
        rot: Math.atan2(v[0], v[1]),
        y,
        anchor: ai,
      })
      return m.frontage
    }
    const pick = (list: string[], k: number): string | undefined => {
      const ok = list.filter((id) => meta.has(id))
      return ok.length ? ok[Math.floor(k * ok.length) % ok.length] : undefined
    }
    // civic buildings round the square (or round the heart where there is none)
    const civic = P.civic.filter((id) => meta.has(id))
    civic.forEach((id, k) => {
      for (let tries = 0; tries < 16; tries++) {
        const ang = ((k + tries * 0.37) / Math.max(1, civic.length)) * Math.PI * 2 + u(5)
        const n: Vec2 = [Math.cos(ang), Math.sin(ang)]
        const r = P.square || 4
        const p: Vec2 = [a.at[0] + n[0] * r, a.at[1] + n[1] * r]
        if (place(id, p, n, 0, 1)) break
      }
    })
    // houses along every street that runs through the place, both sides
    const lines = [...roadLines, ...streets.filter((s) => s.line.some((p) => mine(p, 1)))]
    for (const s of lines) {
      for (const side of [1, -1]) {
        let carry = 0
        for (let k = 1; k < s.line.length; k++) {
          const a0 = s.line[k - 1]!
          const b0 = s.line[k]!
          const len = Math.hypot(b0[0] - a0[0], b0[1] - a0[1])
          if (len < 0.01) continue
          const dx = (b0[0] - a0[0]) / len
          const dz = (b0[1] - a0[1]) / len
          const n: Vec2 = [-dz * side, dx * side]
          let pos = carry
          while (pos < len) {
            const p: Vec2 = [a0[0] + dx * pos, a0[1] + dz * pos]
            if (!mine(p, 1)) {
              pos += 2
              continue
            }
            const dist = Math.hypot(p[0] - a.at[0], p[1] - a.at[1])
            const near = dist < (P.reach || 30) * 0.45
            const id = pick(near ? P.near : P.far, u(7, p[0], p[1]))
            const used = id ? place(id, p, n, s.half, near ? 0.6 : 1.5 + u(8, p[0], p[1]) * 2) : 0
            pos += used ? used + P.gap + (near ? 0 : u(9, p[0], p[1]) * P.gap) : 2
          }
          carry = pos - len
        }
      }
    }
    counts.push(buildings.length - before)
  })
  return { streets, squares, buildings, counts, ms: Math.round(performance.now() - t0) }
}
