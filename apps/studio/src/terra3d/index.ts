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
  type TerraParcels,
  type TerraPlan,
  terraHeightAt,
  terraIsland,
  terraParcels,
  terraPlan,
  terraShore,
} from "@guildhall/world"
import { libraryUrl, loadCatalog } from "../catalog.ts"
import type { Screen } from "../screens.ts"
import { href } from "../shell/router.ts"
import { worldCamera } from "../shell/worldCamera.ts"
import { params, parse } from "../terra/index.ts"
import { buildPlaces } from "./towns.ts"

const logger = log("studio:terra3d")

/** One colour for every road, street and square, so where they meet they read as one surface. */
const ROAD = "#cbb48a"

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

/**
 * One continuous strip per road: the line resampled every metre, each point offset both ways along the
 * mean of its two segments' normals (a mitre, so joints close), each edge vertex draped on the ground
 * under it.
 */
function strip(t: Terra, line: readonly (readonly [number, number])[], half: number, pos: number[]): void {
  const pts: [number, number][] = []
  for (let k = 1; k < line.length; k++) {
    const a = line[k - 1]!
    const b = line[k]!
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])))
    for (let j = 0; j < n; j++) pts.push([a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n])
  }
  const last = line[line.length - 1]
  if (last) pts.push([last[0], last[1]])
  if (pts.length < 2) return
  const at = (x: number, z: number) => Math.max(terraHeightAt(t, x, z), 0.6) + 0.12
  type P3 = [number, number, number]
  const side: [P3, P3][] = []
  for (let k = 0; k < pts.length; k++) {
    const p = pts[k]!
    const a = pts[Math.max(0, k - 1)]!
    const b = pts[Math.min(pts.length - 1, k + 1)]!
    let dx = b[0] - a[0]
    let dz = b[1] - a[1]
    const len = Math.hypot(dx, dz) || 1
    dx /= len
    dz /= len
    const l: [number, number] = [p[0] - dz * half, p[1] + dx * half]
    const r: [number, number] = [p[0] + dz * half, p[1] - dx * half]
    side.push([
      [l[0], at(l[0], l[1]), l[1]],
      [r[0], at(r[0], r[1]), r[1]],
    ])
  }
  for (let k = 1; k < side.length; k++) {
    const [a0, a1] = side[k - 1]!
    const [b0, b1] = side[k]!
    pos.push(...a0, ...b0, ...a1, ...a1, ...b0, ...b1)
  }
}

/** Each road as a continuous strip draped over the ground. */
function roadRibbons(t: Terra, plan: TerraPlan, width?: number): Float32Array {
  const pos: number[] = []
  for (const r of plan.roads) strip(t, r.line, width ?? (r.kind === "main" ? 2.2 : 1.5), pos)
  return new Float32Array(pos)
}

/** Street centrelines as continuous strips of their own width, draped over the ground. */
function streetRibbons(t: Terra, streets: { line: [number, number][]; half: number }[]): Float32Array {
  const pos: number[] = []
  for (const s of streets) if (s.half > 0) strip(t, s.line, s.half, pos)
  return new Float32Array(pos)
}

/** The squares (closed rings, half width 0) as fans from their centre, draped over the ground. */
function squares(t: Terra, streets: { line: [number, number][]; half: number }[]): Float32Array {
  const pos: number[] = []
  for (const s of streets) {
    if (s.half > 0 || s.line.length < 4) continue
    let cx = 0
    let cz = 0
    for (const [x, z] of s.line) {
      cx += x
      cz += z
    }
    cx /= s.line.length
    cz /= s.line.length
    const y = (x: number, z: number) => Math.max(terraHeightAt(t, x, z), 0.6) + 0.14
    for (let k = 1; k < s.line.length; k++) {
      const a = s.line[k - 1]!
      const b = s.line[k]!
      pos.push(cx, y(cx, cz), cz, b[0], y(b[0], b[1]), b[1], a[0], y(a[0], a[1]), a[1])
    }
  }
  return new Float32Array(pos)
}

const CROPS = [
  "kenney-nature/crops-wheat-stage-b",
  "kenney-nature/crops-corn-stage-c",
  "kenney-nature/crops-leafs-stage-b",
  "kenney-nature/crop-pumpkin",
]
const ORCHARD = ["quaternius-crops/apple-4", "quaternius-crops/orange-4"]
const ANIMALS = ["quaternius-farm-animals/sheep", "quaternius-farm-animals/cow"]
const GRASS = [
  "kaykit-forest/grass-1-a-color1",
  "kaykit-forest/grass-2-b-color1",
  "kaykit-forest/grass-1-c-color1",
]
const FENCE = "kenney-nature/fence-simple"
const POI_PIECES: Record<string, string[]> = {
  lookout: ["kaykit-builder/watchtower-gltf"],
  lighthouse: ["kenney-castle/tower-square"],
  shrine: ["kaykit-dungeon/pillar-decorated", "kaykit-halloween/lantern-standing"],
  farmstead: ["quaternius-farm/small-barn", "quaternius-village/house-2"],
}

/**
 * Every parcel dressed by its use, on a lattice turned to the parcel's own heading: crop rows on
 * fields and terraced fields, vine rows on vineyards, fruit trees in rows on orchards, woods and pines,
 * grazing animals inside a fence on pasture, rocks at the quarry, reeds by the river, grass on dunes
 * and meadows; then the places worth a walk.
 */
function dressParcels(t: Terra, pc: TerraParcels, have: (id: string) => boolean): BatchInstance[] {
  const ok = (list: string[]) => list.filter(have)
  const crops = ok(CROPS)
  const orchard = ok(ORCHARD)
  const animals = ok(ANIMALS)
  const grass = ok(GRASS)
  const trees = ok(TREES)
  const pines = ok(PINES)
  const rocks = ok(ROCKS)
  const bushes = ok(BUSHES)
  const fence = have(FENCE)
  const out: BatchInstance[] = []
  const seed = t.spec.seed
  const N = t.w * t.h
  // each parcel's box, in cells
  const box = new Map<number, [number, number, number, number]>()
  for (let i = 0; i < N; i++) {
    const id = pc.cell[i]!
    if (!id) continue
    const x = i % t.w
    const z = (i - x) / t.w
    const b = box.get(id)
    if (!b) box.set(id, [x, z, x, z])
    else {
      b[0] = Math.min(b[0], x)
      b[1] = Math.min(b[1], z)
      b[2] = Math.max(b[2], x)
      b[3] = Math.max(b[3], z)
    }
  }
  const idAt = (x: number, z: number): number => {
    const ix = Math.floor((x - t.origin[0]) / t.cell)
    const iz = Math.floor((z - t.origin[1]) / t.cell)
    if (ix < 0 || iz < 0 || ix >= t.w || iz >= t.h) return 0
    return pc.cell[iz * t.w + ix]!
  }
  const put = (piece: string | undefined, x: number, z: number, rot: number, scale = 1) => {
    if (piece) out.push({ piece, x, y: terraHeightAt(t, x, z) - 0.03, z, rot, scale })
  }
  for (const p of pc.parcels) {
    const id = p.id + 1
    const b = box.get(id)
    if (!b) continue
    const u = (k: number, a = 0, c = 0) => hash2(seed + 7000 + k, p.id * 131 + a, c)
    // the parcel's heading: rows run along it
    const ang = u(1) * Math.PI
    const ca = Math.cos(ang)
    const sa = Math.sin(ang)
    const x0 = t.origin[0] + b[0] * t.cell
    const z0 = t.origin[1] + b[1] * t.cell
    const x1 = t.origin[0] + (b[2] + 1) * t.cell
    const z1 = t.origin[1] + (b[3] + 1) * t.cell
    const cx = (x0 + x1) / 2
    const cz = (z0 + z1) / 2
    const half = Math.hypot(x1 - x0, z1 - z0) / 2
    // [across rows, along rows] pitch, and what stands at a lattice point (null: nothing)
    let pitch: [number, number] = [3, 3]
    let at: (a: number, c: number) => [string | undefined, number] | null = () => null
    const crop = crops[Math.floor(u(2) * crops.length) % crops.length]
    switch (p.use) {
      case "field":
      case "terrace-field":
        pitch = [1.5, 1.2]
        at = () => [crop, 1]
        break
      case "garden":
        pitch = [1.4, 1.4]
        at = (a, c) => (u(3, a, c) < 0.6 ? [crops[(a + c) % crops.length], 0.9] : null)
        break
      case "vineyard":
        pitch = [2.2, 1.1]
        at = () => [bushes[0], 0.55]
        break
      case "orchard":
        pitch = [4.5, 4.5]
        at = (a, c) => [orchard[(a + c) % Math.max(1, orchard.length)], 0.9 + 0.2 * u(4, a, c)]
        break
      case "wood":
        pitch = [3.4, 3.4]
        at = (a, c) =>
          u(5, a, c) < 0.75
            ? [trees[Math.floor(u(6, a, c) * trees.length) % trees.length], 0.85 + 0.45 * u(7, a, c)]
            : [bushes[1], 1]
        break
      case "pine":
        pitch = [3, 3]
        at = (a, c) =>
          u(5, a, c) < 0.7
            ? [pines[Math.floor(u(6, a, c) * pines.length) % pines.length], 0.8 + 0.5 * u(7, a, c)]
            : null
        break
      case "pasture":
        pitch = [9, 9]
        at = (a, c) =>
          u(5, a, c) < 0.45
            ? [animals[Math.floor(u(6, a, c) * animals.length) % animals.length], 1]
            : u(5, a, c) < 0.6
              ? [bushes[0], 1]
              : null
        break
      case "meadow":
      case "dune":
        pitch = [3.2, 3.2]
        at = (a, c) =>
          u(5, a, c) < (p.use === "dune" ? 0.25 : 0.4)
            ? [grass[(a * 3 + c) % Math.max(1, grass.length)], 1]
            : null
        break
      case "reeds":
        pitch = [1.8, 1.8]
        at = (a, c) => (u(5, a, c) < 0.6 ? [grass[(a + c) % Math.max(1, grass.length)], 1.2] : null)
        break
      case "quarry":
        pitch = [3.5, 3.5]
        at = (a, c) =>
          u(5, a, c) < 0.55 ? [rocks[(a + c) % Math.max(1, rocks.length)], 1.4 + u(6, a, c) * 1.6] : null
        break
    }
    const na = Math.ceil(half / pitch[0])
    const nc = Math.ceil(half / pitch[1])
    for (let a = -na; a <= na; a++)
      for (let c = -nc; c <= nc; c++) {
        const jit =
          p.use === "wood" ||
          p.use === "pine" ||
          p.use === "pasture" ||
          p.use === "meadow" ||
          p.use === "dune" ||
          p.use === "quarry" ||
          p.use === "reeds"
        const ja = jit ? (u(8, a, c) - 0.5) * pitch[0] * 0.8 : 0
        const jc = jit ? (u(9, a, c) - 0.5) * pitch[1] * 0.8 : 0
        const along = c * pitch[1] + jc
        const across = a * pitch[0] + ja
        const x = cx + ca * along - sa * across
        const z = cz + sa * along + ca * across
        // keep off the parcel's edge: the hedge line
        if (
          idAt(x, z) !== id ||
          idAt(x + 1.2, z) !== id ||
          idAt(x - 1.2, z) !== id ||
          idAt(x, z + 1.2) !== id ||
          idAt(x, z - 1.2) !== id
        )
          continue
        const got = at(a, c)
        if (!got) continue
        const rot = jit ? u(10, a, c) * Math.PI * 2 : -ang + Math.PI / 2
        put(got[0], x, z, rot, got[1])
      }
    // a fence round pastures, along the parcel's cell edges
    if (p.use === "pasture" && fence) {
      for (let iz: number = b[1]; iz <= b[3]; iz++)
        for (let ix: number = b[0]; ix <= b[2]; ix++) {
          const i = iz * t.w + ix
          if (pc.cell[i] !== id || (ix + iz) % 2) continue
          const x = t.origin[0] + (ix + 0.5) * t.cell
          const z = t.origin[1] + (iz + 0.5) * t.cell
          if (pc.cell[i - 1] !== id || pc.cell[i + 1] !== id) put(FENCE, x, z, 0, 1)
          else if (pc.cell[i - t.w] !== id || pc.cell[i + t.w] !== id) put(FENCE, x, z, Math.PI / 2, 1)
        }
    }
  }
  for (const poi of pc.pois) {
    const list = (POI_PIECES[poi.kind] ?? []).filter(have)
    list.forEach((piece, k) => {
      const x = poi.at[0] + k * 4
      const z = poi.at[1] + k * 2
      const scale = poi.kind === "lighthouse" ? 1.4 : 1
      put(piece, x, z, hash2(seed, k, 5) * Math.PI * 2, scale)
    })
  }
  return out
}

/** Footpaths as narrow ribbons over the ground. */
function trailRibbons(t: Terra, pc: TerraParcels): Float32Array {
  return roadRibbons(
    t,
    {
      anchors: [],
      roads: pc.trails.map((tr) => ({ a: 0, b: 0, line: tr.line, bridges: [], kind: "track" as const })),
      claim: new Uint8Array(0),
      area: [],
      ms: 0,
    },
    0.8,
  )
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
      if (plan) meshes.push(createSurface(stage, roadRibbons(t, plan), ROAD))
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
      const built = plan ? await buildPlaces(t, plan, catalog) : null
      if (disposed) return
      // parcels after the districts: what a place claimed but left unbuilt is farmed too
      const parcels = plan ? terraParcels(t, plan, built?.ground) : null
      if (parcels) meshes.push(createSurface(stage, trailRibbons(t, parcels), "#b89a6a"))
      if (built) {
        meshes.push(createSurface(stage, streetRibbons(t, built.streets), ROAD))
        meshes.push(createSurface(stage, squares(t, built.streets), ROAD))
      }
      const clear = (p: BatchInstance) =>
        !(plan?.roads ?? []).some((r) => r.line.some((q) => Math.hypot(q[0] - p.x, q[1] - p.z) < 3.5))
      const nature = parcels ? dressParcels(t, parcels, have) : wild(t, have)
      const pieces = nature.filter(clear)
      const clusters = built?.clusters ?? []
      batch = await createStaticBatch(
        stage,
        pieces,
        async (id) => {
          const entry = catalog.get(id)
          if (!entry) throw new Error(`terra3d: unknown piece "${id}"`)
          return loadPiece(libraryUrl(entry.files.glb))
        },
        clusters,
      )
      if (disposed) batch.dispose()
      sun.markDirty()
      text.textContent = [
        `seed ${view.spec.seed} · ${view.spec.size} m`,
        `${t.rivers.length} rivers · ${t.stats.lakes} lakes · ${t.falls.length} falls`,
        `${clusters.length} buildings · ${pieces.length} pieces`,
        ...(built?.report ?? []),
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
