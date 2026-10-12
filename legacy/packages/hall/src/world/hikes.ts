import { DMath } from "./dmath.ts"
import { hash } from "./gen/hex.ts"
import type { Post } from "./layout.ts"
import type { World } from "./world.ts"

/**
 * Where a hike goes (terrain 2c): a gen 2 island's trails end at lookouts (world/gen/relief/trails.ts),
 * and the ones who "go out and try it" (the Scout archetype: explorers, the folk of the examples)
 * climb to one now and then. Pure lookups for the views (guild/views.ts for an agent whose deed is
 * a search, guild/town/views.ts for a townsperson at rest); the walking itself is the router's and the
 * brain's (world/paths.ts, scene/brain.ts), which take the trail up and slow on the slope.
 */

/** How far in front of the cairn a hiker stands: on the trail's last stretch, looking out over it. */
const STAND = 2.6
/** Of the ones that may, this many in this many do (a hash of who they are picks). */
export const HIKERS = [1, 3] as const

/** Whether someone goes up: a hash of who they are, against the share that do. */
export function hikes(who: string): boolean {
  return hash(`hike:${who}`) % HIKERS[1] < HIKERS[0]
}

/**
 * The lookout post someone goes to, or undefined where the island has no trail: the summit's and the
 * passes' in turn (a hash of who they are picks), standing short of the cairn, facing out over it.
 */
export function lookoutPost(world: Pick<World, "trails">, who: string): Post | undefined {
  const lookouts = world.trails?.lookouts ?? []
  const lookout = lookouts[hash(`lookout:${who}`) % Math.max(1, lookouts.length)]
  if (!lookout) return undefined
  const x = lookout.at[0] + DMath.sin(lookout.rot) * STAND
  const z = lookout.at[1] + DMath.cos(lookout.rot) * STAND
  return [
    Math.round(x * 100) / 100,
    Math.round(z * 100) / 100,
    Math.round((lookout.rot + Math.PI) * 100) / 100,
  ]
}
