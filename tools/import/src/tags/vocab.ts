/**
 * The controlled vocabulary for vision tags (`tools/import/tags/vocab.json`) and where the tag step
 * keeps its files under the library:
 *   library/tags/batches/<n>.json       a batch manifest written by `tag emit`
 *   library/tags/batches/<n>.out.json   the vision agent's answer (see tools/import/tags/PROMPT.md)
 *   library/tags/cache.json             thumb hash → the answer, so a piece is tagged once per thumbnail
 */
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import type { Facing } from "@guildhall/assets"

export interface Vocab {
  version: 1
  groups: Record<string, string[]>
  /** The sides an answer may name; "none" when no side reads as the front. */
  front: (Facing | "none")[]
  /** Added to `autoTags.tags` when the answer says a door is visible. */
  doorTag: string
}

/** One piece's answer, as it is cached. */
export interface TagAnswer {
  tags: string[]
  front: Facing | "none"
  door: boolean
  by: string
}
export type TagCache = Record<string, TagAnswer>

export const VOCAB_FILE = resolve(import.meta.dir, "../../tags/vocab.json")

export const batchDir = (library: string): string => join(library, "tags", "batches")
export const cacheFile = (library: string): string => join(library, "tags", "cache.json")

export function loadVocab(file = VOCAB_FILE): Vocab {
  return JSON.parse(readFileSync(file, "utf8")) as Vocab
}

/** Every tag an answer may pick, across all groups. */
export const vocabTags = (vocab: Vocab): Set<string> => new Set(Object.values(vocab.groups).flat())
