import { dress, type RepoIsland } from "./dress.ts"
import { fitIsland } from "./plan.ts"
import { type RepoEntry, summarize } from "./repo.ts"

/**
 * A repo as an island (Chapter 2, phase 3): pure and deterministic. The seed is a hash of the tree
 * (order-independent), so the same tree always grows the same island; `seed` only re-rolls it.
 *
 *   tree → summarize (repo.ts) → fitIsland (plan.ts: an IslandPlan in lands.ts' MAP legend, its
 *          land shrunk until it fits the shore's bake)
 *        → dress (dress.ts: lands.ts' Island + road graph + a Site-shaped entry per district)
 */
export function islandFromTree(tree: readonly RepoEntry[], seed = 0): RepoIsland {
  const shape = summarize(tree)
  return dress(fitIsland(shape, (shape.hash ^ Math.imul(seed, 0x9e3779b1)) >>> 0))
}
