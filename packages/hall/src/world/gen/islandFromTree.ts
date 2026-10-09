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
export function islandFromTree(tree: readonly RepoEntry[], seed = 0, gen: Gen = 1): RepoIsland {
  const shape = summarize(tree)
  const mixed = (shape.hash ^ Math.imul(seed, 0x9e3779b1)) >>> 0
  return dress(gen === 2 ? scaledIsland(shape, mixed) : fitIsland(shape, mixed))
}

/** The repo-island generators: 1 today's; 2 ADR 0020's, behind `?gen=2` until it is the default. */
export type Gen = 1 | 2

/** The generator a link asks for (`gen=2`), else 1. */
export const genOf = (search: string): Gen => (new URLSearchParams(search).get("gen") === "2" ? 2 : 1)
