/** The HUD's words and numbers: pure, so the panels and their tests read them the same way. */
import { roman } from "../components/controls.tsx"
import type { ChronicleEntry, EntryKind, Family, HeroView, Phase, Rank, ToastItem } from "./types.ts"

/** Session time as `m:ss` (`h:mm:ss` past an hour). */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, "0")
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`
}

/** A short duration: `42s`, `3m 05s`, `1h 04m`. */
export function span(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`
}

/** Tokens, compact: `840`, `12.4k`, `312k`, `1.2M`. */
export function tokens(n: number): string {
  if (n < 1000) return String(Math.max(0, Math.round(n)))
  if (n < 100_000) return `${(n / 1000).toFixed(1)}k`
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

/** Dollars: `$0`, `$0.042`, `$1.30`. */
export function cost(n: number): string {
  if (n <= 0) return "$0"
  return n < 1 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`
}

/** A phase's tone: the colour that backs its glyph and word. */
export type PhaseTone = "work" | "plea" | "loot" | "idle" | "fail"

/** Phase in words: shown next to its glyph, so status never rests on colour alone. */
const PHASES: Record<Phase, { label: string; tone: PhaseTone }> = {
  working: { label: "At work", tone: "work" },
  waiting: { label: "Plea", tone: "plea" },
  loot: { label: "Bringing loot", tone: "loot" },
  resting: { label: "In the tavern", tone: "idle" },
  leaving: { label: "Leaving", tone: "idle" },
  idle: { label: "Resting", tone: "idle" },
  failed: { label: "In the infirmary", tone: "fail" },
}

/** Tolerant: a phase the sim learns later still renders, as its own name. */
export function phaseOf(phase: Phase | string): { label: string; tone: PhaseTone } {
  return PHASES[phase as Phase] ?? { label: phase.charAt(0).toUpperCase() + phase.slice(1), tone: "idle" }
}

export const RANK_LABEL: Readonly<Record<Rank, string>> = {
  apprentice: "Apprentice",
  journeyman: "Journeyman",
  master: "Master",
}

export const FAMILY_LABEL: Readonly<Record<Family, { one: string; many: string }>> = {
  mage: { one: "Mage", many: "Mages" },
  knight: { one: "Knight", many: "Knights" },
  ranger: { one: "Ranger", many: "Rangers" },
  barbarian: { one: "Barbarian", many: "Barbarians" },
  rogue: { one: "Rogue", many: "Rogues" },
}

/** A hero's name as written out: `Artisan`, the second `Artisan II`. */
export function heroTitle(hero: Pick<HeroView, "name" | "ordinal">): string {
  return hero.ordinal && hero.ordinal > 1 ? `${hero.name} ${roman(hero.ordinal)}` : hero.name
}

/** `1 hero`, `3 heroes`: a count with its noun. */
export function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** A day of history: `14 Mar 2021` (UTC: a repo's history reads the same in every zone). */
export function day(epochMs: number): string {
  const d = new Date(epochMs)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

/** A month of history: `Mar 2021`. */
export function month(epochMs: number): string {
  const d = new Date(epochMs)
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

export interface Tick {
  /** Where on the bar, 0–1. */
  p: number
  label: string
}

/**
 * The bar's tick labels, at most `max` of them, evenly stepped and never at the very ends (the ends
 * carry the range's own readout). History: the 1 January of each year (every 2nd, 5th… year when they
 * would crowd). Session: whole minutes in steps of 1, 5, 10, 15, 30 or 60.
 */
export function ticks(scale: "history" | "session", start: number, end: number, max = 6): Tick[] {
  if (!(end > start) || max < 1) return []
  const len = end - start
  const out: Tick[] = []
  const inside = (at: number) => at > start && at < end
  if (scale === "history") {
    const first = new Date(start).getUTCFullYear() + 1
    const last = new Date(end).getUTCFullYear()
    // how many multiples of `s` fall in [first, last]: the smallest step that fits wins
    const fits = (s: number) => Math.floor(last / s) - Math.ceil(first / s) + 1 <= max
    const step = [1, 2, 5, 10, 20, 50].find(fits) ?? 100
    for (let y = Math.ceil(first / step) * step; y <= last; y += step) {
      const at = Date.UTC(y, 0, 1)
      if (inside(at)) out.push({ p: (at - start) / len, label: String(y) })
    }
    return out
  }
  const minutes = len / 60_000
  const step = [1, 5, 10, 15, 30, 60].find((s) => Math.floor(minutes / s) <= max) ?? 120
  const from = Math.ceil(start / 60_000 / step) * step
  for (let m = from; m * 60_000 < end; m += step) {
    const at = m * 60_000
    if (inside(at)) out.push({ p: (at - start) / len, label: `${m}m` })
  }
  return out
}

/** How long a moment earns a toast (V1's lifetimes, real ms); ordinary deeds and thoughts never do. */
export const TOAST_LIFE: Partial<Record<EntryKind, number>> = {
  join: 5000,
  quest: 6000,
  loot: 6000,
  fail: 11_000,
  plea: 11_000,
}

/**
 * The toasts to show now: the newest `max` moments that earn one and still have time left, oldest
 * first. `firstSeen` remembers when each was first shown (wall clock), so a toast keeps its own life
 * across renders and a paused story still clears; it is updated in place. `cap` (ms) shortens every
 * moment's life: on a short screen a toast folds into the Chronicle chip after a few seconds.
 */
export function pickToasts(
  log: readonly ChronicleEntry[],
  now: number,
  firstSeen: Map<string, number>,
  max = 3,
  cap = Number.POSITIVE_INFINITY,
): ToastItem[] {
  const shown: ToastItem[] = []
  for (let i = log.length - 1; i >= 0 && shown.length < max; i--) {
    const entry = log[i]
    const life = entry && Math.min(cap, TOAST_LIFE[entry.kind] ?? 0)
    if (!entry || !life) continue
    let first = firstSeen.get(entry.key)
    if (first === undefined) {
      first = now
      firstSeen.set(entry.key, now)
    }
    const left = life - (now - first)
    if (left > 0) shown.push({ ...entry, left })
  }
  return shown.reverse()
}
