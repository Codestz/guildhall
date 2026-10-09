import type { Fame } from "./dress/civic.ts"
import { dress, type RepoIsland } from "./dress.ts"
import { fitIsland } from "./plan.ts"
import { type RepoEntry, summarize } from "./repo.ts"
import { scaledIsland } from "./scale.ts"

/**
 * A repo as an island (Chapter 2, phase 3): pure and deterministic. The seed is a hash of the tree
 * (order-independent), so the same tree always grows the same island; `seed` only re-rolls it.
 *
 *   tree → summarize (repo.ts) → plan: an IslandPlan in lands.ts' MAP legend
 *            v1  fitIsland (plan.ts): its land shrunk until it fits the one shore bake
 *            v2  scaledIsland (scale.ts): sized by its files, the shore baked in tiles
 *        → dress (dress.ts: lands.ts' Island + road graph + a Site-shaped entry per district)
 */
export function islandFromTree(tree: readonly RepoEntry[], seed = 0, gen: Gen = 1, fame?: Fame): RepoIsland {
  const shape = summarize(tree)
  const mixed = (shape.hash ^ Math.imul(seed, 0x9e3779b1)) >>> 0
  return dress(gen === 2 ? scaledIsland(shape, mixed) : fitIsland(shape, mixed), fame)
}

/** The repo-island generators: 1 the first (`?gen=1`, the opt-out); 2 ADR 0020's, what a link gets. */
export type Gen = 1 | 2

/**
 * The generator a link asks repo islands of: 2, unless it says `gen=1`. (`islandFromTree`'s own
 * default stays 1: this is the link-level default, so fixtures name their generator.)
 */
export const genOf = (search: string): Gen => (new URLSearchParams(search).get("gen") === "1" ? 1 : 2)
