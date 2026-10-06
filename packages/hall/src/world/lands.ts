import type LANDS from "./lands.json"
import type { Post, Spot } from "./layout.ts"

/**
 * Guild Lands (ADR 0006, 0007): the island round the keep, as data. The island is hand-drawn as a
 * hex map (MAP below); everything else — which road, river and coast tile goes where and how it is
 * turned, the slopes, the walking graph — is derived from it, so the picture and the paths can't
 * drift apart. Hex pieces are drawn at HEX_SCALE.
 */

export type LandPiece = keyof typeof LANDS
export const HEX_SCALE = 5
/** Hex circumradius in world units: the pack's tiles are 2 across the flats (2/√3 to a corner). */
const SIZE = (HEX_SCALE * 2) / Math.sqrt(3)

/**
 * Flat-top hexes (a flat side faces the gate, so the avenue runs straight south). Axial q, r. The
 * pack's tiles are pointy-top, so every tile is turned 30° (see `turn`).
 */
export function hexToWorld(q: number, r: number): Spot {
  return [1.5 * SIZE * q, Math.sqrt(3) * SIZE * (r + q / 2)]
}

/** A placed land piece; `y` 0 is the grass surface. */
export interface LandPlacement {
  piece: LandPiece
  x: number
  z: number
  y?: number
  rot?: number
  scale?: number
}

// ---- The map -------------------------------------------------------------------------------

/**
 * The island, one character per hex. Column q (x = 8.66·q), line L (z = 5·L, north is up): each
 * text line holds every other column, so the text is the map's own shape. The keep is the K block;
 * its gate opens south onto the avenue.
 *
 *   ~ sea          o lake          r river         # bridge        = road
 *   . meadow       f light woods   F forest        h knoll         w wheat field   d tilled field
 *   H foothill (raised, with slopes)       m mountain (raised)     M high mountain
 *   K the keep     V village lot touching the keep    v village lot / building    s site ground
 */
const MAP = `
  ~   ~   ~   ~   ~   ~   ~   ~   ~
~   ~   ~   ~   ~   ~   ~   ~   ~   ~
  ~   ~   ~   m   M   m   ~   ~   ~
~   ~   f   m   M   M   m   m   ~   ~
  ~   F   m   M   M   M   m   m   ~
~   F   f   m   m   M   s   m   m   ~
  ~   F   f   o   H   s   s   m   ~
~   F   v   r   .   h   =   H   m   ~
  F   F   s   f   .   f   .   H   ~
~   F   =   r   .   f   =   .   .   ~
  F   F   r   .   f   .   =   w   .
~   F   =   .   .   .   .   v   w   ~
  F   F   r   v   v   v   =   w   d
~   F   =   v   v   v   v   =   w   ~
  F   F   r   K   K   K   v   w   w
~   F   =   v   K   K   v   =   d   ~
  F   F   r   K   K   K   v   d   w
~   F   =   v   K   K   v   =   w   ~
  F   =   r   K   =   K   v   s   d
~   F   =   v   V   V   v   =   s   ~
  f   v   #   =   =   =   =   s   w
~   f   f   =   =   =   =   .   d   ~
  ~   f   r   v   =   v   s   w   .
~   .   .   =   v   v   =   s   .   ~
  ~   h   r   .   =   .   =   .   ~
~   .   v   =   f   .   .   s   h   ~
  ~   .   r   .   =   f   .   h   ~
~   .   r   .   .   .   .   .   .   ~
  ~   .   .   .   =   .   .   .   ~
~   ~   ~   .   .   .   .   ~   ~   ~
  ~   ~   ~   .   ~   .   ~   ~   ~
~   ~   ~   ~   ~   ~   ~   ~   ~   ~
  ~   ~   ~   ~   ~   ~   ~   ~   ~
`
const TOP = -16
const LEFT = -9
/** Sea is drawn out to this many hexes from the keep; the sea plane covers the rest. */
const SEA_RINGS = 12

/** A hex as (column q, line L) — the map's own coordinates. Axial r = (L − q) / 2. */
export type Cell = readonly [q: number, line: number]
const key = ([q, line]: Cell): string => `${q},${line}`

export function cellToWorld([q, line]: Cell): Spot {
  return hexToWorld(q, (line - q) / 2)
}

/** Neighbour directions, as edge numbers 0–5 clockwise from east-south-east (30°, 90° = south…). */
const DIRS: readonly Cell[] = [
  [1, 1],
  [0, 2],
  [-1, 1],
  [-1, -1],
  [0, -2],
  [1, -1],
]
const step = ([q, line]: Cell, dir: number): Cell => {
  const d = DIRS[((dir % 6) + 6) % 6] ?? [0, 0]
  return [q + d[0], line + d[1]]
}
function direction(from: Cell, to: Cell): number {
  const dir = DIRS.findIndex((d) => from[0] + d[0] === to[0] && from[1] + d[1] === to[1])
  if (dir < 0) throw new Error(`hexes ${key(from)} and ${key(to)} are not neighbours`)
  return dir
}

const GRID = new Map<string, string>()
MAP.split("\n")
  .slice(1, -1)
  .forEach((text, i) => {
    for (let at = 0; at < text.length; at++) {
      const char = text[at]
      if (!char || char === " ") continue
      const cell: Cell = [at / 2 + LEFT, i + TOP]
      if (at % 2 !== 0 || (cell[0] - cell[1]) % 2 !== 0)
        throw new Error(`MAP: '${char}' off the grid at ${key(cell)}`)
      GRID.set(key(cell), char)
    }
  })
const at = (cell: Cell): string => GRID.get(key(cell)) ?? "~"

// ---- Roads: the outdoor half of the walking graph (paths.ts joins it at the gate) -------------

/** Named road hexes: the walking graph's junctions and ends. */
const PLACES = {
  OUT: [0, 4],
  DOCKS: [0, 12],
  BRIDGE: [-4, 4],
  FOREST: [-6, 2],
  TOWER: [-5, -7],
  RIVER: [-3, 9],
  YARD: [5, 3],
  PROVING: [4, 8],
  QUARRY: [3, -9],
} as const satisfies Record<string, Cell>

/** Every road, hex by hex. Consecutive hexes are neighbours; each pair is a walkable edge. */
const ROADS: readonly (readonly Cell[])[] = [
  // The avenue: gate → square → docks.
  [PLACES.OUT, [0, 6], [0, 8], [0, 10], PLACES.DOCKS],
  // West over the bridge to the forest edge…
  [PLACES.OUT, [-1, 5], [-2, 4], [-3, 5], PLACES.BRIDGE, [-5, 3], PLACES.FOREST],
  // …and north along the river to the wizard tower.
  [[-5, 3], [-5, 1], [-5, -1], [-5, -3], [-5, -5], PLACES.TOWER],
  // Down the east bank to the fishing spot.
  [[-3, 5], [-3, 7], PLACES.RIVER],
  // East through the farms to the construction yard, then north to the quarry.
  [PLACES.OUT, [1, 5], [2, 4], [3, 5], [4, 4], PLACES.YARD],
  [PLACES.YARD, [5, 1], [5, -1], [5, -3], [4, -4], [4, -6], [3, -7], PLACES.QUARRY],
  // South-east to the proving grounds.
  [[3, 5], [3, 7], PLACES.PROVING],
]
/** Road hexes that are drawn but not walked: the gate's apron, the quay. Cell → extra open edges. */
const STUBS: readonly (readonly [Cell, readonly number[]])[] = [
  [[0, 2], [1]],
  [PLACES.OUT, [4]],
  [PLACES.DOCKS, [1]],
]
/** The river, source to mouth: out of the mountain lake, west of the keep, into the south-west bay. */
const RIVER: readonly Cell[] = [
  [-2, -10],
  [-3, -9],
  [-3, -7],
  [-4, -6],
  [-4, -4],
  [-4, -2],
  [-4, 0],
  [-4, 2],
  PLACES.BRIDGE,
  [-4, 6],
  [-4, 8],
  [-4, 10],
  [-5, 11],
  [-5, 13],
]

const nodeName = (cell: Cell): string =>
  Object.entries(PLACES).find(([, place]) => key(place) === key(cell))?.[0] ?? `R${cell[0]}_${cell[1]}`

export const ROAD_NODES: Readonly<Record<string, Spot>> = Object.fromEntries(
  ROADS.flat().map((cell) => [nodeName(cell), cellToWorld(cell)]),
)
export const ROAD_EDGES: readonly (readonly [string, string])[] = ROADS.flatMap((road) =>
  road.slice(1).map((cell, i) => [nodeName(road[i] ?? cell), nodeName(cell)] as const),
)

/** Open edges per hex, from consecutive pairs along a set of paths. */
function links(paths: readonly (readonly Cell[])[]): Map<string, Set<number>> {
  const open = new Map<string, Set<number>>()
  const add = (cell: Cell, dir: number) => {
    const set = open.get(key(cell)) ?? new Set<number>()
    set.add(dir)
    open.set(key(cell), set)
  }
  for (const path of paths) {
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]
      const b = path[i]
      if (!a || !b) continue
      add(a, direction(a, b))
      add(b, direction(b, a))
    }
  }
  return open
}
const ROAD_LINKS = links(ROADS)
for (const [cell, dirs] of STUBS)
  for (const dir of dirs) ROAD_LINKS.set(key(cell), new Set([...(ROAD_LINKS.get(key(cell)) ?? []), dir]))
const RIVER_LINKS = links([RIVER])

// ---- Turning the pack's tiles onto the grid ----------------------------------------------------

/**
 * The y-rotation that puts a pointy-top tile's model edge k on grid edge k + m. Measured from the
 * pack (scratch analysis of each tile's top surface): model edge k points at k·60° from +x.
 */
const turn = (m: number): number => -(Math.PI / 6 + (m * Math.PI) / 3)

/** Model edges that carry road (or river) on each tile of the pack, by tile letter. */
const PATH_TILES: Record<string, readonly number[]> = {
  A: [0, 3],
  B: [3, 5],
  C: [3, 4],
  D: [1, 3, 5],
  E: [0, 3, 5],
  F: [0, 1, 3],
  G: [2, 3, 4],
  H: [0, 2, 3, 4],
  I: [1, 2, 4, 5],
  J: [0, 1, 2, 3],
  K: [1, 2, 3, 4, 5],
  L: [0, 1, 2, 3, 4, 5],
  M: [3],
}
/** Coast tiles: model edges that open onto water. */
const COAST_TILES: Record<string, readonly number[]> = { A: [1], B: [1, 2], C: [0, 1, 2], D: [5, 0, 1, 2] }

const mask = (edges: Iterable<number>): number => {
  let bits = 0
  for (const edge of edges) bits |= 1 << (((edge % 6) + 6) % 6)
  return bits
}
/** The tile (from `tiles`) and turn m whose open edges are exactly `edges`. */
function fit(
  tiles: Record<string, readonly number[]>,
  edges: Iterable<number>,
): { tile: string; m: number } | undefined {
  const want = mask(edges)
  for (const [tile, model] of Object.entries(tiles))
    for (let m = 0; m < 6; m++) if (mask(model.map((k) => k + m)) === want) return { tile, m }
  return undefined
}

// ---- Sites ---------------------------------------------------------------------------------

export type SiteId = "yard" | "forest" | "river" | "proving" | "quarry" | "tower"

export interface Site {
  id: SiteId
  label: string
  at: Spot
  /** Where adventurers stand to work, facing the work. */
  posts: readonly Post[]
}

/** Facing from a post towards a point. */
function toward(x: number, z: number, tx: number, tz: number): Post {
  return [x, z, Math.atan2(tx - x, tz - z)]
}
/** A post `distance` from `work`, on the side of `from` (usually the road), facing the work. */
function stand(work: Spot, from: Spot, distance: number): Post {
  const length = Math.hypot(from[0] - work[0], from[1] - work[1]) || 1
  const x = work[0] + ((from[0] - work[0]) / length) * distance
  const z = work[1] + ((from[1] - work[1]) / length) * distance
  return toward(round(x), round(z), work[0], work[1])
}
const round = (value: number): number => Math.round(value * 100) / 100
const W = cellToWorld

/** Where each site's work is: trees to fell, rocks to break, water to fish, targets to hit. */
const WORK = {
  forest: [W([-7, 1]), W([-7, 3]), W([-6, 0])],
  quarry: [
    [17.5, -49],
    [34, -49],
    [26, -52],
  ],
  river: [
    [-33.5, 40],
    [-33.5, 50],
    [-33.5, 45],
  ],
  targets: [
    [40.5, 34],
    [43.5, 38.5],
    [38, 31],
  ],
} as const satisfies Record<string, readonly Spot[]>
const YARD_AT = W([6, 2])
const TOWER_AT = W([-5, -9])

export const SITES: Record<SiteId, Site> = {
  yard: {
    id: "yard",
    label: "Construction yard",
    at: YARD_AT,
    posts: [
      stand(YARD_AT, [44, 15], 7.5),
      stand(YARD_AT, [50, 20], 7.5),
      stand(YARD_AT, [43, 7], 7.5),
      stand(YARD_AT, [56, 19], 7.5),
    ],
  },
  forest: {
    id: "forest",
    label: "Forest edge",
    at: [-56, 7],
    posts: WORK.forest.map((tree) => stand(tree, W(PLACES.FOREST), 5)),
  },
  river: {
    id: "river",
    label: "River bend",
    at: [-31, 45],
    posts: WORK.river.map((water) => stand(water, [-20, water[1]], 3.2)),
  },
  proving: {
    id: "proving",
    label: "Proving grounds",
    at: [40, 36],
    posts: WORK.targets.map((target) => stand(target, W(PLACES.PROVING), 2.6)),
  },
  quarry: {
    id: "quarry",
    label: "Quarry",
    at: [26, -50],
    posts: WORK.quarry.map((rock) => stand(rock, W(PLACES.QUARRY), 3.5)),
  },
  tower: {
    id: "tower",
    label: "Wizard tower",
    at: TOWER_AT,
    posts: [toward(-40, -39.5, TOWER_AT[0], TOWER_AT[1]), toward(-46.6, -39.5, TOWER_AT[0], TOWER_AT[1])],
  },
}

// ---- Landmarks -------------------------------------------------------------------------------

/**
 * Buildings and features the Life layer animates or dresses (ADR 0007): the windmill's sails turn,
 * the water wheel spins, chimneys smoke, each site's work leaves traces next to it.
 */
export type LandmarkKind =
  | "windmill"
  | "watermill"
  | "lumbermill"
  | "mine"
  | "tower"
  | "well"
  | "home"
  | "market"
  | "dock"
  | "chimney"
export interface Landmark {
  kind: LandmarkKind
  /** The placement drawing it (already in `decor`), or none for a pure marker (a chimney top). */
  piece?: LandPiece
  x: number
  z: number
  /** Height of the interesting point (a chimney's top, the wheel's axle), world units. */
  y?: number
  rot?: number
  /** The site it belongs to, when it's a workplace. */
  site?: SiteId
}

const LANDMARK_OF: Partial<Record<LandPiece, LandmarkKind>> = {
  building_windmill_blue: "windmill",
  building_watermill_blue: "watermill",
  building_lumbermill_blue: "lumbermill",
  building_mine_blue: "mine",
  building_tower_A_blue: "tower",
  building_well_blue: "well",
  building_market_blue: "market",
  building_market_red: "market",
  building_home_A_blue: "home",
  building_home_B_blue: "home",
  building_home_A_red: "home",
  building_home_B_red: "home",
  building_home_A_yellow: "home",
  building_home_B_yellow: "home",
  building_home_A_green: "home",
  building_home_B_green: "home",
  building_blacksmith_blue: "home",
  floor_wood_large: "dock",
}
/** Chimney tops in the piece's own units (measured from the models). */
const CHIMNEY: Partial<Record<LandPiece, readonly [number, number, number]>> = {
  building_home_A_blue: [0, 0.93, -0.35],
  building_home_A_red: [0, 0.93, -0.35],
  building_home_A_yellow: [0, 0.93, -0.35],
  building_home_A_green: [0, 0.93, -0.35],
  building_home_B_blue: [0.14, 1.28, -0.42],
  building_home_B_red: [0.14, 1.28, -0.42],
  building_home_B_yellow: [0.14, 1.28, -0.42],
  building_home_B_green: [0.14, 1.28, -0.42],
  building_blacksmith_blue: [0.21, 0.98, -0.14],
}
const SITE_OF: Partial<Record<LandPiece, SiteId>> = {
  building_mine_blue: "quarry",
  building_tower_A_blue: "tower",
  building_watermill_blue: "river",
  building_lumbermill_blue: "forest",
  building_archeryrange_blue: "proving",
}

// ---- Hand-placed buildings and dressing --------------------------------------------------------

/** Rotation that turns a building's front (+z) towards a point. */
const facing = (from: Spot, to: Spot): number => Math.atan2(to[0] - from[0], to[1] - from[1])
/** A piece at a hex, nudged by (dx, dz), its front turned towards `look` (a hex or a point). */
function put(piece: LandPiece, cell: Cell, dx = 0, dz = 0, look?: Cell, scale?: number): LandPlacement {
  return putFacing(piece, cell, dx, dz, look && W(look), scale)
}
/** As `put`, facing a world point. */
function putFacing(piece: LandPiece, cell: Cell, dx = 0, dz = 0, look?: Spot, scale?: number): LandPlacement {
  const [cx, cz] = W(cell)
  const x = round(cx + dx)
  const z = round(cz + dz)
  return { piece, x, z, rot: look ? facing([x, z], look) : 0, ...(scale ? { scale } : {}) }
}
/** A piece at a world point. */
const place = (
  piece: LandPiece,
  x: number,
  z: number,
  rot = 0,
  scale?: number,
  y?: number,
): LandPlacement => ({
  piece,
  x,
  z,
  rot,
  ...(scale ? { scale } : {}),
  ...(y !== undefined ? { y } : {}),
})

const AVENUE: Spot = [0, 30]
const DRESSING: LandPlacement[] = [
  // The gate: banners either side, the square's well and market.
  place("flag_blue", -5.5, 15.5),
  place("flag_blue", 5.5, 15.5),
  put("building_well_blue", [0, 4], -6.2, 6.5),
  putFacing("building_market_blue", [-1, 7], 1, 0, AVENUE),
  putFacing("building_market_red", [1, 7], -1, -2.5, AVENUE),
  put("crate_A_big", [1, 7], -3.4, 2.2),
  put("barrel", [1, 7], -2.2, 3.4),
  put("sack", [-1, 7], 3.6, 3.2),
  // Houses hugging the keep's south wall, either side of the gate.
  put("building_home_A_red", [-1, 3], -2.5, 1, [-1, 5]),
  put("barrel", [-1, 3], 1.8, 2.4),
  put("building_home_B_blue", [1, 3], 2.5, 1, [1, 5]),
  put("crate_A_small", [1, 3], -1.6, 2.6),
  // West quarter, between the keep and the river.
  put("building_home_A_blue", [-3, 3], 1.5, 0, [-3, 5]),
  put("building_home_B_yellow", [-3, 3], -3, -3.5, [-3, 5]),
  put("building_blacksmith_blue", [-3, 1], 0, 0, [0, 1]),
  put("building_home_A_green", [-3, -1], -1, 1, [0, -1]),
  put("tree_single_B", [-3, -1], 3, -3.5),
  put("building_tavern_blue", [-3, -3], 0, 1, [0, -3]),
  put("building_home_B_red", [-2, -4], 0, -1, [-2, -2]),
  put("building_church_blue", [0, -4], 0, -1, [0, -2]),
  put("building_home_A_yellow", [2, -4], 0, -1, [2, -2]),
  put("building_home_B_green", [-1, -3], 0, -1, [-1, -1]),
  put("building_home_A_blue", [1, -3], 0, -1, [1, -1]),
  // East quarter, between the keep and the north road.
  put("building_home_B_blue", [3, -3], 0, 0, [5, -3]),
  put("building_barracks_blue", [3, -1], 0, 0, [0, -1]),
  put("building_home_A_red", [3, 1], 0, 0, [5, 1]),
  put("building_home_B_yellow", [3, 3], 0, 1, [3, 5]),
  put("barrel", [3, 3], 3.2, 2.6),
  put("building_home_A_green", [4, -2], 0, 0, [5, -1]),
  put("building_home_B_red", [4, 0], 0, 0, [5, 1]),
  put("building_home_A_yellow", [4, 2], 0, 0, [5, 3]),
  put("building_home_A_blue", [-2, 6], 0, 0, [-1, 5]),
  put("building_home_B_green", [2, 6], 0, 0, [1, 5]),
  // Second rows: the village thickens towards the roads.
  put("building_home_B_red", [-2, 6], -3.5, 3, [-1, 5]),
  put("tree_single_A", [-2, 6], 3.5, 3.5),
  put("building_home_A_red", [2, 6], 3.5, 3, [1, 5]),
  put("barrel", [2, 6], -2.5, 3.5),
  put("building_home_B_blue", [-3, -1], 2.5, -3.5, [0, -1]),
  put("building_home_A_yellow", [-3, 1], -2.5, 3.5, [0, 1]),
  put("building_home_A_red", [-1, -3], 3.5, -2.5, [-1, -1]),
  put("building_home_B_green", [3, 1], 3, -3.5, [5, 1]),
  put("tree_single_B", [4, 0], 3.5, 3),
  put("crate_A_big", [4, 2], -3, 3),
  put("tree_single_A", [3, -3], -3.5, -3),
  put("building_home_A_green", [3, 3], -3.5, -2, [3, 5]),
  put("flag_yellow", [0, 6], -4, 0),
  put("flag_yellow", [0, 6], 4, 0),
  // Farms: the windmill on its rise, a farmhouse.
  put("building_windmill_blue", [5, -5], 0, 0, [4, -4]),
  put("sack", [5, -5], -3, 2.5),
  put("sack", [5, -5], -2.2, 3.3, undefined, 1.1),
  // Forest edge: the lumber mill by the bridge, stumps where the explorers fell trees.
  put("building_lumbermill_blue", [-6, 4], 0, 0, [-5, 3]),
  put("resource_lumber", [-6, 4], 3.5, -3.5),
  put("tree_single_A_cut", [-7, 1], 2.5, 1.5),
  put("tree_single_A_cut", [-7, 3], 3, -1),
  put("tree_single_B_cut", [-6, 0], -1, 3.5),
  put("trees_B_cut", [-6, 2], -3.5, -4),
  // River bend: the watermill on the far bank.
  put("building_watermill_blue", [-5, 9], 1.5, 0, [-4, 9]),
  put("waterplant_A", [-4, 8], 2.5, -2.5),
  put("waterlily_A", [-4, 10], -1, 2),
  put("waterlily_B", [-5, 11], 1, 1),
  put("bucket_water", [-3, 9], -2.5, 3),
  // Proving grounds: targets, the archery range, a tent and a rack.
  ...WORK.targets.map(([x, z]) => place("target", x, z, facing([x, z], W(PLACES.PROVING)), 1.4)),
  put("building_archeryrange_blue", [5, 9], 0, 0, [4, 8]),
  put("weaponrack", [4, 8], 4, -3, [4, 8]),
  put("tent", [5, 7], 3, 3),
  put("flag_red", [5, 7], -1, -3.5),
  // Quarry: the mine in the mountain's foot, broken stone.
  put("building_mine_blue", [3, -11], 0, 1, [3, -9]),
  place("resource_stone", WORK.quarry[0][0], WORK.quarry[0][1] - 1.8, 0.4),
  place("rock_single_D", WORK.quarry[0][0] - 2, WORK.quarry[0][1] + 0.5, 1.2, 1.4),
  place("resource_stone", WORK.quarry[1][0], WORK.quarry[1][1] - 1.8, -0.5),
  place("rock_single_E", WORK.quarry[1][0] + 2, WORK.quarry[1][1], 0.2, 1.4),
  put("wheelbarrow", [3, -9], -3, 2.5, undefined),
  put("pallet", [4, -10], 2.5, 3),
  // Wizard tower.
  put("building_tower_A_blue", [-5, -9], 0, 0, [-5, -7]),
  put("rock_single_B", [-5, -9], 4, 2),
  // Construction yard: timber and tools round the growing building.
  put("resource_lumber", [6, 2], 6, -5.5, undefined),
  put("pallet", [6, 2], -6.5, -4),
  put("wheelbarrow", [6, 2], 7, 4.5),
  put("ladder", [6, 2], -7, 1),
  // The quay: planks out into the sea off the avenue's end, cargo, a lantern-free rope coil.
  ...[66, 70, 74, 78].map((z) => place("floor_wood_large", 0, z, 0, 0.2, -0.45)),
  place("floor_wood_large", -4, 78, 0, 0.2, -0.45),
  place("floor_wood_large", 4, 78, 0, 0.2, -0.45),
  place("barrel", 1.3, 66.5, 0, 1, -0.4),
  place("crate_A_big", -1.3, 71, 0.3, 1, -0.4),
  place("rope_bundle_A", 4.5, 78.5, 0, 0.25, -0.4),
  place("crate_long_A", -4.5, 77.5, 1.6, 1, -0.4),
  // Beach: cargo waiting for the boats.
  put("crate_open", [-1, 13], 1.5, -2.5, [0, 12]),
  put("barrel", [-1, 13], 3, -1),
  put("crate_long_A", [1, 13], -2.5, -2, [0, 12]),
  put("rock_single_C", [1, 13], 1.5, 0.5),
]

/** The yard's building, by how far the work has come (completed edits/writes). */
export function yardBuilding(progress: number): LandPiece {
  if (progress >= 9) return "building_home_B_blue"
  if (progress >= 6) return "building_stage_C"
  if (progress >= 4) return "building_stage_B"
  if (progress >= 2) return "building_stage_A"
  return "building_scaffolding"
}

/** Which roles work out on the island (ADR 0006); the rest of the roster stays in the keep. */
export const ROLE_SITE: Partial<Record<string, SiteId>> = {
  "guild-implementer": "yard",
  "guild-explorer": "forest",
  "guild-researcher": "river",
  "guild-verifier": "proving",
  "guild-librarian": "tower",
}

/** Agents from outside the guild (OpenCode's own `general`, a user's agents) work the quarry. */
export function siteOf(agent: string, known: boolean): SiteId | undefined {
  return ROLE_SITE[agent] ?? (known ? undefined : "quarry")
}

// ---- Terrain -------------------------------------------------------------------------------

function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** How far the bridge sits below the road (its deck crowns 1.25 above its base at HEX_SCALE). */
const BRIDGE_SINK = -0.9
/** Height of one terrace: half a tile (tiles are 1 deep × HEX_SCALE). */
const TERRACE = HEX_SCALE / 2
const LEVEL: Record<string, number> = { H: 1, m: 1, M: 2 }
const WATER = new Set(["~", "o", "r", "#"])
const OPEN = new Set(["~", "o"])
const FIELD = new Set(["w", "d"])

const LEVELS = new Map<string, number>()
for (const [cell, char] of GRID) if (LEVEL[char]) LEVELS.set(cell, LEVEL[char] ?? 0)
const level = (cell: Cell): number => LEVELS.get(key(cell)) ?? 0
// A foothill that can't fall away in one clean slope sinks to level ground (a knoll), until none
// is left: the island has slopes and mountain terraces, never a lone grass mesa with dirt cliffs.
for (let changed = true; changed; ) {
  changed = false
  for (const [id, height] of LEVELS) {
    if (GRID.get(id) !== "H") continue
    const cell = id.split(",").map(Number) as unknown as Cell
    const lower = [0, 1, 2, 3, 4, 5].filter((dir) => level(step(cell, dir)) < height)
    if (lower.length > 0 && rampOf(cell, lower) === undefined) {
      LEVELS.delete(id)
      changed = true
    }
  }
}
const hexDistance = ([q, line]: Cell): number => {
  const r = (line - q) / 2
  return (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2
}

/**
 * The island, as data every layer reads (ADR 0007). Contract:
 * - `tiles` and `decor` are drawn by scene/Island.tsx (batched).
 * - `water` lists the centre of every water tile (sea, river, lake, the bridge's river hex).
 * - `meadow` lists the centre of every open grass tile (no road, building, forest, field or site,
 *   level ground): Nature scatters grass and flowers there.
 * - `landmarks` are what Life animates.
 * - Roads, sites, the keep and the space round the gate are flat at y = 0; elevation is only ever
 *   off the walking graph, so adventurers never need a height lookup.
 */
/** A farm field's hex: wheat, or a vegetable plot. Its crops are drawn by scene/nature/Fields. */
export interface Field {
  kind: "wheat" | "crops"
  x: number
  z: number
}

export interface Island {
  tiles: LandPlacement[]
  decor: LandPlacement[]
  water: Spot[]
  meadow: Spot[]
  landmarks: Landmark[]
  fields: Field[]
}

const cache = new Map<number, Island>()

/** The island for a seed: the hand-drawn map, tiled and dressed. The seed only varies the nature. */
export function island(seed = 7): Island {
  const known = cache.get(seed)
  if (known) return known
  const random = rng(seed)
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)] as T
  /** A random rotation that keeps a hex-shaped piece on the hex. */
  const spin = (): number => turn(Math.floor(random() * 6))
  const tiles: LandPlacement[] = []
  const decor: LandPlacement[] = []
  const water: Spot[] = []
  const meadow: Spot[] = []
  const fields: Field[] = []

  const cells: Cell[] = []
  for (let q = -SEA_RINGS; q <= SEA_RINGS; q++)
    for (let line = -2 * SEA_RINGS; line <= 2 * SEA_RINGS; line++)
      if ((q - line) % 2 === 0 && hexDistance([q, line]) <= SEA_RINGS) cells.push([q, line])

  for (const cell of cells) {
    const char = at(cell)
    const [x, z] = W(cell)
    const tile = (piece: LandPiece, m = 0, y = 0) =>
      tiles.push({ piece, x, z, rot: turn(m), ...(y ? { y } : {}) })
    const add = (piece: LandPiece, dx = 0, dz = 0, rot = spin(), y = 0, scale?: number) =>
      decor.push({
        piece,
        x: round(x + dx),
        z: round(z + dz),
        rot,
        ...(y ? { y } : {}),
        ...(scale ? { scale } : {}),
      })
    /** A spot inside the hex, `reach` from its centre. */
    const offset = (reach: number): [number, number] => {
      const angle = random() * Math.PI * 2
      return [Math.cos(angle) * reach, Math.sin(angle) * reach]
    }

    if (OPEN.has(char)) {
      tile("hex_water")
      water.push([x, z])
      continue
    }
    if (char === "r" || char === "#") {
      water.push([x, z])
      const edges = RIVER_LINKS.get(key(cell)) ?? new Set<number>()
      if (char === "#") {
        // Bridge: the river crossing tile under the pack's bridge, both turned to the road.
        const crossing = fitCrossing(edges, ROAD_LINKS.get(key(cell)) ?? new Set())
        tile(crossing.tile, crossing.m)
        // Sunk so the deck's crown is at walking height (adventurers never leave y = 0); the ends
        // tuck under the banks.
        decor.push({ piece: crossing.bridge, x, z, rot: turn(crossing.m), y: BRIDGE_SINK })
        continue
      }
      const fitted = fit(PATH_TILES, edges)
      if (!fitted) throw new Error(`river at ${key(cell)}: no tile opens onto ${[...edges]}`)
      const straight = fitted.tile === "A" && random() < 0.5 ? "A_curvy" : fitted.tile
      tile(`hex_river_${straight}` as LandPiece, fitted.m)
      continue
    }
    if (char === "=") {
      const edges = ROAD_LINKS.get(key(cell)) ?? new Set<number>()
      const fitted = fit(PATH_TILES, edges)
      if (!fitted) throw new Error(`road at ${key(cell)}: no tile opens onto ${[...edges]}`)
      tile(`hex_road_${fitted.tile}` as LandPiece, fitted.m)
      continue
    }

    // Land. Raised ground first: terraces, with slopes where the hill falls away on one side.
    const height = level(cell)
    if (height > 0) {
      const lower: number[] = []
      for (let dir = 0; dir < 6; dir++) {
        const next = step(cell, dir)
        if (level(next) < height) lower.push(dir)
      }
      const ramp = char === "H" ? rampOf(cell, lower) : undefined
      if (ramp !== undefined) {
        tile("hex_grass_sloped_low", ramp + 3, (height - 1) * TERRACE)
        if (random() < 0.5)
          add(
            pick(["tree_single_A", "tree_single_B"] as const),
            ...offset(2),
            spin(),
            (height - 0.6) * TERRACE,
          )
        continue
      }
      tile("hex_grass", 0, height * TERRACE)
      // A tile is one terrace pair deep: under a high one, a filler keeps its cliff foot buried.
      for (let below = height - 2; below >= 0; below -= 2) tile("hex_grass", 0, below * TERRACE)
      const y = height * TERRACE
      if (char === "M")
        add(pick(["mountain_A", "mountain_B", "mountain_C", "mountain_C_grass"] as const), 0, 0, spin(), y)
      else if (char === "m")
        add(
          pick([
            "mountain_A_grass_trees",
            "mountain_B_grass_trees",
            "mountain_A_grass",
            "mountain_B_grass",
            "mountain_C_grass_trees",
          ] as const),
          0,
          0,
          spin(),
          y,
        )
      else add(pick(["hills_A_trees", "hills_B_trees", "hills_C_trees"] as const), 0, 0, spin(), y)
      continue
    }

    // Level ground meeting the sea or the lake: a coast tile, sand and shallows.
    const wet: number[] = []
    for (let dir = 0; dir < 6; dir++) if (OPEN.has(at(step(cell, dir)))) wet.push(dir)
    if (wet.length > 0 && char !== "K" && char !== "V") {
      const coast = coastOf(wet)
      tile(`hex_coast_${coast.tile}` as LandPiece, coast.m)
      // A shore with one wet side keeps its trees, set back from the water.
      if (coast.tile === "A" && (char === "F" || char === "f")) {
        const away = (((wet[0] ?? 0) + 3) * Math.PI) / 3 + Math.PI / 6
        add(pick(["trees_A_small", "trees_B_small"] as const), Math.cos(away) * 2, Math.sin(away) * 2)
      } else if (coast.tile === "A" && random() < 0.5)
        add(pick(["rock_single_A", "rock_single_C"] as const), ...offset(2.5))
      continue
    }

    tile("hex_grass")
    switch (char) {
      case "F":
        add(pick(["trees_A_large", "trees_B_large", "trees_A_large", "trees_B_medium"] as const))
        break
      case "f":
        if (random() < 0.55)
          add(pick(["trees_A_medium", "trees_B_medium", "trees_A_small", "trees_B_small"] as const))
        else {
          add(pick(["tree_single_A", "tree_single_B"] as const), ...offset(2.5))
          add(pick(["tree_single_A", "tree_single_B"] as const), ...offset(2.8))
          meadow.push([x, z])
        }
        break
      case "h":
      case "H":
        add(pick(["hills_A_trees", "hills_B_trees", "hills_C_trees"] as const))
        break
      case "w":
      case "d":
        // Tilled soil under both; the wheat and the vegetable rows grow on it (scene/nature/Fields).
        add("building_dirt", 0, 0, turn(0))
        fields.push({ kind: char === "w" ? "wheat" : "crops", x, z })
        // Fence each side that doesn't run into another field, a road or water.
        for (let dir = 0; dir < 6; dir++) {
          const next = at(step(cell, dir))
          if (FIELD.has(next) || next === "=" || WATER.has(next)) continue
          add(dir === 1 ? "fence_wood_straight_gate" : "fence_wood_straight", 0, 0, turn(dir - 3))
        }
        break
      case ".": {
        meadow.push([x, z])
        const roll = random()
        if (roll < 0.22) add(pick(["tree_single_A", "tree_single_B"] as const), ...offset(3))
        else if (roll < 0.34)
          add(pick(["rock_single_A", "rock_single_B", "rock_single_C"] as const), ...offset(3))
        break
      }
      default:
        // K, V, v, s: the keep, village lots and sites — dressed by hand (DRESSING).
        break
    }
  }

  decor.push(...DRESSING)
  const landmarks: Landmark[] = []
  for (const placement of DRESSING) {
    const kind = LANDMARK_OF[placement.piece]
    if (!kind) continue
    const rot = placement.rot ?? 0
    const site = SITE_OF[placement.piece]
    if (kind === "dock") {
      if (!landmarks.some((mark) => mark.kind === "dock"))
        landmarks.push({ kind, piece: placement.piece, x: 0, z: 78, y: -0.45, rot })
      continue
    }
    landmarks.push({
      kind,
      piece: placement.piece,
      x: placement.x,
      z: placement.z,
      rot,
      ...(site ? { site } : {}),
    })
    const chimney = CHIMNEY[placement.piece]
    if (chimney) {
      const scale = HEX_SCALE * (placement.scale ?? 1)
      const [cx, cy, cz] = chimney
      landmarks.push({
        kind: "chimney",
        x: round(placement.x + (cx * Math.cos(rot) + cz * Math.sin(rot)) * scale),
        z: round(placement.z + (-cx * Math.sin(rot) + cz * Math.cos(rot)) * scale),
        y: round(cy * scale),
      })
    }
  }
  const result = { tiles, decor, water, meadow, landmarks, fields }
  cache.set(seed, result)
  return result
}

/** A slope for a foothill whose lower neighbours are one run of at most three sides. */
function rampOf(cell: Cell, lower: readonly number[]): number | undefined {
  if (lower.length === 0 || lower.length > 3) return undefined
  if (lower.some((dir) => WATER.has(at(step(cell, dir))))) return undefined
  const run = contiguous(lower)
  if (!run) return undefined
  return run.start + Math.floor((run.length - 1) / 2)
}

/** The start of the one contiguous run (round the hex) that `dirs` forms, or undefined. */
function contiguous(dirs: readonly number[]): { start: number; length: number } | undefined {
  const set = new Set(dirs)
  if (set.size === 6) return { start: 0, length: 6 }
  for (let start = 0; start < 6; start++) {
    if (!set.has(start) || set.has((start + 5) % 6)) continue
    let length = 0
    while (set.has((start + length) % 6)) length++
    return length === set.size ? { start, length } : undefined
  }
  return undefined
}

function coastOf(wet: readonly number[]): { tile: string; m: number } {
  const fitted = fit(COAST_TILES, wet)
  if (fitted) return fitted
  throw new Error(`coast: no tile opens onto edges ${wet.join(",")}`)
}

/** The crossing tile + bridge whose river and road edges match. */
function fitCrossing(
  river: ReadonlySet<number>,
  road: ReadonlySet<number>,
): { tile: LandPiece; bridge: LandPiece; m: number } {
  const want = mask(river)
  const wantRoad = mask(road)
  for (const [letter, roadModel, bridge] of [
    ["A", [1, 4], "building_bridge_A"],
    ["B", [2, 5], "building_bridge_B"],
  ] as const) {
    for (let m = 0; m < 6; m++) {
      if (mask([0 + m, 3 + m]) === want && mask(roadModel.map((k) => k + m)) === wantRoad)
        return { tile: `hex_river_crossing_${letter}` as LandPiece, bridge, m }
    }
  }
  throw new Error("bridge: river and road don't cross square")
}

/** Exported for tests: what the map says at a hex, and the hex a world point falls in. */
export const MAP_FOR_TESTS = {
  at,
  cellOf(spot: Spot): Cell {
    const q = Math.round(spot[0] / (1.5 * SIZE))
    let best: Cell = [q, 0]
    let distance = Number.POSITIVE_INFINITY
    for (let dq = -1; dq <= 1; dq++)
      for (let line = Math.floor(spot[1] / 5) - 2; line <= Math.ceil(spot[1] / 5) + 2; line++) {
        const cell: Cell = [q + dq, line]
        if ((cell[0] - line) % 2 !== 0) continue
        const [x, z] = W(cell)
        const d = Math.hypot(x - spot[0], z - spot[1])
        if (d < distance) {
          distance = d
          best = cell
        }
      }
    return best
  },
  level,
  roadLinks: ROAD_LINKS,
  riverLinks: RIVER_LINKS,
  cells: () => [...GRID.keys()],
}
