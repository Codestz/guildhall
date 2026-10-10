import type { Craft } from "@guildhall/core"
import { activeWorld } from "./active.ts"
import { DMath } from "./dmath.ts"
import type { Biome } from "./gen/biomes.ts"
import type { Spot } from "./layout.ts"
import type { Fixture } from "./prefabs/index.ts"

/**
 * The venue registry (world-gen v2 §3.5): the buildings of a gen 2 island that people go into. Each
 * district kind has its venue, standing on the district's landmark hex facing its square; an
 * adventurer's deed by craft takes them to the matching venue, and the townsfolk call at their own
 * district's. Pure data and lookups: the generator places them (gen/dress/venues.ts), the guild's
 * views send people (guild/visits.ts) and the scene's figures walk in (scene/visit.ts).
 *
 *   forge       a code district: edits and writes        library   docs, examples, the site: reads, searches
 *   market      a workspace package's district           tavern    the harbour: plans, consults, delegates
 *   mine        data, assets, public: shell commands     watchtower  tests, CI: test runs and checks
 */

export type VenueKind = "forge" | "library" | "tavern" | "mine" | "watchtower" | "market"

/** Where someone goes in: stand at `step` facing `inward`, walk to `sill` (up `y` over steps). */
export interface VenueDoor {
  step: Spot
  sill: Spot
  y: number
  /** Heading (rotation-y) of someone facing the door, about to go in. */
  inward: number
}

export interface Venue {
  /** "<district>#<kind>": stable for an island. */
  id: string
  kind: VenueKind
  /** The district (its folder: "/", "compiler", "packages/react") it stands in. */
  district: string
  /** The prefab it was placed from (world/prefabs/venues.ts). */
  prefab: string
  at: Spot
  rot: number
  door: VenueDoor
  /** The road node its step joins (a key of the world's `roads.nodes`). */
  node: string
  /** How many may be inside at once; the rest wait at the step. */
  capacity: number
  /** Where the windows glow and the chimneys smoke while someone is inside, in the world. */
  windows: readonly Fixture[]
  chimneys: readonly Fixture[]
}

/** The prefab each kind stands as, and how many fit inside. */
export const VENUE_KINDS: Readonly<Record<VenueKind, { prefab: string; capacity: number }>> = {
  forge: { prefab: "forge", capacity: 3 },
  library: { prefab: "library", capacity: 4 },
  tavern: { prefab: "tavern", capacity: 6 },
  mine: { prefab: "mine-entrance", capacity: 3 },
  watchtower: { prefab: "watchtower", capacity: 3 },
  market: { prefab: "market-hall", capacity: 4 },
}

/** Workshop and CI folders (the farms biome's names) that are a watch's, not a forge's. */
const WATCH = /^(\.?github|\.circleci|ci|infra|deploy|ops|config|configs)$/

/**
 * The venue a district gets, by its biome (and its name or kind of folder), or none (forest, wilds).
 * `leading`: the biggest of the village districts, which is always the forge; a workspace package
 * is otherwise a market hall, and any other code folder a forge.
 */
export function venueKindOf(
  district: { biome: Biome; name: string; package: boolean },
  leading: boolean,
): VenueKind | undefined {
  switch (district.biome) {
    case "harbour":
      return "tavern"
    case "library":
      return "library"
    case "quarry":
      return "mine"
    case "proving":
      return "watchtower"
    case "farms":
      return WATCH.test(district.name.split("/").pop() ?? district.name) ? "watchtower" : "forge"
    case "village":
      return district.package && !leading ? "market" : "forge"
    default:
      return undefined
  }
}

/**
 * Where a deed's craft takes an adventurer, when it takes them anywhere: the shell digs at the mine,
 * the rest as ADR 0011's table reads (core/craft.ts). A craft not here is done where they stand.
 */
const OF_CRAFT: Readonly<Partial<Record<Craft, VenueKind>>> = {
  edit: "forge",
  write: "forge",
  read: "library",
  search: "library",
  fetch: "library",
  test: "watchtower",
  lint: "watchtower",
  run: "mine",
  plan: "tavern",
  consult: "tavern",
  delegate: "tavern",
}

export const venueOfCraft = (craft: Craft | undefined): VenueKind | undefined =>
  craft ? OF_CRAFT[craft] : undefined

/** A world's venues (a gen 2 island's; the hand lands and the first generator's have none). */
export const venuesIn = (
  world: { venues?: readonly Venue[] } | undefined = activeWorld(),
): readonly Venue[] => world?.venues ?? []

/** The venue of `kind` nearest `from` (the keep's gate, usually): ties go to the first in id order. */
export function nearestVenue(
  kind: VenueKind,
  from: Spot,
  world: { venues?: readonly Venue[] } | undefined = activeWorld(),
): Venue | undefined {
  let best: Venue | undefined
  let bestDistance = Number.POSITIVE_INFINITY
  for (const venue of venuesIn(world)) {
    if (venue.kind !== kind) continue
    const distance = DMath.hypot(venue.at[0] - from[0], venue.at[1] - from[1])
    if (distance < bestDistance || (distance === bestDistance && best && venue.id < best.id)) {
      best = venue
      bestDistance = distance
    }
  }
  return best
}

/** The venues of `kind`, nearest `from` first (ties in id order). */
export function venuesNear(
  kind: VenueKind,
  from: Spot,
  world: { venues?: readonly Venue[] } | undefined = activeWorld(),
): Venue[] {
  const away = (venue: Venue): number => DMath.hypot(venue.at[0] - from[0], venue.at[1] - from[1])
  return venuesIn(world)
    .filter((venue) => venue.kind === kind)
    .sort((a, b) => away(a) - away(b) || (a.id < b.id ? -1 : 1))
}

/** A venue of a world by id. */
export const venueById = (
  id: string,
  world: { venues?: readonly Venue[] } | undefined = activeWorld(),
): Venue | undefined => venuesIn(world).find((venue) => venue.id === id)
