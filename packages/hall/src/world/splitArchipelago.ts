import { crossingsOf, extentOf, type Footprint, mainLanguage, type Shore } from "./archipelago.ts"
import type { Archipelago, FarIsland, IslandInfo, PatchesOf } from "./archipelagoSource.ts"
import type { Tree } from "./gen/load.ts"
import { type Slice, splitRepo } from "./gen/split.ts"
import { APRON, withQuays } from "./quays.ts"
import { growIslandAsync, layoutAsync } from "./source.ts"
import { reachOf, type World, type WorldParts } from "./world.ts"

/**
 * A repo grown as an archipelago (`?repo=…&split`): its tree cut into islands (world/gen/split.ts),
 * each grown from its own subtree, laid out by how bound they are, joined, and given their quays
 * (world/repoArchipelago.ts). The core is the home island; the rest are far ones.
 */

/** An island's id: the repo and its folder in it ("facebook/react#packages/react-dom"). */
export const splitIdOf = (repo: string, slice: Slice): string => `${repo}#${slice.id}`

/** The tree one island is grown from. */
export function sliceTree(tree: Tree, slice: Slice): Tree {
  const { repo, source, branch, truncated } = tree
  return {
    repo,
    source,
    ...(branch ? { branch } : {}),
    ...(truncated ? { truncated } : {}),
    entries: slice.entries,
  }
}

export interface Grown {
  /** The core's world, with its quays. */
  home: World
  archipelago: Archipelago
  /** Islands that could not be grown (left out of the sea). */
  failed: { repo: string; reason: string }[]
}

/** The tree grown as an archipelago, or undefined when it is not one (a single island: the repo as it was). */
export async function growSplit(tree: Tree, patchesOf: PatchesOf): Promise<Grown | undefined> {
  const split = splitRepo(tree.entries, tree.repo)
  if (!split) return undefined
  const settled = await Promise.allSettled(
    split.slices.map((slice) => growIslandAsync(sliceTree(tree, slice))),
  )
  const core = settled[0]
  if (core?.status !== "fulfilled") throw (core as PromiseRejectedResult).reason
  const failed: Grown["failed"] = []
  const kept: { slice: Slice; world: World; parts: WorldParts }[] = []
  for (const [i, outcome] of settled.entries()) {
    const slice = split.slices[i] as Slice
    if (outcome.status === "fulfilled") kept.push({ slice, ...outcome.value })
    else failed.push({ repo: splitIdOf(tree.repo, slice), reason: (outcome.reason as Error).message })
  }
  // Laid out by the slices' own ids (the coupling is keyed by them), in a worker (world/grow/layout.ts):
  // the quays alone take seconds on a big repo. Named by full id once placed.
  const placed = await layoutAsync({
    islands: kept.map(({ slice, world, parts }, i) => ({
      id: slice.id,
      parts,
      patches: patchesOf(world, i > 0, true),
    })),
    coupling: [...split.coupling],
  })
  const named = (id: string): string => `${tree.repo}#${id}`
  const layout = {
    ...placed,
    links: placed.links.map((link) => ({ ...link, a: named(link.a), b: named(link.b) })),
    quays: placed.quays.map((quays) => quays.map((quay) => ({ ...quay, partner: named(quay.partner) }))),
  }
  const infos = kept.map(({ slice, world }, i): IslandInfo => {
    const id = splitIdOf(tree.repo, slice)
    const center = layout.centers[i] as IslandInfo["center"]
    return {
      id,
      repo: id,
      name: slice.label,
      label: slice.label,
      language: mainLanguage(slice.entries),
      at: center,
      center,
      reach: reachOf(world),
      quays: layout.quays[i] ?? [],
      kind: slice.kind,
      files: slice.files,
      ...(i > 0 ? { tight: true as const } : {}),
    }
  })
  const [home, ...far] = infos as [IslandInfo, ...IslandInfo[]]
  const worlds = kept.map(({ world }, i) =>
    withQuays(
      world,
      (layout.quays[i] ?? []).map((quay) => {
        if (layout.links[quay.link]?.kind !== "bridge") return quay
        // The bridge runs to the partner's quay: the whole way is kept clear.
        const other = layout.quays.flat().find((q) => q.link === quay.link && q !== quay)
        const span = other ? Math.hypot(other.at[0] - quay.at[0], other.at[1] - quay.at[1]) : APRON.ahead
        return { ...quay, span }
      }),
    ),
  )
  const islands: FarIsland[] = far.map((info, i) => ({ ...info, world: worlds[i + 1] as World }))
  const shores: Shore[] = infos
  return {
    home: worlds[0] as World,
    archipelago: {
      home,
      islands,
      crossings: crossingsOf(shores),
      extent: extentOf(shores),
      links: layout.links,
    },
    failed,
  }
}
