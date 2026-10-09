import { hasFolk, populationOf, primePopulation } from "../folk/plan.ts"
import type { Population } from "../folk/types.ts"
import type { Gen } from "../gen/islandFromTree.ts"
import { islandFromTree } from "../gen/islandFromTree.ts"
import type { Tree } from "../gen/load.ts"
import { repoParts, type World, type WorldParts, worldOf } from "../world.ts"

/**
 * A repo's island, grown in one of two places from the same code (ADR 0007's pure generator):
 * `growSync` on this thread (tests, node, a browser without workers), or `grow` in a Web Worker
 * (grow/pool.ts), whose `Grown` is plain data (no closures, no three objects) that `worldFrom`
 * closes into the same World on the main thread. Same tree and gen, same World either way.
 */

/** What the worker posts back: the island's world without its closures, and its folk, planned there. */
export interface Grown {
  parts: WorldParts
  population: Population
}

/** The island's world data: `islandFromTree` then `repoWorld`'s relief, rivers, trails and venues, as the link asks. */
export function growParts(tree: Tree, gen: Gen): WorldParts {
  const { repo, source, branch, truncated } = tree
  return repoParts(islandFromTree(tree.entries, 0, gen), {
    repo,
    source,
    ...(gen === 2 ? { gen } : {}),
    ...(branch ? { branch } : {}),
    ...(truncated ? { truncated } : {}),
  })
}

/** The worker's job: the island's data, and the folk who live on it (their plan is the costliest part left). */
export function grow(tree: Tree, gen: Gen): Grown {
  const parts = growParts(tree, gen)
  return { parts, population: populationOf(worldOf(parts)) }
}

/** The main thread's half: closes the data into a World, and keeps its folk as planned (hasFolk worlds only). */
export function worldFrom({ parts, population }: Grown): World {
  const world = worldOf(parts)
  if (hasFolk(world)) primePopulation(world, population)
  return world
}

/** The whole job on this thread; the folk are planned when first wanted (folk/plan.ts). */
export const growSync = (tree: Tree, gen: Gen): World => worldOf(growParts(tree, gen))

/** The buffers of a Grown's big typed arrays (the massifs' grids), to be transferred instead of copied. */
export function transferablesOf({ parts }: Grown): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>()
  for (const massif of parts.relief?.massifs ?? [])
    for (const array of [massif.grid.data, massif.slope, massif.pristine])
      buffers.add(array.buffer as ArrayBuffer)
  return [...buffers]
}
