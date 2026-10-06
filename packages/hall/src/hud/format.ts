import type { Entry, Session } from "@guildhall/core"
import type { LogEntry, Marker, Phase } from "../guild/store.ts"

/** Run time as `m:ss`. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

/** A short duration: `42s`, `3m 05s`. */
export function span(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`
}

export function tokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 100_000) return `${(n / 1000).toFixed(1)}k`
  return `${Math.round(n / 1000)}k`
}

export function cost(n: number): string {
  if (n === 0) return "$0"
  return n < 1 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`
}

/** Phase in words: shown next to its glyph, so status never rests on colour alone. */
const PHASES: Record<Phase, { label: string; tone: Tone }> = {
  working: { label: "At work", tone: "work" },
  waiting: { label: "Plea", tone: "plea" },
  loot: { label: "Bringing loot", tone: "loot" },
  resting: { label: "In the tavern", tone: "idle" },
  leaving: { label: "Leaving", tone: "idle" },
  idle: { label: "Resting", tone: "idle" },
  failed: { label: "In the infirmary", tone: "fail" },
}

/** Tolerant: a phase the store learns later still renders, as its own name. */
export function phaseOf(phase: Phase | string): { label: string; tone: Tone } {
  return PHASES[phase as Phase] ?? { label: phase.charAt(0).toUpperCase() + phase.slice(1), tone: "idle" }
}

export const STATUS: Record<Session["status"], { label: string; tone: Tone }> = {
  starting: { label: "Arriving", tone: "idle" },
  running: { label: "At work", tone: "work" },
  waiting: { label: "Plea", tone: "plea" },
  done: { label: "Quest done", tone: "loot" },
  failed: { label: "Fallen", tone: "fail" },
}

export type Tone = "work" | "plea" | "loot" | "idle" | "fail" | "quest"

export const LOG_TONE: Record<LogEntry["kind"], Tone | "deed" | "thought" | "join"> = {
  join: "join",
  quest: "quest",
  deed: "deed",
  fail: "fail",
  plea: "plea",
  loot: "loot",
  thought: "thought",
}

export const MARKER_LABEL: Record<Marker["kind"], string> = {
  quest: "Quest sent",
  fail: "Deed failed",
  plea: "Plea",
  loot: "Loot returned",
  walk: "Journey",
}

/** The most telling argument of a tool call: the file, the command, the url. */
export function targetOf(entry: Extract<Entry, { kind: "tool" }>): string {
  const input = entry.input ?? {}
  for (const key of ["filePath", "path", "pattern", "command", "url", "query", "description"]) {
    const value = input[key]
    if (typeof value === "string" && value) return key === "filePath" || key === "path" ? tail(value) : value
  }
  return ""
}

function tail(path: string): string {
  const parts = path.split("/").filter(Boolean)
  return parts.slice(-2).join("/")
}

/** Two letters for a sigil: `Guildmaster` → `Gm`, `Product Owner` → `PO`. */
export function initials(title: string): string {
  const words = title.split(/[\s-]+/).filter(Boolean)
  if (words.length > 1) return (words[0]?.[0] ?? "") + (words[1]?.[0] ?? "")
  return title.slice(0, 2)
}
