import type { World } from "./world.ts"

/**
 * The world the scene draws now, for the code outside React that places people on it: the walking
 * router (world/paths.ts), the store's site posts (guild/store.ts), the behaviours' places and the
 * crowds' ground (world/behaviours.ts, sharers.ts, clearance.ts). world/source.ts sets it whenever
 * the world changes; until then (and in tests that never load one) it is undefined, which every
 * reader takes to mean the hand-drawn lands.
 *
 * Its own module, holding only a type of World: world.ts reaches the behaviours through the site
 * registry, so they can't import it back.
 */

let active: World | undefined

export function activeWorld(): World | undefined {
  return active
}

export function setActiveWorld(world: World | undefined): void {
  active = world
}
