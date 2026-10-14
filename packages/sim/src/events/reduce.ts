import type { CiState, Craft, PrStatus } from "@guildhall/core"
import type { ArchetypeId } from "../roster/archetypes.ts"
import type { Body } from "../roster/bodies.ts"
import type { Rank } from "../roster/ranks.ts"
import type { Who, Work, WorldEvent } from "./world.ts"

/**
 * The guild's world, folded from its events (plan-hud-events.md §3.1, decision D): who is on the
 * island, where they work and what they are doing, and the sea (open pull requests, CI). `reduce` is
 * pure and immutable (the world it is given is never changed, untouched parts are shared) and reads
 * no clock but `ev.at`, so a world at `t` is the fold of the log up to `t`, played or sought.
 *
 * **Hysteresis (where a hero stands).** A hero's place moves only when its work settles at one place:
 * every call that names files leaves marks on its trail (weight 2 for an edit or a write, ½ for a
 * search, 1 otherwise, split between the files it names); the marks of the last `WINDOW_MS` are
 * weighed and a place that holds more than half the weight leads. A lead that is not where the hero
 * stands becomes its `pending` move, which happens `DWELL_MS` after the lead began, unless before then
 * the lead goes elsewhere, or no place leads (the work scattered again), or the lead comes back to
 * where it stands. So a grep across four packages, a quarter each, moves nobody; a run of edits in
 * one package does, 6 s after it took the lead. Work that names no file leaves no mark. The move's time
 * is exact (`pending.since + DWELL_MS`), so `placeAt(actor, t)` gives it between events too.
 */

/** How far back a hero's trail is weighed. */
export const WINDOW_MS = 20_000
/** How long a place must lead before the hero walks there. */
export const DWELL_MS = 6_000

/** How much one call counts towards a place: an edit is where the work is, a search only looks. */
export function weightOf(craft: Craft): number {
  return craft === "edit" || craft === "write" ? 2 : craft === "search" ? 0.5 : 1
}

export type ActorStatus = "starting" | "working" | "waiting" | "done" | "failed"

/** One mark on a hero's trail: a place its work touched, when, and how much it counts. */
export interface Mark {
  at: number
  place: number
  weight: number
}

/** What a hero is doing: its latest call, running or just done. */
export interface Intent {
  call: string
  tool: string
  craft: Craft
  target: string
  paths: readonly string[]
  places: readonly number[]
  /** When it started (or, for a call heard only when it ended, when it ended). */
  at: number
  /** When it ended; undefined while it runs. */
  ended?: number
  failed?: boolean
}

export interface WorldActor {
  id: string
  parent?: string
  agent: string
  archetype: ArchetypeId
  body: Body
  name: string
  color: string
  title: string
  task?: string
  status: ActorStatus
  /** When the status began. */
  since: number
  joined: number
  /** When it left the island (a finished subagent, `GONE_MS` after it ended). */
  gone?: number
  rank: Rank
  deeds: number
  failures: number
  quests: number
  /** Where it stands: a zone index, or undefined for the hall. */
  place?: number
  /** When it settled there. */
  moved: number
  /** The place its work leads to, and since when (the hysteresis rule above). */
  pending?: { place: number; since: number }
  trail: readonly Mark[]
  intent?: Intent
  /** When it began waiting on a human, while it does. */
  plea?: number
}

export interface Pr {
  repo: string
  n: number
  title: string
  author: string
  branch: string
  status?: PrStatus
  size?: number
  url?: string
  opened: number
  updated: number
}

export interface Ci {
  repo: string
  name: string
  branch: string
  sha: string
  state: CiState
  at: number
}

export interface Issue {
  repo: string
  n: number
  title: string
  author: string
  labels?: string[]
  url?: string
  opened: number
}

/**
 * The petitioners at the quay (PROTOCOL.md §7: every open issue a place in their queue): one comes for
 * each issue opened and is served, first come first, when one closes; the queue is the order they came
 * in, whichever issue a closing names. Pure counts and times, so a seek and a replay see the same queue.
 */
export interface Petitioners {
  /** When each one still waiting came (its issue opened), first come first: one per open issue. */
  waiting: readonly number[]
  /** How many have been served in all (the next served is the `served`-th to have come, from 0). */
  served: number
  /** When the latest were served (an issue closed), oldest first, at most SERVED_KEPT. */
  lately: readonly number[]
}

/** How many of the latest servings `Petitioners.lately` keeps (a queue's shuffle forward is drawn from them). */
export const SERVED_KEPT = 8

export interface SeaState {
  /** Open pull requests, by `repo#n`. */
  prs: ReadonlyMap<string, Pr>
  /** The latest CI run per `repo:branch`. */
  ci: ReadonlyMap<string, Ci>
  pushes: number
  merged: number
  lastPush?: number
  lastRelease?: { repo: string; tag: string; name?: string; at: number }
  /** Open issues, by `repo#n` (none: no issue ever seen). */
  issues?: ReadonlyMap<string, Issue>
  /** The petitioners their issues bring to the quay (none: no issue ever seen). */
  petitioners?: Petitioners
}

export interface GuildWorld {
  /** The last event's `at` (−∞ for an empty world). */
  at: number
  /** The last event's seq (0 for an empty world). */
  seq: number
  /** Events folded. */
  count: number
  actors: ReadonlyMap<string, WorldActor>
  sea: SeaState
  /** The latest events worth telling (captions, the chronicle feed), oldest first, at most `RECENT`. */
  recent: readonly WorldEvent[]
}

/** How many events `recent` keeps. */
export const RECENT = 32

export function emptyWorld(): GuildWorld {
  return {
    at: Number.NEGATIVE_INFINITY,
    seq: 0,
    count: 0,
    actors: new Map(),
    sea: { prs: new Map(), ci: new Map(), pushes: 0, merged: 0 },
    recent: [],
  }
}

/** Kinds that are bookkeeping, not news: they never reach `recent`. */
const QUIET = new Set(["actor.info", "actor.step", "actor.rank"])

/** The world after one event. Pure: `world` is not changed; the parts the event did not touch are shared. */
export function reduce(world: GuildWorld, ev: WorldEvent): GuildWorld {
  const base = { at: ev.at, seq: ev.seq, count: world.count + 1 }
  const recent =
    QUIET.has(ev.kind) || ev.kind === "sea.issue" || (ev.kind === "sea.ci" && !ev.moment)
      ? world.recent
      : told(world, ev)
  if (ev.kind.startsWith("sea.")) return { ...world, ...base, recent, sea: sea(world.sea, ev) }
  const actors = cast(world.actors, ev)
  return { ...world, ...base, recent, actors }
}

function told(world: GuildWorld, ev: WorldEvent): readonly WorldEvent[] {
  const out = world.recent.length >= RECENT ? world.recent.slice(1 - RECENT) : world.recent.slice()
  out.push(ev)
  return out
}

function who(
  w: Who,
): Pick<WorldActor, "id" | "agent" | "archetype" | "body" | "name" | "color" | "title"> &
  Partial<Pick<WorldActor, "parent" | "task">> {
  return {
    id: w.id,
    ...(w.parent !== undefined ? { parent: w.parent } : {}),
    agent: w.agent,
    archetype: w.archetype,
    body: w.body,
    name: w.name,
    color: w.color,
    title: w.title,
    ...(w.task !== undefined ? { task: w.task } : {}),
  }
}

function cast(actors: ReadonlyMap<string, WorldActor>, ev: WorldEvent): ReadonlyMap<string, WorldActor> {
  if (ev.kind === "actor.join") {
    const actor: WorldActor = {
      ...who(ev),
      status: "starting",
      since: ev.at,
      joined: ev.at,
      rank: "apprentice",
      deeds: 0,
      failures: 0,
      quests: 0,
      moved: ev.at,
      trail: [],
    }
    return put(actors, actor)
  }
  if (!("id" in ev)) return actors
  const found = actors.get(ev.id)
  if (!found) return actors
  const a = settle(found, ev.at)
  switch (ev.kind) {
    case "actor.info": {
      const { parent: _p, task: _t, ...rest } = a
      return put(actors, { ...rest, ...who(ev) })
    }
    case "actor.step":
      return put(actors, mark(work(a, ev.at), ev, ev.at, { intent: intentOf(ev, ev.at) }))
    case "actor.deed": {
      const ended = ev.at
      const intent: Intent =
        a.intent?.call === ev.call
          ? { ...a.intent, ended, ...(ev.failed ? { failed: true } : {}) }
          : { ...intentOf(ev, ended), ended, ...(ev.failed ? { failed: true } : {}) }
      const counted = { deeds: a.deeds + 1, failures: a.failures + (ev.failed ? 1 : 0), intent }
      const next = work(a, ev.at)
      return put(actors, ev.stepped ? { ...next, ...counted } : mark(next, ev, ev.at, counted))
    }
    case "actor.quest":
      return put(actors, { ...work(a, ev.at), quests: a.quests + 1 })
    case "actor.plea":
      return put(actors, { ...status(a, "waiting", ev.at), plea: ev.at })
    case "actor.answered": {
      const { plea: _, ...rest } = a
      return put(actors, status(rest, "working", ev.at))
    }
    case "actor.loot":
    case "actor.fail":
      return put(actors, rest(status(a, ev.kind === "actor.loot" ? "done" : "failed", ev.at)))
    case "actor.recover":
    case "actor.resume": {
      const { gone: _, ...back } = a
      return put(actors, status(back, "working", ev.at))
    }
    case "actor.rank":
      return put(actors, { ...a, rank: ev.rank })
    case "actor.leave":
      return put(actors, { ...a, gone: ev.at })
    default:
      return actors
  }
}

function put(actors: ReadonlyMap<string, WorldActor>, actor: WorldActor): ReadonlyMap<string, WorldActor> {
  const next = new Map(actors)
  next.set(actor.id, actor)
  return next
}

function status(a: WorldActor, to: ActorStatus, at: number): WorldActor {
  return a.status === to ? a : { ...a, status: to, since: at }
}

/** Any call means it is at work (a plea answered by working, a starting session's first call). */
function work(a: WorldActor, at: number): WorldActor {
  return a.status === "starting" || a.status === "waiting" ? status(a, "working", at) : a
}

/** Ended: what it was doing and where it was heading are done with; it stays where it stood. */
function rest(a: WorldActor): WorldActor {
  const { pending: _, plea: __, ...still } = a
  return { ...still, trail: [] }
}

function intentOf(w: Work, t: number): Intent {
  return {
    call: w.call,
    tool: w.tool,
    craft: w.craft,
    target: w.target,
    paths: w.paths,
    places: w.places,
    at: t,
  }
}

/** A pending move whose dwell is over has happened (at its own time, not the event's). */
export function settle(a: WorldActor, t: number): WorldActor {
  if (!a.pending || t < a.pending.since + DWELL_MS) return a
  const { pending, ...rest } = a
  return { ...rest, place: pending.place, moved: pending.since + DWELL_MS }
}

/** The place that holds more than half of a trail's weight, if one does. */
export function leadOf(trail: readonly Mark[]): number | undefined {
  const weights = new Map<number, number>()
  let total = 0
  for (const m of trail) {
    weights.set(m.place, (weights.get(m.place) ?? 0) + m.weight)
    total += m.weight
  }
  for (const [place, weight] of weights) if (weight * 2 > total) return place
  return undefined
}

/** One call's marks on the trail, and the hysteresis rule (see the top of this file). */
function mark(a: WorldActor, w: Work, t: number, extra: Partial<WorldActor>): WorldActor {
  if (w.places.length === 0) return { ...a, ...extra }
  const weight = weightOf(w.craft) / w.places.length
  const trail = [
    ...a.trail.filter((m) => m.at > t - WINDOW_MS),
    ...w.places.map((place) => ({ at: t, place, weight })),
  ]
  const lead = leadOf(trail)
  const { pending: _, ...still } = a
  if (lead === undefined || lead === a.place) return { ...still, ...extra, trail }
  const pending = a.pending?.place === lead ? a.pending : { place: lead, since: t }
  return { ...still, ...extra, trail, pending }
}

/** Where an actor stands at `t` (≥ its world's `at`): its place, or the place its pending move reached. */
export function placeAt(a: WorldActor, t: number): number | undefined {
  return a.pending && t >= a.pending.since + DWELL_MS ? a.pending.place : a.place
}

function sea(s: SeaState, ev: WorldEvent): SeaState {
  switch (ev.kind) {
    case "sea.push":
      return { ...s, pushes: s.pushes + 1, lastPush: ev.at }
    case "sea.pr": {
      const key = `${ev.repo}#${ev.n}`
      const prs = new Map(s.prs)
      if (ev.state === "merged" || ev.state === "closed") {
        prs.delete(key)
        return { ...s, prs, merged: s.merged + (ev.state === "merged" ? 1 : 0) }
      }
      const was = s.prs.get(key)
      prs.set(key, prState(ev, was))
      return { ...s, prs }
    }
    case "sea.ci": {
      const ci = new Map(s.ci)
      ci.set(`${ev.repo}:${ev.branch}`, {
        repo: ev.repo,
        name: ev.name,
        branch: ev.branch,
        sha: ev.sha,
        state: ev.state,
        at: ev.at,
      })
      return { ...s, ci }
    }
    case "sea.release":
      return {
        ...s,
        lastRelease: { repo: ev.repo, tag: ev.tag, ...(ev.name ? { name: ev.name } : {}), at: ev.at },
      }
    case "sea.issue":
      return docket(s, ev)
    default:
      return s
  }
}

const NO_PETITIONERS: Petitioners = { waiting: [], served: 0, lately: [] }

/**
 * An issue opened or closed: a petitioner comes to the end of the queue, or the first in it is served.
 * An issue opened again while open, or closed while not open (it was never seen opening), changes nothing.
 */
function docket(s: SeaState, ev: Extract<WorldEvent, { kind: "sea.issue" }>): SeaState {
  const key = `${ev.repo}#${ev.n}`
  const open = s.issues?.has(key) ?? false
  const was = s.petitioners ?? NO_PETITIONERS
  if (ev.state === "opened") {
    if (open) return s
    const issues = new Map(s.issues)
    issues.set(key, {
      repo: ev.repo,
      n: ev.n,
      title: ev.title,
      author: ev.author,
      ...(ev.labels ? { labels: ev.labels } : {}),
      ...(ev.url ? { url: ev.url } : {}),
      opened: ev.at,
    })
    return { ...s, issues, petitioners: { ...was, waiting: [...was.waiting, ev.at] } }
  }
  if (!open) return s
  const issues = new Map(s.issues)
  issues.delete(key)
  return {
    ...s,
    issues,
    petitioners: {
      waiting: was.waiting.slice(1),
      served: was.served + 1,
      lately: [...was.lately, ev.at].slice(-SERVED_KEPT),
    },
  }
}

function prState(ev: Extract<WorldEvent, { kind: "sea.pr" }>, was: Pr | undefined): Pr {
  const status = ev.status ?? was?.status
  const size = ev.size ?? was?.size
  const url = ev.url ?? was?.url
  return {
    repo: ev.repo,
    n: ev.n,
    title: ev.title,
    author: ev.author,
    branch: ev.branch,
    ...(status ? { status } : {}),
    ...(size !== undefined ? { size } : {}),
    ...(url ? { url } : {}),
    opened: was?.opened ?? ev.at,
    updated: ev.at,
  }
}
