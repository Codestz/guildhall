import { dayOf } from "../../world/chronicle/format.ts"
import { planGrowth, timeOfDay } from "../../world/chronicle/growth.ts"
import type { GrowthFilm, GrowthStart } from "../../world/chronicle/growthControl.ts"
import { storyOf } from "../../world/chronicle/growthStory.ts"
import { islandFromTree } from "../../world/gen/islandFromTree.ts"
import { summarize } from "../../world/gen/repo.ts"
import type { World } from "../../world/world.ts"

/**
 * A repo's film (ADR 0010): its tree (cached for the session by world/gen/load.ts, so not fetched
 * again) grown into the same island the hall draws, its chronicle (bundled, or quick-built from
 * GitHub), and the growth plan and story read off them. Resolves with the reason in words when there
 * is no history to tell.
 */
export async function filmFor(repo: string, world: World): Promise<GrowthFilm | string> {
  const { treeFor, chronicleFor } = await import("../../world/gen/load.ts")
  // The hall's own repo is a bundled fixture under "sample", not its GitHub name.
  const sample = await treeFor("sample")
  const tree =
    repo === "sample" || repo.toLowerCase() === sample.repo.toLowerCase() ? sample : await treeFor(repo)
  const chronicle = await chronicleFor(repo, tree)
  if (!chronicle) return `couldn't read ${tree.repo}'s history from GitHub`
  const made = islandFromTree(tree.entries, 0, world.repo?.gen)
  // The film moves the hall's own island: it must be the same one, piece for piece.
  if (
    made.island.tiles.length !== world.island.tiles.length ||
    made.island.decor.length !== world.island.decor.length
  )
    return `${tree.repo}'s island changed while its history loaded`
  const plan = planGrowth({ chronicle, shape: summarize(tree.entries), plan: made.plan })
  return {
    repo: tree.repo,
    plan,
    story: storyOf(chronicle, plan),
    chronicle,
    start: chronicle.start,
    end: chronicle.end,
  }
}

/** Where a link asks the film to start, in film time; a link that names one starts paused there. */
export function startOf(film: GrowthFilm, start: GrowthStart): { t: number; paused: boolean } {
  if (!start) return { t: 0, paused: false }
  if ("t" in start) return { t: start.t, paused: true }
  return { t: timeOfDay(film.plan, dayOf(`${start.year}-01-01`)), paused: true }
}

/** Keeps `grow` in the address while a film plays (so the link shares it), out of it after. */
export function markAddress(on: boolean): void {
  const params = new URLSearchParams(location.search)
  if (params.has("grow") === on) return
  if (on) params.set("grow", "")
  else params.delete("grow")
  const text = params
    .toString()
    .replace(/%2F/gi, "/")
    .replace(/=(?=&|$)/g, "")
  history.replaceState(history.state, "", `${location.pathname}${text ? `?${text}` : ""}${location.hash}`)
}
