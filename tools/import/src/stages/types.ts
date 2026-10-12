/**
 * The stage seam (plan §2.4). The pipeline runs normalize → colour → ao → optimize → measure on each
 * static piece (characters go through `characters` instead); each stage edits the glTF document in
 * place and records what it learned in `ctx.out`.
 */
import type { Document } from "@gltf-transform/core"
import type {
  Category,
  ComposeMeta,
  Kind,
  PackConfig,
  PackRule,
  Palette,
  PieceFlag,
  PieceOverride,
  ScaleInfo,
} from "@guildhall/assets"
import type { Logger } from "@guildhall/core"

/** One piece as discovered and classified, before anything is read. */
export interface PieceSource {
  pack: string
  /** Absolute path of the raw file. */
  file: string
  /** Path relative to the pack's source folder, `/`-separated. */
  source: string
  /** File stem (or top-level node name when the pack splits by node). */
  name: string
  /** kebab(name): stable across runs. */
  slug: string
  /** With `split: "top-nodes"`: the node this piece is cut from. */
  node?: string
  category: Category
  tags: string[]
  /** The first rule that matched, if any. */
  rule?: PackRule
  override?: Partial<PieceOverride>
  /** Set when a `characters` entry matches; the piece becomes a character if it is skinned. */
  rig?: string
}

export interface Measures {
  size: [w: number, h: number, d: number]
  footprint: { w: number; d: number }
  tris: number
  verts: number
}

export interface CharacterInfo {
  rig: string
  clips: string[]
  bones: number
}

export interface PieceReport {
  slug: string
  kind: Kind
  flags: Set<PieceFlag>
  scale?: ScaleInfo
  /** Palette ids used. */
  swatches: Set<number>
  compose: ComposeMeta
  character?: CharacterInfo
  measures?: Measures
}

export interface StageCtx {
  pack: PackConfig
  source: PieceSource
  palette: Palette
  /** The raw packs root (`Paths.raw`): reference pieces are read from under it. */
  raw: string
  /** The library root (`Paths.library`): the read cache, and the rigs a character is checked against. */
  library: string
  log: Logger
  out: PieceReport
}

export type Stage = (doc: Document, ctx: StageCtx) => Promise<void>
