import { RESERVED } from "./plan/keep.ts"
import { type IslandPlan, planIsland } from "./plan.ts"
import type { Folder, RepoShape } from "./repo.ts"

/**
 * Generator v2's island size (ADR 0020 §2): land grows with the square root of the repo's files,
 * so a big repo finally reads big while a small one barely changes, and nothing is shrunk to fit
 * the shore's bake (the shore is baked in tiles, scene/nature/shoreTiles.ts). One island holds at
 * most H_MAX land hexes; past that a repo becomes a realm of several (a later slice), until then
 * it is capped.
 */

/** Land hexes one island holds at most. */
export const H_MAX = 1400

/** Land hexes for a repo of `files` files: 40 + 13·√files, at most H_MAX. */
export function landOf(files: number): number {
  return Math.min(H_MAX, Math.round(40 + 13 * Math.sqrt(files)))
}

/** A district's claim on the island's land: its files, and a little for its bytes. */
const weightOf = (folder: Folder): number =>
  Math.sqrt(folder.files) + 0.5 * Math.log2(1 + folder.bytes / 1024)

/**
 * Each district's quota (the root first, then its folders): the island's land, less the keep's
 * reserve (the harbour's from the start), shared ∝ each one's weight.
 */
export function quotasByFiles(shape: RepoShape): number[] {
  const folders = [shape.root, ...shape.folders]
  const files = folders.reduce((sum, folder) => sum + folder.files, 0)
  const weights = folders.map(weightOf)
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  const land = landOf(files) - RESERVED.size
  return weights.map((weight) => (total > 0 ? (land * weight) / total : 0))
}

/** The island for a repo's shape, generator v2: sized by its files, never shrunk. */
export function scaledIsland(shape: RepoShape, seed: number): IslandPlan {
  return planIsland(shape, seed, quotasByFiles(shape))
}
