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
  terraHeightAt,
  terraIsland,
  terraShore,
} from "@guildhall/world"
import { libraryUrl, loadCatalog } from "../catalog.ts"
import type { Screen } from "../screens.ts"
import { href } from "../shell/router.ts"
import { params, parse } from "./index.ts"

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
      const pieces = wild(t, (id) => catalog.get(id) !== undefined)
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
      batch?.dispose()
      water?.dispose()
      for (const m of meshes) m.dispose()
      stage.dispose()
      host.replaceChildren()
    }
  },
}
