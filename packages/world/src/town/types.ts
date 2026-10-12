/**
 * The town contracts (plan §3.4), pinned in one place: the spec a preset is written in, the plan the
 * generator fills stage by stage, and the flat draw list render reads. Later stages fill these;
 * they never rename them. Positions are `[x, z]` on the ground plane, in metres.
 */
import type { PrefabMeta } from "@guildhall/assets"
import type { Rect } from "../geom/obb.ts"
import type { Ring } from "../geom/poly.ts"
import type { Vec2 } from "../geom/vec.ts"

export type { Vec2 }

/** Settlement tiers, smallest first: a package's size picks one (hamlet → capital). */
export const TIERS = ["hamlet", "village", "town", "city", "capital"] as const
export type Tier = (typeof TIERS)[number]

export const DISTRICT_KINDS = ["market", "residential", "craft", "harbour", "castle", "farm"] as const
export type DistrictKind = (typeof DISTRICT_KINDS)[number]

export const LANDMARKS = ["castle", "chapel", "guildhall"] as const
export type Landmark = (typeof LANDMARKS)[number]

/**
 * A town preset (`data/towns/<preset>.json`). Optional fields take the tier's defaults
 * (spec.ts `TIER_DEFAULTS`, via `normalizeSpec`).
 */
export interface TownSpec {
  seed: number
  tier: Tier
  /** One seed point per entry: a kind listed twice makes two quarters of it. */
  districts?: DistrictKind[]
  landmark: Landmark | null
  /** Radians: the side of the town the water lies on, as the direction `[cos, sin]` from the centre. */
  harbour: null | { bearing: number }
  walls?: boolean
  farms?: number
  /** Metres from the centre to the gates. */
  radius?: number
}

/** A spec as a preset may write it: `landmark` and `harbour` left out also take the tier's defaults. */
export type TownSpecInput = Omit<TownSpec, "landmark" | "harbour"> & {
  landmark?: TownSpec["landmark"]
  harbour?: TownSpec["harbour"]
}

/** A spec with every default filled in: what the stages read. */
export type NormalSpec = Required<TownSpec>

/** What a tier gives a spec that leaves a field out, and the knobs later stages read from it. */
export interface TierDefaults {
  /** Metres from the centre to the gates; the bounds are a 2.6r square. */
  radius: number
  districts: DistrictKind[]
  /** Street density: the largest lots block (m²) before a lane cuts it. */
  amax: number
  gates: number
  /** The plaza's long side, metres. */
  plaza: number
  walls: boolean
  farms: number
  /** The chance a spec that leaves `harbour` out gets one. */
  harbourOdds: number
  landmark: Landmark | null
}

/** The two levels of the flat world (metres): everything stands on land; water sits below it. */
export const LEVELS = { land: 0, water: -0.6 } as const

/** The ground a town is laid out on (site.ts): flat land, the water cut out of it, and the reserves. */
export interface Site {
  radius: number
  /** The 2.6r square, counter-clockwise, centred on the origin. */
  bounds: Ring
  /** The bounds minus the water: outer rings CCW, holes CW. */
  land: Ring[][]
  /** Water cut-outs inside the bounds (outer rings, CCW). Empty when the town has no harbour. */
  water: Ring[]
  /** The market square: a rounded rectangle, CCW. */
  plaza: Ring
  /** The castle's ground beside the plaza, away from the water; null unless the landmark is a castle. */
  castleSite: Rect | null
}

/** Edge dressing, per edge kind: catalog ids for the run, its posts or towers, and its gate. */
export interface EdgeKit {
  /** The repeating piece along a chord. */
  segment: string
  /** Metres one segment covers. */
  length: number
  post?: string
  tower?: string
  gate?: string
}
export type EdgeKits = Record<Edge["kind"], EdgeKit>

/** Everything the generator may place, by id and size only (no geometry). */
export interface TownLibrary {
  prefabs: PrefabMeta[]
  edges: EdgeKits
  nature: { trees: string[]; bushes: string[]; crops: string[]; hay: string[]; rocks: string[] }
}

export interface StreetNode {
  id: number
  at: Vec2
  kind: "plaza" | "gate" | "junction" | "end" | "quay"
}

/** Widths: main 7, street 5, lane 3.5, road 4 m. */
export interface StreetEdge {
  id: number
  a: number
  b: number
  points: Vec2[]
  cls: "main" | "street" | "lane" | "road"
  width: number
}

export interface StreetGraph {
  nodes: StreetNode[]
  edges: StreetEdge[]
}

export interface Block {
  id: number
  poly: Vec2[]
  use: "lots" | "plaza" | "castle" | "green" | "harbour"
  district: DistrictKind
}

export interface Lot {
  id: number
  block: number
  /** The street edge id it fronts. */
  street: number
  /** Lot frame: +z faces the street. */
  origin: Vec2
  rot: number
  w: number
  depth: number
  status: "built" | "garden" | "corner"
  prefab?: string
  seed?: number
}

export interface Placement {
  prefab: string
  seed: number
  at: Vec2
  rot: number
  lot?: number
  role?: string
}

export interface Edge {
  id: number
  kind: "wall" | "hedge" | "fence"
  points: Vec2[]
  closed: boolean
  gaps: { s: number; width: number; kind: "gate" | "gap" }[]
  towers?: { spacing: number }
}

export interface Field {
  poly: Vec2[]
  crop: string
  /** Row direction, radians. */
  rows: number
}

export interface Station {
  id: string
  kind: "market" | "forge" | "tavern" | "dock" | "field" | "hall" | "well" | "gate"
  at: Vec2
  facing: number
}

export interface TownPlan {
  spec: TownSpec
  bounds: Vec2[]
  water: Vec2[][]
  plazas: Vec2[][]
  streets: StreetGraph
  blocks: Block[]
  lots: Lot[]
  placements: Placement[]
  edges: Edge[]
  fields: Field[]
  nature: Placement[]
  stations: Station[]
  hash: string
}

export interface PieceInstance {
  piece: string
  x: number
  y: number
  z: number
  rot: number
  scale: number
  swatchMap?: Record<number, number>
}

export interface TownDraw {
  pieces: PieceInstance[]
  ground: {
    land: Vec2[]
    holes: Vec2[][]
    overlays: { kind: "cobble" | "plaza" | "dirt" | "field" | "garden" | "sand"; poly: Vec2[] }[]
    /** Building and wall footprints, for contact darkening. */
    footprints: Vec2[][]
  }
  /** `level` is `LEVELS.water`. */
  water: { polys: Vec2[][]; level: number; shore: Vec2[][] }
}

export interface TownMetrics {
  builtPct: number
  houses: number
  frontageFill: number
  lots: number
  pieces: number
  estTris: number
}

/** One townsperson (populate.ts): a look seed on a recipe, where they stand or walk, and what they do. */
export interface Actor {
  seed: number
  recipe: string
  at: Vec2
  facing: number
  clip: string
  path?: Vec2[]
}
