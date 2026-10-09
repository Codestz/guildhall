import type { Craft } from "@guildhall/core"
import { activeWorld } from "../world/active.ts"
import { hikes, lookoutPost } from "../world/hikes.ts"
import type { Post, Spot } from "../world/layout.ts"
import { nearestVenue, type Venue, type VenueDoor, type VenueKind, venueOfCraft } from "../world/venues.ts"

/**
 * Who goes into which venue, for the views (guild/views.ts, guild/town/views.ts): a gen 2 island's
 * buildings (world/venues.ts) are visited by what a deed's craft calls for. The visitor walks to the
 * venue's step and, if there is room, goes in through the door (scene/visit.ts: pause, dissolve
 * through the sill, hidden while the deed runs, out again) — a venue holds `capacity` at once, the
 * rest wait about its step. The hand lands and the first generator have no venues: nobody visits.
 */

/** What a figure's view says about its visit; read by scene/Adventurer.tsx. */
export interface Visit {
  /** The venue's id (world/venues.ts), whose windows light while someone is inside. */
  venue: string
  kind: VenueKind
  door: VenueDoor
  /** The venue is full: they wait at the step, and go in when someone comes out. */
  wait: boolean
  /** A townsperson's: they call in for a while between spells at work, rather than stay (scene/visit.ts). */
  cycle?: true
}

/** A tool done this recently still counts as the deed they are at, between one call and the next. */
export const LINGER_MS = 6000
/** Those waiting at a step stand this far apart, along the way across the door. */
const QUEUE_GAP = 1

/** One pass's bookkeeping: who is inside each venue, who waits outside it. */
export class Visits {
  private readonly inside = new Map<string, number>()
  private readonly waiting = new Map<string, number>()

  /** The visitors' venues of the world (the nearest of the kind to the keep). */
  constructor(private readonly venues: readonly Venue[]) {}

  get any(): boolean {
    return this.venues.length > 0
  }

  /**
   * Where a deed of `craft` takes someone (the venue nearest the keep that has one) and the visit
   * that goes with it; undefined where the island has no venue for it.
   */
  forCraft(craft: Craft | undefined): { visit: Visit; target: Post } | undefined {
    const kind = venueOfCraft(craft)
    if (!kind) return undefined
    const venue = nearestVenue(kind, KEEP, { venues: this.venues })
    return venue ? this.admit(venue) : undefined
  }

  /**
   * Where a Scout's search takes them on an island with trails, now and then: up to a lookout
   * (world/hikes.ts), to stand there while the deed runs. No venue and no door; undefined for anyone else.
   */
  lookoutFor(who: string, archetype: string, craft: Craft | undefined): Post | undefined {
    const world = activeWorld()
    return world && archetype === "scout" && craft === "search" && hikes(who)
      ? lookoutPost(world, who)
      : undefined
  }

  /** A visit to a given venue (a townsperson's own district's): theirs to cycle, never queued. */
  to(venue: Venue): { visit: Visit; target: Post } {
    return this.door(venue, false, 0, true)
  }

  private admit(venue: Venue): { visit: Visit; target: Post } {
    const inside = this.inside.get(venue.id) ?? 0
    if (inside < venue.capacity) {
      this.inside.set(venue.id, inside + 1)
      return this.door(venue, false)
    }
    const queued = this.waiting.get(venue.id) ?? 0
    this.waiting.set(venue.id, queued + 1)
    return this.door(venue, true, queued)
  }

  private door(venue: Venue, wait: boolean, queued = 0, cycle = false): { visit: Visit; target: Post } {
    const { step, inward } = venue.door
    // Those waiting stand off to the side, alternately either side of the door.
    const across = Math.ceil(queued / 2) * QUEUE_GAP * (queued % 2 === 0 ? 1 : -1)
    const side: Spot = [Math.cos(inward), -Math.sin(inward)]
    const at: Spot = wait && queued > 0 ? [step[0] + side[0] * across, step[1] + side[1] * across] : step
    return {
      visit: {
        venue: venue.id,
        kind: venue.kind,
        door: venue.door,
        wait,
        ...(cycle ? { cycle: true as const } : {}),
      },
      target: [round(at[0]), round(at[1]), inward],
    }
  }
}

/** The keep: the centre of the island's walking. */
const KEEP: Spot = [0, 0]

const round = (value: number): number => Math.round(value * 100) / 100
