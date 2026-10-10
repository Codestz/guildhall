import type { Gen } from "../gen/islandFromTree.ts"
import type { Tree } from "../gen/load.ts"
import type { SplitLayout } from "../repoArchipelago.ts"
import { type Grown, grow, transferablesOf } from "./grow.ts"
import { type LayoutInput, layoutOf } from "./layout.ts"

/** What the pool asks of a worker (grow/pool.ts): one island to grow. */
export interface GrowRequest {
  tree: Tree
  gen: Gen
}

/** …or a split repo's islands to lay out (grow/layout.ts). */
export interface LayoutRequest {
  layout: LayoutInput
}

/** What the worker answers: the island, or why it could not be grown. */
export type GrowReply = { grown: Grown } | { error: string }
export type LayoutReply = { layout: SplitLayout } | { error: string }

/**
 * The worker's whole behaviour, apart from the thread it runs on (grow/worker.ts is the glue), so
 * tests can run it through a structured clone with no worker: the reply and the buffers to transfer.
 */
export function answer(request: GrowRequest): { reply: GrowReply; transfer: ArrayBuffer[] }
export function answer(request: LayoutRequest): { reply: LayoutReply; transfer: ArrayBuffer[] }
export function answer(request: GrowRequest | LayoutRequest): {
  reply: GrowReply | LayoutReply
  transfer: ArrayBuffer[]
}
export function answer(request: GrowRequest | LayoutRequest): {
  reply: GrowReply | LayoutReply
  transfer: ArrayBuffer[]
} {
  try {
    if ("layout" in request) return { reply: { layout: layoutOf(request.layout) }, transfer: [] }
    const grown = grow(request.tree, request.gen)
    return { reply: { grown }, transfer: transferablesOf(grown) }
  } catch (error) {
    return { reply: { error: (error as Error).message }, transfer: [] }
  }
}
