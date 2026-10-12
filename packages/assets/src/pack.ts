/**
 * A pack's import config (plan §3.1): `tools/import/packs/<id>.ts` default-exports one, `satisfies PackConfig`.
 * The type lives here, beside the catalog it produces, so every vocabulary it names has one home.
 */
import type { Category } from "./catalog.ts"
import type { Anchor, AttachRole, EdgeKind, Facing } from "./compose.ts"

/** `vertex` reads like `material` (factor × COLOR_0, textures by how faces sit): for vertex-coloured packs. */
export type ColourMode = "atlas" | "colormap" | "material" | "vertex" | "texture-average" | "keep-texture"
export type Pivot = "bottom-centre" | "trunk" | "keep"

/** ADR 004: a fixed factor, or a reference piece measured to a hero-relative size. */
export type PackScale =
  | { factor: number }
  | { ref: string; measure: "height" | "doorTop" | "storey"; metres: number }

export interface PackRule {
  match: string
  category: Category
  attach?: AttachRole
  tags?: string[]
  front?: Facing
  streetEdge?: Facing
  edgeKind?: EdgeKind
}

/**
 * An override anchor, in the raw model's frame. A `door` anchor's `at` marks the top of the opening;
 * `height` (raw units) puts its threshold at `at.y − height`, which `doorTop` measures from.
 */
export type OverrideAnchor = Anchor & { height?: number }

export interface PieceOverride {
  exclude: true
  factor: number
  pivot: Pivot
  category: Category
  tags: string[]
  front: Facing
  anchors: OverrideAnchor[]
  /** Mesh simplify ratio in (0, 1]; the optimize stage runs simplify only when this is set. */
  simplify: number
}

export interface PackConfig {
  /** Catalog prefix, kebab: "kenney-town". */
  id: string
  /** Folder under assets/src. */
  source: string
  vendor: "kaykit" | "kenney" | "quaternius" | "other"
  license: "CC0"
  /** Globs relative to `source`. */
  include: string[]
  exclude?: string[]
  /** One piece per file (default) or per top-level node. */
  split?: "file" | "top-nodes"
  /** `map`: source hex → swatch name, fixes nearest-colour misses. */
  colour: { mode: ColourMode; map?: Record<string, string> }
  scale: PackScale
  /** Mixed packs: per-glob scale. */
  scaleBy?: { match: string; factor?: number; ref?: string; metres?: number }[]
  /** trunk = xz centroid of the lowest 10% of verts. */
  pivot: Pivot
  /** Metres to embed after the pivot (default 0). */
  sink?: number
  /** Known ground offset to remove. */
  ground?: number
  /** First match wins. */
  rules: PackRule[]
  overrides?: Record<string, Partial<PieceOverride>>
  /** Skinned pieces → kind "character". */
  characters?: { match: string; rig: string }[]
  /** Clip-only GLBs (mesh stripped). */
  rigs?: { id: string; files: string[]; clips?: string[] }[]
  /** Default { rays: 48, distance: auto, strength: 0.6 }. */
  ao?: false | { rays?: number; distance?: number; strength?: number }
}
