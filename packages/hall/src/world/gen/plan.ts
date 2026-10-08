import { type Cell, cellToWorld } from "../lands.ts"
import type { Biome } from "./biomes.ts"
import { cellAt, key, neighbours, noise, rings, rng, step, unkey } from "./hex.ts"
import type { Folder, RepoShape } from "./repo.ts"
import { contiguous } from "./tiles.ts"

/**
 * An island planned from a repo's shape, before any tile is chosen: which hex is land, which
 * district holds it, and what grows there, written in lands.ts' own MAP legend (~ sea, = road,
 * . meadow, f/F woods, h knoll, H foothill, m/M mountain, w/d fields, v village lot, s site ground)
 * so the adapter (dress.ts) can tile it exactly the way lands.ts tiles the hand-drawn map.
 *
 * The keep stands at the origin, as on the hand-drawn map (lands.ts' K block: Room, the stations
 * and the hall's aisles are placed there), its gate opening south down a short avenue onto the
 * harbour (the root's own files): the hub, two hexes south, its quay running on south into a bay
 * nothing may fill. The keep's block and the ring of land round it are reserved before anything
 * grows: level harbour ground no district, road or shore may take. The top-level folders sit round it in sectors sized by their land, each grown
 * hex by hex from a seed (its square, where its road ends), so every district is one piece. Roads
 * run from the hub to every square (Dijkstra over the hexes, reusing roads already laid; a road over
 * sea is a causeway and makes land). Then the shore is smoothed until every land hex meets the sea
 * along one run of at most four sides (what the pack's coast tiles can draw).
 */

export interface PlanDistrict {
  folder: Folder
  biome: Biome
  /** Hexes it was meant to grow to: ∝ log of its bytes. */
  quota: number
  /** Where its road ends. */
  square: Cell
  /** Its landmark's hex, beside the square (none if the shore left no room). */
  site?: Cell
  /** Land hexes it holds in the end (road hexes included). */
  hexes: number
  /** Elevation from its folder depth: 0 level, 1 foothills, 2 mountains. */
  level: 0 | 1 | 2
  /** 0–1: how built-up or wooded its hexes are, from files per hex. */
  density: number
}

export interface PlanHex {
  char: string
  district: number
}

export interface IslandPlan {
  hash: number
  seed: number
  /** Every land hex by key ("q,line"). Anything missing is sea. */
  land: Map<string, PlanHex>
  /** [0] is the harbour (the root), then the folders in RepoShape order. */
  districts: PlanDistrict[]
  /** The avenue (hub → the gate's apron), then hub → each square, hex by hex; consecutive hexes are neighbours. */
  roads: Cell[][]
  /** The hub, and the sea hex its quay runs out over (straight south). */
  hub: Cell
  quay: Cell
  /** The road hex at the keep's gate: drawn, opening south onto the avenue, not walked (lands.ts' [0, 2] stub). */
  gate: Cell
  /** Rings from the hub that hold all the land. */
  radius: number
}

export const HUB: Cell = [0, 6]
const QUAY: Cell = [0, 8]
/** The gate's apron, and the avenue's one hex between it and the hub (lands.ts' [0, 2] and OUT). */
const GATE: Cell = [0, 2]
const AVENUE: Cell = [0, 4]
/** The keep's block: lands.ts' K hexes, and the V lots either side of its gate. */
export const KEEP: ReadonlyMap<string, "K" | "V"> = new Map([
  ...(
    [
      [-2, -2],
      [0, -2],
      [2, -2],
      [-1, -1],
      [1, -1],
      [-2, 0],
      [0, 0],
      [2, 0],
      [-1, 1],
      [1, 1],
      [-2, 2],
      [2, 2],
    ] as const
  ).map(([q, line]) => [`${q},${line}`, "K"] as const),
  ["-1,3", "V"],
  ["1,3", "V"],
])
/** Half-angle of the bay kept open south of the hub: the quay always faces open sea. */
const BAY = (35 * Math.PI) / 180
/** World radius of a round patch of n hexes (a hex is 86.6 square units). */
const patch = (n: number): number => 5.25 * Math.sqrt(n)

/** Land ∝ code size, log-scaled: 1 KB ≈ 7 hexes, 100 KB ≈ 25, 10 MB ≈ 47. */
export function quotaOf(bytes: number): number {
  return Math.round(4 + 3.2 * Math.log2(1 + bytes / 1024))
}

function levelOf(folder: Folder): 0 | 1 | 2 {
  if (folder.biome === "harbour") return 0
  const base = folder.depth < 1.6 ? 0 : folder.depth < 3 ? 1 : 2
  if (folder.biome === "quarry") return Math.min(2, base + 1) as 1 | 2
  if (folder.biome === "library") return Math.max(1, base) as 1 | 2
  return base
}

const [HUB_X, HUB_Z] = cellToWorld(HUB)
const inBay = (cell: Cell): boolean => {
  if (cell[0] === HUB[0] && cell[1] === HUB[1]) return false
  const [x, z] = cellToWorld(cell)
  return z - HUB_Z > 0 && Math.abs(x - HUB_X) <= (z - HUB_Z) * Math.tan(BAY)
}

/** The keep's block, its gate and avenue, and the ring of land round them: the harbour's, kept level and clear. */
const RESERVED: ReadonlySet<string> = (() => {
  const out = new Set<string>([...KEEP.keys(), key(GATE), key(AVENUE)])
  for (const id of KEEP.keys()) for (const next of neighbours(unkey(id))) if (!inBay(next)) out.add(key(next))
  out.delete(key(HUB))
  return out
})()

/**
 * How far the land may reach from the origin along x or z, world units: the shore's distance bake
 * covers ±120 (scene/nature/shore.ts SHORE.half), and a coast tile's sand runs to its hex's edge.
 */
export const LAND_HALF = 118
/** Each try shrinks every district's land by this much until the island fits. */
const SHRINK = 0.85
/** The smallest share of its land a district is shrunk to (a giant monorepo still gets an island). */
const SMALLEST = 0.3

/** How far a plan's land reaches along x or z, to its hexes' edges. */
export function extentOf(plan: IslandPlan): number {
  let extent = 0
  for (const id of plan.land.keys()) {
    const [x, z] = cellToWorld(unkey(id))
    extent = Math.max(extent, Math.abs(x) + HEX_RADIUS, Math.abs(z) + HEX_APOTHEM)
  }
  return extent
}
const HEX_RADIUS = 10 / Math.sqrt(3)
const HEX_APOTHEM = 5

/** The island for a repo's shape, its land shrunk until it fits inside ±LAND_HALF. */
export function fitIsland(shape: RepoShape, seed: number): IslandPlan {
  let plan = planIsland(shape, seed)
  for (let scale = SHRINK; extentOf(plan) > LAND_HALF && scale >= SMALLEST; scale *= SHRINK)
    plan = planIsland(shape, seed, scale)
  return plan
}

export function planIsland(shape: RepoShape, seed: number, scale = 1): IslandPlan {
  const random = rng(seed)
  const folders = [shape.root, ...shape.folders]
  const districts: PlanDistrict[] = folders.map((folder, i) => {
    const own = Math.max(3, Math.round(quotaOf(folder.bytes) * scale))
    const quota = i === 0 ? Math.max(7, own) : own
    return {
      folder,
      biome: folder.biome,
      quota,
      square: HUB,
      hexes: 0,
      level: levelOf(folder),
      density: Math.min(0.85, Math.max(0.15, Math.log2(1 + folder.files / quota) / 4)),
    }
  })

  // ---- Seeds: the folders round the hub in sectors ∝ their land, the bay left open ----
  const order = districts.slice(1).map((_, i) => i + 1)
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[order[i], order[j]] = [order[j] ?? 0, order[i] ?? 0]
  }
  const total = order.reduce((sum, i) => sum + (districts[i]?.quota ?? 0), 0)
  const rootRadius = patch(districts[0]?.quota ?? 7)
  const seeded = new Set([key(HUB), ...RESERVED])
  let swept = 0
  for (const i of order) {
    const district = districts[i]
    if (!district) continue
    const angle = BAY + (2 * Math.PI - 2 * BAY) * ((swept + district.quota / 2) / total)
    swept += district.quota
    let distance = rootRadius + patch(district.quota) + 4
    const at = (): Cell => cellAt([HUB_X + distance * Math.sin(angle), HUB_Z + distance * Math.cos(angle)])
    let cell = at()
    while (seeded.has(key(cell)) || inBay(cell)) {
      distance += 5
      cell = at()
    }
    seeded.add(key(cell))
    district.square = cell
  }

  // ---- Growth: each district claims the frontier hex nearest its seed, the emptiest first ----
  const owner = new Map<string, number>()
  const frontiers = districts.map(() => new Set<string>())
  const claim = (cell: Cell, i: number): void => {
    const id = key(cell)
    owner.set(id, i)
    for (const frontier of frontiers) frontier.delete(id)
    for (const next of neighbours(cell)) {
      const nextId = key(next)
      if (!owner.has(nextId) && !inBay(next)) frontiers[i]?.add(nextId)
    }
  }
  for (const id of RESERVED) owner.set(id, 0)
  districts.forEach((district, i) => {
    claim(district.square, i)
  })
  const claimed = districts.map(() => 1)
  for (;;) {
    let pick = -1
    let emptiest = Number.POSITIVE_INFINITY
    districts.forEach((district, i) => {
      const fill = (claimed[i] ?? 0) / district.quota
      if (fill < 1 && (frontiers[i]?.size ?? 0) > 0 && fill < emptiest) {
        emptiest = fill
        pick = i
      }
    })
    const district = districts[pick]
    if (!district) break
    const [sx, sz] = cellToWorld(district.square)
    const reach = patch(district.quota)
    let best: string | undefined
    let bestScore = Number.POSITIVE_INFINITY
    for (const id of frontiers[pick] ?? []) {
      const cell = unkey(id)
      const [x, z] = cellToWorld(cell)
      const score = Math.hypot(x - sx, z - sz) / reach + 0.3 * noise(seed, cell, `grow${pick}`)
      if (score < bestScore) {
        bestScore = score
        best = id
      }
    }
    if (best === undefined) break
    claim(unkey(best), pick)
    claimed[pick] = (claimed[pick] ?? 0) + 1
  }

  // Holes between districts fill in from their neighbours.
  const majority = (cell: Cell): { count: number; district: number } => {
    const counts = new Map<number, number>()
    for (const next of neighbours(cell)) {
      const i = owner.get(key(next))
      if (i !== undefined) counts.set(i, (counts.get(i) ?? 0) + 1)
    }
    let district = -1
    let most = 0
    let count = 0
    for (const [i, n] of [...counts].sort((a, b) => a[0] - b[0])) {
      count += n
      if (n > most) {
        most = n
        district = i
      }
    }
    return { count, district }
  }
  let radius = 0
  const span = (): Cell[] => {
    radius = 0
    for (const id of owner.keys()) radius = Math.max(radius, rings(unkey(id)))
    const cells: Cell[] = []
    for (let q = -radius - 1; q <= radius + 1; q++)
      for (let line = -2 * radius - 2; line <= 2 * radius + 2; line++)
        if ((q - line) % 2 === 0 && rings([q, line]) <= radius + 1) cells.push([q, line])
    return cells
  }
  for (let pass = 0; pass < 3; pass++)
    for (const cell of span()) {
      if (owner.has(key(cell)) || inBay(cell)) continue
      const { count, district } = majority(cell)
      if (count >= 4) owner.set(key(cell), district)
    }

  // ---- Roads: the avenue, then hub → every square, nearest first, reusing what's laid ----
  const road = new Set<string>([key(HUB), key(AVENUE), key(GATE)])
  const roads: Cell[][] = [[HUB, AVENUE]]
  const byDistance = districts
    .map((district, i) => ({ i, d: rings(district.square) }))
    .filter(({ i }) => i > 0)
    .sort((a, b) => a.d - b.d || a.i - b.i)
  for (const { i } of byDistance) {
    const district = districts[i]
    if (!district) continue
    const path = cheapest(HUB, district.square, radius + 2, (cell) => {
      const id = key(cell)
      if (inBay(cell) || (RESERVED.has(id) && !road.has(id)) || id === key(GATE)) return undefined
      if (road.has(id)) return 0.4
      return owner.has(id) ? 1 : 8
    })
    for (const cell of path) {
      const id = key(cell)
      road.add(id)
      if (!owner.has(id)) owner.set(id, i)
    }
    roads.push(path)
  }

  // ---- Shore: until every land hex meets the sea along one run of ≤ 4 sides ----
  const wet = (cell: Cell): number[] => [0, 1, 2, 3, 4, 5].filter((dir) => !owner.has(key(step(cell, dir))))
  const drawable = (dirs: number[]): boolean => dirs.length === 0 || (dirs.length <= 4 && !!contiguous(dirs))
  const erode = (): boolean => {
    let changed = false
    for (const id of [...owner.keys()]) {
      if (road.has(id) || RESERVED.has(id)) continue
      if (!drawable(wet(unkey(id)))) {
        owner.delete(id)
        changed = true
      }
    }
    return changed
  }
  for (let pass = 0; pass < 20; pass++) {
    let changed = false
    for (const cell of span()) {
      const id = key(cell)
      if (owner.has(id) || inBay(cell)) continue
      const { count, district } = majority(cell)
      if (count >= 4 && drawable(wet(cell))) {
        owner.set(id, district)
        changed = true
      }
    }
    if (erode()) changed = true
    if (!changed) break
  }
  while (erode());
  span()

  // ---- Sites: a level hex beside each square for its landmark, inland if it can be ----
  const sites = new Set<string>()
  const [hx, hz] = cellToWorld(HUB)
  districts.forEach((district, i) => {
    let best: Cell | undefined
    let bestScore = Number.NEGATIVE_INFINITY
    for (const cell of neighbours(district.square)) {
      const id = key(cell)
      if (road.has(id) || sites.has(id) || KEEP.has(id) || !owner.has(id)) continue
      const [x, z] = cellToWorld(cell)
      const score =
        (owner.get(id) === i ? 100 : 0) +
        (wet(cell).length === 0 ? 50 : 0) +
        Math.hypot(x - hx, z - hz) / 10 +
        noise(seed, cell, "site")
      if (score > bestScore) {
        bestScore = score
        best = cell
      }
    }
    if (!best) return
    district.site = best
    sites.add(key(best))
  })

  // ---- What grows where: elevation from depth, then each biome's ground ----
  const land = new Map<string, PlanHex>()
  const nearRoad = (cell: Cell): boolean => neighbours(cell).some((next) => road.has(key(next)))
  districts.forEach((district, i) => {
    const own = [...owner].filter(([, d]) => d === i).map(([id]) => unkey(id))
    district.hexes = own.length
    const raised = new Set<string>()
    if (district.level > 0) {
      const [sx, sz] = cellToWorld(district.square)
      const inland = own
        .filter((cell) => !road.has(key(cell)) && !sites.has(key(cell)) && !nearRoad(cell))
        .map((cell) => {
          const [x, z] = cellToWorld(cell)
          return { cell, far: Math.hypot(x - sx, z - sz) + noise(seed, cell, "rise") * 5 }
        })
        .sort((a, b) => b.far - a.far)
      const count = Math.round(inland.length * (district.level === 1 ? 0.35 : 0.5))
      for (const { cell } of inland.slice(0, count)) raised.add(key(cell))
    }
    for (const cell of own) {
      const id = key(cell)
      let char: string
      if (road.has(id)) char = "="
      else if (KEEP.has(id)) char = KEEP.get(id) ?? "K"
      else if (sites.has(id)) char = "s"
      // The ring round the keep: open lots, kept clear like the hand map's (lands.ts' V).
      else if (RESERVED.has(id)) char = "V"
      else if (raised.has(id))
        char =
          district.level === 1 ? "H" : neighbours(cell).every((next) => raised.has(key(next))) ? "M" : "m"
      else char = ground(district, noise(seed, cell, "ground"), noise(seed, cell, "crop"))
      land.set(id, { char, district: i })
    }
  })

  return { hash: shape.hash, seed, land, districts, roads, hub: HUB, quay: QUAY, gate: GATE, radius }
}

/** A hex's ground in a district's biome; `roll` against its density decides how full it is. */
function ground(district: PlanDistrict, roll: number, crop: number): string {
  const d = district.density
  switch (district.biome) {
    case "village":
      return roll < d ? "v" : roll < d + 0.15 ? "f" : "."
    case "harbour":
      return roll < d * 0.6 ? "v" : roll < d * 0.6 + 0.1 ? "f" : "."
    case "proving":
      return roll < d * 0.5 ? "s" : roll < 0.8 ? "." : "f"
    case "library":
      return roll < d ? "f" : roll > 0.8 ? "h" : "."
    case "quarry":
      return roll < d * 0.6 ? "h" : "."
    case "forest":
      return roll < d ? "F" : "f"
    case "farms":
      return roll < d ? (crop < 0.6 ? "w" : "d") : "."
    case "wilds":
      return roll < 0.3 ? "f" : roll < 0.45 ? "h" : "."
  }
}

/** Dijkstra over the hexes within `radius` rings; `cost` undefined means impassable. */
function cheapest(from: Cell, to: Cell, radius: number, cost: (cell: Cell) => number | undefined): Cell[] {
  const goal = key(to)
  const best = new Map<string, number>([[key(from), 0]])
  const back = new Map<string, string>()
  const heap: [number, string][] = [[0, key(from)]]
  const push = (item: [number, string]): void => {
    heap.push(item)
    let i = heap.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if ((heap[parent]?.[0] ?? 0) <= item[0]) break
      heap[i] = heap[parent] ?? item
      i = parent
    }
    heap[i] = item
  }
  const pop = (): [number, string] | undefined => {
    const top = heap[0]
    const last = heap.pop()
    if (!top || !last || heap.length === 0) return top
    let i = 0
    for (;;) {
      const left = 2 * i + 1
      const right = left + 1
      let smallest = i
      const at = (n: number): number => (n === i ? last[0] : (heap[n]?.[0] ?? Number.POSITIVE_INFINITY))
      if (left < heap.length && at(left) < at(smallest)) smallest = left
      if (right < heap.length && at(right) < at(smallest)) smallest = right
      if (smallest === i) break
      heap[i] = heap[smallest] ?? last
      i = smallest
    }
    heap[i] = last
    return top
  }
  for (let item = pop(); item; item = pop()) {
    const [distance, id] = item
    if (id === goal) break
    if (distance > (best.get(id) ?? Number.POSITIVE_INFINITY)) continue
    for (const next of neighbours(unkey(id))) {
      if (rings(next) > radius) continue
      const step = cost(next)
      if (step === undefined) continue
      const nextId = key(next)
      const total = distance + step
      if (total < (best.get(nextId) ?? Number.POSITIVE_INFINITY)) {
        best.set(nextId, total)
        back.set(nextId, id)
        push([total, nextId])
      }
    }
  }
  const path: Cell[] = [to]
  for (let id = back.get(goal); id !== undefined; id = back.get(id)) path.unshift(unkey(id))
  if (key(path[0] ?? to) !== key(from)) throw new Error(`no road from ${key(from)} to ${goal}`)
  return path
}
