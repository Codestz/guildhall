import type { CatalogEntry } from "@guildhall/assets"
import { LIBRARY } from "../catalog.ts"

/**
 * Which pieces the lineup shows: the raw vendor files, the importer's baked GLBs, or both, raw in
 * front and baked one row behind (`?bake=compare`).
 */
export type BakeMode = "raw" | "baked" | "compare"

/** How far behind the raw row the baked row stands in compare mode (metres). */
export const COMPARE_DEPTH = 12

/** `?bake=1` (or `true`, `baked`) → baked, `?bake=compare` → both, anything else → raw. */
export function parseBake(text: string | null): BakeMode {
  const value = text?.trim().toLowerCase() ?? ""
  if (value === "compare") return "compare"
  return ["1", "true", "baked"].includes(value) ? "baked" : "raw"
}

/** A baked piece the lineup can load in place of a raw part. */
export interface Baked {
  /** Under `/library/`. */
  url: string
  /** The raw → metre factor the importer applied, so offsets in raw units can follow it. */
  factor: number
}

/** The catalog index the importer wrote: which packs the library holds. */
export const INDEX_URL = `${LIBRARY}/catalog/index.json`

/** The pack catalog shard the importer wrote, under `/library/`. */
export const shardUrl = (pack: string): string => `${LIBRARY}/catalog/${encodeURIComponent(pack)}.json`

/**
 * Raw part path (`<pack folder>/<path in the pack>`) → its baked piece, from a pack's catalog
 * entries. Entries record their source relative to the pack folder, so the folder is dropped first.
 * Undefined when the importer did not take that file.
 */
export function bakedPart(file: string, entries: readonly CatalogEntry[]): Baked | undefined {
  const inPack = file.slice(file.indexOf("/") + 1)
  const entry = entries.find((e) => e.kind === "static" && e.source === inPack)
  if (!entry) return undefined
  const url = `${LIBRARY}/${entry.files.glb.split("/").map(encodeURIComponent).join("/")}`
  return { url, factor: entry.scale.factor }
}
