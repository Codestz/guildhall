/**
 * The island contracts (plan-w8 §3), pinned in one place: the spec an island preset is written in,
 * the layout the stages fill in growth order (ADR 014), and the draw list render reads. Later stages
 * fill these; they never rename them. Island coordinates are `[x, z]` metres; a settlement's layout
 * stays in its own local frame and `Settlement.origin` places it (ADR 011). Everything here is plain
 * data: typed arrays and all, it clones to and from a worker.
 */
import type { Polygon, Ring } from "../geom/poly.ts"
import type { Vec2 } from "../geom/vec.ts"
import type { TownLayout } from "../town/index.ts"
import type {
  Activity,
  Edge,
  Field,
  NormalSpec,
  PieceInstance,
  Placement,
  Station,
  StationKind,
  Tier,
  TownDraw,
  TownFrame,
  TownSpecInput,
} from "../town/types.ts"
import type { WalkGraph, WalkKind } from "../town/walk.ts"

export type { Activity, StationKind, TownFrame }

/** What a settlement is for: the harbour town, then the satellites that settle on its roads. */
export const ROLES = ["main", "fishing", "farming", "mining"] as const
export type Role = (typeof ROLES)[number]

/** The tiers a satellite may take: always smaller than a town. */
export const SATELLITE_TIERS = ["hamlet", "village"] as const

export interface SatelliteSpec {
  role: Exclude<Role, "main">
  tier: (typeof SATELLITE_TIERS)[number]
  seed?: number
}

export const POI_KINDS = [
  "lumber-camp",
  "sawmill",
  "quarry",
  "mine",
  "fishing-spot",
  "lake-pier",
  "ruins",
  "old-tower",
  "shrine",
  "lighthouse",
  "lookout",
  "campsite",
  "training-ground",
] as const
export type PoiKind = (typeof POI_KINDS)[number]

/** An island preset (`data/islands/<preset>.json`). Optional fields take the main tier's defaults (spec.ts). */
export interface IslandSpec {
  seed: number
  /** The harbour town, the growth origin: its harbour is forced on. */
  town: TownSpecInput
  /** Island mean radius in main-town radii (default 2.2: the town covers about 21%). */
  scale?: number
  satellites?: SatelliteSpec[]
  pois?: PoiKind[]
  lakes?: 0 | 1 | 2
  /** Rock fields, where M4 raises hills. */
  rough?: 0 | 1 | 2
  wildlife?: boolean
}

/** An island spec as a preset may write it. */
export type IslandSpecInput = IslandSpec

/** A spec with every default filled in, the town's included: what the stages read. */
export interface NormalIslandSpec {
  seed: number
  town: NormalSpec & { harbour: { bearing: number } }
  scale: number
  satellites: (SatelliteSpec & { seed: number })[]
  pois: PoiKind[]
  lakes: 0 | 1 | 2
  rough: 0 | 1 | 2
  wildlife: boolean
}

export interface Bay {
  id: string
  /** The innermost shore point. */
  shore: Vec2
  mouth: [Vec2, Vec2]
  /** Unit direction out to sea. */
  out: Vec2
  main: boolean
}

export interface IslandSite {
  centre: Vec2
  bounds: Ring
  coast: Ring
  /** Lakes are holes. */
  land: Polygon[]
  sea: Ring[]
  lakes: Ring[]
  rough: Ring[]
  bays: Bay[]
  headlands: Vec2[]
  islets: Ring[]
  ground: GroundGrid
}

/** In this order: `GroundGrid.kind` stores the index. */
export const GROUND_KINDS = ["sea", "lake", "land", "shore", "rough"] as const
export type GroundKind = (typeof GROUND_KINDS)[number]

/** A raster of the island's bounding box, row-major from `origin`; the one O(1) query surface. */
export interface GroundGrid {
  /** Metres per cell. */
  cell: number
  origin: Vec2
  w: number
  h: number
  /** Index into `GROUND_KINDS`, per cell. */
  kind: Uint8Array
  coastDist: Float32Array
  lakeDist: Float32Array
}

export interface Settlement {
  id: string
  role: Role
  tier: Tier
  /** Island coordinates of the layout's local origin. */
  origin: Vec2
  frame: TownFrame
  /** Local coordinates. */
  layout: TownLayout
  /** Island walk node ids. */
  exits: number[]
  grown: number
}

/** Widths: road 4, track 3, trail 1.6, path 1.2 m. */
export type RoadClass = "road" | "track" | "trail" | "path"

export interface RoadNode {
  id: number
  at: Vec2
  kind: "exit" | "junction" | "settlement" | "poi" | "farm" | "end" | "pier"
  ref?: string
}

export interface RoadEdge {
  id: number
  a: number
  b: number
  cls: RoadClass
  points: Vec2[]
  width: number
  /** road, path, trail, pier or boat-lane. */
  walk: WalkKind
  /** The reason a main road was built for (plan-w8 §4.2). */
  reason?: string
  grown: number
}

export interface RoadNetwork {
  nodes: RoadNode[]
  edges: RoadEdge[]
}

export type SiteClass =
  | "headland"
  | "bay-shore"
  | "lake-shore"
  | "rough-edge"
  | "rough"
  | "deep-wood"
  | "glade"
  | "meadow"
  | "near-gate"
  | "remote"
  | "islet"

/** Where a POI kind may stand and how it joins the island (poi.ts `POI_RULES`, ADR 013). */
export interface PoiRule {
  kind: PoiKind
  sites: SiteClass[]
  count: [min: number, max: number]
  /** How it joins the network. */
  link: RoadClass
  minApart: number
  maxTrail: number
  stations: StationKind[]
  /** A named scorer in poi.ts. */
  score: string
}

export interface Poi {
  id: string
  kind: PoiKind
  at: Vec2
  rot: number
  recipe: string
  seed: number
  site: SiteClass
  /** The flat shelf: the vignette's footprint + 2 m. */
  pad: Ring
  stations: IslandStation[]
  /** Set when a settlement owns it (the mining camp's quarry and mine). */
  settlement?: string
  grown: number
}

export interface IslandStation extends Omit<Station, "kind"> {
  kind: StationKind
  activities: Activity[]
  /** The settlement or POI id it belongs to. */
  place: string
  /** The island walk node on its pad. */
  node: number
}

export interface Farmstead {
  id: string
  at: Vec2
  /** The road edge it faces. */
  road: number
  placements: number[]
  fields: number[]
  pasture?: number
  grown: number
}

export interface Countryside {
  farmsteads: Farmstead[]
  fields: Field[]
  pastures: Ring[]
  edges: Edge[]
  placements: Placement[]
  stations: Station[]
  /** Busy and quiet runs per road edge, by arc length. */
  schedule: { edge: number; s0: number; s1: number; busy: boolean }[]
}

export type Species = "sheep" | "cow" | "horse" | "deer" | "rabbit" | "fox" | "bird"

export interface WildZone {
  id: string
  kind: "pasture" | "wood" | "glade" | "meadow" | "shore" | "sky"
  poly: Ring
  grown: number
}

/** A parametric motion model, data only (motion itself is R5/W7's). */
export type Motion =
  /** Sheep, cows, horses. */
  | { model: "graze"; radius: number; speed: number; dwell: [number, number]; cohesion: number }
  /** Deer: glade to glade. */
  | { model: "wander"; waypoints: Vec2[]; speed: number; dwell: [number, number]; shy: number }
  /** Rabbits: along wood rims. */
  | { model: "hop"; along: Vec2[]; speed: number; burrow: Vec2 }
  /** Birds. */
  | { model: "circle"; centre: Vec2; radius: number; height: [number, number]; speed: number }

export interface Herd {
  id: string
  species: Species
  zone: string
  count: number
  home: Vec2
  motion: Motion
  seed: number
}

export interface Wild {
  nature: Placement[]
  clearings: Ring[]
  zones: WildZone[]
  herds: Herd[]
}

/** In this order: `LandUseGrid.use` stores the index. */
export const LAND_USES = [
  "settlement",
  "road",
  "farm",
  "pasture",
  "poi",
  "wood",
  "glade",
  "meadow",
  "rough",
  "lake",
  "shore",
] as const
export type LandUse = (typeof LAND_USES)[number]

export interface LandUseGrid {
  cell: 10
  origin: Vec2
  w: number
  h: number
  /** Index into `LAND_USES`, per cell. */
  use: Uint8Array
  /** 1 = within 60 m of a station or a field. */
  job: Uint8Array
}

/** One step of the growth story (ADR 014): ranks rise in story order. */
export interface GrowthStep {
  rank: number
  what: "town" | "road" | "settlement" | "farmstead" | "poi" | "trail" | "wild"
  ref: string
}

export interface IslandLayout {
  spec: NormalIslandSpec
  site: IslandSite
  settlements: Settlement[]
  network: RoadNetwork
  countryside: Countryside
  pois: Poi[]
  wild: Wild
  /** All of them: the settlements' (in island coordinates), the farms' and the POIs'. */
  stations: IslandStation[]
  walk: WalkGraph
  landUse: LandUseGrid
  growth: GrowthStep[]
  hash: string
}

export interface IslandDraw {
  pieces: PieceInstance[]
  clusters: { key: string; first: number; count: number }[]
  ground: TownDraw["ground"]
  water: TownDraw["water"] & { lakes: Ring[] }
}

export interface IslandMetrics {
  townShare: number
  satellites: number
  pois: number
  stations: number
  coverage: {
    unlabelled: number
    /** m²: the largest no-job tract not labelled wild. */
    idleMax: number
    wildShare: number
  }
  alternation: { longestBusy: number; longestQuiet: number }
  /** Seconds from the main gate, by place id. */
  travel: Record<string, number>
  unreachable: string[]
  pieces: number
  clustersFar: number
  estTris: number
  ms: Record<string, number>
}
