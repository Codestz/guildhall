import { bundledChronicle } from "../../world/chronicle/bundled.ts"
import { CHRONICLES_CDN } from "../../world/chronicle/catalog.ts"
import type { Chronicle, Day } from "../../world/chronicle/format.ts"
import { dayAt, EPILOGUE_S, PROLOGUE_S } from "../../world/chronicle/growth.ts"
import { growing, growth } from "../../world/chronicle/growthControl.ts"
import { WINDOW_DAYS } from "../../world/town/presence.ts"
import { comingsAndGoings, filmWindow, type Resident, townsfolkAt } from "../../world/town/townsfolk.ts"
import type { World } from "../../world/world.ts"
import type { Names } from "../casting.ts"
import { PROBE } from "../mode.ts"
import { quality, type Tier } from "../quality.ts"
import type { AdventurerView } from "../views.ts"
import { townViewsOf } from "./views.ts"

/**
 * The town (ADR 0013): on a repo's island with a chronicle, its contributors live there as
 * townsfolk. This keeps who is in town on the day the island shows — today, or the growth film's
 * day while it plays — and their views for the cast (scene/Scene.tsx), the dossier and the film's
 * tape. The cast ticks it once a frame; it reads the island again at most UPDATE_S apart (the film
 * moves weeks a second), and only notifies when someone changed.
 *
 * The chronicle is a deep one (bundled with the hall, else the chronicles repo's CDN), or the one
 * the film loaded; a town is never worth GitHub API calls of its own.
 */

/** How many the town shows at each quality tier: the cast's crowd draws them all at High. */
export const TOWN_CAP: Readonly<Record<Tier, number>> = { 0: 60, 1: 120, 2: 300, 3: 300 }
/** Least real time between two readings while the day moves. */
const UPDATE_S = 0.25

const NO_VIEWS: readonly AdventurerView[] = []

/** `?townsfolk=N` caps the town for a measurement (0: nobody); unset, the tier's cap. */
function asked(): number | undefined {
  if (typeof location === "undefined") return undefined
  const value = new URLSearchParams(location.search).get("townsfolk")
  return value === null || value === "" || Number.isNaN(Number(value)) ? undefined : Number(value)
}

export class Town {
  /** Who is in town, in the chronicle's order. */
  residents: readonly Resident[] = []
  views: readonly AdventurerView[] = NO_VIEWS
  /** The chronicle they come from, once there is one for this island. */
  chronicle: Chronicle | undefined
  /** The day shown, and how many days count as "now" on it. */
  day: Day = 0
  window = WINDOW_DAYS
  /** Every day someone came or went (the ferry's timetable). */
  comings: readonly Day[] = []
  /** Bumps when the day jumps (a seek, the film's start or end): whoever is mid-walk is let go. */
  epoch = 0
  /** Bumps on every notified change (useSyncExternalStore's snapshot). */
  version = 0
  cap: number | undefined = asked()

  private world: World | undefined
  private names: Names = "world"
  private tier: Tier = quality.tier
  private wait = 0
  private shown = Number.NaN
  private loaded = new WeakMap<World, Promise<Chronicle | undefined>>()
  private listeners = new Set<() => void>()

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  snapshot = (): number => this.version

  /** The resident behind a view id, if it is one of the town's. */
  resident(id: string | null): Resident | undefined {
    return id ? this.residents.find((r) => r.id === id) : undefined
  }

  /** Once a frame (the cast): `delta` real seconds went by on `world`, named the `names` way. */
  tick(world: World, names: Names, delta: number): void {
    if (world !== this.world) this.enter(world)
    const film = growing() ? growth.film : undefined
    const chronicle = film?.chronicle ?? this.chronicle
    const changed = names !== this.names || quality.tier !== this.tier
    this.names = names
    this.tier = quality.tier
    this.wait -= delta
    if (!chronicle || world.kind !== "repo" || (growing() && !film)) {
      this.show(NO_VIEWS, [])
      return
    }
    const plan = film?.plan
    // The harbour is still rising through the film's prologue: nobody is ashore yet.
    if (plan && growth.t < PROLOGUE_S) {
      this.show(NO_VIEWS, [])
      return
    }
    const day = plan ? Math.floor(dayAt(plan, growth.t)) : chronicle.end
    if (day === this.shown && !changed) return
    if (this.wait > 0 && !changed && Number.isFinite(this.shown)) return
    this.wait = UPDATE_S
    const window = plan
      ? filmWindow((plan.end - plan.start) / Math.max(1, plan.duration - PROLOGUE_S - EPILOGUE_S))
      : WINDOW_DAYS
    const jumped = Number.isFinite(this.shown) && Math.abs(day - this.shown) > 2 * window
    if (jumped) this.epoch++
    this.shown = day
    this.day = day
    this.window = window
    if (chronicle !== this.chronicle && film) this.adopt(chronicle)
    const residents = townsfolkAt(chronicle, world, day, {
      cap: this.cap ?? TOWN_CAP[this.tier],
      window,
    })
    const previous = new Map(this.views.map((view) => [view.id, view]))
    const views = townViewsOf(residents, world, names, !jumped, previous)
    this.show(views, residents)
  }

  /** A new island: nobody until its chronicle is in (none for the hand-drawn lands). */
  private enter(world: World): void {
    this.world = world
    this.chronicle = undefined
    this.comings = []
    this.shown = Number.NaN
    this.epoch++
    const repo = world.kind === "repo" ? world.repo?.repo : undefined
    if (!repo) return
    let load = this.loaded.get(world)
    if (!load) {
      load = deepChronicle(repo)
      this.loaded.set(world, load)
    }
    load.then((chronicle) => {
      if (this.world === world && chronicle && !this.chronicle) this.adopt(chronicle)
    })
  }

  private adopt(chronicle: Chronicle): void {
    this.chronicle = chronicle
    this.comings = comingsAndGoings(chronicle)
    this.shown = Number.NaN
  }

  private show(views: readonly AdventurerView[], residents: readonly Resident[]): void {
    if (views === this.views || (views.length === 0 && this.views.length === 0)) return
    if (views.length === this.views.length && views.every((view, i) => view === this.views[i])) {
      this.residents = residents
      return
    }
    if (views.length === 0) this.shown = Number.NaN
    this.views = views
    this.residents = residents
    this.version++
    for (const listener of this.listeners) listener()
  }
}

/** The deep chronicle of `repo`: bundled with the hall, else the chronicles repo's; never a quick build. */
async function deepChronicle(repo: string): Promise<Chronicle | undefined> {
  return (await bundledChronicle(repo)) ?? (await bundledChronicle(repo, fetch, CHRONICLES_CDN))
}

export const town = new Town()

// Probes: `town.residents`, `town.views`, `town.cap` (scripts/probe.ts eval).
if (PROBE && typeof window !== "undefined") Object.assign(window, { town })
