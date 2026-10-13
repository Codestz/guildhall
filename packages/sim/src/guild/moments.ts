// From V1 hall (main:packages/hall/src/guild/moments.ts), without the HUD log's naming (V1 ADR 0008).
import { type Change, type CiState, failedDeed, type SeaEvent, type ToolState } from "@guildhall/core"
import type { Model, Status } from "./model.ts"

/**
 * Moments: the typed things that *happen* in a guild, for anything that reacts to an event rather
 * than to a state (the normaliser, captions, sound). Derived by comparing the model just before a
 * change with just after it, so a repeated change (OpenCode 1 re-sends a running call as its output
 * streams) never makes a second moment: only a transition does.
 *
 *   join           a subagent joins a party (its session learns its parent)
 *   quest          an adventurer sends a quest (a `task` / `subagent` call starts)
 *   deed           a tool call completes; `size` is the lines it wrote, when the input says
 *   deed-failed    a tool call fails, or a check (tests, lint, typecheck) exits non-zero: a completed
 *                  call, but red work (core's `failedDeed`); `exit` says so. Other non-zero exits
 *                  (`grep` finding nothing) stay deeds
 *   fail           a session fails (its own word, or settled when the subagent above it failed)
 *   recover        a failed session works again
 *   loot           a session finishes (done)
 *   plea           a session waits on a human (permission / question)
 *   plea-answered  it stops waiting
 *
 * V1's `leave` (a finished subagent walks out a while after it ended) is a matter of time passing,
 * not of a change, so it is the normaliser's to make, not this diff's.
 *
 * And the sea (PROTOCOL.md §7): what happened on GitHub to the guild's project (`seaMomentOf`).
 *
 *   sea-push       new commits pushed
 *   sea-merged     a pull request merged
 *   sea-red        a CI run failed
 *   sea-green      a CI run passed on a branch whose last finished run had failed
 *   sea-release    a release published
 */
export type Happening =
  | { kind: "join" }
  | { kind: "quest"; tool: string; call: string; text: string }
  | { kind: "deed"; tool: string; call: string; size?: number }
  | { kind: "deed-failed"; tool: string; call: string; error?: string; exit?: number }
  | { kind: "fail"; error?: string }
  | { kind: "recover" }
  | { kind: "loot" }
  | { kind: "plea" }
  | { kind: "plea-answered" }

export type MomentKind = Happening["kind"]

/** One moment: what happened, to which session, and when (the change's `at`). */
export type Moment = Happening & { id: string; at: number }

/** What the model said, just before a change, about the sessions the change can move. */
export interface Glance {
  change: Change
  parentID: string | undefined
  /** Status of every session the change can move: just its own, or every one for a failure. */
  statuses: Map<string, Status>
  /** The call's state, for a tool change. */
  tool: ToolState | undefined
}

/** Read before `apply(model, change)`; hand to `momentsOf` after it. */
export function glance(model: Model, change: Change): Glance {
  const s = model.sessions.get(change.id)
  const statuses = new Map<string, Status>()
  // A failure also settles what the session launched (the model's `cascade`): watch them all then.
  if (change.type === "status" && change.status === "failed")
    for (const other of model.sessions.values()) statuses.set(other.id, other.status)
  else if (s) statuses.set(s.id, s.status)
  const entry =
    change.type === "tool" && s
      ? s.entries.find((e) => e.kind === "tool" && e.call === change.call)
      : undefined
  return {
    change,
    parentID: s?.parentID,
    statuses,
    tool: entry?.kind === "tool" ? entry.state : undefined,
  }
}

/**
 * Everything one change made happen, in order, each with the session it is about. Pure: the same
 * glance and model always give the same moments — live, replayed or simulated.
 */
export function momentsOf(before: Glance, after: Model): Moment[] {
  const { change } = before
  const s = after.sessions.get(change.id)
  if (!s) return []
  const at = change.at
  const out: Moment[] = []
  if (change.type === "session" && s.parentID && !before.parentID) out.push({ kind: "join", id: s.id, at })

  if (change.type === "tool") {
    const entry = s.entries.find((e) => e.kind === "tool" && e.call === change.call)
    if (entry?.kind === "tool" && entry.state !== before.tool) {
      const tool = entry.name
      if (entry.state === "running" && (tool === "task" || tool === "subagent")) {
        const text = typeof entry.input.description === "string" ? entry.input.description : "a quest"
        out.push({ kind: "quest", id: s.id, at, tool, call: entry.call, text })
      } else if (failedDeed(entry)) {
        out.push({
          kind: "deed-failed",
          id: s.id,
          at,
          tool,
          call: entry.call,
          ...(entry.error ? { error: entry.error } : {}),
          ...(entry.state === "completed" && entry.exit !== undefined ? { exit: entry.exit } : {}),
        })
      } else if (entry.state === "completed") {
        const size = sizeOf(tool, entry.input)
        out.push({
          kind: "deed",
          id: s.id,
          at,
          tool,
          call: entry.call,
          ...(size === undefined ? {} : { size }),
        })
      }
    }
  }

  // Status moves: the session's own first, then any it settled (in the model's order).
  const moved = [s.id, ...[...before.statuses.keys()].filter((id) => id !== s.id)]
  for (const id of moved) {
    const from = before.statuses.get(id)
    const now = after.sessions.get(id)
    if (from === undefined || !now || now.status === from) continue
    out.push(...statusMoments(id, at, from, now.status, now.error))
  }
  return out
}

function statusMoments(
  id: string,
  at: number,
  from: Status,
  to: Status,
  error: string | undefined,
): Moment[] {
  const out: Moment[] = []
  if (from === "waiting") out.push({ kind: "plea-answered", id, at })
  if (from === "failed") out.push({ kind: "recover", id, at })
  if (to === "waiting") out.push({ kind: "plea", id, at })
  else if (to === "failed") out.push({ kind: "fail", id, at, ...(error ? { error } : {}) })
  else if (to === "done") out.push({ kind: "loot", id, at })
  return out
}

/** Lines a deed wrote, when its input carries them (OpenCode's edit / write); else unknown. */
export function sizeOf(tool: string, input: Record<string, unknown>): number | undefined {
  const text =
    tool === "write"
      ? input.content
      : tool === "edit" || tool === "patch" || tool === "multiedit"
        ? input.newString
        : undefined
  if (typeof text !== "string") return undefined
  return text === "" ? 0 : text.split("\n").length
}

/** The sea's moments (see the list above). */
export type SeaMomentKind = "sea-push" | "sea-merged" | "sea-red" | "sea-green" | "sea-release"

export interface SeaMoment {
  kind: SeaMomentKind
  event: SeaEvent
}

/**
 * The moment a sea event makes, if any. `finished` remembers each repo branch's last finished CI
 * run (passed or failed), read and updated here, so a pass after a failure is a recovery. Pure but
 * for `finished`: the same events in the same order always give the same moments.
 */
export function seaMomentOf(event: SeaEvent, finished: Map<string, CiState>): SeaMoment | undefined {
  switch (event.kind) {
    case "push":
      return { kind: "sea-push", event }
    case "pr_merged":
      return { kind: "sea-merged", event }
    case "release":
      return { kind: "sea-release", event }
    case "ci": {
      if (event.state !== "passed" && event.state !== "failed") return undefined
      const key = `${event.repo}:${event.branch}`
      const before = finished.get(key)
      finished.set(key, event.state)
      if (event.state === "failed") return { kind: "sea-red", event }
      return before === "failed" ? { kind: "sea-green", event } : undefined
    }
    default:
      return undefined
  }
}
