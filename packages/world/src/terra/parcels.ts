/**
 * Step 3 of the terrain-first island: no land left as bare terrain. Everything the places of step 2
 * did not claim is cut into parcels and each parcel is given a use that suits where it lies.
 *
 * Parcels: seeds on a jittered grid (closer on the terraces, so treads cut into strips), grown all at
 * once over easy ground; roads, rivers, the claimed places and the risers between terraces are walls,
 * so parcel edges follow the roads, the water and the steps of the hill, as fields do.
 *
 * Use, by where a parcel lies: terraces near the town hold vineyards and terraced crops, higher treads
 * pine woods and sheep pasture, the top tread by the crag a quarry; the lowland round the town gardens
 * and orchards, further out fields, pasture and woods; the river banks reeds and meadow; the shore
 * dunes. Then the places worth a walk (a lookout on the hill, the quarry, a shrine in the woods, a
 * lighthouse on the most exposed point) each get a trail from the nearest road, the hill's winding
 * along the treads.
 */
import { type CostGrid, gridAStar, smoothRoute, stringPull } from "../geom/route.ts"
import type { Vec2 } from "../geom/vec.ts"
import { TERRA_CRAG, TERRA_WATER, type Terra } from "./island.ts"
import type { LandmarkKind } from "./landmarks.ts"
import { fbm, hash2 } from "./noise.ts"
import type { TerraPlan } from "./plan.ts"

export const PARCEL_USES = [
  "garden",
  "orchard",
  "field",
  "pasture",
  "meadow",
  "wood",
  "pine",
  "vineyard",
  "terrace-field",
  "quarry",
  "reeds",
  "dune",
] as const
export type ParcelUse = (typeof PARCEL_USES)[number]

export interface Parcel {
  id: number
  use: ParcelUse
  /** Centroid, world metres. */
  at: Vec2
  areaM2: number
  /** Mean terrace level (0 lowland). */
  level: number
}

export type PoiKind = "lookout" | "quarry" | "shrine" | "lighthouse" | "farmstead" | LandmarkKind

export interface TerraPoi {
  kind: PoiKind
  at: Vec2
}

export interface TerraTrail {
  line: Vec2[]
  to: PoiKind
}

export interface TerraParcels {
  /** Parcel id + 1 per cell (0: none: a place's ground, a road, water, a riser). */
  cell: Int32Array
  parcels: Parcel[]
  pois: TerraPoi[]
  trails: TerraTrail[]
  /** Share of the dry land that has a job (a place, a parcel, a road). */
  covered: number
  ms: number
}

/**
 * `built`, when given, is the ground the districts really use (`districtGround`): what a place claimed
 * but left unbuilt is parcelled too. Without it the whole of every claim is the place's.
 */
export function terraParcels(
  t: Terra,
  plan: TerraPlan,
  built?: Uint8Array,
  /** Places already standing (the landmarks) that want a trail too. */
  extra: readonly TerraPoi[] = [],
): TerraParcels {
  const t0 = performance.now()
  const { w, h, cell, origin, water, slope, coastDist, terraceLevel, height, spec } = t
  const N = w * h
  const seed = spec.seed
  const px = (i: number): number => origin[0] + ((i % w) + 0.5) * cell
  const pz = (i: number): number => origin[1] + (Math.floor(i / w) + 0.5) * cell
  const cellOf = (p: Vec2): number =>
    Math.max(
      0,
      Math.min(N - 1, Math.floor((p[1] - origin[1]) / cell) * w + Math.floor((p[0] - origin[0]) / cell)),
    )

  // roads as a raster: walls between parcels
  const road = new Uint8Array(N)
  for (const r of plan.roads)
    for (let k = 1; k < r.line.length; k++) {
      const a = r.line[k - 1]!
      const b = r.line[k]!
      const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (cell * 0.5))
      for (let j = 0; j <= n; j++) {
        const x = a[0] + ((b[0] - a[0]) * j) / n
        const z = a[1] + ((b[1] - a[1]) * j) / n
        road[cellOf([x, z])] = 1
      }
    }
  const open = (i: number): boolean =>
    water[i] === TERRA_WATER.land &&
    !(built ? built[i] : plan.claim[i]) &&
    !road[i] &&
    terraceLevel[i] !== TERRA_CRAG &&
    slope[i]! <= 0.6

  // ---- seeds and growth ----
  const seeds: number[] = []
  const pitchLow = 24
  const pitchHill = 15
  for (let z = origin[1]; z < origin[1] + h * cell; z += pitchHill)
    for (let x = origin[0]; x < origin[0] + w * cell; x += pitchHill) {
      const jx = x + (hash2(seed + 51, Math.round(x), Math.round(z)) - 0.5) * pitchHill * 0.8
      const jz = z + (hash2(seed + 52, Math.round(x), Math.round(z)) - 0.5) * pitchHill * 0.8
      const i = cellOf([jx, jz])
      if (!open(i)) continue
      // the lowland keeps only the seeds on the coarser lattice: bigger fields
      if (
        terraceLevel[i] === 0 &&
        hash2(seed + 53, Math.round(x), Math.round(z)) > (pitchHill / pitchLow) ** 2
      )
        continue
      seeds.push(i)
    }
  const owner = new Int32Array(N)
  const dist = new Float64Array(N).fill(Infinity)
  const heap: [number, number, number][] = []
  const push = (d: number, i: number, k: number): void => {
    heap.push([d, i, k])
    let j = heap.length - 1
    while (j > 0) {
      const p = (j - 1) >> 1
      if (heap[p]![0] <= d) break
      ;[heap[p], heap[j]] = [heap[j]!, heap[p]!]
      j = p
    }
  }
  const pop = (): [number, number, number] => {
    const top = heap[0]!
    const last = heap.pop()!
    if (heap.length) {
      heap[0] = last
      let j = 0
      for (;;) {
        const l = 2 * j + 1
        const r = l + 1
        let m = j
        if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l
        if (r < heap.length && heap[r]![0] < heap[m]![0]) m = r
        if (m === j) break
        ;[heap[m], heap[j]] = [heap[j]!, heap[m]!]
        j = m
      }
    }
    return top
  }
  seeds.forEach((i, k) => {
    dist[i] = 0
    push(0, i, k)
  })
  while (heap.length) {
    const [d, i, k] = pop()
    if (owner[i] || d > dist[i]!) continue
    owner[i] = k + 1
    const x = i % w
    const y = (i - x) / w
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const xx = x + dx
      const yy = y + dy
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
      const j = yy * w + xx
      if (owner[j] || !open(j) || terraceLevel[j] !== terraceLevel[i]) continue
      const nd = d + cell * (1 + 6 * slope[j]!)
      if (nd < dist[j]!) {
        dist[j] = nd
        push(nd, j, k)
      }
    }
  }

  // ---- per parcel: where it lies ----
  const P = seeds.length
  const area = new Float64Array(P)
  const sx = new Float64Array(P)
  const sz = new Float64Array(P)
  const lvl = new Float64Array(P)
  const coast = new Float64Array(P)
  const wet = new Float64Array(P)
  const touchesTown = new Uint8Array(P)
  const touchesRoad = new Uint8Array(P)
  const townIdx = plan.anchors.findIndex((a) => a.kind === "town") + 1
  for (let i = 0; i < N; i++) {
    const o = owner[i]!
    if (!o) continue
    const k = o - 1
    area[k] = area[k]! + cell * cell
    sx[k] = sx[k]! + px(i)
    sz[k] = sz[k]! + pz(i)
    lvl[k] = lvl[k]! + terraceLevel[i]!
    coast[k] = coast[k]! + coastDist[i]!
    const x = i % w
    for (const j of [i - 1, i + 1, i - w, i + w]) {
      if (j < 0 || j >= N || Math.abs((j % w) - x) > 1) continue
      if (water[j] === TERRA_WATER.river || water[j] === TERRA_WATER.lake) wet[k] = 1
      if (townIdx && plan.claim[j] === townIdx) touchesTown[k] = 1
      if (road[j]) touchesRoad[k] = 1
    }
  }
  let levels = 1
  for (let i = 0; i < N; i++) if (terraceLevel[i] !== TERRA_CRAG) levels = Math.max(levels, terraceLevel[i]!)
  const anchorOf = (kind: string) => plan.anchors.find((a) => a.kind === kind)
  const town = anchorOf("town")
  const farm = anchorOf("farm")
  const near = (a: { at: Vec2 } | undefined, p: Vec2) =>
    a ? Math.hypot(a.at[0] - p[0], a.at[1] - p[1]) : Infinity
  let crag: Vec2 | null = null
  {
    let cx = 0
    let cz = 0
    let n = 0
    for (let i = 0; i < N; i++)
      if (terraceLevel[i] === TERRA_CRAG) {
        cx += px(i)
        cz += pz(i)
        n++
      }
    if (n) crag = [cx / n, cz / n]
  }

  const parcels: Parcel[] = []
  let quarry = -1
  for (let k = 0; k < P; k++) {
    if (!area[k]) continue
    const n = area[k]! / (cell * cell)
    const at: Vec2 = [sx[k]! / n, sz[k]! / n]
    const L = lvl[k]! / n
    const D = coast[k]! / n
    const u = (s: number) => hash2(seed + 300 + s, k, 17)
    const wood = fbm(seed + 901, at[0] / 75, at[1] / 75, 3)
    let use: ParcelUse
    if (L >= 0.5) {
      const top = L >= levels - 1.5
      if (quarry < 0 && top && crag && Math.hypot(at[0] - crag[0], at[1] - crag[1]) < 70 && area[k]! > 250) {
        use = "quarry"
        quarry = parcels.length
      } else if (near(town, at) < 110 && L <= 2.5) use = u(1) < 0.55 ? "vineyard" : "terrace-field"
      else if (top) use = u(1) < 0.65 ? "pine" : "pasture"
      else use = u(1) < 0.4 ? "terrace-field" : u(1) < 0.7 ? "pasture" : "pine"
    } else if (D < 14) use = u(1) < 0.6 ? "dune" : "meadow"
    else if (wet[k] && u(2) < 0.45) use = "reeds"
    else if (touchesTown[k]) use = u(1) < 0.5 ? "garden" : "orchard"
    else if (near(farm, at) < 90) use = u(1) < 0.75 ? "field" : "orchard"
    else if (wood > 0.15) use = "wood"
    else if (near(town, at) < 140) use = u(1) < 0.55 ? "field" : u(1) < 0.7 ? "orchard" : "pasture"
    else use = u(1) < 0.4 ? "pasture" : u(1) < 0.6 ? "meadow" : u(1) < 0.8 ? "wood" : "field"
    parcels.push({ id: k, use, at, areaM2: area[k]!, level: L })
  }
  const byId = new Map(parcels.map((p) => [p.id, p]))

  // ---- places worth a walk ----
  const pois: TerraPoi[] = []
  if (crag) {
    // the lookout: the open top-tread cell nearest the crag
    let best = -1
    let bd = Infinity
    for (let i = 0; i < N; i++) {
      if (!owner[i] || terraceLevel[i]! < levels - 1) continue
      const d = Math.hypot(px(i) - crag[0], pz(i) - crag[1])
      if (d < bd) {
        bd = d
        best = i
      }
    }
    if (best >= 0) pois.push({ kind: "lookout", at: [px(best), pz(best)] })
  }
  if (quarry >= 0) pois.push({ kind: "quarry", at: parcels[quarry]!.at })
  const woods = parcels.filter((p) => p.use === "wood").sort((a, b) => near(town, b.at) - near(town, a.at))
  if (woods[0]) pois.push({ kind: "shrine", at: woods[0].at })
  if (!extra.some((e) => e.kind === "lighthouse")) {
    // the lighthouse: the dry cell furthest from the island's middle, on high coast
    let best = -1
    let bd = 0
    for (let i = 0; i < N; i++) {
      if (water[i] !== TERRA_WATER.land || coastDist[i]! > 8 || height[i]! < 2.5 || plan.claim[i]) continue
      const d = Math.hypot(px(i), pz(i))
      if (d > bd) {
        bd = d
        best = i
      }
    }
    if (best >= 0) pois.push({ kind: "lighthouse", at: [px(best), pz(best)] })
  }
  for (const p of parcels)
    if (
      (p.use === "field" || p.use === "pasture" || p.use === "orchard") &&
      hash2(seed + 77, p.id, 3) < 0.35
    ) {
      const o = owner[cellOf(p.at)]
      if (o && touchesRoad[p.id]) pois.push({ kind: "farmstead", at: p.at })
    }

  // ---- trails: footpaths from the nearest road; on the hill they keep to the treads ----
  const cost = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    const k = water[i]
    if (k === TERRA_WATER.sea || k === TERRA_WATER.stack || k === TERRA_WATER.lake) cost[i] = Infinity
    else if (k === TERRA_WATER.river) cost[i] = 20
    else if (road[i]) cost[i] = 0.6
    else cost[i] = 1 + 14 * Math.min(slope[i]!, 1.5) + (terraceLevel[i] === TERRA_CRAG ? 3 : 0)
  }
  const grid: CostGrid = { w, h, cost, cell, origin: [origin[0], origin[1]] }
  const trails: TerraTrail[] = []
  pois.push(...extra)
  for (const poi of pois) {
    if (poi.kind === "farmstead") continue
    const from = cellOf(poi.at)
    const cells = gridAStar(grid, from, (i) => road[i] === 1)
    if (!cells || cells.length < 3) continue
    const line = smoothRoute(stringPull(cells, grid), grid, { radius: 10, step: 3, snap: 0.5 })
    trails.push({ line, to: poi.kind })
    for (const c of cells) if (Number.isFinite(cost[c]!)) cost[c] = Math.min(cost[c]!, 0.8)
  }

  // ---- how much dry land has a job ----
  let dry = 0
  let used = 0
  for (let i = 0; i < N; i++) {
    if (water[i] !== TERRA_WATER.land) continue
    dry++
    if (
      (built ? built[i] : plan.claim[i]) ||
      owner[i] ||
      road[i] ||
      slope[i]! > 0.6 ||
      terraceLevel[i] === TERRA_CRAG
    )
      used++
  }
  const cellOut = new Int32Array(N)
  for (let i = 0; i < N; i++) if (owner[i] && byId.has(owner[i]! - 1)) cellOut[i] = owner[i]!
  return {
    cell: cellOut,
    parcels,
    pois,
    trails,
    covered: dry ? used / dry : 0,
    ms: Math.round(performance.now() - t0),
  }
}
