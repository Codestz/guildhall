import { activeWorld } from "./active.ts"
import type { Archipelago } from "./archipelagoSource.ts"
import type { Hall } from "./hall/types.ts"
import type { Spot } from "./layout.ts"
import type { LinkNet } from "./linkNet.ts"
import { handWorld, type World } from "./world.ts"

/**
 * The archipelago for the code outside React that sends people across it (guild/hall.ts picks who
 * works abroad, scene/voyage.ts walks and sails them): its islands, each with its world, where it
 * lies and its hall, and the links between them once the scene has made them (world/linkNet.ts).
 * Set by the archipelago's source and the scene's link layer, like the active world (world/active.ts);
 * until then (and on a lone island) there is no sea: nobody goes anywhere.
 */

export interface Isle {
  /** What names it in the archipelago and its links ("facebook/react#packages/react-dom"). */
  id: string
  /** Where its keep lies in the archipelago's coordinates: its own are this less. */
  at: Spot
  world: World
}

export interface Sea {
  home: Isle
  far: readonly Isle[]
  net: LinkNet | undefined
}

let archipelago: Archipelago | null = null
let links: LinkNet | undefined
let made: Sea | undefined

/** The archipelago drawn now (null: none). */
export function setSea(next: Archipelago | null): void {
  archipelago = next
  links = undefined
  made = undefined
}

/** The links made concrete, from the scene's link layer (undefined before it has). */
export function setSeaNet(next: LinkNet | undefined): void {
  links = next
  made = undefined
}

/** The sea as it stands, or undefined without an archipelago. The home island's world is the active one. */
export function seaNow(): Sea | undefined {
  if (!archipelago) return undefined
  made ??= {
    home: { id: archipelago.home.id, at: archipelago.home.at, world: activeWorld() ?? handWorld() },
    far: archipelago.islands.map((island) => ({ id: island.id, at: island.at, world: island.world })),
    net: links,
  }
  return made
}

/** An island of the sea by id. */
export function isleOf(sea: Sea, id: string): Isle | undefined {
  return sea.home.id === id ? sea.home : sea.far.find((isle) => isle.id === id)
}

/** A point of the island's own coordinates in the archipelago's, and back. */
export const toSea = (isle: Pick<Isle, "at">, [x, z]: Spot): Spot => [x + isle.at[0], z + isle.at[1]]
export const fromSea = (isle: Pick<Isle, "at">, [x, z]: Spot): Spot => [x - isle.at[0], z - isle.at[1]]

/** A far island's hall, with the island it is on. */
export function hallOf(isle: Isle): Hall | undefined {
  return isle.world.hall
}

/**
 * The far island a path belongs to: the one whose package folder (the part of its id after `#`:
 * "packages/react-dom") the path runs through, whole segments only, the longest folder first. A path
 * can be absolute ("/work/react/packages/react-dom/src/a.js") or the repo's own. The root's share
 * ("."), the pooled rest ("+") and the home island's own package belong to no far island: undefined.
 */
export function islandOfPath(far: readonly Pick<Isle, "id">[], path: string): string | undefined {
  const where = `/${path.replace(/\\/g, "/")}/`
  let best: string | undefined
  let length = 0
  for (const { id } of far) {
    const folder = id.split("#")[1]
    if (!folder || folder === "." || folder === "+") continue
    if (where.includes(`/${folder}/`) && folder.length > length) {
      best = id
      length = folder.length
    }
  }
  return best
}
