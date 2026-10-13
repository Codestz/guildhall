// From V1 core (main:packages/core/src/model/model.ts), itself from opencode-cockpit (V1 ADR 0001).
/**
 * Sessions, built from changes. Pure: no OpenCode, no terminal — a test feeds it the changes a real
 * run produced and checks what came out. What the views ask of it is in views.ts.
 *
 * Every session is kept, the conversation you are in included: a subagent is only "a subagent" in
 * relation to the session it hangs under, and `subagentsOf` walks that from whichever conversation is
 * on screen.
 */

import { type Change, type ToolState, taskText } from "@guildhall/core"

export type Status = "starting" | "running" | "waiting" | "done" | "failed"

export type Entry =
  | { kind: "prompt"; key: string; text: string; at: number; first: boolean }
  | { kind: "thinking"; key: string; text: string; done: boolean; at: number }
  | { kind: "reply"; key: string; text: string; done: boolean; at: number }
  | {
      kind: "tool"
      call: string
      name: string
      /** The craft its source declared (`Change` tool `craft`), unchecked: read it with `deedCraft`. */
      craft?: string
      state: ToolState
      input: Record<string, unknown>
      output: string
      error?: string
      summary?: string
      /** A shell call's exit code (`Change` tool `exit`). */
      exit?: number
      at: number
      ended?: number
    }

export interface Session {
  id: string
  parentID?: string
  agent: string
  /** The archetype the source asked for (`session.archetype`), if any. */
  archetype?: string
  title: string
  /** The task it was given — its first prompt. */
  task?: string
  status: Status
  /** When the current status began: how long it has been waiting, say. */
  since: number
  error?: string
  started: number
  /** When it last went idle or failed; cleared when it works again. */
  ended?: number
  entries: Entry[]
  tokens: number
  cost: number
  model?: string
  background?: boolean
  denied: string[]
  steps: number
  /** When anything was last heard about it: a run gone quiet this long is asked about. */
  seen: number
  /**
   * Set when it was settled as stopped because the subagent that launched it ended badly, not by an
   * event of its own: anything it does after that brings it back (`cascade`).
   */
  orphaned?: number
}

export interface Model {
  sessions: Map<string, Session>
}

/** Still at it: anything short of having ended. */
export const working = (s: Session): boolean => s.status !== "done" && s.status !== "failed"

export const emptyModel = (): Model => ({ sessions: new Map() })

function session(model: Model, id: string, at: number): Session {
  let found = model.sessions.get(id)
  if (!found) {
    found = {
      id,
      agent: "agent",
      title: "",
      status: "starting",
      since: at,
      started: at,
      entries: [],
      tokens: 0,
      cost: 0,
      denied: [],
      steps: 0,
      seen: at,
    }
    model.sessions.set(id, found)
  }
  return found
}

const findText = (s: Session, kind: "thinking" | "reply", key: string) =>
  s.entries.find(
    (entry): entry is Extract<Entry, { kind: "thinking" | "reply" }> =>
      entry.kind === kind && entry.key === key,
  )

const findTool = (s: Session, call: string) =>
  s.entries.find(
    (entry): entry is Extract<Entry, { kind: "tool" }> => entry.kind === "tool" && entry.call === call,
  )

function applyStatus(s: Session, change: Extract<Change, { type: "status" }>): void {
  /** Its own word on how it is replaces what was assumed from its parent. */
  const orphaned = s.orphaned !== undefined
  delete s.orphaned
  if (change.status === "busy") {
    s.status = "running"
    delete s.ended
    delete s.error
  } else if (change.status === "waiting") {
    s.status = "waiting"
  } else if (change.status === "failed") {
    s.status = "failed"
    s.ended = change.at
    if (change.error) s.error = change.error
    settle(s, change.at)
  } else if (s.status !== "failed" || orphaned) {
    if (orphaned) delete s.error
    /** Idle before it ever worked is a session that has not started, not one that finished — live. */
    s.status = s.status === "starting" && s.entries.length === 0 && !change.settled ? "starting" : "done"
    s.ended = change.at
    settle(s, change.at)
  }
}

/**
 * A run that ended has no call still running: one left so was cut off (a stop, an abort) and never
 * told us — without this its spinner turned forever, and the sidebar said it was still at it.
 */
function settle(s: Session, at: number): void {
  for (const entry of s.entries) {
    if (entry.kind === "tool" && (entry.state === "running" || entry.state === "pending")) {
      entry.state = "failed"
      entry.error ??= "stopped"
      entry.ended = at
    }
    if ((entry.kind === "thinking" || entry.kind === "reply") && !entry.done) entry.done = true
  }
}

/** What a subagent left running is told when the subagent that launched it stopped or failed. */
export const ORPHANED = "cancelled: the subagent that launched it ended"

/**
 * A subagent that stopped or failed takes down what it launched: a nested run still marked working
 * under it is settled as stopped, so the sidebar, the pane and the tools do not show a child spinning
 * forever under a parent that was cancelled — OpenCode tells us of the parent's end, not always of
 * theirs. Only what it launched, at any depth; the conversation's own end is not a subagent's.
 * Marked `orphaned`, since an assumption: any later event of its own (a call, a status) wins.
 */
function cascade(model: Model, parent: string, at: number): void {
  const seen = new Set([parent])
  const walk = (id: string) => {
    for (const child of model.sessions.values()) {
      if (child.parentID !== id || seen.has(child.id)) continue
      seen.add(child.id)
      if (working(child)) {
        child.status = "failed"
        child.since = at
        child.ended = at
        child.error = ORPHANED
        child.orphaned = at
        settle(child, at)
      }
      walk(child.id)
    }
  }
  walk(parent)
}

/** An orphaned run doing something after it was settled was not stopped after all. */
function revive(s: Session, at: number): void {
  if (s.orphaned === undefined || at <= s.orphaned) return
  delete s.orphaned
  delete s.ended
  delete s.error
  s.status = "running"
  s.since = at
}

/** Applies one change in place. Unknown sessions are created, so order never loses anything. */
export function apply(model: Model, change: Change): void {
  const s = session(model, change.id, change.at)
  if (change.at > s.seen) s.seen = change.at
  if (change.type === "thinking" || change.type === "reply" || change.type === "tool") revive(s, change.at)
  switch (change.type) {
    case "session":
      if (change.parentID) s.parentID = change.parentID
      if (change.agent) s.agent = change.agent
      if (change.archetype) s.archetype = change.archetype
      if (change.title) s.title = change.title
      if (change.model) s.model = change.model
      if (change.background) s.background = true
      if (change.denied) s.denied = change.denied
      /** A session's own creation time beats when we first heard of it. */
      if (change.at < s.started) s.started = change.at
      return
    case "step":
      s.steps++
      return
    case "status": {
      const before = s.status
      applyStatus(s, change)
      if (s.status !== before) s.since = change.at
      if (s.status === "failed" && before !== "failed" && s.parentID) cascade(model, s.id, change.at)
      return
    }
    case "prompt": {
      if (s.entries.some((entry) => entry.kind === "prompt" && entry.key === change.key)) return
      const first = !s.entries.some((entry) => entry.kind === "prompt")
      const text = first ? taskText(change.text) : change.text.trim()
      if (first) s.task = text
      s.entries.push({ kind: "prompt", key: change.key, text, at: change.at, first })
      return
    }
    case "thinking":
    case "reply": {
      let entry = findText(s, change.type, change.key)
      if (!entry) {
        const created: Extract<Entry, { kind: "thinking" | "reply" }> = {
          kind: change.type,
          key: change.key,
          text: "",
          done: false,
          at: change.at,
        }
        s.entries.push(created)
        entry = created
      }
      if (change.text !== undefined) entry.text = change.text
      else if (change.delta) entry.text += change.delta
      if (change.done) entry.done = true
      if (s.status === "starting") s.status = "running"
      return
    }
    case "tool": {
      let entry = findTool(s, change.call)
      if (!entry) {
        entry = {
          kind: "tool",
          call: change.call,
          name: change.name ?? "tool",
          state: "pending",
          input: {},
          output: "",
          at: change.started ?? change.at,
        }
        s.entries.push(entry)
      }
      if (change.started !== undefined) entry.at = change.started
      if (change.summary) entry.summary = change.summary
      if (change.exit !== undefined) entry.exit = change.exit
      if (change.name) entry.name = change.name
      if (change.craft) entry.craft = change.craft
      if (change.state) entry.state = change.state
      if (change.input && Object.keys(change.input).length > 0) entry.input = change.input
      if (change.output !== undefined) entry.output = change.output
      if (change.error) entry.error = change.error
      if (change.state === "completed" || change.state === "failed") entry.ended = change.ended ?? change.at
      if (s.status === "starting") s.status = "running"
      return
    }
    case "usage":
      if (change.tokens !== undefined) s.tokens = change.tokens
      if (change.cost !== undefined) s.cost = change.cost
      return
  }
}

export function applyAll(model: Model, changes: Iterable<Change>): Model {
  for (const change of changes) apply(model, change)
  return model
}
