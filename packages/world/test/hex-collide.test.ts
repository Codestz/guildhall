/**
 * The collision layer (collide.ts) and what reads it, with the authored data/tiles installed as the
 * Studio builds:
 *
 *   ground    every building, wall and tower stands on ground at its base under every point of its
 *             outline (the user: "buildings must always have a terrain block below them"), on seeds 1–3
 *             as the island grows (500, 4000, 12000 files);
 *   heights   a walker's feet stand on the stair tread and the bridge plank the mesh draws there;
 *   spots     no spot stands inside a building, a wall or a fence; the agents rest at places of their own
 *             in the open, never in the great hall's walls;
 *   walks     the agents' ways and nearly every townsman's keep out of buildings, walls and fences.
 */
import { afterAll, describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { DEMO_AGENTS } from "../../../apps/studio/src/hexworld/lifeAgents.ts"
import {
  agentLoop,
  HARD,
  HEX_TILE_SIZE,
  hexAt,
  hexGroundHeights,
  hexIsland,
  hexStructures,
  hexWalk,
  hexWorld,
  hexZones,
  installTilePrefabs,
  type LifeStep,
  lifePlaces,
  parseTilePrefabs,
  pieceFootprint,
  planFolk,
  type Solid,
  solidDistance,
  solidKind,
  walkwayAt,
  workTiles,
} from "../src/index.ts"

const DIR = join(import.meta.dir, "../../../data/tiles")
installTilePrefabs(
  parseTilePrefabs(
    Object.fromEntries(
      readdirSync(DIR)
        .filter((f) => f.endsWith(".json"))
        .map((f) => [f.slice(0, -5), JSON.parse(readFileSync(join(DIR, f), "utf8")) as unknown]),
    ),
  ).prefabs,
)
afterAll(() => installTilePrefabs(null))

/** Points over a solid's inside, on a grid `step` apart, and its corners. */
function inside(s: Solid, step: number): [number, number][] {
  let x0 = Number.POSITIVE_INFINITY
  let x1 = Number.NEGATIVE_INFINITY
  let z0 = Number.POSITIVE_INFINITY
  let z1 = Number.NEGATIVE_INFINITY
  const out: [number, number][] = []
  for (let k = 0; k < s.pts.length; k += 2) {
    x0 = Math.min(x0, s.pts[k]!)
    x1 = Math.max(x1, s.pts[k]!)
    z0 = Math.min(z0, s.pts[k + 1]!)
    z1 = Math.max(z1, s.pts[k + 1]!)
  }
  for (let x = x0; x <= x1; x += step)
    for (let z = z0; z <= z1; z += step) if (solidDistance(s, x, z) < -0.01) out.push([x, z])
  return out
}

describe("buildings stand on ground", () => {
  for (const seed of [1, 2, 3])
    for (const files of [500, 4000, 12000])
      test(`seed ${seed}, ${files} files: under every building, wall and tower its base's ground`, () => {
        const h = hexIsland({ seed, files })
        const z = hexZones(h)
        const w = hexWorld(h, z)
        const ground = hexGroundHeights(h, w)
        const tileOf = new Map(w.tiles.map((t) => [t.i, t]))
        const off: string[] = []
        let checked = 0
        for (const p of w.pieces) {
          const kind = solidKind(p.piece)
          if ((kind !== "building" && kind !== "wall") || /fence|hedge/.test(p.piece)) continue
          // what stands in the water (a quay's blocks, a dock's posts) stands on its bed, not on land
          const { q, r } = hexAt(p.x / HEX_TILE_SIZE, p.z / HEX_TILE_SIZE)
          if (tileOf.get(h.grid.index(q, r))?.ground === "water") continue
          const s = pieceFootprint(p)
          if (!s) continue
          checked++
          let worst = 0
          for (const [x, zz] of inside(s, 0.25))
            worst = Math.max(worst, Math.abs(ground.heightAt(x, zz) - p.y))
          if (worst > 0.05)
            off.push(`${p.piece} at ${p.x.toFixed(1)},${p.z.toFixed(1)}: ${worst.toFixed(2)} m`)
        }
        expect(checked).toBeGreaterThan(50)
        expect(off).toEqual([])
      })
})

/** The top of the mesh's upward faces over (x, z): the highest (null: none). */
function meshTop(pos: Float32Array, x: number, z: number): number | null {
  let top: number | null = null
  for (let k = 0; k < pos.length; k += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = [...pos.subarray(k, k + 9)] as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ]
    // facing up (a tread, a plank), not a riser or a side
    const ux = bx - ax
    const uy = by - ay
    const uz = bz - az
    const vx = cx - ax
    const vy = cy - ay
    const vz = cz - az
    const ny = uz * vx - ux * vz
    const len = Math.hypot(uy * vz - uz * vy, ny, ux * vy - uy * vx)
    if (len < 1e-9 || Math.abs(ny) / len < 0.7) continue
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz)
    if (Math.abs(d) < 1e-9) continue
    const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d
    const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d
    if (l1 < -1e-6 || l2 < -1e-6 || l1 + l2 > 1 + 1e-6) continue
    const y = l1 * ay + l2 * by + (1 - l1 - l2) * cy
    if (top === null || y > top) top = y
  }
  return top
}

describe("feet on the steps and the planks", () => {
  for (const seed of [1, 2, 3])
    test(`seed ${seed}: along every flight and deck the walker stands on the drawn tread`, () => {
      const h = hexIsland({ seed, files: 4000 })
      const w = hexWorld(h, hexZones(h))
      let checked = 0
      for (const st of [...w.stairs, ...w.bridges.flatMap((b) => b.legs)]) {
        const mesh = hexStructures({ stairs: st.kind === "stairs" ? [st] : [], bridges: [] })
        const len = Math.hypot(st.bx - st.ax, st.bz - st.az)
        const ux = (st.bx - st.ax) / len
        const uz = (st.bz - st.az) / len
        for (let f = 0.02; f < 0.99; f += 0.04)
          for (const side of [-0.6, 0, 0.6]) {
            const x = st.ax + ux * len * f - uz * side * st.half
            const z = st.az + uz * len * f + ux * side * st.half
            // (where two walkways meet, a bridge's legs at its middle, either may be the one stood on)
            const all = [...w.stairs, ...w.bridges.flatMap((b) => b.legs)]
            if (all.filter((o) => walkwayAt(o, x, z) !== null).length > 1) continue
            const y = w.stairAt(x, z)
            expect(y).not.toBeNull()
            expect(walkwayAt(st, x, z)).toBeCloseTo(y!, 6)
            if (st.kind === "stairs") {
              const top = meshTop(mesh.position, x, z)
              // the tread under the foot, and no tread drawn over it (never sunk into a step)
              expect(top).not.toBeNull()
              expect(Math.abs(top! - y!)).toBeLessThan(0.005)
            }
            checked++
          }
      }
      expect(checked).toBeGreaterThan(100)
    })

  test("a bridge's walker stands on the deck's line, as its planks are laid", () => {
    const h = hexIsland({ seed: 1, files: 4000 })
    const w = hexWorld(h, hexZones(h))
    for (const b of w.bridges) {
      const mesh = hexStructures({ stairs: [], bridges: [b] })
      for (const leg of b.legs) {
        const x = leg.ax + (leg.bx - leg.ax) * 0.5
        const z = leg.az + (leg.bz - leg.az) * 0.5
        const top = meshTop(mesh.position, x, z)
        expect(top).not.toBeNull()
        expect(Math.abs(top! - w.stairAt(x, z)!)).toBeLessThan(0.02)
      }
    }
  })
})

describe("people out of buildings, walls and fences", () => {
  for (const seed of [1, 2, 3])
    test(`seed ${seed}: no spot stands in one, and the agents rest apart in the open`, () => {
      const h = hexIsland({ seed, files: 4000 })
      const z = hexZones(h)
      const w = hexWorld(h, z)
      const walk = hexWalk(h, z, w, { reach: workTiles(h, z) })
      const places = lifePlaces(h, z, w, walk)
      const f = places.furniture
      for (const s of f.spots) {
        if (s.kind === "sleep") continue
        const d = Math.min(
          1,
          ...f
            .solidsNear(s.x, s.z, 0.1)
            .filter((o) => HARD(o.kind))
            .map((o) => solidDistance(o, s.x, s.z)),
        )
        expect([s.tile, s.kind, d >= 0]).toEqual([s.tile, s.kind, true])
      }
      const rests = DEMO_AGENTS.map((a, slot) => {
        const loop = agentLoop(walk, z, a.errands, { slot: slot * 2, mps: 0.92, role: a.recipe, places })
        const first = loop.steps[0]!
        return first.kind === "stay" ? first.at : first.pts[0]!
      })
      for (const [k, at] of rests.entries()) {
        // where the Warden stood in the castle's front: now at least a body's room from every wall
        for (const o of f.solidsNear(at[0], at[2], 0.3))
          if (HARD(o.kind)) expect(solidDistance(o, at[0], at[2])).toBeGreaterThan(0.1)
        for (const other of rests.slice(k + 1))
          expect(Math.hypot(other[0] - at[0], other[2] - at[2])).toBeGreaterThan(0.6)
      }
    })

  /** A body brushing a gate's post or a wall's foot (its shoulder, not its feet), metres. */
  const BRUSH = 0.15
  /** How deep a walk runs into a building, a wall or a fence (its door's last metre aside). */
  const cut = (
    f: { solidsNear(x: number, z: number, r: number): Solid[] },
    steps: LifeStep[],
    si: number,
  ) => {
    const s = steps[si]!
    if (s.kind !== "walk") return 0
    const prev = steps[si - 1]
    const next = steps[si + 1] ?? steps[0]
    const fromIn = prev?.kind === "stay" && !!prev.indoors
    const toIn = next?.kind === "stay" && !!next.indoors
    const a = s.pts[0]!
    const b = s.pts[s.pts.length - 1]!
    let worst = 0
    for (let k = 0; k + 1 < s.pts.length; k++) {
      const p = s.pts[k]!
      const q = s.pts[k + 1]!
      const n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[2] - p[2]) / 0.1))
      for (let j = 0; j <= n; j++) {
        const x = p[0] + ((q[0] - p[0]) * j) / n
        const z = p[2] + ((q[2] - p[2]) * j) / n
        for (const o of f.solidsNear(x, z, 0.05)) {
          if (!HARD(o.kind)) continue
          if (solidDistance(o, a[0], a[2]) < (fromIn ? 1 : 0.05)) continue
          if (solidDistance(o, b[0], b[2]) < (toIn ? 1 : 0.05)) continue
          worst = Math.max(worst, -solidDistance(o, x, z))
        }
      }
    }
    return worst
  }

  test("seed 1: the agents' ways keep out of them all, and nearly every townsman's does", () => {
    const h = hexIsland({ seed: 1, files: 4000 })
    const z = hexZones(h)
    const w = hexWorld(h, z)
    const walk = hexWalk(h, z, w, { reach: workTiles(h, z) })
    const places = lifePlaces(h, z, w, walk)
    const f = places.furniture
    const agents = DEMO_AGENTS.map((a, slot) =>
      agentLoop(walk, z, a.errands, { slot: slot * 2, mps: 0.92, role: a.recipe, places }),
    )
    const folk = planFolk(h, z, w, walk, { seed: 1, pace: 144, places })
    for (const [k, a] of agents.entries())
      for (const si of a.steps.keys())
        expect([DEMO_AGENTS[k]!.id, si, cut(f, a.steps, si) > BRUSH]).toEqual([DEMO_AGENTS[k]!.id, si, false])
    let walks = 0
    let bad = 0
    for (const p of folk)
      for (const si of p.day.keys()) {
        if (p.day[si]!.kind !== "walk") continue
        walks++
        if (cut(f, p.day, si) > BRUSH) bad++
      }
    expect(walks).toBeGreaterThan(400)
    // the few left are scenes with no gap a body passes (hex-spots-reach's WALLED) and the ways round them
    expect(bad / walks).toBeLessThan(0.15)
  })
})
