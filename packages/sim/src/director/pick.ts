import { type GuildWorld, placeAt, settle, type WorldActor } from "../events/reduce.ts"
import type { WorldEvent } from "../events/world.ts"
import type { ShowKind } from "../story/worldEvents.ts"

/**
 * The director (plan-hud-events.md D1): which shot the camera runs now, chosen from the guild's world
 * and its latest moments. V1's rule (main:packages/hall/src/guild/director.ts, the Bard), kept and made
 * a pure function: rank **plea > failed > quest > loot > walk**, no shot shorter than `HOLD_MS`, and a
 * user who moves the camera owns it for `USER_MS`. The camera code (the app's) films what it says.
 *
 * `pick(world, moments, t, state)` returns the shot; the caller keeps it as `state.shot` for the next
 * pick, a few times a second. The same inputs give the same shot. What it weighs:
 *
 *   plea    a hero waiting on a human, for as long as it waits: an open plea on camera holds there
 *   failed  a failed deed or session (close), or CI turning red (`storm`, the whole island)
 *   quest   a hero sent out (`actor.join` with a parent), a quest given, a hero called back; a pull
 *           request opened or merged and a release (`ship`, the harbour)
 *   loot    a hero's quest done; CI green again after a red (`clear`)
 *   walk    a hero walking to a new place, from its move until `WALK_MS` later
 *   work    nothing new: the place where most heroes work (`idle`, the overview, when nobody does)
 *   show    a world event starting (story/worldEvents.ts `showHint`): its own weight (V1's scale, halved
 *           onto this one: a dragon's 8 ranks with a failure, a comet's 5 between quest and loot), its
 *           own framing, for its own `ttl`
 *
 * A moment counts for its `LIFE_MS` after it happened. The shot changes only once it has run `HOLD_MS`,
 * and then only for a higher rank, for a subject of the same rank after `SAME_RANK_MS` when that one has
 * not been shown in `RECENT_MS` (or is newer), when its subject has nothing left to show, or after
 * `LONG_HOLD_MS` on one subject (a different one, or the overview to clear the palate). A plea on
 * camera holds until it is answered. That is the whole of the anti-thrash rule: every cut is at least
 * `HOLD_MS` after the one before it.
 */

/** What the camera looks at. */
export type Focus =
  | { kind: "hero"; id: string }
  | { kind: "place"; place: number }
  | { kind: "harbour" }
  | { kind: "overview" }
  /** A world event (story/worldEvents.ts): the camera asks the show's site where it is; `lift` aims up. */
  | { kind: "show"; id: string; show: ShowKind; lift?: number }

/** Why: the beat that chose the shot. */
export type Reason =
  | "user"
  | "plea"
  | "failed"
  | "storm"
  | "quest"
  | "ship"
  | "loot"
  | "clear"
  | "walk"
  | "work"
  | "idle"
  | "show"

/** How far the camera stands: a hero's face, a place with its people, the whole island. */
export type Distance = "close" | "mid" | "map"

/** The ranking, V1's: plea > failed > quest > loot > walk; the sea's beats beside their kin. */
export const RANK: Readonly<Record<Reason, number>> = {
  user: 9,
  plea: 5,
  failed: 4,
  storm: 4,
  quest: 3,
  ship: 3,
  loot: 2,
  clear: 2,
  walk: 1,
  work: 0.5,
  idle: 0,
  /** A show's default; each hint brings its own (`weight / 2`). */
  show: 4,
}

/** The framing each beat asks for. */
export const DISTANCE: Readonly<Record<Exclude<Reason, "user">, Distance>> = {
  plea: "close",
  failed: "close",
  storm: "map",
  quest: "mid",
  ship: "mid",
  loot: "close",
  clear: "map",
  walk: "mid",
  work: "mid",
  idle: "map",
  show: "map",
}

/** No shot is shorter than this. */
export const HOLD_MS = 4000
/** A user who moved the camera owns it this long. */
export const USER_MS = 10_000
/** A subject of the same rank may take the camera once the shot has run this long. */
export const SAME_RANK_MS = 6000
/** Shown within this long: not fresh, so a same-rank cut does not come back to it. */
export const RECENT_MS = 12_000
/** Held this long on one subject: another, or the overview. */
export const LONG_HOLD_MS = 20_000
/** A hero walks for about this long after it moves (the camera follows). */
export const WALK_MS = 9000
/** How long a moment counts after it happened, by beat. */
export const LIFE_MS: Readonly<Record<"failed" | "storm" | "quest" | "ship" | "loot" | "clear", number>> = {
  failed: 10_000,
  storm: 12_000,
  quest: 14_000,
  ship: 10_000,
  loot: 8000,
  clear: 8000,
}

/** The shot being run. */
export interface Shot {
  focus: Focus
  reason: Reason
  distance: Distance
  /** When this shot began (the cut). */
  since: number
  /** No cut before this. */
  holdUntil: number
  /** When the beat it shows happened. */
  start: number
  /** The focus as a key (`hero:<id>`, `place:<n>`, `harbour`, `overview`, `show:<id>`). */
  key: string
  /** Its beat's rank, when the beat brought its own (a show's hint). */
  rank?: number
  /** When each subject was last on camera (kept for `RECENT_MS`, by key). */
  seen: Readonly<Record<string, number>>
}

export interface DirectorState {
  /** The last shot `pick` returned. */
  shot?: Shot
  /** When the user last moved the camera. */
  userAt?: number
  /** What the user is looking at, if they picked something (a hero clicked, a place); else the last shot's. */
  userFocus?: Focus
}

/** A focus as a key. */
export function focusKey(focus: Focus): string {
  switch (focus.kind) {
    case "hero":
      return `hero:${focus.id}`
    case "place":
      return `place:${focus.place}`
    case "show":
      return `show:${focus.id}`
    default:
      return focus.kind
  }
}

const OVERVIEW: Focus = { kind: "overview" }
const HARBOUR: Focus = { kind: "harbour" }

interface Candidate {
  focus: Focus
  key: string
  reason: Exclude<Reason, "user">
  rank: number
  /** When its beat happened. */
  start: number
  distance: Distance
}

/**
 * A world event's hint (story/worldEvents.ts `showHint`): film `focus` from `start` for `ttl` ms at
 * `distance`, ranked `weight / 2` (V1's 10-a-plea scale onto this one's 5).
 */
export interface FocusHint {
  focus: Extract<Focus, { kind: "show" }>
  weight: number
  start: number
  ttl: number
  distance: Distance
}

const hero = (id: string): Focus => ({ kind: "hero", id })

function candidate(focus: Focus, reason: Exclude<Reason, "user">, start: number): Candidate {
  return { focus, key: focusKey(focus), reason, rank: RANK[reason], start, distance: DISTANCE[reason] }
}

/** The beat a moment is, if it is one the director films. */
function beatOf(ev: WorldEvent): Candidate | undefined {
  switch (ev.kind) {
    case "actor.deed":
      return ev.failed ? candidate(hero(ev.id), "failed", ev.at) : undefined
    case "actor.fail":
      return candidate(hero(ev.id), "failed", ev.at)
    case "actor.join":
      return ev.parent !== undefined ? candidate(hero(ev.id), "quest", ev.at) : undefined
    case "actor.quest":
    case "actor.resume":
    case "actor.recover":
      return candidate(hero(ev.id), "quest", ev.at)
    case "actor.loot":
      return candidate(hero(ev.id), "loot", ev.at)
    case "sea.pr":
      return ev.state === "opened" || ev.state === "merged" ? candidate(HARBOUR, "ship", ev.at) : undefined
    case "sea.release":
      return candidate(HARBOUR, "ship", ev.at)
    case "sea.ci":
      return ev.moment === "sea-red"
        ? candidate(OVERVIEW, "storm", ev.at)
        : ev.moment === "sea-green"
          ? candidate(OVERVIEW, "clear", ev.at)
          : undefined
    default:
      return undefined
  }
}

/** When an actor's latest move happened, as of `t` (its pending move counts once its dwell is over). */
function movedAt(a: WorldActor, t: number): number | undefined {
  const s = settle(a, t)
  if (s.place === undefined || s.moved <= a.joined) return undefined
  return s.moved
}

/** Everything worth a shot at `t`. */
function candidates(
  world: GuildWorld,
  moments: readonly WorldEvent[],
  t: number,
  hints: readonly FocusHint[],
): Candidate[] {
  const out: Candidate[] = []
  for (const h of hints)
    if (t >= h.start && t - h.start < h.ttl)
      out.push({
        focus: h.focus,
        key: focusKey(h.focus),
        reason: "show",
        rank: h.weight / 2,
        start: h.start,
        distance: h.distance,
      })
  const here = (id: string) => {
    const a = world.actors.get(id)
    return a !== undefined && a.gone === undefined
  }
  for (const ev of moments) {
    if (ev.at > t) continue
    const c = beatOf(ev)
    if (!c) continue
    if (t - c.start >= LIFE_MS[c.reason as keyof typeof LIFE_MS]) continue
    if (c.focus.kind === "hero" && !here(c.focus.id)) continue
    out.push(c)
  }
  const working = new Map<number, number>()
  for (const a of world.actors.values()) {
    if (a.gone !== undefined) continue
    if (a.plea !== undefined && a.plea <= t) out.push(candidate(hero(a.id), "plea", a.plea))
    const moved = movedAt(a, t)
    if (moved !== undefined && moved <= t && t - moved < WALK_MS)
      out.push(candidate(hero(a.id), "walk", moved))
    const place = placeAt(a, t)
    if (place !== undefined && (a.status === "working" || a.status === "waiting"))
      working.set(place, (working.get(place) ?? 0) + 1)
  }
  let busiest: [number, number] | undefined
  for (const entry of working)
    if (!busiest || entry[1] > busiest[1] || (entry[1] === busiest[1] && entry[0] < busiest[0]))
      busiest = entry
  if (busiest) out.push(candidate({ kind: "place", place: busiest[0] }, "work", t))
  out.push(candidate(OVERVIEW, "idle", t))
  return out
}

const fresh = (c: Candidate, seen: Readonly<Record<string, number>>, t: number) => {
  const at = seen[c.key]
  return at === undefined || t - at >= RECENT_MS
}

/** The best of `list`: highest rank, then not shown lately, then the newest beat, then by key. */
function best(list: readonly Candidate[], seen: Readonly<Record<string, number>>, t: number): Candidate {
  let top = list[0] as Candidate
  for (const c of list.slice(1)) {
    if (c.rank !== top.rank) {
      if (c.rank > top.rank) top = c
      continue
    }
    const cf = fresh(c, seen, t)
    const tf = fresh(top, seen, t)
    if (cf !== tf) {
      if (cf) top = c
      continue
    }
    if (c.start !== top.start) {
      if (c.start > top.start) top = c
      continue
    }
    if (c.key < top.key) top = c
  }
  return top
}

function remember(seen: Readonly<Record<string, number>>, key: string, t: number): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [k, at] of Object.entries(seen)) if (t - at < RECENT_MS * 2) out[k] = at
  out[key] = t
  return out
}

function cut(c: Candidate, t: number, seen: Readonly<Record<string, number>>): Shot {
  return {
    focus: c.focus,
    reason: c.reason,
    distance: c.distance,
    since: t,
    holdUntil: t + HOLD_MS,
    start: c.start,
    key: c.key,
    ...(c.reason === "show" ? { rank: c.rank } : {}),
    seen: remember(seen, c.key, t),
  }
}

/** The same shot, still running: reframed if its subject's beat rose (no cut), and seen now. */
function keep(shot: Shot, now: Candidate | undefined, t: number): Shot {
  const rose = now !== undefined && now.rank > (shot.rank ?? RANK[shot.reason])
  return {
    ...shot,
    ...(rose ? { reason: now.reason, distance: now.distance, start: now.start, rank: now.rank } : {}),
    seen: remember(shot.seen, shot.key, t),
  }
}

/** The framing for a focus the user chose. */
const userDistance = (focus: Focus): Distance =>
  focus.kind === "hero" ? "close" : focus.kind === "overview" ? "map" : "mid"

/**
 * The shot to run at `t` (see the top of this file). `moments` are the latest world events (default
 * `world.recent`); `hints` the world events' (story/worldEvents.ts `showHint`), none by default.
 */
export function pick(
  world: GuildWorld,
  moments: readonly WorldEvent[] = world.recent,
  t: number = world.at,
  state: DirectorState = {},
  hints: readonly FocusHint[] = [],
): Shot {
  const prev = state.shot
  const seen = prev?.seen ?? {}
  if (state.userAt !== undefined && t >= state.userAt && t - state.userAt < USER_MS) {
    const focus = state.userFocus ?? prev?.focus ?? OVERVIEW
    const key = focusKey(focus)
    const same = prev?.reason === "user" && prev.key === key
    return {
      focus,
      reason: "user",
      distance: same ? prev.distance : userDistance(focus),
      since: same ? prev.since : state.userAt,
      holdUntil: state.userAt + USER_MS,
      start: state.userAt,
      key,
      seen: remember(seen, key, t),
    }
  }
  const list = candidates(world, moments, t, hints)
  const top = best(list, seen, t)
  if (!prev || prev.reason === "user" || t < prev.since) return cut(top, t, seen)
  const mine = list.filter((c) => c.key === prev.key)
  const now = mine.length > 0 ? best(mine, seen, t) : undefined
  if (t < prev.holdUntil) return keep(prev, now, t)
  if (!now) return cut(top, t, seen)
  if (top.rank > now.rank) return cut(top, t, seen)
  if (now.reason === "plea") return keep(prev, now, t)
  const held = t - prev.since
  if (
    top.key !== prev.key &&
    top.rank === now.rank &&
    held >= SAME_RANK_MS &&
    (fresh(top, seen, t) || top.start > prev.start)
  )
    return cut(top, t, seen)
  if (held >= LONG_HOLD_MS) {
    const others = list.filter((c) => c.key !== prev.key && c.rank > 0)
    const next = others.length > 0 ? best(others, seen, t) : undefined
    if (!next && prev.key === "overview") return keep(prev, now, t)
    return cut(next ?? candidate(OVERVIEW, "idle", t), t, seen)
  }
  return keep(prev, now, t)
}

/** The director as one object, for the camera: `director.pick(world, moments, t, state)`. */
export const director = { pick } as const
