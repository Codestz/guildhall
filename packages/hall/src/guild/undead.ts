import { castOf } from "@guildhall/roster"
import type { UndeadKind } from "../world/cast.ts"
import { GRAVEYARD } from "../world/graveyard.ts"
import type { Moment } from "./moments.ts"

/**
 * The graveyard's undead (roadmap G3), as state: who stands at which grave and what they are doing.
 * Pure — no three, no React; scene/Undead.tsx draws it, the store feeds it.
 *
 *   A session fails        a skeleton claws up out of a free grave (rising), then keeps vigil.
 *                          The adventurer still goes to the infirmary: this is the story's echo.
 *   It recovers, or goes   the skeleton dies again and sinks back (sinking), then is gone.
 *   A deed fails           a minion pops up at a random free grave and crumbles after MINION_MS.
 *
 * Two inputs, so a seek can never raise a graveyard burst:
 *   take(moment)   live moments only (the store passes `moments.on`): they decide *how* a skeleton
 *                  appears or goes — rising, sinking, a minion.
 *   sync(fallen)   the state, on every refresh: *who* stands. After a rebuild (`rebuild()`: a seek,
 *                  a loop restart, a live hello) the first sync places the fallen already standing,
 *                  with no rise, and drops anyone no longer fallen without a death.
 */

/** Graves the fallen may hold; the rest of the overflow is a count on the crypt. */
export const MAX_STANDING = 8
/** Minions are flavour: at most this many at once. */
export const MAX_MINIONS = 3
/** Lying still (Skeletons_Inactive_Floor_Pose), then Skeletons_Awaken_Floor (2.3 s). */
export const RISE_MS = 2800
/** Skeletons_Death (2 s), then down into the earth. */
export const SINK_MS = 2600
/** A failed deed's minion waits this long, in case the same failure ends its session. */
export const MINION_GRACE_MS = 2000
/** A minion stands this long before it crumbles. */
export const MINION_MS = 5000
/** How long the Bard looks at a rise before going back to the action. */
export const GLANCE_MS = 3500

/** A failed adventurer, as the graveyard needs them. */
export interface Fallen {
  id: string
  agent: string
  /** As the hall names them: `Implementer II`. */
  title: string
}

export type RiserState = "rising" | "vigil" | "sinking"

export interface Riser {
  /** Unique across risers and minions, for React. */
  key: string
  /** The fallen's session id (a minion: its own key). */
  id: string
  title: string
  kind: UndeadKind
  /** Index into GRAVEYARD.graves. */
  grave: number
  state: RiserState
  /** When the state began (the graveyard's clock, ms). */
  since: number
}

/**
 * Which skeleton a fallen agent becomes, by the look of its archetype: knights and barbarians are
 * warriors, rogues and rangers rogues, mages mages. Wanderers and automatons are minions.
 */
export function undeadOf(agent: string, declared?: string): UndeadKind {
  const { id, model } = castOf(agent, declared).archetype
  if (id === "wanderer" || id === "automaton") return "minion"
  if (model === "knight" || model === "barbarian") return "warrior"
  if (model === "mage") return "mage"
  if (model.startsWith("rogue") || model === "ranger") return "rogue"
  return "minion"
}

export class Undead {
  /** The fallen at their graves (rising, keeping vigil or sinking), at most MAX_STANDING standing. */
  risers: Riser[] = []
  /** Failed deeds' minions, at most MAX_MINIONS. */
  minions: Riser[] = []
  /** Failed deeds waiting out MINION_GRACE_MS, by session. */
  private minionsDue: { id: string; at: number }[] = []
  /** Fallen beyond MAX_STANDING (or without a free grave): shown as a count on the crypt. */
  overflow = 0
  /** Set once anyone has stood here: the skeletons are fetched then, and kept (scene/Undead.tsx). */
  wanted = false
  /** Bumps whenever risers or minions change, so a view can tell. */
  version = 0
  /** A live rise the Bard may glance at: where, and when it began. */
  glance: { x: number; z: number; at: number } | null = null

  private now = 0
  /** The next sync follows a rebuild: whoever is fallen is simply there. */
  private quiet = true
  /** Live failures waiting for the next sync to give them a grave. */
  private pending = new Set<string>()
  private minted = 0

  constructor(private readonly random: () => number = Math.random) {}

  /** The graveyard's clock (ms): the store's real elapsed time. */
  get clock(): number {
    return this.now
  }

  /** Where the Bard should glance, while a rise is fresh. */
  glancing(): { x: number; z: number } | undefined {
    return this.glance && this.now - this.glance.at < GLANCE_MS ? this.glance : undefined
  }

  /** History is being rebuilt: nothing in flight survives, and no one rises from it. */
  rebuild(): void {
    this.pending.clear()
    this.risers = this.risers.filter((r) => r.state !== "sinking")
    this.minions = []
    this.minionsDue = []
    this.glance = null
    this.quiet = true
    this.version++
  }

  /** A live moment. */
  take(moment: Moment): void {
    if (!moment.live) return
    switch (moment.kind) {
      case "fail":
        this.pending.add(moment.id)
        // The failure that ended a session already raises its skeleton: no minion on top.
        this.minionsDue = this.minionsDue.filter((due) => due.id !== moment.id)
        break
      case "recover":
      case "leave":
        this.sink(moment.id)
        break
      case "deed-failed":
        // Held MINION_GRACE_MS: if this failure ends its session, the skeleton tells it alone.
        this.minionsDue.push({ id: moment.id, at: this.now + MINION_GRACE_MS })
        break
      default:
        break
    }
  }

  /** Who is fallen now (failed sessions on stage, in join order), at the graveyard's clock. */
  sync(fallen: readonly Fallen[], now: number): void {
    this.now = now
    this.expire()
    const due = this.minionsDue.filter((d) => now >= d.at)
    if (due.length > 0) {
      this.minionsDue = this.minionsDue.filter((d) => now < d.at)
      for (const _ of due) this.raiseMinion()
    }
    const shown = fallen.slice(0, MAX_STANDING)
    const ids = new Set(shown.map((f) => f.id))
    for (const riser of this.risers) {
      if (riser.state === "sinking" || ids.has(riser.id)) continue
      if (!this.quiet) this.sink(riser.id)
      else {
        this.risers = this.risers.filter((r) => r !== riser)
        this.version++
      }
    }
    let homeless = 0
    for (const f of shown) {
      if (this.risers.some((r) => r.id === f.id && r.state !== "sinking")) continue
      // Back before it had sunk (its party left the stage and returned): it keeps its grave and
      // its watch, rather than a second skeleton rising beside it (review-2 #15).
      const sinking = this.risers.find((r) => r.id === f.id && r.state === "sinking")
      if (sinking) {
        sinking.state = "vigil"
        sinking.since = now
        this.version++
        continue
      }
      const grave = this.free()[0]
      if (grave === undefined) {
        homeless++
        continue
      }
      const rising = !this.quiet && this.pending.has(f.id)
      this.risers.push({
        key: `${f.id}#${++this.minted}`,
        id: f.id,
        title: f.title,
        kind: undeadOf(f.agent),
        grave,
        state: rising ? "rising" : "vigil",
        since: now,
      })
      if (rising) {
        const at = GRAVEYARD.graves[grave]
        if (at) this.glance = { x: at.x, z: at.z, at: now }
      }
      this.version++
    }
    this.overflow = fallen.length - shown.length + homeless
    this.pending.clear()
    this.quiet = false
    if (this.risers.length > 0 || this.minions.length > 0) this.wanted = true
  }

  private sink(id: string): void {
    for (const riser of this.risers)
      if (riser.id === id && riser.state !== "sinking") {
        riser.state = "sinking"
        riser.since = this.now
        this.version++
      }
  }

  private raiseMinion(): void {
    if (this.minions.length >= MAX_MINIONS) return
    const free = this.free()
    const grave = free[Math.floor(this.random() * free.length)]
    if (grave === undefined) return
    const key = `minion#${++this.minted}`
    this.minions.push({ key, id: key, title: "", kind: "minion", grave, state: "rising", since: this.now })
    this.wanted = true
    this.version++
  }

  /** Moves everyone on with the clock: risen to vigil, minions to crumbling, the sunk away. */
  private expire(): void {
    const before = this.risers.length + this.minions.length
    for (const riser of this.risers)
      if (riser.state === "rising" && this.now - riser.since >= RISE_MS) {
        riser.state = "vigil"
        riser.since = this.now
        this.version++
      }
    for (const minion of this.minions)
      if (minion.state === "rising" && this.now - minion.since >= MINION_MS) {
        minion.state = "sinking"
        minion.since = this.now
        this.version++
      }
    const gone = (r: Riser) => r.state === "sinking" && this.now - r.since >= SINK_MS
    this.risers = this.risers.filter((r) => !gone(r))
    this.minions = this.minions.filter((r) => !gone(r))
    if (this.risers.length + this.minions.length !== before) this.version++
  }

  /** Graves nobody stands at, nearest the gate first. */
  private free(): number[] {
    const taken = new Set([...this.risers, ...this.minions].map((r) => r.grave))
    return GRAVEYARD.graves.map((_, i) => i).filter((i) => !taken.has(i))
  }
}
