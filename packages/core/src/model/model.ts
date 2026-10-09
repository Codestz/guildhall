// from opencode-cockpit: packages/subagents/src/core/model/model.ts (ADR 0001)
/**
 * Subagents, built from changes. Pure: no OpenCode, no terminal — a test feeds it the changes a real
 * run produced and checks what came out.
 *
 * Every session is kept, the conversation you are in included: a subagent is only "a subagent" in
 * relation to the session it hangs under, and `subagentsOf` walks that from whichever conversation is
 * on screen.
 */

import type { Change, ToolState } from "./changes.ts"
import { taskText } from "./changes.ts"

export type Status = "starting" | "running" | "waiting" | "done" | "failed"

export type Entry =
  | { kind: "prompt"; key: string; text: string; at: number; first: boolean }
  | { kind: "thinking"; key: string; text: string; done: boolean; at: number }
  | { kind: "reply"; key: string; text: string; done: boolean; at: number }
  | {
      kind: "tool"
      call: string
      name: string
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

// ---------------------------------------------------------------------------------------------------
// What the views ask

export interface Node {
  session: Session
  /** 0 for a subagent of the conversation on screen, 1 for one it launched, … */
  depth: number
}

/** Still at it: anything short of having ended. */
export const working = (s: Session): boolean => s.status !== "done" && s.status !== "failed"

/**
 * The facts every view of a run states — the sidebar, the pane, and the main agent's tools — each
 * from one function, so a person and the agent looking at the same subagent read the same thing
 * (docs/building/principles.md, rule 2).
 */

/** OpenCode's placeholder for a session nobody has titled yet: `Child session - 2026-10-03T…`. */
const PLACEHOLDER = /^(new|child) session - \d{4}-\d{2}-\d{2}t/i

/** Words of a task kept as a name: enough to tell two runs apart, short enough to be a name. */
const NAME_WORDS = 8

/** A task's first words, from its first line that says anything: a name for an untitled run. */
export function firstWords(text: string | undefined): string {
  const line = (text ?? "").split("\n").find((each) => each.trim() !== "") ?? ""
  const words = line.trim().split(/\s+/).filter(Boolean)
  return words.length > NAME_WORDS ? `${words.slice(0, NAME_WORDS).join(" ")}…` : words.join(" ")
}

/**
 * What a subagent is called, everywhere it is named — the sidebar, the pane, the main agent's tools.
 * Its title; with none (or only OpenCode's placeholder) its task's first words; never an empty name,
 * which drew a row that was an agent and a time with nothing between them.
 */
export function titleOf(s: Session): string {
  const title = s.title?.trim()
  if (title && !PLACEHOLDER.test(title)) return title
  return firstWords(s.task) || "subagent"
}

/** How many calls it made. */
export const callsOf = (s: Session): number => s.entries.filter((entry) => entry.kind === "tool").length

/**
 * How many rounds it has had: a round is a prompt — its task, the main agent continuing it, or you
 * writing to it — and the run that followed. Never fewer than one.
 */
export const roundsOf = (s: Session): number =>
  Math.max(1, s.entries.filter((entry) => entry.kind === "prompt").length)

/** When its current (or last) round began: the last thing it was asked, or when it started. */
export function roundStart(s: Session): number {
  for (let i = s.entries.length - 1; i >= 0; i--) {
    const entry = s.entries[i]
    if (entry?.kind === "prompt") return Math.max(entry.at, s.started)
  }
  return s.started
}

/**
 * How long its last round has taken: from that round's prompt to its end, or to now while it works.
 * Not the whole span: a subagent continued the next day read "done in 24h04m" for four minutes of
 * work. `roundsOf` says when there was more than one.
 */
export const runTime = (s: Session, now: number): number =>
  Math.max(0, (working(s) ? now : (s.ended ?? now)) - roundStart(s))

/**
 * Siblings, working ones first, then oldest first inside each half. Nothing but a status change moves
 * a row: a new subagent joins the end of its half, and two that started together keep their order by
 * id. Ordered by start rather than by last activity on purpose — a list that reshuffles on every tool
 * call cannot be clicked.
 */
function siblingOrder<T>(busy: (item: T) => boolean, first: (item: T) => Session) {
  return (a: T, b: T): number => {
    const x = first(a)
    const y = first(b)
    return (
      Number(busy(b)) - Number(busy(a)) || x.started - y.started || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0)
    )
  }
}

/**
 * The subagents under `root`, depth first; at each level working ones first, then oldest first. One
 * that has finished but launched one still working counts as working, so a running subagent is never
 * listed below finished ones, and children always sit directly under their parent.
 */
export function subagentsOf(model: Model, root: string): Node[] {
  const children = new Map<string, Session[]>()
  for (const s of model.sessions.values()) {
    if (!s.parentID) continue
    const list = children.get(s.parentID) ?? []
    list.push(s)
    children.set(s.parentID, list)
  }
  const busy = new Map<string, boolean>()
  /** It, or anything under it, working. A cycle in parentage counts as not. */
  const busyTree = (s: Session, path: Set<string>): boolean => {
    const known = busy.get(s.id)
    if (known !== undefined) return known
    if (path.has(s.id)) return false
    path.add(s.id)
    const result = working(s) || (children.get(s.id) ?? []).some((child) => busyTree(child, path))
    busy.set(s.id, result)
    return result
  }
  const order = siblingOrder<Session>(
    (s) => busyTree(s, new Set()),
    (s) => s,
  )
  const out: Node[] = []
  const seen = new Set<string>()
  const walk = (parent: string, depth: number) => {
    const list = (children.get(parent) ?? []).sort(order)
    for (const s of list) {
      if (seen.has(s.id)) continue // a cycle in parentage would otherwise never end
      seen.add(s.id)
      out.push({ session: s, depth })
      walk(s.id, depth + 1)
    }
  }
  walk(root, 0)
  return out
}

/**
 * One sidebar entry: subagents under the same parent with the same agent and the same task — an
 * "advisor" a subagent asks again and again. Each is a session of its own, so they are not rounds
 * (a round is another prompt within one session); they are one entry with a count, rather than a
 * column of identical rows pushing everything else out of the sidebar.
 */
export interface Group {
  /** The member the entry describes and a click opens: one held on you, else working, else the latest. */
  lead: Session
  /** Every member, oldest first. */
  members: Session[]
  depth: number
  /** The entries under any of its members, in sibling order. */
  children: Group[]
}

/** Untitled ones are never assumed to be the same. */
const groupKey = (s: Session): string => {
  const title = s.title || s.task
  return title ? `${s.parentID ?? ""}\u0000${s.agent}\u0000${title}` : `\u0000${s.id}`
}

/** Held on a permission needs you first; then the newest still working; then the newest finished. */
function leadOf(members: readonly Session[]): Session {
  return (
    members.filter((s) => s.status === "waiting").at(-1) ??
    members.filter(working).at(-1) ??
    (members.at(-1) as Session)
  )
}

/** Whether anything in it, or under it, is working. */
export const groupWorking = (group: Group): boolean =>
  group.members.some(working) || group.children.some(groupWorking)

/**
 * `nodes`, as `subagentsOf` gives them, folded into entries as a tree. Entries keep the sibling order,
 * keyed on the group's *first* member: a group does not move because a different member of it is the
 * one running, only because the group as a whole started or stopped working.
 */
export function groupsOf(nodes: readonly Node[]): Group[] {
  const listed = new Set(nodes.map((node) => node.session.id))
  const depthOf = new Map(nodes.map((node) => [node.session.id, node.depth]))
  const under = new Map<string, Session[]>()
  const top: Session[] = []
  for (const { session } of nodes) {
    const parent = session.parentID
    if (parent && listed.has(parent)) under.set(parent, [...(under.get(parent) ?? []), session])
    else top.push(session)
  }
  const order = siblingOrder<Group>(groupWorking, (group) => group.members[0] as Session)
  const build = (level: readonly Session[]): Group[] => {
    const buckets = new Map<string, Session[]>()
    for (const s of level) buckets.set(groupKey(s), [...(buckets.get(groupKey(s)) ?? []), s])
    return [...buckets.values()]
      .map((members): Group => {
        members.sort((a, b) => a.started - b.started || (a.id < b.id ? -1 : 1))
        return {
          lead: leadOf(members),
          members,
          depth: depthOf.get((members[0] as Session).id) ?? 0,
          children: build(members.flatMap((member) => under.get(member.id) ?? [])),
        }
      })
      .sort(order)
  }
  return build(top)
}

/** The conversation a session belongs to: up its parents to the one with none. */
export function rootOf(model: Model, id: string): string {
  let at = id
  for (let hop = 0; hop < 16; hop++) {
    const parent = model.sessions.get(at)?.parentID
    if (!parent) return at
    at = parent
  }
  return at
}

const base = (path: string) => path.split("/").filter(Boolean).slice(-2).join("/")

/** What a tool call is *about*, in a few words: the file, the pattern, the command. */
export function toolTarget(name: string, input: Record<string, unknown>): string {
  const str = (key: string) => (typeof input[key] === "string" ? (input[key] as string) : undefined)
  const path = str("filePath") ?? str("path") ?? str("file")
  switch (name) {
    case "read":
    case "write":
    case "edit":
    case "patch":
    case "list":
    case "ls":
      return path ? base(path) : ""
    case "grep":
      return [str("pattern") ? `"${str("pattern")}"` : "", str("include") ?? (path ? base(path) : "")]
        .filter(Boolean)
        .join(" ")
    case "glob":
      return str("pattern") ?? ""
    case "bash":
    case "shell":
      return (str("command") ?? "").replace(/\s+/g, " ").trim()
    case "task":
    case "subagent":
      return str("description") ?? ""
    case "webfetch":
      return str("url") ?? ""
    default: {
      const first = Object.values(input).find((value) => typeof value === "string") as string | undefined
      return first ? first.replace(/\s+/g, " ") : ""
    }
  }
}

export interface Activity {
  kind: "starting" | "tool" | "thinking" | "writing" | "waiting" | "done" | "failed"
  /** The tool's name, for `tool`. */
  tool?: string
  text: string
  /** When the current thing started, for its elapsed time. */
  since: number
}

/** What a subagent is doing right now — the line under its name in the sidebar. */
export function activityOf(s: Session): Activity {
  if (s.status === "failed") return { kind: "failed", text: s.error ?? "failed", since: s.ended ?? s.started }
  if (s.status === "waiting") return { kind: "waiting", text: "waiting for permission", since: s.since }
  const tools = s.entries.filter((entry): entry is Extract<Entry, { kind: "tool" }> => entry.kind === "tool")
  if (s.status === "done") {
    return {
      kind: "done",
      text: `${tools.length} tool${tools.length === 1 ? "" : "s"}`,
      since: s.ended ?? s.started,
    }
  }
  const last = s.entries.at(-1)
  const running = tools.filter((tool) => tool.state === "running" || tool.state === "pending").at(-1)
  if (running)
    return {
      kind: "tool",
      tool: running.name,
      text: toolTarget(running.name, running.input),
      since: running.at,
    }
  if (last?.kind === "thinking" && !last.done) return { kind: "thinking", text: "thinking", since: last.at }
  if (last?.kind === "reply" && !last.done)
    return { kind: "writing", text: "writing its answer", since: last.at }
  if (s.status === "starting") return { kind: "starting", text: "starting", since: s.started }
  return { kind: "thinking", text: "thinking", since: last?.at ?? s.started }
}

/** Counts for the block's heading. */
export function countsOf(nodes: readonly Node[]): {
  total: number
  running: number
  /** Of those running, the ones stopped on a question only you can answer. */
  waiting: number
  done: number
  failed: number
} {
  const of = (test: (s: Session) => boolean) => nodes.filter((node) => test(node.session)).length
  return {
    total: nodes.length,
    running: of((s) => s.status === "running" || s.status === "starting" || s.status === "waiting"),
    waiting: of((s) => s.status === "waiting"),
    done: of((s) => s.status === "done"),
    failed: of((s) => s.status === "failed"),
  }
}
