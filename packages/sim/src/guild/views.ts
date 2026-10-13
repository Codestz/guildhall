// From V1 core (main:packages/core/src/model/model.ts), itself from opencode-cockpit (V1 ADR 0001).
/**
 * What the views ask of the model (model.ts): a session's name, what it is doing now, the party
 * tree under a conversation, and the counts for a heading. Pure reads; nothing here changes a session.
 */

import { type Craft, deedCraft } from "@guildhall/core"
import type { Experience } from "../roster/ranks.ts"
import { type Entry, type Model, type Session, working } from "./model.ts"

export interface Node {
  session: Session
  /** 0 for a subagent of the conversation on screen, 1 for one it launched, … */
  depth: number
}

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
  /** What the tool call means, for `tool` (craft.ts `deedCraft`). */
  craft?: Craft
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
      craft: deedCraft(running),
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

/** What a session has done, as the roster ranks it (`rankOf`): its deeds (calls made) and tokens spent. */
export const experienceOf = (s: Session): Experience => ({ deeds: callsOf(s), tokens: s.tokens })
