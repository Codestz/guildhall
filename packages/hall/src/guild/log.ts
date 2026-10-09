import { type Change, failedDeed, type Model, type Session } from "@guildhall/core"
import type { Chapter } from "@guildhall/sim"
import { shorten } from "./views.ts"

/**
 * The guild's log (the HUD's feed, at most LOG_SIZE lines) and the timeline's markers: what a
 * change says, if anything, as one line or one tick. Pure; the intake (guild/intake.ts) writes them.
 */

/** Newest last, at most this many lines. */
export const LOG_SIZE = 80

/** One line of the guild chronicle, for the HUD's feed. */
export interface LogEntry {
  key: number
  /** Run time, ms. */
  at: number
  id: string
  title: string
  color: string
  kind: "join" | "quest" | "deed" | "fail" | "plea" | "loot" | "thought"
  text: string
  /** Their party (root session id). */
  party: string
}

/** An interesting moment on the timeline (run time, ms), for scrubber ticks. */
export interface Marker {
  at: number
  kind: "quest" | "fail" | "plea" | "loot" | "walk" | "chapter"
  /** A chapter's name: `Act III — The storm`. */
  label?: string
}

/** A chapter as its title card and tick name it: `Act III — The storm`. */
export function chapterLabel(chapter: Pick<Chapter, "numeral" | "title">): string {
  return `Act ${chapter.numeral} — ${chapter.title}`
}

export function markerOf(change: Change): Marker["kind"] | undefined {
  if (change.type === "status" && change.status === "waiting") return "plea"
  if (change.type === "tool" && change.state === "failed") return "fail"
  if (
    change.type === "tool" &&
    change.state === "running" &&
    (change.name === "task" || change.name === "subagent")
  )
    return "quest"
  if (change.type === "tool" && change.state === "running" && change.name === "webfetch") return "walk"
  if (change.type === "status" && change.status === "idle") return "loot"
  return undefined
}

export function lineOf(change: Change, s: Session): Pick<LogEntry, "kind" | "text"> | undefined {
  switch (change.type) {
    case "session":
      return change.parentID
        ? { kind: "join", text: `joins: ${s.title.replace(/ \(@.*\)$/, "")}` }
        : undefined
    case "status":
      if (change.status === "waiting") return { kind: "plea", text: "asks for permission" }
      if (change.status === "failed") return { kind: "fail", text: change.error ?? "failed" }
      if (change.status === "idle") return { kind: "loot", text: s.parentID ? "quest complete" : "all done" }
      return undefined
    case "tool": {
      if (change.state === "failed")
        return { kind: "fail", text: `${toolName(s, change.call)} failed: ${change.error ?? ""}` }
      if (change.state === "completed" && change.exit !== undefined && change.exit !== 0) {
        const entry = s.entries.find((e) => e.kind === "tool" && e.call === change.call)
        if (entry?.kind === "tool" && failedDeed(entry))
          return {
            kind: "fail",
            text: `${entry.name} exited ${change.exit}: ${shorten(String(entry.input.command ?? ""), 60)}`,
          }
      }
      if (change.state !== "running") return undefined
      const name = change.name ?? "tool"
      if (name === "task" || name === "subagent") {
        const what = typeof change.input?.description === "string" ? change.input.description : "a quest"
        return { kind: "quest", text: `sends a quest: ${what}` }
      }
      return { kind: "deed", text: `${name} ${shorten(targetOf(change.input), 40)}`.trim() }
    }
    case "prompt": {
      const prompts = s.entries.filter((entry) => entry.kind === "prompt").length
      return prompts > 1 ? { kind: "quest", text: `called back: ${shorten(change.text, 70)}` } : undefined
    }
    case "thinking":
      return change.done || !change.text ? undefined : { kind: "thought", text: shorten(change.text, 90) }
    default:
      return undefined
  }
}

/** A completed call that is red work: a check (tests, lint, typecheck) that exited non-zero (core's `failedDeed`). */
export function redCheck(change: Change, model: Model): boolean {
  if (change.type !== "tool" || change.state !== "completed" || !change.exit) return false
  const entry = model.sessions
    .get(change.id)
    ?.entries.find((e) => e.kind === "tool" && e.call === change.call)
  return entry?.kind === "tool" && failedDeed(entry)
}

function toolName(s: Session, call: string): string {
  const entry = s.entries.find((e) => e.kind === "tool" && e.call === call)
  return entry?.kind === "tool" ? entry.name : "tool"
}

function targetOf(input: Record<string, unknown> | undefined): string {
  if (!input) return ""
  for (const key of ["filePath", "pattern", "command", "url", "query", "path"]) {
    const value = input[key]
    if (typeof value === "string") return value.split("/").at(-1) ?? value
  }
  return ""
}
