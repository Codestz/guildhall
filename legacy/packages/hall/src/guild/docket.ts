import type { PrStatus } from "@guildhall/core"
import type { Tier } from "./quality.ts"
import type { Sighting } from "./sea.ts"

/**
 * The docket: the repo's open work as the island lays it out (PROTOCOL.md §7) — every open pull
 * request a berth at the anchorage, every open issue a place in the petitioners' queue. A pure
 * reading of the sea's sightings at a run time, so a seek, a paused probe shot and a replay lay out
 * the same water and the same quay, and the same events always give the same slots.
 *
 * Berths and places are taken first-fit, in the order things opened, and given back when they end.
 * There are only so many (`Caps`, by quality tier): what opens when all are taken waits, unseen, and
 * takes the first berth freed; the rest is counted (`waitingPulls`, `open`) for the pile chips.
 */

/** Berths at the anchorage and places in the queue, by quality tier (the crowd draws what the tier affords). */
export interface Caps {
  berths: number
  places: number
}

export const CAPS: Readonly<Record<Tier, Caps>> = {
  0: { berths: 2, places: 3 },
  1: { berths: 4, places: 5 },
  2: { berths: 6, places: 8 },
  3: { berths: 8, places: 10 },
}
/** The most berths any tier has: what the instanced layers are sized for. */
export const MAX_BERTHS = 8

/** A ship found at anchor as it ends (opened before the hall was watching) has lain there this long. */
const UNSEEN_AGE_MS = 10_000
/** A diff of this many lines is the largest ship. */
const FULL_SIZE_LINES = 10_000
/** A pull request whose size was not read is drawn this big (0-1). */
const UNKNOWN_SIZE = 0.35

/** What an issue's labels make of its petitioner. */
export type Tint = "bug" | "feature" | "other"

export interface Pull {
  /** `repo#number`: stable while it is on the water. */
  key: string
  number: number
  title: string
  status: PrStatus
  /** How big its diff is, 0-1 (log of the lines). */
  size: number
  /** Its berth, or -1 while it waits for one. */
  berth: number
  /** Run time it took the berth (it sails in from there). */
  seated: number
  ended?: { kind: "pr_merged" | "pr_closed"; at: number }
}

export interface Petition {
  key: string
  number: number
  title: string
  tint: Tint
  /** Its place in the queue, or -1 while the queue is full. */
  place: number
  /** Run time it took the place. */
  since: number
  /** Run time the issue closed: the petitioner walks off. */
  closed?: number
}

export interface Docket {
  /** Every pull request sighted, oldest first (the sea shows those still within their passage). */
  pulls: Pull[]
  /** Every issue sighted that was ever seated, oldest first. */
  petitions: Petition[]
  /** Open pull requests with no berth yet. */
  waitingPulls: number
  /** Open issues in all, seated or not. */
  open: number
}

/** First-fit slots with a waiting line: a freed slot goes to whoever has waited longest. */
class Slots {
  private readonly held: (string | undefined)[]
  private readonly line: string[] = []
  constructor(size: number) {
    this.held = new Array(size).fill(undefined)
  }

  /** The slot `key` takes, or -1 when it must wait. */
  take(key: string): number {
    const slot = this.held.indexOf(undefined)
    if (slot === -1) {
      this.line.push(key)
      return -1
    }
    this.held[slot] = key
    return slot
  }

  /** `key` is done: its slot goes to the first in line, who is returned with it. */
  free(key: string): { key: string; slot: number } | undefined {
    const waiting = this.line.indexOf(key)
    if (waiting !== -1) this.line.splice(waiting, 1)
    const slot = this.held.indexOf(key)
    if (slot === -1) return undefined
    this.held[slot] = undefined
    const next = this.line.shift()
    if (next === undefined) return undefined
    this.held[slot] = next
    return { key: next, slot }
  }
}

/** 0-1 from a diff's lines: a one-liner is a dinghy, ten thousand lines the biggest ship. */
export function sizeOf(lines: number | undefined): number {
  if (lines === undefined || !Number.isFinite(lines)) return UNKNOWN_SIZE
  return Math.min(1, Math.log10(1 + Math.max(0, lines)) / Math.log10(1 + FULL_SIZE_LINES))
}

/** Bugs first (a bug that is also a feature request is still a bug). */
export function tintOf(labels: readonly string[] | undefined): Tint {
  const text = (labels ?? []).join(" ").toLowerCase()
  if (/bug|defect|regression|crash|broken/.test(text)) return "bug"
  if (/feature|enhancement|request|proposal|idea/.test(text)) return "feature"
  return "other"
}

/** The docket at run time `time`: what has been sighted by then, and where it sits. */
export function docketAt(sightings: readonly Sighting[], time: number, caps: Caps): Docket {
  const pulls = new Map<string, Pull>()
  const petitions = new Map<string, Petition>()
  const berths = new Slots(caps.berths)
  const places = new Slots(caps.places)

  const open = (event: { repo: string; number: number; title: string }, at: number): Pull | undefined => {
    const key = `${event.repo}#${event.number}`
    return pulls.get(key) ?? seat(key, event, at)
  }
  const seat = (key: string, event: { number: number; title: string }, at: number, size?: number) => {
    const berth = berths.take(key)
    const pull: Pull = {
      key,
      number: event.number,
      title: event.title,
      status: "open",
      size: sizeOf(size),
      berth,
      seated: berth === -1 ? Number.POSITIVE_INFINITY : at,
    }
    pulls.set(key, pull)
    return pull
  }

  for (const { event, at } of sightings) {
    if (at > time) break
    switch (event.kind) {
      case "pr_opened": {
        const key = `${event.repo}#${event.number}`
        if (pulls.has(key)) break
        const pull = seat(key, event, at, event.size)
        pull.status = event.status ?? "open"
        break
      }
      case "pr_updated": {
        const pull = pulls.get(`${event.repo}#${event.number}`)
        if (pull && !pull.ended) pull.status = event.status
        break
      }
      case "pr_merged":
      case "pr_closed": {
        // Opened before the hall was watching: it is found at anchor as it ends.
        const pull = open(event, at - UNSEEN_AGE_MS)
        if (!pull || pull.ended) break
        pull.ended = { kind: event.kind, at }
        const next = berths.free(pull.key)
        const promoted = next && pulls.get(next.key)
        if (promoted && next) {
          promoted.berth = next.slot
          promoted.seated = at
        }
        break
      }
      case "issue_opened": {
        const key = `${event.repo}#${event.number}`
        if (petitions.has(key)) break
        const place = places.take(key)
        petitions.set(key, {
          key,
          number: event.number,
          title: event.title,
          tint: tintOf(event.labels),
          place,
          since: place === -1 ? Number.POSITIVE_INFINITY : at,
        })
        break
      }
      case "issue_closed": {
        const petition = petitions.get(`${event.repo}#${event.number}`)
        if (!petition || petition.closed !== undefined) break
        petition.closed = at
        const next = places.free(petition.key)
        const promoted = next && petitions.get(next.key)
        if (promoted && next) {
          promoted.place = next.slot
          promoted.since = at
        }
        break
      }
    }
  }

  const all = [...petitions.values()]
  return {
    pulls: [...pulls.values()],
    petitions: all.filter((p) => p.since !== Number.POSITIVE_INFINITY),
    waitingPulls: [...pulls.values()].filter((p) => p.berth === -1 && !p.ended).length,
    open: all.filter((p) => p.closed === undefined).length,
  }
}
