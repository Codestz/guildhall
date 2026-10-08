import {
  type Change,
  type CiState,
  failedDeed,
  type Model,
  type SeaEvent,
  type Status,
  type ToolState,
} from "@guildhall/core"

/**
 * Moments: the typed things that *happen* in a guild (ADR 0008), for anything that reacts to an
 * event rather than to a state — ravens, sound, captions, the graveyard, Legends. Derived in one
 * place, the store's `take()`, from the same changes that build the HUD log, by comparing the model
 * just before a change with just after it. So a repeated change (OpenCode 1 re-sends a running call
 * as its output streams) never makes a second moment: only a transition does.
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
 *   leave          a finished subagent walks out of the gate (run time `GONE_MS` after it ended)
 *
 * And the sea (PROTOCOL.md §7): what happened on GitHub to the guild's project, told by the store as
 * its clock reaches each sea event (`seaHappening`). Their actor is the harbour (`HARBOUR`), not an
 * adventurer: no one in the hall did it, the guild's work did.
 *
 *   sea-push       new commits pushed (quiet: a ship sails, nobody is told)
 *   sea-merged     a pull request merged
 *   sea-red        a CI run failed
 *   sea-green      a CI run passed on a branch whose last finished run had failed
 *   sea-release    a release published
 */
export type MomentKind = Moment["kind"]

/** Who a moment is about, as the hall names them at that moment. */
export interface Actor {
  /** Session id. */
  id: string
  /** OpenCode agent name (`guild-implementer`). */
  agent: string
  /** The hall's name for them, numbered when the role repeats (`Implementer II`). */
  title: string
  /** The role's colour. */
  color: string
  /** The session that sent them; absent for a guildmaster. */
  parent?: string
  /** The guildmaster at the top of their party (themselves, for a guildmaster). */
  master: string
}

/** One moment on the stream. */
export type Moment = Actor & {
  /** Increases by one for every moment the store ever makes, across rebuilds: a cursor never repeats. */
  seq: number
  /** Run time, ms (the same clock as the log and the timeline). */
  at: number
  /**
   * True when it happened as the hall watched; false when it was rebuilt from history (a seek, a
   * replay loop restarting, a scenario load, a live hello). Only live moments reach `on` listeners.
   */
  live: boolean
} & Happening

/** What happened, without who or when: what `happenings` derives from one change. */
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
  | { kind: "leave" }
  | { kind: SeaMomentKind; event: SeaEvent }

/** The sea's moments (see the list above). */
export type SeaMomentKind = "sea-push" | "sea-merged" | "sea-red" | "sea-green" | "sea-release"

/** Who a sea moment is about: the harbour, in the guild's own gold. `master` is the store's to set. */
export const HARBOUR: Omit<Actor, "master"> = {
  id: "sea",
  agent: "",
  title: "Harbour",
  color: "#dcb662",
}

/**
 * The moment a sea event makes, if any. `finished` remembers each repo branch's last finished CI
 * run (passed or failed), read and updated here, so a pass after a failure is a recovery. Pure but
 * for `finished`: the same events in the same order always give the same moments.
 */
export function seaHappening(
  event: SeaEvent,
  finished: Map<string, CiState>,
): { kind: SeaMomentKind; event: SeaEvent } | undefined {
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

/** What the model said, just before a change, about the sessions the change can move. */
export interface Before {
  parentID: string | undefined
  /** Status of every session the change can move: just its own, or the whole tree for a failure. */
  statuses: Map<string, Status>
  /** The call's state, for a tool change. */
  tool: ToolState | undefined
}

/** Read before `apply(model, change)`; hand to `happenings` after it. */
export function before(model: Model, change: Change): Before {
  const s = model.sessions.get(change.id)
  const statuses = new Map<string, Status>()
  // A failure also settles what the session launched (core's `cascade`): watch them all then.
  if (change.type === "status" && change.status === "failed")
    for (const other of model.sessions.values()) statuses.set(other.id, other.status)
  else if (s) statuses.set(s.id, s.status)
  const entry =
    change.type === "tool" && s
      ? s.entries.find((e) => e.kind === "tool" && e.call === change.call)
      : undefined
  return {
    parentID: s?.parentID,
    statuses,
    tool: entry?.kind === "tool" ? entry.state : undefined,
  }
}

/**
 * Everything one change made happen, in order, each with the session it is about. Pure: the same
 * model, change and `before` always give the same moments — live, replayed or simulated.
 */
export function happenings(model: Model, change: Change, was: Before): (Happening & { id: string })[] {
  const s = model.sessions.get(change.id)
  if (!s) return []
  const out: (Happening & { id: string })[] = []
  if (change.type === "session" && s.parentID && !was.parentID) out.push({ kind: "join", id: s.id })

  if (change.type === "tool") {
    const entry = s.entries.find((e) => e.kind === "tool" && e.call === change.call)
    if (entry?.kind === "tool" && entry.state !== was.tool) {
      const tool = entry.name
      if (entry.state === "running" && (tool === "task" || tool === "subagent")) {
        const text = typeof entry.input.description === "string" ? entry.input.description : "a quest"
        out.push({ kind: "quest", id: s.id, tool, call: entry.call, text })
      } else if (failedDeed(entry)) {
        out.push({
          kind: "deed-failed",
          id: s.id,
          tool,
          call: entry.call,
          ...(entry.error ? { error: entry.error } : {}),
          ...(entry.state === "completed" && entry.exit !== undefined ? { exit: entry.exit } : {}),
        })
      } else if (entry.state === "completed") {
        const size = sizeOf(tool, entry.input)
        out.push({ kind: "deed", id: s.id, tool, call: entry.call, ...(size === undefined ? {} : { size }) })
      }
    }
  }

  // Status moves: the session's own first, then any it settled (in the model's order).
  const moved = [s.id, ...[...was.statuses.keys()].filter((id) => id !== s.id)]
  for (const id of moved) {
    const from = was.statuses.get(id)
    const now = model.sessions.get(id)
    if (from === undefined || !now || now.status === from) continue
    out.push(...statusMoments(id, from, now.status, now.error))
  }
  return out
}

function statusMoments(
  id: string,
  from: Status,
  to: Status,
  error: string | undefined,
): (Happening & { id: string })[] {
  const out: (Happening & { id: string })[] = []
  if (from === "waiting") out.push({ kind: "plea-answered", id })
  if (from === "failed") out.push({ kind: "recover", id })
  if (to === "waiting") out.push({ kind: "plea", id })
  else if (to === "failed") out.push({ kind: "fail", id, ...(error ? { error } : {}) })
  else if (to === "done") out.push({ kind: "loot", id })
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

/** How many moments the stream keeps for `history`: plenty for captions, bounded for a long live run. */
const KEEP = 1000

/**
 * The store's moment stream. Two ways to read it:
 *
 *   on(fn)         push: `fn` is called synchronously for every **live** moment, as it is made. Never
 *                  for rebuilt ones, so an effect hung on it (a raven, a sound) can never burst on a
 *                  seek or a replayed backlog. Subscribing re-renders nothing.
 *   onRebuild(fn)  called when history is thrown away and rebuilt (seek, loop restart, scenario
 *                  load, live hello), *before* the rebuilt moments are added: drop anything in flight.
 *                  `continued` is true for a live hello (a reconnect): the same run goes on, so what
 *                  was already news (a world event shown) must not become news again.
 *   history        everything since the last rebuild, oldest first (at most KEEP), rebuilt moments
 *                  marked `live: false`: for consumers that tell a story rather than react.
 *
 * The rule: a moment is news only if `live`. `seq` only ever grows; `epoch` counts rebuilds.
 */
export class MomentStream {
  epoch = 0
  private kept: Moment[] = []
  private next = 1
  private listeners = new Set<(moment: Moment) => void>()
  private rebuilds = new Set<(epoch: number, continued: boolean) => void>()

  get history(): readonly Moment[] {
    return this.kept
  }

  on(listener: (moment: Moment) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  onRebuild(listener: (epoch: number, continued: boolean) => void): () => void {
    this.rebuilds.add(listener)
    return () => this.rebuilds.delete(listener)
  }

  /** The store's: add a moment (`seq` is assigned here). */
  add(moment: Actor & { at: number; live: boolean } & Happening): Moment {
    const made = { ...moment, seq: this.next++ } as Moment
    this.kept.push(made)
    if (this.kept.length > KEEP) this.kept.splice(0, this.kept.length - KEEP)
    if (made.live) for (const listener of this.listeners) listener(made)
    return made
  }

  /** The store's: history is about to be rebuilt from scratch (`continued`: the same live run goes on). */
  rebuild(continued = false): void {
    this.epoch++
    this.kept = []
    for (const listener of this.rebuilds) listener(this.epoch, continued)
  }
}
