import type { Gen } from "../gen/islandFromTree.ts"
import type { Tree } from "../gen/load.ts"
import { type Grown, grow, transferablesOf } from "./grow.ts"

/** What the pool asks of a worker (grow/pool.ts): one island to grow. */
export interface GrowRequest {
  tree: Tree
  gen: Gen
}

/** What the worker answers: the island, or why it could not be grown. */
export type GrowReply = { grown: Grown } | { error: string }

/**
 * The worker's whole behaviour, apart from the thread it runs on (grow/worker.ts is the glue), so
 * tests can run it through a structured clone with no worker: the reply and the buffers to transfer.
 */
export function answer({ tree, gen }: GrowRequest): { reply: GrowReply; transfer: ArrayBuffer[] } {
  try {
    const grown = grow(tree, gen)
    return { reply: { grown }, transfer: transferablesOf(grown) }
  } catch (error) {
    return { reply: { error: (error as Error).message }, transfer: [] }
  }
}
