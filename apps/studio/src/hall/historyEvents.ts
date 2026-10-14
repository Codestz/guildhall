/**
 * The history's narration (user 10-14, "events while the island grows"): while the hall plays a repo's
 * growth, or rests where a scrub left it, V1's growth film told what was happening: the first commit, a
 * hand arriving, a place founded, a release. The moments come from the chronicle (sim
 * `historyMomentsOf`); this file is when they are told, as pure functions of the clock's `t`:
 *
 *   captions  the narrator's pill (an era opening as an act's title card): at most one per
 *             `CAPTION_GAP_S` of playback at the clock's speed, the heaviest kept when they crowd
 *   toasts    the next tier, in the stack bottom left: what the captions had no room for, at most one
 *             per `TOAST_GAP_S`
 *   feed      the Chronicle: every moment up to the clock's day, under its era's heading
 *
 * Nothing here keeps time of its own: the same `t` (and speed) always picks the same caption and toasts,
 * so a scrub tells what a playthrough would.
 */
import {
  type Chronicle,
  DAY_MS,
  type HistoryMoment,
  historyMomentsOf,
  type MomentEra,
  type RepoLegend,
} from "@guildhall/sim"
import type { CaptionView, ChronicleEntry, EntryKind } from "@guildhall/ui"
import { HISTORY_SECONDS } from "./clock.ts"
import { tOfDay } from "./history.ts"

/** Least playback between two captions, seconds (at the clock's speed). */
export const CAPTION_GAP_S = 2.5
/** How long a caption is the clock's, playback seconds; the pill holds it `CAPTION_HOLD_MS` of wall time. */
export const CAPTION_HOLD_S = 2.4
/** A caption's time on screen, ms (a newer one replaces it sooner). */
export const CAPTION_HOLD_MS = 3600
/** An era's title card stays a little longer. */
export const CHAPTER_HOLD_MS = 4200
/** Least playback between two toasts, seconds. */
export const TOAST_GAP_S = 1
/** A toast is the clock's for this long of playback, seconds: a scrub past it leaves it be. */
export const TOAST_WINDOW_S = 3
/** A toast's life on screen, ms. */
export const TOAST_LIFE_MS = 4500
/** The least weight a moment needs for a toast (renamings and the smallest places stay in the feed). */
export const TOAST_MIN_WEIGHT = 40

/** A moment placed on the clock: where along the history (0..1) it is told. */
export interface Beat {
  moment: HistoryMoment
  /** Its day along the history, 0..1. */
  t: number
  /** When it is told, if a little after its day (a caption that waited for a heavier one, `spaced`). */
  at?: number
}

/** When a beat is told. */
const toldAt = (b: Beat) => b.at ?? b.t

export interface HistoryEvents {
  /** Every moment, oldest first, with its `t`. */
  beats: readonly Beat[]
  /** The ones a caption tells at this speed, oldest first. */
  captions: readonly Beat[]
  /** The ones a toast tells (not the captions'), oldest first. */
  toasts: readonly Beat[]
}

/** The history's span in `t` that `seconds` of playback covers at `rate`. */
export function gapOf(seconds: number, rate: number, duration = HISTORY_SECONDS): number {
  return (seconds * Math.max(0, rate)) / Math.max(1e-3, duration)
}

/** The eras as the moments open them: the book's, its titles without their code marks. */
export function erasOf(legend: Pick<RepoLegend, "eras"> | null): MomentEra[] {
  return (legend?.eras ?? []).map((e) => ({
    from: Math.floor(e.begin / DAY_MS),
    numeral: e.numeral,
    title: e.title.replace(/`/g, ""),
    span: e.span,
    ...(e.release ? { release: e.release } : {}),
  }))
}

/** Every moment of the chronicle on the clock. */
export function beatsOf(
  c: Chronicle,
  legend: Pick<RepoLegend, "eras"> | null,
  placeOf?: (unit: string) => string | undefined,
): Beat[] {
  const moments = historyMomentsOf(c, { eras: erasOf(legend), ...(placeOf ? { placeOf } : {}) })
  return moments.map((moment) => ({ moment, t: tOfDay(c, moment.day) }))
}

/** A beat may be told this share of the gap after its own day, when a heavier one holds its moment. */
export const SLIP = 0.4

/**
 * The beats kept when no two may be told closer than `gap` (in `t`): the heaviest first (the earlier of
 * two as heavy), each told at its own `t` or, when one kept before holds that moment, as soon after as
 * leaves the gap clear, at most `SLIP` of the gap late (`at`); else not at all. Oldest first. Pure.
 */
export function spaced(beats: readonly Beat[], gap: number, minWeight = 0): Beat[] {
  const order = beats
    .filter((b) => b.moment.weight >= minWeight)
    .sort((a, b) => b.moment.weight - a.moment.weight || a.t - b.t)
  const kept: Beat[] = []
  const clear = (at: number) => kept.every((k) => Math.abs(toldAt(k) - at) >= gap - 1e-9)
  for (const b of order) {
    const tries = [b.t, ...kept.map((k) => toldAt(k) + gap)]
      .filter((at) => at >= b.t && at <= Math.min(1, b.t + SLIP * gap))
      .sort((x, y) => x - y)
    const at = tries.find(clear)
    if (at !== undefined) kept.push(at === b.t ? b : { ...b, at })
  }
  return kept.sort((a, b) => toldAt(a) - toldAt(b))
}

/** The captions and toasts for a speed (`rate`, the clock's). */
export function scheduleOf(beats: readonly Beat[], rate: number, duration = HISTORY_SECONDS): HistoryEvents {
  const captions = spaced(beats, gapOf(CAPTION_GAP_S, rate, duration))
  const told = new Set(captions.map((b) => b.moment.id))
  const toasts = spaced(
    beats.filter((b) => !told.has(b.moment.id)),
    gapOf(TOAST_GAP_S, rate, duration),
    TOAST_MIN_WEIGHT,
  )
  return { beats, captions, toasts }
}

/** The index of the beat (of `list`, oldest first) the clock is on at `t`: the last at or before it, within `hold`; -1 for none. */
export function beatAt(list: readonly Beat[], t: number, hold: number): number {
  let lo = 0
  let hi = list.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (toldAt(list[mid] as Beat) <= t + 1e-9) lo = mid + 1
    else hi = mid
  }
  const k = lo - 1
  const b = list[k]
  return b && t - toldAt(b) < hold ? k : -1
}

/** The toasts' beats the clock has passed within `window` (in `t`) at `t`, oldest first. */
export function toastsAt(list: readonly Beat[], t: number, window: number): Beat[] {
  return list.filter((b) => toldAt(b) <= t + 1e-9 && t - toldAt(b) < window)
}

/** A beat as the narrator's pill shows it (`key` makes it a new line). */
export function captionOf(b: Beat, key: number): CaptionView {
  const m = b.moment
  if (m.chapter)
    return {
      key,
      kind: "chapter",
      priority: 3,
      text: m.text,
      parts: [{ text: m.chapter.act }, { text: m.chapter.title }, { text: m.chapter.tagline }],
      hold: CHAPTER_HOLD_MS,
    }
  return {
    key,
    kind: m.kind === "release" ? "loot" : m.kind === "gone" ? "fall" : "quest",
    priority: m.weight >= 60 ? 3 : 2,
    text: `${m.text}.`,
    parts: [...m.parts, { text: "." }],
    hold: CAPTION_HOLD_MS,
  }
}

const KIND: Record<HistoryMoment["kind"], EntryKind> = {
  founded: "quest",
  era: "quest",
  arrival: "join",
  place: "join",
  release: "loot",
  milestone: "quest",
  reshaped: "deed",
  gone: "fail",
  renamed: "deed",
}

/** The era headings' and the hall's brass. */
const BRASS = "var(--brass)"

/**
 * A moment as a Chronicle line (and a toast): a name that opens it is the line's `who`, in its colour; a
 * place's line opens its dossier (`place:<index>`), an era's the Legends (`era:<id>`).
 */
export function entryOf(b: Beat, placeIndex?: (unit: string) => number): ChronicleEntry {
  const m = b.moment
  const at = m.day * DAY_MS
  if (m.chapter)
    return {
      key: `h-${m.id}`,
      at,
      kind: "quest",
      who: `${m.chapter.act.replace(/^Chapter /, "")}. ${m.chapter.title}`,
      banner: BRASS,
      text: `· ${m.chapter.tagline}`,
      hero: `era:${m.id.replace(/^era:/, "era-")}`,
    }
  const [lead, ...rest] = m.parts
  const named = lead?.color && m.who !== undefined
  const index = m.unit !== undefined && placeIndex ? placeIndex(m.unit) : -1
  return {
    key: `h-${m.id}`,
    at,
    kind: KIND[m.kind],
    who: named ? (lead?.text ?? "") : "",
    banner: named ? (lead?.color ?? BRASS) : BRASS,
    text: named
      ? rest
          .map((p) => p.text)
          .join("")
          .replace(/^\s+/, "")
      : m.text,
    ...(index >= 0 ? { hero: `place:${index}` } : {}),
  }
}

/** The Chronicle at `t`: every moment up to it, oldest first (the feed shows the newest on top). */
export function feedAt(
  beats: readonly Beat[],
  t: number,
  placeIndex?: (unit: string) => number,
): ChronicleEntry[] {
  const out: ChronicleEntry[] = []
  for (const b of beats) if (b.t <= t + 1e-9) out.push(entryOf(b, placeIndex))
  return out
}

/** How many beats the clock has passed at `t` (the feed changes only when this does). */
export function passed(beats: readonly Beat[], t: number): number {
  let lo = 0
  let hi = beats.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if ((beats[mid] as Beat).t <= t + 1e-9) lo = mid + 1
    else hi = mid
  }
  return lo
}
