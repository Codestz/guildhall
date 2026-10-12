/**
 * Step 2 of the hex world: zones, the places that become buildings, and the roads between them, all on
 * the tiles (decisions.md "Clean restart on hex").
 *
 * Places: every land tile is scored for each kind of place (flat ground, how central, water near, the
 * coast, height, forest, rock) and the best tile of each kind is taken in order, each a few tiles from
 * the ones before: the town at the heart, the harbour on the sheltered shore nearest it, the castle on a
 * high tread near it, then villages that suit the land (a farm village on open lowland, a fishing
 * village on a far beach, a mining camp at the foot of the rock, a lumber camp at a forest's edge). A
 * bigger island gets more of them.
 *
 * Each place grows over the easy tiles round its heart (flat, dry, on its own level or one step off) to
 * its size, nearest first. Roads join the places: a spanning tree plus one loop, each road the cheapest
 * tile path (a step up or down costs, a river tile is a bridge and costs more, rock and lakes are
 * closed), and later roads ride the earlier ones.
 *
 * Then every tile of a place gets a job, so it reads when built: the heart is a square; a road tile is
 * a street; a tile beside a street is a building (thinned by the place's density, never a solid block);
 * the rest are yards and gardens. Round a farm village and the town's edge, open lowland becomes fields.
 */
import { hash2 } from "../geom/noise.ts"
import type { HexIsland } from "./island.ts"
import { kindOf } from "./island.ts"

export const ZONE_KINDS = ["town", "harbour", "castle", "farm", "fishing", "mine", "lumber"] as const
export type ZoneKind = (typeof ZONE_KINDS)[number]

/** What a tile is for. */
export const TILE_USES = [
  "none",
  "square",
  "building",
  "landmark",
  "yard",
  "road",
  "bridge",
  "field",
  "dock",
  // the countryside: every land tile outside the places gets one of these (each a tile prefab later)
  "farmstead",
  "orchard",
  "pasture",
  "woods",
  "grove",
  "meadow",
  "hillside",
  "crag",
  "quarry",
  "beach",
  "bluff",
  "reeds",
  "windmill",
  "lighthouse",
  "watchtower",
  "ruins",
  "shrine",
  "campsite",
  "sawmill",
] as const
export type TileUse = (typeof TILE_USES)[number]

export interface HexZone {
  kind: ZoneKind
  /** The heart tile. */
  tile: number
  /** Tiles it holds. */
  tiles: number[]
  buildings: number
}

export interface HexRoad {
  /** Zone indices it joins. */
  a: number
  b: number
  /** Tile path, a to b. */
  tiles: number[]
}

export interface HexZones {
  zones: HexZone[]
  roads: HexRoad[]
  /** Zone index + 1 per tile (0 none). */
  zoneOf: Int16Array
  /** TILE_USES index per tile. */
  use: Uint8Array
  stats: { buildings: number; roadTiles: number; bridges: number; fields: number; ms: number }
}

/** How big each kind grows (tiles, per 1,000 land tiles, at least `min`), how built up it is, and how far apart it keeps. */
const PLAN: Record<ZoneKind, { per1k: number; min: number; density: number; apart: number }> = {
  town: { per1k: 42, min: 22, density: 0.75, apart: 0 },
  harbour: { per1k: 9, min: 6, density: 0.55, apart: 6 },
  castle: { per1k: 3, min: 3, density: 0.4, apart: 6 },
  farm: { per1k: 10, min: 6, density: 0.32, apart: 10 },
  fishing: { per1k: 7, min: 5, density: 0.4, apart: 10 },
  mine: { per1k: 5, min: 4, density: 0.4, apart: 9 },
  lumber: { per1k: 5, min: 4, density: 0.4, apart: 9 },
}

const U = Object.fromEntries(TILE_USES.map((k, i) => [k, i])) as Record<TileUse, number>

/** Cheapest tile path from `from` to any tile `goal` accepts; null if none. */
function path(
  h: HexIsland,
  from: number,
  goal: (i: number) => boolean,
  cost: (a: number, b: number) => number,
): number[] | null {
  const g = h.grid
  const dist = new Float64Array(g.size).fill(Infinity)
  const prev = new Int32Array(g.size).fill(-1)
  const heap: [number, number][] = []
  const push = (d: number, i: number) => {
    heap.push([d, i])
    let j = heap.length - 1
    while (j > 0) {
      const p = (j - 1) >> 1
      if (heap[p]![0] <= d) break
      ;[heap[p], heap[j]] = [heap[j]!, heap[p]!]
      j = p
    }
  }
  const pop = (): [number, number] => {
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
  push(0, from)
  dist[from] = 0
  while (heap.length) {
    const [d, i] = pop()
    if (d > dist[i]!) continue
    if (i !== from && goal(i)) {
      const out = [i]
      let k = i
      while (prev[k]! >= 0) {
        k = prev[k]!
        out.push(k)
      }
      return out.reverse()
    }
    for (const j of g.neighbours(i)) {
      if (j < 0) continue
      const c = cost(i, j)
      if (!Number.isFinite(c)) continue
      if (d + c < dist[j]!) {
        dist[j] = d + c
        prev[j] = i
        push(d + c, j)
      }
    }
  }
  return null
}

export function hexZones(h: HexIsland): HexZones {
  const t0 = performance.now()
  const g = h.grid
  const N = g.size
  const seed = h.spec.seed
  const kind = (i: number) => kindOf(h, i)
  const dry = (i: number) => {
    const k = kind(i)
    return k !== "sea" && k !== "shallows" && k !== "lake" && k !== "river" && k !== "rock"
  }
  const flatness = (i: number) => {
    let n = 0
    for (const j of g.neighbours(i)) if (j >= 0 && dry(j) && h.level[j] === h.level[i]) n++
    return n / 6
  }
  // steps from water (river, lake) and from forest and rock, for scoring
  const stepsFrom = (src: (i: number) => boolean): Int16Array => {
    const d = new Int16Array(N).fill(999)
    const q: number[] = []
    for (let i = 0; i < N; i++)
      if (src(i)) {
        d[i] = 0
        q.push(i)
      }
    for (let k = 0; k < q.length; k++) {
      const i = q[k]!
      for (const j of g.neighbours(i))
        if (j >= 0 && d[j]! > d[i]! + 1) {
          d[j] = d[i]! + 1
          q.push(j)
        }
    }
    return d
  }
  const toWater = stepsFrom((i) => kind(i) === "river" || kind(i) === "lake")
  const toForest = stepsFrom((i) => kind(i) === "forest")
  const toRock = stepsFrom((i) => kind(i) === "rock")
  let land = 0
  let topLevel = 1
  for (let i = 0; i < N; i++)
    if (dry(i)) {
      land++
      topLevel = Math.max(topLevel, h.level[i]!)
    }
  const ring = (i: number) => g.ring(i)

  const zones: HexZone[] = []
  const far = (i: number, apart: number) =>
    zones.every((z) => {
      const dq = g.q[i]! - g.q[z.tile]!
      const dr = g.r[i]! - g.r[z.tile]!
      return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2 >= apart
    })
  const dist = (i: number, j: number) => {
    const dq = g.q[i]! - g.q[j]!
    const dr = g.r[i]! - g.r[j]!
    return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2
  }
  const score = (k: ZoneKind, i: number): number => {
    if (!dry(i)) return -1
    const f = flatness(i)
    const L = h.level[i]!
    const town = zones[0]?.tile
    switch (k) {
      case "town":
        return f >= 0.8 && L <= 3 ? f * 2 - ring(i) / 12 - Math.abs(toWater[i]! - 2) * 0.15 : -1
      case "harbour": {
        if (kind(i) !== "sand" || town === undefined) return -1
        let land = 0
        for (const j of g.neighbours(i)) if (j >= 0 && dry(j)) land++
        return land / 6 - dist(i, town) / 15
      }
      case "castle":
        return town !== undefined && L >= 3 && dist(i, town) >= 4 && dist(i, town) <= 14
          ? L + f - dist(i, town) / 8
          : -1
      case "farm":
        return f >= 0.8 && L <= 2 && toForest[i]! >= 2 && kind(i) !== "sand"
          ? f + (town === undefined ? 0 : dist(i, town) / 40)
          : -1
      case "fishing":
        return kind(i) === "sand" && town !== undefined ? dist(i, town) / 20 + flatness(i) : -1
      case "mine":
        return toRock[i]! >= 1 && toRock[i]! <= 2 && f >= 0.5 ? 2 - toRock[i]! * 0.3 + f : -1
      case "lumber":
        return kind(i) !== "forest" && toForest[i]! === 1 && f >= 0.6
          ? f + (town === undefined ? 0 : dist(i, town) / 40)
          : -1
    }
  }
  const order: ZoneKind[] = ["town", "harbour", "castle", "farm", "fishing", "mine", "lumber"]
  // a bigger island gets a second farm and fishing village
  if (land > 1400) order.push("farm", "fishing")
  if (land > 2200) order.push("farm", "lumber")
  for (const k of order) {
    let best = -1
    let bs = -1e9
    for (let i = 0; i < N; i++) {
      const s = score(k, i)
      if (s < -0.5 || s <= bs || !far(i, PLAN[k].apart || 6)) continue
      best = i
      bs = s
    }
    if (best >= 0) zones.push({ kind: k, tile: best, tiles: [], buildings: 0 })
  }

  // ---- each place grows over easy tiles round its heart ----
  const zoneOf = new Int16Array(N)
  for (const [zi, z] of zones.entries()) {
    const want = Math.max(PLAN[z.kind].min, Math.round((PLAN[z.kind].per1k * land) / 1000))
    const lvl = h.level[z.tile]!
    const queue = [z.tile]
    const seen = new Set(queue)
    for (let k = 0; k < queue.length && z.tiles.length < want; k++) {
      const i = queue[k]!
      if (zoneOf[i] || !dry(i) || kind(i) === "cliff") continue
      // a place keeps to its own level or one step off it
      if (Math.abs(h.level[i]! - lvl) > 1) continue
      zoneOf[i] = zi + 1
      z.tiles.push(i)
      const nb = [...g.neighbours(i)].filter((j) => j >= 0 && !seen.has(j))
      // grow round, not in a line: nearer the heart first, with a little noise
      nb.sort(
        (a, b) =>
          dist(a, z.tile) + hash2(seed + 3, a, zi) * 0.9 - dist(b, z.tile) - hash2(seed + 3, b, zi) * 0.9,
      )
      for (const j of nb) {
        seen.add(j)
        queue.push(j)
      }
    }
  }

  // ---- roads: spanning tree + one loop, cheapest tile paths ----
  const use = new Uint8Array(N)
  const roadCost = (a: number, b: number): number => {
    const k = kind(b)
    if (k === "sea" || k === "shallows" || k === "rock" || k === "lake") return Infinity
    const climb = Math.abs(h.level[b]! - h.level[a]!)
    if (climb > 1) return Infinity
    let c = 1 + climb * 2.5
    if (k === "river") c += 6
    if (k === "forest") c += 1.2
    if (k === "cliff" || k === "sand") c += 0.8
    if (use[b] === U.road || use[b] === U.bridge) c *= 0.35
    return c
  }
  const pairs: [number, number, number][] = []
  for (let a = 0; a < zones.length; a++)
    for (let b = a + 1; b < zones.length; b++) pairs.push([a, b, dist(zones[a]!.tile, zones[b]!.tile)])
  pairs.sort((p, q) => p[2] - q[2])
  const parent = zones.map((_, i) => i)
  const find = (i: number): number => {
    let r = i
    while (parent[r] !== r) r = parent[r]!
    return r
  }
  const links: [number, number][] = []
  const spare: [number, number][] = []
  for (const [a, b] of pairs) {
    if (find(a) !== find(b)) {
      parent[find(a)] = find(b)
      links.push([a, b])
    } else spare.push([a, b])
  }
  if (spare[0]) links.push(spare[0])
  links.sort((p, q) => Number(p[0] !== 0) - Number(q[0] !== 0))
  const roads: HexRoad[] = []
  for (const [a, b] of links) {
    const target = zones[b]!.tile
    const tiles = path(h, zones[a]!.tile, (i) => i === target, roadCost)
    if (!tiles) continue
    roads.push({ a, b, tiles })
    for (const i of tiles) if (use[i] !== U.square) use[i] = kind(i) === "river" ? U.bridge : U.road
  }
  // town streets: from the square out through the town, a spoke each way the town reaches
  const town = zones.find((z) => z.kind === "town")
  if (town) {
    const ti = zones.indexOf(town) + 1
    for (let d = 0; d < 6; d++) {
      let i: number = town.tile
      const street = [i]
      for (let k = 0; k < 12; k++) {
        const j = g.neighbours(i)[(d + (hash2(seed + 9, k, d) < 0.25 ? 1 : 0)) % 6]!
        if (j < 0 || zoneOf[j] !== ti || kind(j) === "river") break
        if (use[j] !== U.bridge) use[j] = U.road
        street.push(j)
        i = j
      }
      if (street.length > 1) roads.push({ a: ti - 1, b: ti - 1, tiles: street })
    }
  }

  // ---- every tile of a place gets a job ----
  for (const [zi, z] of zones.entries()) {
    use[z.tile] = z.kind === "castle" ? U.landmark : U.square
    const P = PLAN[z.kind]
    for (const i of z.tiles) {
      if (use[i]) continue
      const byRoad = [...g.neighbours(i)].some((j) => j >= 0 && (use[j] === U.road || use[j] === U.square))
      const built = [...g.neighbours(i)].filter((j) => j >= 0 && use[j] === U.building).length
      // a building fronts a street; never a solid block (at most two built neighbours)
      if (byRoad && built <= 2 && hash2(seed + 21, i, zi) < P.density + 0.25) use[i] = U.building
      else if (!byRoad && built <= 1 && hash2(seed + 23, i, zi) < P.density * 0.45) use[i] = U.building
      else use[i] = U.yard
    }
    // docks: the harbour's and the fishing village's sea side
    if (z.kind === "harbour" || z.kind === "fishing")
      for (const i of z.tiles)
        for (const j of g.neighbours(i))
          if (j >= 0 && kind(j) === "shallows" && !use[j] && hash2(seed + 27, j, zi) < 0.5) use[j] = U.dock
    z.buildings = z.tiles.filter((i) => use[i] === U.building).length
  }
  // fields round the farm villages and the town's edge
  for (const z of zones) {
    if (z.kind !== "farm" && z.kind !== "town") continue
    const R = z.kind === "farm" ? 5 : 7
    for (let i = 0; i < N; i++) {
      if (use[i] || zoneOf[i] || !dry(i)) continue
      const k = kind(i)
      if (k !== "grass" && k !== "meadow") continue
      const d = dist(i, z.tile)
      if (d > R || d < 2) continue
      if (hash2(seed + 31, g.q[i]!, g.r[i]!) < (z.kind === "farm" ? 0.85 : 0.5)) use[i] = U.field
    }
  }
  // ---- the countryside: every land tile gets content, so nothing is bare ----
  const toRoad = stepsFrom((i) => use[i] === U.road || use[i] === U.bridge)
  const toZone = stepsFrom((i) => zoneOf[i]! > 0)
  const free = (i: number) => !use[i] && !zoneOf[i]
  const h1 = (k: number, i: number) => hash2(seed + 100 + k, g.q[i]!, g.r[i]!)
  // landmarks first, one each where it suits best
  const pick = (u: TileUse, score: (i: number) => number) => {
    let best = -1
    let bs = -1e9
    for (let i = 0; i < N; i++) {
      if (!free(i) || !dry(i)) continue
      const sc = score(i)
      if (sc > bs && zones.every((zz) => dist(i, zz.tile) >= 3)) {
        bs = sc
        best = i
      }
    }
    if (best >= 0 && bs > -1e8) use[best] = U[u]
  }
  const townTile = zones[0]?.tile ?? 0
  pick("lighthouse", (i) => (kind(i) === "cliff" ? dist(i, townTile) + h1(1, i) : -1e9))
  pick("watchtower", (i) => (kind(i) === "hill" ? h.level[i]! * 2 - dist(i, townTile) / 6 + h1(2, i) : -1e9))
  pick("ruins", (i) => (kind(i) === "forest" ? toZone[i]! + toRoad[i]! * 0.5 + h1(3, i) : -1e9))
  pick("shrine", (i) =>
    kind(i) === "meadow" || kind(i) === "grass" ? toZone[i]! * 0.6 + h1(4, i) * 3 - toRoad[i]! * 0.3 : -1e9,
  )
  pick("campsite", (i) => {
    let lake = 0
    for (const j of g.neighbours(i)) if (j >= 0 && kind(j) === "lake") lake++
    return lake ? lake + h1(5, i) : -1e9
  })
  for (let n = 0; n < Math.max(1, Math.round(land / 900)); n++)
    pick("windmill", (i) => {
      let fields = 0
      for (const j of g.neighbours(i)) if (j >= 0 && use[j] === U.field) fields++
      return fields ? fields + h.level[i]! * 0.5 + h1(6 + n, i) : -1e9
    })
  const lumber = zones.find((zz) => zz.kind === "lumber")
  if (lumber) pick("sawmill", (i) => (toWater[i]! <= 1 ? -dist(i, lumber.tile) : -1e9))
  // farmsteads along the roads in the open country, a few tiles apart
  const farms: number[] = []
  for (let i = 0; i < N; i++) {
    if (!free(i) || toRoad[i] !== 1 || toZone[i]! < 3) continue
    const k = kind(i)
    if (k !== "grass" && k !== "meadow") continue
    if (farms.some((f) => dist(f, i) < 4) || h1(10, i) > 0.55) continue
    use[i] = U.farmstead
    farms.push(i)
  }
  // fields and orchards round each farmstead
  for (const f of farms)
    for (const j of g.neighbours(f))
      if (j >= 0 && free(j) && (kind(j) === "grass" || kind(j) === "meadow"))
        use[j] = h1(11, j) < 0.65 ? U.field : U.orchard
  // the rest, by the ground under it
  for (let i = 0; i < N; i++) {
    if (!free(i) || !dry(i)) {
      if (free(i) && kind(i) === "rock") use[i] = toZone[i]! <= 2 ? U.quarry : U.crag
      continue
    }
    const k = kind(i)
    const near = toZone[i]! <= 3 || toRoad[i]! <= 1
    let u: TileUse
    if (k === "forest") u = h1(20, i) < 0.82 ? "woods" : "grove"
    else if (k === "sand") u = "beach"
    else if (k === "cliff") u = "bluff"
    else if (k === "hill") u = h1(21, i) < 0.55 ? "hillside" : h1(22, i) < 0.6 ? "pasture" : "grove"
    else if (toWater[i] === 1 && h1(23, i) < 0.45) u = "reeds"
    else if (near) u = h1(24, i) < 0.4 ? "field" : h1(25, i) < 0.55 ? "pasture" : "orchard"
    else u = h1(26, i) < 0.4 ? "meadow" : h1(27, i) < 0.55 ? "grove" : h1(28, i) < 0.6 ? "pasture" : "meadow"
    use[i] = U[u]
  }

  let buildings = 0
  let roadTiles = 0
  let bridges = 0
  let fields = 0
  for (let i = 0; i < N; i++) {
    if (use[i] === U.building || use[i] === U.farmstead) buildings++
    if (use[i] === U.road) roadTiles++
    if (use[i] === U.bridge) bridges++
    if (use[i] === U.field) fields++
  }
  return {
    zones,
    roads,
    zoneOf,
    use,
    stats: { buildings, roadTiles, bridges, fields, ms: Math.round(performance.now() - t0) },
  }
}

/** The use name of tile i. */
export const useOf = (z: HexZones, i: number): TileUse => TILE_USES[z.use[i]!]!
