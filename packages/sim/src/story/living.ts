import type { Craft } from "@guildhall/core"
import type { WorldEvent } from "../events/world.ts"
import type { GraveCause, Show } from "./worldEvents.ts"

/**
 * Living work: the island shows what the work touches, place by place, from the same events the heroes
 * act on. Pure: the same log, shows and `t` give the same picture, played through or sought.
 *
 *   read     a call that reads a place (a read; a search at half) makes it glow: up in `readRiseMs`,
 *            held while the call runs, out over `readFadeMs` once it is done
 *   edit     a call that edits or writes a place raises its scaffold, from the call's start until
 *            `editLingerMs` after it ends
 *   blight   a grave whose cause stands at a place (a session that fell there, its tests failing there:
 *            the graveyard's own rule, story/worldEvents.ts) blights the place from the skeleton's rise
 *            until the fix lands, then heals over `healMs`
 *
 * A place is a zone index, as the world's events name it. A span is one call or one grave; `livingLevel`
 * says how strong it is at a time. With `still` (reduced motion) every level is flat: on or off, no ease.
 */
export const LIVING = {
  /** A read's glow comes up over this, ms. */
  readRiseMs: 450,
  /** …and fades out over this once the read is done, ms. */
  readFadeMs: 4000,
  /** A search only looks: it glows this much of a read. */
  searchLevel: 0.55,
  /** An edit's scaffold stands this long after the edit is done, ms. */
  editLingerMs: 9000,
  /** Blight comes over a failing place in this (the skeleton clawing up takes 2.8 s), ms. */
  blightInMs: 1600,
  /** …and heals in this once the fix lands, ms. */
  healMs: 1800,
  /** How far back the calls are read, ms: a read or an edit that runs longer is not followed. */
  lookbackMs: 60_000,
} as const

export type LivingKind = "read" | "edit" | "blight"

export interface LivingSpan {
  kind: LivingKind
  /** The place (a zone index). */
  place: number
  /** Who: the session's id (a grave's fallen; none for a grave with nobody). */
  who?: string
  /** A grave's fallen as the hall named them then. */
  name?: string
  /** What raised a blight's grave: a fall, red tests. */
  cause?: GraveCause
  /** The call's id (read, edit) or the show's (blight): stable while it lasts. */
  key: string
  /** When the call started, or the grave rose (ms, the log's clock). */
  start: number
  /** When the call ended, or the fix landed; undefined while it runs or stands (as of the `t` read). */
  end?: number
  /** Its full strength (a search's read is weaker). */
  level: number
}

const READS: ReadonlySet<Craft> = new Set<Craft>(["read", "search"])
const EDITS: ReadonlySet<Craft> = new Set<Craft>(["edit", "write"])

const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x))

/** The first index of `events` (sorted by `at`) whose `at` is over `t` (the count at or before it). */
function countAt(events: readonly { at: number }[], t: number): number {
  let lo = 0
  let hi = events.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if ((events[mid] as { at: number }).at <= t) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** The first index whose `at` is at or over `t`. */
function firstFrom(events: readonly { at: number }[], t: number): number {
  let lo = 0
  let hi = events.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if ((events[mid] as { at: number }).at < t) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * The reads and edits that still show at `t`: the log's calls of the last `lookbackMs` up to `t`, one
 * span per call and place it names (a call across two packages glows both), oldest first. A call heard
 * only as it ended starts and ends there.
 */
export function workSpans(events: readonly WorldEvent[], t: number): LivingSpan[] {
  const to = countAt(events, t)
  const from = firstFrom(events, t - LIVING.lookbackMs)
  const byCall = new Map<string, LivingSpan[]>()
  const out: LivingSpan[] = []
  for (let i = from; i < to; i++) {
    const ev = events[i] as WorldEvent
    if (ev.kind !== "actor.step" && ev.kind !== "actor.deed") continue
    const read = READS.has(ev.craft)
    if (!read && !EDITS.has(ev.craft)) continue
    const key = `${ev.id}:${ev.call}`
    const open = byCall.get(key)
    if (open) {
      if (ev.kind === "actor.deed") for (const s of open) s.end = ev.at
      continue
    }
    if (ev.places.length === 0) continue
    const spans: LivingSpan[] = []
    for (const place of new Set(ev.places)) {
      const span: LivingSpan = {
        kind: read ? "read" : "edit",
        place,
        who: ev.id,
        key,
        start: ev.at,
        level: ev.craft === "search" ? LIVING.searchLevel : 1,
        ...(ev.kind === "actor.deed" ? { end: ev.at } : {}),
      }
      spans.push(span)
      out.push(span)
    }
    byCall.set(key, spans)
  }
  return out.filter((s) => showing(s, t))
}

/** Whether a span still shows at `t` (or will: one just started is at 0). */
const showing = (s: LivingSpan, t: number): boolean =>
  s.end === undefined ||
  t <
    s.end + (s.kind === "read" ? LIVING.readFadeMs : s.kind === "edit" ? LIVING.editLingerMs : LIVING.healMs)

/**
 * The blight at `t`: one span per grave standing at a place, from its rise to its fix (`Grave.fixed`, as
 * `t` knows it), while it shows (healing included). A failed deed's minion is flavour, not a failing
 * place; a red CI's grave stands at no place (the storm is its sign).
 */
export function blightSpans(shows: readonly Show[], t: number): LivingSpan[] {
  const out: LivingSpan[] = []
  for (const show of shows) {
    const g = show.params.grave
    const place = show.params.where?.place
    if (show.kind !== "undead" || !g || g.minion || place === undefined) continue
    const span: LivingSpan = {
      kind: "blight",
      place,
      key: show.id,
      start: g.rise,
      level: 1,
      ...(show.params.who ? { who: show.params.who.id, name: show.params.who.name } : {}),
      cause: g.cause,
      ...(g.fixed !== undefined && g.fixed <= t ? { end: g.fixed } : {}),
    }
    if (showing(span, t)) out.push(span)
  }
  return out
}

/** How strong a span is at `t` (0 … its level). `still`: flat, on or off (reduced motion). */
export function livingLevel(s: LivingSpan, t: number, still = false): number {
  if (t < s.start) return 0
  const end = s.end
  switch (s.kind) {
    case "read": {
      if (still) return end === undefined || t < end + LIVING.readFadeMs / 2 ? s.level : 0
      // it comes up from its start and goes out from its end: a quick read (or one heard only as it
      // ended) still comes up as it fades
      const rise = smooth((t - s.start) / LIVING.readRiseMs)
      if (end === undefined || t <= end) return s.level * rise
      const fade = 1 - (t - end) / LIVING.readFadeMs
      return fade <= 0 ? 0 : s.level * rise * smooth(fade)
    }
    case "edit":
      return end === undefined || t < end + LIVING.editLingerMs ? 1 : 0
    case "blight": {
      if (still) return end === undefined || t < end ? 1 : 0
      const rise = (to: number) => smooth((to - s.start) / LIVING.blightInMs)
      if (end === undefined || t <= end) return rise(t)
      const heal = 1 - (t - end) / LIVING.healMs
      return heal <= 0 ? 0 : rise(end) * smooth(heal)
    }
  }
}

/** What is happening at a place at a time: how strong each kind is, and who. */
export interface PlaceLiving {
  read: number
  edit: number
  blight: number
  /** Who reads it, edits it, fell there (session ids, first seen first). */
  readers: string[]
  editors: string[]
  /** Who fell there or whose tests are red there (as the grave says), while it stands. */
  failing: { who?: string; name?: string; cause?: GraveCause }[]
}

/** Each place's state at `t` from its spans (the strongest of each kind). For the tooltip and the tests. */
export function livingAt(spans: readonly LivingSpan[], t: number, still = false): Map<number, PlaceLiving> {
  const out = new Map<number, PlaceLiving>()
  for (const s of spans) {
    const v = livingLevel(s, t, still)
    if (v <= 0) continue
    let p = out.get(s.place)
    if (!p) {
      p = { read: 0, edit: 0, blight: 0, readers: [], editors: [], failing: [] }
      out.set(s.place, p)
    }
    p[s.kind] = Math.max(p[s.kind], v)
    if (s.kind === "blight") {
      if (s.end === undefined)
        p.failing.push({
          ...(s.who ? { who: s.who } : {}),
          ...(s.name ? { name: s.name } : {}),
          ...(s.cause ? { cause: s.cause } : {}),
        })
    } else {
      const list = s.kind === "read" ? p.readers : p.editors
      if (s.who && !list.includes(s.who)) list.push(s.who)
    }
  }
  return out
}

/** The places an edit's scaffold stands at, at `t`. */
export function editedPlaces(spans: readonly LivingSpan[], t: number): Set<number> {
  const out = new Set<number>()
  for (const s of spans) if (s.kind === "edit" && livingLevel(s, t) > 0) out.add(s.place)
  return out
}
