import type { Patch } from "../archipelago.ts"
import { layoutSplit, type SplitLayout } from "../repoArchipelago.ts"
import { reachOf, type WorldParts, worldOf } from "../world.ts"

/**
 * A repo split into packages (`?repo=…&split`) is laid out in a worker too (grow/pool.ts): where its
 * islands lie, which are joined, and each link's quays take seconds on a big repo (the quays walk
 * every island's obstacles), and the loader must not stall the page for them. The job is plain data
 * in and plain data out, so it runs the same on either thread: `layoutSplit` (world/repoArchipelago.ts)
 * over the islands' worlds, closed from the data they were grown as.
 */

export interface LayoutInput {
  /** Core first: each island's id (its slice's, the coupling's key), the data of its world, and its water patches. */
  islands: readonly { id: string; parts: WorldParts; patches: readonly Patch[] }[]
  /** The coupling's weights by pair (world/gen/coupling.ts), as entries. */
  coupling: readonly (readonly [string, number])[]
}

export function layoutOf({ islands, coupling }: LayoutInput): SplitLayout {
  const laid = islands.map(({ id, parts, patches }) => {
    const world = worldOf(parts)
    return { id, world, footprint: { reach: reachOf(world), patches } }
  })
  return layoutSplit(laid, new Map(coupling))
}
