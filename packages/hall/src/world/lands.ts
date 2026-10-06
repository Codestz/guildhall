import type LANDS from "./lands.json"
import { type Post, ROOM, type Spot } from "./layout.ts"

/**
 * Guild Lands (ADR 0006): the island round the keep, as data. Hex pieces are drawn at HEX_SCALE;
 * the island is generated from a seed so it is the same on every load.
 */

export type LandPiece = keyof typeof LANDS
export const HEX_SCALE = 5
/** Pointy-top hexes: circumradius of one tile in world units (2.31 / 2 × scale). */
const SIZE = (2.31 / 2) * HEX_SCALE
const SQRT3 = Math.sqrt(3)

export function hexToWorld(q: number, r: number): Spot {
  return [SIZE * SQRT3 * (q + r / 2), SIZE * 1.5 * r]
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

export const SITES: Record<SiteId, Site> = {
  yard: {
    id: "yard",
    label: "Construction yard",
    at: [46, 12],
    posts: [toward(40, 16, 46, 12), toward(52, 17, 46, 12), toward(46, 19, 46, 12), toward(40, 7, 46, 12)],
  },
  forest: {
    id: "forest",
    label: "Forest edge",
    at: [-50, 8],
    posts: [toward(-43, 12, -50, 10), toward(-44, 3, -51, 3), toward(-41, 18, -48, 20)],
  },
  river: {
    id: "river",
    label: "River bend",
    at: [-32, 50],
    posts: [toward(-26, 46, -33, 51), toward(-22, 50, -30, 55), toward(-29, 42, -36, 46)],
  },
  proving: {
    id: "proving",
    label: "Proving grounds",
    at: [38, 50],
    posts: [toward(32, 47, 38, 53), toward(37, 45, 43, 51), toward(28, 52, 35, 57)],
  },
  quarry: {
    id: "quarry",
    label: "Quarry",
    at: [22, -48],
    posts: [toward(16, -41, 22, -48), toward(25, -40, 25, -49), toward(31, -43, 30, -50)],
  },
  tower: {
    id: "tower",
    label: "Wizard tower",
    at: [-36, -36],
    posts: [toward(-31, -30, -36, -36), toward(-38, -28, -37, -36)],
  },
}

// ---- Roads: the outdoor half of the walking graph (paths.ts joins it at the gate) -------------

export const ROAD_NODES = {
  OUT: [0, 22],
  CROSS: [0, 34],
  EAST: [22, 30],
  YARD: [40, 22],
  NE: [44, -14],
  QUARRY: [22, -36],
  WEST: [-22, 30],
  FOREST: [-40, 14],
  NW: [-44, -16],
  TOWER: [-32, -27],
  SW: [-14, 46],
  RIVER: [-22, 44],
  SE: [18, 46],
  PROVING: [28, 45],
} as const satisfies Record<string, Spot>

export const ROAD_EDGES: readonly (readonly [keyof typeof ROAD_NODES, keyof typeof ROAD_NODES])[] = [
  ["OUT", "CROSS"],
  ["CROSS", "EAST"],
  ["EAST", "YARD"],
  ["YARD", "NE"],
  ["NE", "QUARRY"],
  ["CROSS", "WEST"],
  ["WEST", "FOREST"],
  ["FOREST", "NW"],
  ["NW", "TOWER"],
  ["CROSS", "SW"],
  ["SW", "RIVER"],
  ["CROSS", "SE"],
  ["SE", "PROVING"],
]

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

const LAND_RINGS = 7
const SEA_RINGS = 11

function ring(q: number, r: number): number {
  return (Math.abs(q) + Math.abs(r) + Math.abs(-q - r)) / 2
}

/** Distance from a point to a segment. */
function toSegment(p: Spot, a: Spot, b: Spot): number {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz || 1)))
  return Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dz * t))
}

/** Within `margin` of the keep's footprint. */
function nearKeep([x, z]: Spot, margin: number): boolean {
  return Math.abs(x) < ROOM.width / 2 + margin && Math.abs(z) < ROOM.depth / 2 + margin
}

function nearRoad(p: Spot, margin: number): boolean {
  return ROAD_EDGES.some(([a, b]) => toSegment(p, ROAD_NODES[a], ROAD_NODES[b]) < margin)
}

function nearSite(p: Spot, margin: number): boolean {
  return Object.values(SITES).some((site) => Math.hypot(p[0] - site.at[0], p[1] - site.at[1]) < margin)
}

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

/**
 * The island, as data every layer reads (ADR 0007). Contract:
 * - `tiles` and `decor` are drawn by scene/Island.tsx (instanced).
 * - `water` lists the centre of every water tile (sea, river, lakes): Nature draws water there.
 * - `meadow` lists the centre of every open grass tile (no road, building, forest or site): Nature
 *   scatters grass and flowers there.
 * - `landmarks` are what Life animates.
 * - Roads, sites, the keep and the space round the gate are flat at y = 0; elevation is only ever
 *   off the walking graph, so adventurers never need a height lookup.
 */
export interface Island {
  tiles: LandPlacement[]
  decor: LandPlacement[]
  water: Spot[]
  meadow: Spot[]
  landmarks: Landmark[]
}

/** The island for a seed: land tiles, a sea ring, and scattered nature that keeps roads and sites clear. */
export function island(seed = 7): Island {
  const random = rng(seed)
  const tiles: LandPlacement[] = []
  const decor: LandPlacement[] = []
  const water: Spot[] = []
  const meadow: Spot[] = []
  const quarter = (Math.PI / 3) * Math.floor(random() * 6)

  for (let q = -SEA_RINGS; q <= SEA_RINGS; q++) {
    for (let r = -SEA_RINGS; r <= SEA_RINGS; r++) {
      const d = ring(q, r)
      if (d > SEA_RINGS) continue
      const [x, z] = hexToWorld(q, r)
      const land = d <= LAND_RINGS - (random() < 0.25 && d === LAND_RINGS ? 1 : 0)
      tiles.push({ piece: land ? "hex_grass" : "hex_water", x, z, rot: quarter })
      if (!land) {
        water.push([x, z])
        if (d === LAND_RINGS + 1 && random() < 0.12) decor.push({ piece: "waterlily_A", x, z })
        continue
      }
      if (nearKeep([x, z], 4) || nearRoad([x, z], 5) || nearSite([x, z], 13)) continue
      // North: mountains behind the quarry; elsewhere woods, thicker in the west.
      const roll = random()
      const west = x < -30
      const north = z < -40
      let piece: LandPiece | undefined
      if (north && roll < 0.55) piece = random() < 0.5 ? "mountain_A_grass_trees" : "mountain_B_grass"
      else if (west && roll < 0.8) piece = random() < 0.5 ? "trees_A_large" : "trees_B_large"
      else if (roll < 0.35) piece = random() < 0.5 ? "trees_A_medium" : "trees_B_medium"
      else if (roll < 0.45) piece = "hills_A_trees"
      else if (roll < 0.52) piece = "rock_single_A"
      if (piece) decor.push({ piece, x, z, rot: random() * Math.PI * 2 })
      else meadow.push([x, z])
    }
  }
  decor.push(...SITE_DRESSING)
  const landmarks: Landmark[] = SITE_DRESSING.flatMap((placement) => {
    const kind = LANDMARK_OF[placement.piece]
    return kind
      ? [{ kind, piece: placement.piece, x: placement.x, z: placement.z, rot: placement.rot ?? 0 }]
      : []
  })
  return { tiles, decor, water, meadow, landmarks }
}

const LANDMARK_OF: Partial<Record<LandPiece, LandmarkKind>> = {
  building_windmill_blue: "windmill",
  building_watermill_blue: "watermill",
  building_lumbermill_blue: "lumbermill",
  building_mine_blue: "mine",
  building_tower_A_blue: "tower",
  building_well_blue: "well",
  building_home_A_blue: "home",
  building_home_B_blue: "home",
}

/** What stands at each site (the yard's building is drawn separately: it grows). */
const SITE_DRESSING: LandPlacement[] = [
  { piece: "building_lumbermill_blue", x: 56, z: 4, rot: -0.6 },
  { piece: "resource_lumber", x: 38, z: 4, rot: 0.3 },
  { piece: "wheelbarrow", x: 54, z: 20, rot: 1.2 },
  { piece: "pallet", x: 36, z: 12 },
  { piece: "trees_A_cut", x: -50, z: 10 },
  { piece: "trees_B_cut", x: -51, z: 2 },
  { piece: "tree_single_A_cut", x: -48, z: 20 },
  { piece: "trees_A_large", x: -58, z: 12 },
  { piece: "trees_B_large", x: -57, z: -2 },
  { piece: "building_watermill_blue", x: -42, z: 56, rot: 0.8 },
  { piece: "hex_water", x: -34, z: 54, y: 0.02 },
  { piece: "waterplant_A", x: -30, z: 57 },
  { piece: "building_archeryrange_blue", x: 46, z: 58, rot: -0.4 },
  { piece: "target", x: 38, z: 53, scale: 1.4 },
  { piece: "target", x: 43, z: 51, scale: 1.4, rot: -0.3 },
  { piece: "target", x: 35, z: 57, scale: 1.4, rot: 0.2 },
  { piece: "building_mine_blue", x: 26, z: -54, rot: 0.2 },
  { piece: "resource_stone", x: 16, z: -50 },
  { piece: "mountain_C", x: 34, z: -62 },
  { piece: "building_tower_A_blue", x: -38, z: -38 },
  { piece: "flag_blue", x: 6, z: 20 },
  { piece: "flag_blue", x: -6, z: 20 },
  { piece: "building_well_blue", x: 8, z: 32 },
  { piece: "building_windmill_blue", x: -14, z: -30, rot: 0.5 },
  { piece: "building_home_A_blue", x: 26, z: 36, rot: -0.8 },
  { piece: "building_home_B_blue", x: -24, z: 38, rot: 0.6 },
  { piece: "tent", x: 12, z: 46, rot: 0.4 },
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
