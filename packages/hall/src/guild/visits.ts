import type { Craft } from "@guildhall/core"
import { activeWorld } from "../world/active.ts"
import { hikes, lookoutPost } from "../world/hikes.ts"
import type { Post, Spot } from "../world/layout.ts"
import { type Venue, type VenueDoor, type VenueKind, venueOfCraft, venuesNear } from "../world/venues.ts"

/**
 * Who goes into which venue, for the views (guild/views.ts, guild/town/views.ts): a gen 2 island's
 * buildings (world/venues.ts) are visited by what a deed's craft calls for. The visitor walks to the
 * venue's step and, if there is room, goes in through the door (scene/visit.ts: pause, dissolve
 * through the sill, hidden while the deed runs, out again) — a venue holds `capacity` at once, a
 * few more wait in a short line back from its step, and anyone past that goes to the next venue of
 * the kind, or does the deed where they stand. The hand lands and the first generator have no venues: nobody visits.
 */

/** What a figure's view says about its visit; read by scene/Adventurer.tsx. */
export interface Visit {
  /** The venue's id (world/venues.ts), whose windows light while someone is inside. */
  venue: string
  kind: VenueKind
  door: VenueDoor
  /** How many the venue holds at once (a townsperson looks at its load before calling in). */
  capacity: number
  /** The venue is full: they wait in the line at the step, and go in when someone comes out. */
  wait: boolean
  /** A townsperson's: they call in for a while between spells at work, rather than stay (scene/visit.ts). */
  cycle?: true
}

/** A tool done this recently still counts as the deed they are at, between one call and the next. */
export const LINGER_MS = 6000
/** Those waiting at a step stand this far apart, in a line back along the way they came by. */
const QUEUE_GAP = 1.3
/** The line is this long at most: whoever finds it full goes to another venue of the kind, or carries on. */
export const QUEUE_MAX = 3

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
   * Where a deed of `craft` takes someone (the venue nearest the keep with room inside or in its
   * line, else the next of the kind) and the visit that goes with it; undefined where the island has
   * no venue for it, or every one is full and lined up: they do it where they stand.
   */
  forCraft(craft: Craft | undefined): { visit: Visit; target: Post } | undefined {
    const kind = venueOfCraft(craft)
    if (!kind) return undefined
    for (const venue of venuesNear(kind, KEEP, { venues: this.venues })) {
      const admitted = this.admit(venue)
      if (admitted) return admitted
    }
    return undefined
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

  private admit(venue: Venue): { visit: Visit; target: Post } | undefined {
    const inside = this.inside.get(venue.id) ?? 0
    if (inside < venue.capacity) {
      this.inside.set(venue.id, inside + 1)
      return this.door(venue, false)
    }
    const queued = this.waiting.get(venue.id) ?? 0
    if (queued >= QUEUE_MAX) return undefined
    this.waiting.set(venue.id, queued + 1)
    return this.door(venue, true, queued)
  }

  private door(venue: Venue, wait: boolean, queued = 0, cycle = false): { visit: Visit; target: Post } {
    const { step, inward } = venue.door
    // Those waiting line up behind the step, one gap apart, facing the door.
    const back = (queued + 1) * QUEUE_GAP
    const at: Spot = wait ? [step[0] - Math.sin(inward) * back, step[1] - Math.cos(inward) * back] : step
    return {
      visit: {
        venue: venue.id,
        kind: venue.kind,
        door: venue.door,
        capacity: venue.capacity,
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
