/**
 * Terrain in 3D (`/lab/terra3d`, same query as `/lab/terra`): the height map as one ground mesh in
 * the palette material (so it takes the cascaded sun), the sea from the shared water, rivers and
 * lakes as their own surfaces, and the wild planted on it from the library (broadleaf woods in the
 * lowland, pines on the terraces, rocks on the risers and cliffs), every piece standing on the ground.
 */
import type { CameraPose } from "@guildhall/core"
import { log } from "@guildhall/core"
import {
  type BatchInstance,
  createHeightGround,
  createInlandWater,
  createSky,
  createStage,
  createStaticBatch,
  createSun,
  createSurface,
  createWater,
  loadPiece,
  type StaticBatch,
  type TerrainMesh,
  type Water,
} from "@guildhall/render"
import {
  fbm,
  hash2,
  paintTerra,
  TERRA_CRAG,
  TERRA_WATER,
  type Terra,
  type TerraPlan,
  terraHeightAt,
  terraIsland,
  terraPlan,
  terraShore,
} from "@guildhall/world"
import { libraryUrl, loadCatalog } from "../catalog.ts"
import type { Screen } from "../screens.ts"
import { href } from "../shell/router.ts"
import { worldCamera } from "../shell/worldCamera.ts"
import { params, parse } from "../terra/index.ts"

const logger = log("studio:terra3d")

const TREES = [
  "kaykit-forest/tree-1-b-color1",
  "kaykit-forest/tree-1-c-color1",
  "kaykit-forest/tree-3-b-color1",
  "kaykit-forest/tree-3-c-color1",
  "kaykit-forest/tree-2-c-color1",
  "quaternius-nature/common-tree-1",
  "quaternius-nature/common-tree-2",
]
const PINES = [
  "quaternius-nature/pine-tree-2",
  "quaternius-nature/pine-tree-3",
  "kenney-nature/tree-pine-round-a",
]
const ROCKS = ["kenney-nature/rock-small-c", "kenney-nature/rock-small-f", "kaykit-forest/rock-2-d-color1"]
const BUSHES = ["kenney-nature/plant-bush", "kenney-nature/plant-bush-large", "kaykit-forest/bush-2-d-color1"]

/**
 * Inland water as triangle positions: each river a ribbon along its smoothed line (its width, just
 * under the banks of the carved channel), each lake a quad per cell at its surface.
 */
function inlandWater(t: Terra): Float32Array {
  const { w, h, cell, origin, water, surface } = t
  const pos: number[] = []
  for (let i = 0; i < w * h; i++) {
    if (water[i] !== TERRA_WATER.lake) continue
    const x = origin[0] + (i % w) * cell
    const z = origin[1] + Math.floor(i / w) * cell
    const y = surface[i]! - 0.25
    const e = cell * 0.5
    pos.push(x - e, y, z - e, x - e, y, z + cell + e, x + cell + e, y, z - e)
    pos.push(x + cell + e, y, z - e, x - e, y, z + cell + e, x + cell + e, y, z + cell + e)
  }
  for (const r of t.rivers) {
    const n = r.line.length
    type P3 = [number, number, number]
    const side: [P3, P3][] = []
    let prevY = Number.POSITIVE_INFINITY
    for (let k = 0; k < n; k++) {
      const p = r.line[k]!
      const a = r.line[Math.max(0, k - 1)]!
      const b = r.line[Math.min(n - 1, k + 1)]!
      let dx = b[0] - a[0]
      let dz = b[1] - a[1]
      const len = Math.hypot(dx, dz) || 1
      dx /= len
      dz /= len
      const half = r.width[k]! / 2 + 0.6
      // the water never climbs downstream: bed + 0.45, held at or under the last point
      const y = Math.min(prevY, Math.max(terraHeightAt(t, p[0], p[1]) + 0.45, 0.05))
      prevY = y
      side.push([
        [p[0] - dz * half, y, p[1] + dx * half],
        [p[0] + dz * half, y, p[1] - dx * half],
      ])
    }
    for (let k = 1; k < n; k++) {
      const [a0, a1] = side[k - 1]!
      const [b0, b1] = side[k]!
      pos.push(...a0, ...b0, ...a1, ...a1, ...b0, ...b1)
    }
  }
  return new Float32Array(pos)
}

/** Each road as a ribbon draped over the ground (sampled every metre so it follows the terraces). */
function roadRibbons(t: Terra, plan: TerraPlan): Float32Array {
  const pos: number[] = []
  for (const r of plan.roads) {
    const half = r.kind === "main" ? 2.2 : 1.5
    const pts: [number, number][] = []
    for (let k = 1; k < r.line.length; k++) {
      const a = r.line[k - 1]!
      const b = r.line[k]!
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])))
      for (let j = 0; j < n; j++) pts.push([a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n])
    }
    pts.push(r.line[r.line.length - 1] as [number, number])
    const at = (p: [number, number]) => Math.max(terraHeightAt(t, p[0], p[1]), 0.6) + 0.12
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1]!
      const b = pts[k]!
      let dx = b[0] - a[0]
      let dz = b[1] - a[1]
      const len = Math.hypot(dx, dz) || 1
      dx /= len
      dz /= len
      const ya = at(a)
      const yb = at(b)
      const a0 = [a[0] - dz * half, ya, a[1] + dx * half]
      const a1 = [a[0] + dz * half, ya, a[1] - dx * half]
      const b0 = [b[0] - dz * half, yb, b[1] + dx * half]
      const b1 = [b[0] + dz * half, yb, b[1] - dx * half]
      pos.push(...a0, ...b0, ...a1, ...a1, ...b0, ...b1)
    }
  }
  return new Float32Array(pos)
}

const HOUSES = [
  "quaternius-village/house-1",
  "quaternius-village/house-2",
  "quaternius-village/house-3",
  "quaternius-village/house-4",
]
/** Stand-in buildings per anchor (step 4 replaces them with real districts). */
const HOUSES_BY_KIND: Record<string, number> = {
  town: 14,
  harbour: 6,
  crossing: 5,
  outpost: 2,
  fishing: 4,
  farm: 3,
}

/**
 * Stand-ins so the anchors read in 3D: a ring of houses on flat ground round each anchor, facing it,
 * and a flag at its heart.
 */
function anchorPieces(t: Terra, plan: TerraPlan, have: (id: string) => boolean): BatchInstance[] {
  const houses = HOUSES.filter(have)
  const out: BatchInstance[] = []
  plan.anchors.forEach((a, k) => {
    const count = houses.length ? (HOUSES_BY_KIND[a.kind] ?? 3) : 0
    let placed = 0
    for (let tries = 0; placed < count && tries < count * 12; tries++) {
      const u = (s: number) => hash2(t.spec.seed + 4000 + k * 97 + s, tries, placed)
      const ang = u(1) * Math.PI * 2
      const d = 9 + u(2) * (a.kind === "town" ? 34 : 18)
      const x = a.at[0] + Math.cos(ang) * d
      const z = a.at[1] + Math.sin(ang) * d
      const ix = Math.floor((x - t.origin[0]) / t.cell)
      const iz = Math.floor((z - t.origin[1]) / t.cell)
      const i = iz * t.w + ix
      if (t.water[i] !== TERRA_WATER.land || t.slope[i]! > 0.18) continue
      if (out.some((p) => Math.hypot(p.x - x, p.z - z) < 8)) continue
      if (plan.roads.some((r) => r.line.some((p) => Math.hypot(p[0] - x, p[1] - z) < 5))) continue
      out.push({
        piece: houses[Math.floor(u(3) * houses.length) % houses.length]!,
        x,
        y: terraHeightAt(t, x, z) - 0.1,
        z,
        rot: Math.atan2(a.at[0] - x, a.at[1] - z),
        scale: 1,
      })
      placed++
    }
    if (have("kenney-mini-forest/flag"))
      out.push({
        piece: "kenney-mini-forest/flag",
        x: a.at[0],
        y: terraHeightAt(t, a.at[0], a.at[1]),
        z: a.at[1],
        rot: 0,
        scale: 3,
      })
  })
  return out
}

/** The wild on the land: a jittered 4 m grid read against woods noise, height, slope and the coast. */
function wild(t: Terra, have: (id: string) => boolean): BatchInstance[] {
  const seed = t.spec.seed
  const trees = TREES.filter(have)
  const pines = PINES.filter(have)
  const rocks = ROCKS.filter(have)
  const bushes = BUSHES.filter(have)
  const out: BatchInstance[] = []
  const pitch = 4
  const half = (t.w * t.cell) / 2
  for (let gz = -half; gz < half; gz += pitch)
    for (let gx = -half; gx < half; gx += pitch) {
      const u = (k: number) => hash2(seed + k, Math.round(gx), Math.round(gz))
      const x = gx + (u(1) - 0.5) * pitch * 0.9
      const z = gz + (u(2) - 0.5) * pitch * 0.9
      const ix = Math.floor((x - t.origin[0]) / t.cell)
      const iz = Math.floor((z - t.origin[1]) / t.cell)
      if (ix < 1 || iz < 1 || ix >= t.w - 1 || iz >= t.h - 1) continue
      const i = iz * t.w + ix
      if (t.water[i] !== TERRA_WATER.land) continue
      const D = t.coastDist[i]!
      const sl = t.slope[i]!
      const lvl = t.terraceLevel[i]!
      const wood = fbm(seed + 901, x / 75, z / 75, 3) + 0.25 * fbm(seed + 907, x / 22, z / 22, 2)
      const pick = (list: string[], k: number) => list[Math.floor(u(k) * list.length) % list.length]
      let id: string | undefined
      let scale = 0.85 + 0.4 * u(5)
      if (sl > 0.8) {
        if (u(3) < 0.18) id = pick(rocks, 4)
      } else if (D < 10) {
        if (u(3) < 0.02) id = pick(rocks, 4)
      } else if (lvl >= 1) {
        if (u(3) < (lvl === TERRA_CRAG ? 0.06 : 0.3)) id = pick(pines, 4)
        else if (u(3) < 0.38) id = pick(rocks, 4)
      } else if (wood > 0.18) {
        const dense = Math.min(1, (wood - 0.18) * 4)
        if (u(3) < 0.25 + 0.5 * dense) id = pick(D < 30 ? pines : trees, 4)
        else if (u(3) < 0.85) id = pick(bushes, 4)
      } else if (u(3) < 0.025) {
        id = pick(trees, 4)
        scale *= 1.2
      } else if (u(3) < 0.05) id = pick(bushes, 4)
      if (!id) continue
      out.push({ piece: id, x, y: terraHeightAt(t, x, z) - 0.05, z, rot: u(6) * Math.PI * 2, scale })
    }
  return out
}

export const terra3d: Screen = {
  id: "terra3d",
  title: "Terrain 3D",
  mount(host, ctx) {
    const view = parse(ctx.query)
    const t = terraIsland(view.spec)
    const stage = createStage(host)
    ctx.attach(stage)
    const cam = worldCamera(stage, host, ctx.query)
    const span0 = (t.w * t.cell) / 2
    cam.start({
      centre: [0, 0],
      half: span0 * 1.4,
      heightAt: (x, z) => terraHeightAt(t, x, z),
      water: 0,
      free: true,
    })
    let disposed = false
    let batch: StaticBatch | null = null
    let water: Water | null = null
    const meshes: TerrainMesh[] = []
    const info = document.createElement("div")
    info.style.cssText =
      "position:absolute;left:12px;top:12px;z-index:2;padding:8px 12px;border-radius:4px;background:rgba(21,17,13,0.82);color:#f3e9d4;font:12px/1.5 ui-monospace,Menlo,monospace;white-space:pre"
    const back = document.createElement("a")
    back.textContent = "◀ back to the map"
    back.href = href("terra", params(view))
    back.style.cssText = "color:#e8c27a;display:block;margin-bottom:4px"
    const text = document.createElement("div")
    info.append(back, text)

    const build = async () => {
      host.append(info)
      const R = view.spec.size / 2
      const pose: CameraPose = { target: [0, 2, 0], azimuth: 30, elevation: 38, distance: R * 3.4 }
      stage.setCamera(pose)
      const span = (t.w * t.cell) / 2
      const sun = createSun(stage, { town: { min: [-span, -2, -span], max: [span, 22, span] } })
      createSky(stage, { sun, hour: 15.5, reach: R * 2.2 })
      const plan = view.plan ? terraPlan(t) : null
      if (plan) meshes.push(createSurface(stage, roadRibbons(t, plan), "#c9a774"))
      meshes.push(
        createHeightGround(stage, { ...t, rgba: paintTerra(t, { shade: false, contours: false }) }),
        createInlandWater(stage, inlandWater(t)),
      )
      water = createWater(stage, {
        polys: [
          [
            [-span * 3, -span * 3],
            [span * 3, -span * 3],
            [span * 3, span * 3],
            [-span * 3, span * 3],
          ],
        ],
        level: 0,
        shore: terraShore(t),
      })
      const catalog = await loadCatalog()
      if (!catalog || disposed) return
      const have = (id: string) => catalog.get(id) !== undefined
      const settled = plan ? anchorPieces(t, plan, have) : []
      const clear = (p: BatchInstance) =>
        !settled.some((s) => Math.hypot(s.x - p.x, s.z - p.z) < 6) &&
        !(plan?.roads ?? []).some((r) => r.line.some((q) => Math.hypot(q[0] - p.x, q[1] - p.z) < 3.5))
      const pieces = [...settled, ...wild(t, have).filter(clear)]
      batch = await createStaticBatch(stage, pieces, async (id) => {
        const entry = catalog.get(id)
        if (!entry) throw new Error(`terra3d: unknown piece "${id}"`)
        return loadPiece(libraryUrl(entry.files.glb))
      })
      if (disposed) batch.dispose()
      sun.markDirty()
      text.textContent = [
        `seed ${view.spec.seed} · ${view.spec.size} m`,
        `${t.rivers.length} rivers · ${t.stats.lakes} lakes · ${t.falls.length} falls`,
        `${pieces.length} trees, pines, rocks, bushes`,
      ].join("\n")
      logger.info("terra3d", { pieces: pieces.length })
    }
    const ready = build()
    ctx.load(ready).catch((error: unknown) => logger.error("build failed", { error: String(error) }))
    return () => {
      disposed = true
      cam.dispose()
      batch?.dispose()
      water?.dispose()
      for (const m of meshes) m.dispose()
      stage.dispose()
      host.replaceChildren()
    }
  },
}
