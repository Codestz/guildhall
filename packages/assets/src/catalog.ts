/** The catalog's shape (plan §3.2): `library/catalog/index.json` plus one shard per pack. */
import type { ComposeMeta } from "./compose.ts"

export const CATEGORIES = [
  "building",
  "wall",
  "roof",
  "floor",
  "door",
  "tower",
  "bridge",
  "fence",
  "tree",
  "bush",
  "rock",
  "cliff",
  "ground",
  "water",
  "prop",
  "furniture",
  "vehicle",
  "character",
  "animal",
  "other",
] as const
export type Category = (typeof CATEGORIES)[number]

export const KINDS = ["static", "character"] as const
export type Kind = (typeof KINDS)[number]

export const PIECE_FLAGS = [
  "off-centre",
  "sunk",
  "floating",
  "texture-lost",
  "high-tris",
  "colour-miss",
] as const
export type PieceFlag = (typeof PIECE_FLAGS)[number]

export const SCALE_FLAGS = ["undersize", "oversize"] as const
export type ScaleFlag = (typeof SCALE_FLAGS)[number]

export const SCALE_RULES = ["ref", "factor", "override"] as const
export const SCALE_CONFIDENCES = ["ref", "pack", "guess"] as const

/** A target band in metres; `max: null` is open-ended (a building is "at least two storeys"). */
export type ScaleTarget = [min: number, max: number | null]

export interface ScaleInfo {
  factor: number
  rule: (typeof SCALE_RULES)[number]
  confidence: (typeof SCALE_CONFIDENCES)[number]
  target?: ScaleTarget
  flags: ScaleFlag[]
}

export interface RigEntry {
  id: string
  file: string
  clips: { name: string; seconds: number }[]
  bones: number
}

export interface CatalogIndex {
  version: 1
  /** paletteHash() of the palette the library was baked with. */
  palette: string
  importer: string
  packs: { id: string; vendor: string; count: number; hash: string }[]
  rigs: RigEntry[]
}

export interface CatalogEntry {
  /** "<pack>/<slug>", slug = kebab(source name); stable across runs. */
  id: string
  pack: string
  source: string
  name: string
  kind: Kind
  category: Category
  tags: string[]
  autoTags?: { tags: string[]; by: string; thumb: string }
  /** Metres to 1e-2, after normalization. */
  size: [w: number, h: number, d: number]
  /** Whole 1 m cells. */
  footprint: { w: number; d: number }
  tris: number
  verts: number
  bytes: number
  /** Palette ids used, sorted. */
  swatches: number[]
  scale: ScaleInfo
  flags: PieceFlag[]
  compose: ComposeMeta
  /** `parts`: the body's sub-mesh names, for NPC recipes to hide (absent until re-imported). */
  character?: { rig: string; clips: string[]; bones: number; parts?: string[] }
  files: { glb: string; thumb: string | null }
  /** Content hash of the written GLB. */
  hash: string
}
