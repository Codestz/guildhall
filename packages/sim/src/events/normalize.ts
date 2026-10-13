import { type CiState, deedCraft, type GuildEvent, type SeaEvent, type ToolState } from "@guildhall/core"
import { GuildModel } from "../guild/guildModel.ts"
import { type Entry, type Session, working } from "../guild/model.ts"
import { seaMomentOf, sizeOf } from "../guild/moments.ts"
import { experienceOf, toolTarget } from "../guild/views.ts"
import { bodyOf } from "../roster/bodies.ts"
import { type Rank, rankOf } from "../roster/ranks.ts"
import { actorOf, namedOf } from "../story/teller.ts"
import { GONE_MS, type Who, type Work, type WorldEvent, type WorldHappening } from "./world.ts"

/**
 * The normaliser (plan-hud-events.md §3.1): wire in, world events out. A guild change goes through
 * the session model (`GuildModel`) and the moments it makes, so only a transition is an event; what
 * the moments do not say and the world needs (a session seen for the first time, a call that
 * started, the file paths a call names and their places, a rank earned) is read off the same model
 * just before and after the change. A sea event is read through `seaMomentOf`.
 *
 * It keeps the stream's state in its context (the model, the sea's last CI verdicts, what it has
 * seen), so it is pure but for that: the same inputs in the same order make the same events.
 */

export interface NormalizeOptions {
  /** The place a file path leads to (`bindPlaces(...).placeOf`); without it no work has a place. */
  placeOf?: (path: string) => number | undefined
  /** How long a finished subagent stays before it leaves; `GONE_MS` by default. */
  goneMs?: number
}

/** A normaliser's stream state. Make one with `normalizer`, one per stream. */
export interface NormalizeContext {
  readonly model: GuildModel
  readonly placeOf: ((path: string) => number | undefined) | undefined
  readonly goneMs: number
  /** The next event's seq. */
  seq: number
  /** The last event's `at`: no event is made earlier than it. */
  last: number
  /** The last seq taken per guild: a repeat (a reconnect's replay) is dropped. */
  readonly guilds: Map<string, number>
  /** Sea events seen, by `kind:id`. */
  readonly sighted: Set<string>
  /** The last finished CI verdict per repo branch (`seaMomentOf`'s memory). */
  readonly finished: Map<string, CiState>
  /** Leaves due, by session: when each finished subagent goes. */
  readonly leaving: Map<string, number>
  /** The rank last said per session. */
  readonly ranks: Map<string, Rank>
  /** Who each session was last said to be (`Who` as a key), to tell only what changed. */
  readonly said: Map<string, string>
  /** Calls whose start was an `actor.step`. */
  readonly stepped: Set<string>
  /** Sessions that have left (until one works again). */
  readonly gone: Set<string>
}

/** A session its host closed (`closed`, Claude Code's `SessionEnd`) leaves this long after, ms. */
export const CLOSED_MS = 3000

export function normalizer(opts: NormalizeOptions = {}): NormalizeContext {
  return {
    model: new GuildModel(),
    placeOf: opts.placeOf,
    goneMs: opts.goneMs ?? GONE_MS,
    seq: 1,
    last: Number.NEGATIVE_INFINITY,
    guilds: new Map(),
    sighted: new Set(),
    finished: new Map(),
    leaving: new Map(),
    ranks: new Map(),
    said: new Map(),
    stepped: new Set(),
    gone: new Set(),
  }
}

/** Either thing the hub sends: a guild's change, or what happened on GitHub. */
export type WireInput = GuildEvent | SeaEvent

const isGuildEvent = (input: WireInput): input is GuildEvent => "change" in input

/**
 * The world events one wire input makes, in order, after any leave that fell due before it (`flush`).
 * Events never go back in time: one whose source says an earlier time than the last event's is made at
 * the last event's (it is heard then).
 */
export function normalize(input: WireInput, ctx: NormalizeContext): WorldEvent[] {
  if (isGuildEvent(input)) {
    const lastSeq = ctx.guilds.get(input.guild)
    if (lastSeq !== undefined && input.seq <= lastSeq) return []
    ctx.guilds.set(input.guild, input.seq)
    const out = flush(ctx, input.change.at)
    return out.concat(stamp(ctx, input.change.at, `${input.guild}#${input.seq}`, fromChange(input, ctx)))
  }
  const key = `${input.kind}:${input.id}`
  if (ctx.sighted.has(key)) return []
  ctx.sighted.add(key)
  const out = flush(ctx, input.at)
  const happening = fromSea(input, ctx)
  return happening ? out.concat(stamp(ctx, input.at, `sea:${input.id}`, [happening])) : out
}

/** The leaves due by `t` (a finished subagent gone `goneMs` after it ended), for a clock with no input. */
export function flush(ctx: NormalizeContext, t: number): WorldEvent[] {
  const due = [...ctx.leaving].filter(([, at]) => at <= t).sort((a, b) => a[1] - b[1] || cmp(a[0], b[0]))
  const out: WorldEvent[] = []
  for (const [id, at] of due) {
    ctx.leaving.delete(id)
    ctx.gone.add(id)
    out.push(...stamp(ctx, at, "clock", [{ kind: "actor.leave", id }]))
  }
  return out
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** `id` and every session under it (its subagents, theirs…), `id` first. */
function partyOf(sessions: ReadonlyMap<string, Pick<Session, "parentID">>, id: string): string[] {
  const out = [id]
  for (let k = 0; k < out.length; k++)
    for (const [other, s] of sessions) if (s.parentID === out[k] && !out.includes(other)) out.push(other)
  return out
}

function stamp(ctx: NormalizeContext, at: number, src: string, happenings: WorldHappening[]): WorldEvent[] {
  return happenings.map((h) => {
    ctx.last = Math.max(ctx.last, at)
    return { at: ctx.last, seq: ctx.seq++, src, ...h } as WorldEvent
  })
}

/** The file paths a tool call's input names, by the keys hosts use (Claude Code's are renamed too). */
export function pathsOf(input: Record<string, unknown>): string[] {
  const out: string[] = []
  for (const key of ["filePath", "file_path", "path", "file", "notebook_path", "notebookPath"]) {
    const value = input[key]
    if (typeof value === "string" && value && !out.includes(value)) out.push(value)
  }
  return out
}

function workOf(ctx: NormalizeContext, s: Session, entry: Extract<Entry, { kind: "tool" }>): Work {
  const paths = pathsOf(entry.input)
  const places: number[] = []
  if (ctx.placeOf)
    for (const path of paths) {
      const place = ctx.placeOf(path)
      if (place !== undefined) places.push(place)
    }
  return {
    id: s.id,
    call: entry.call,
    tool: entry.name,
    craft: deedCraft(entry),
    target: toolTarget(entry.name, entry.input),
    paths,
    places,
  }
}

function whoOf(ctx: NormalizeContext, s: Session): Who {
  const named = namedOf(s)
  const archetype = named.archetype.id
  return {
    id: s.id,
    ...(s.parentID ? { parent: s.parentID } : {}),
    agent: s.agent,
    archetype,
    body: bodyOf(archetype),
    name: actorOf(ctx.model, s).title,
    color: named.archetype.color,
    title: s.title,
    ...(s.task ? { task: s.task } : {}),
  }
}

const findTool = (s: Session | undefined, call: string) =>
  s?.entries.find((e): e is Extract<Entry, { kind: "tool" }> => e.kind === "tool" && e.call === call)

function fromChange(input: GuildEvent, ctx: NormalizeContext): WorldHappening[] {
  const { change } = input
  const before = ctx.model.sessions.get(change.id)
  const seen = before !== undefined
  const wasDone = before?.status === "done"
  const toolBefore: ToolState | undefined =
    change.type === "tool" ? findTool(before, change.call)?.state : undefined

  const moments = ctx.model.apply(change)
  const s = ctx.model.sessions.get(change.id)
  if (!s) return []
  const out: WorldHappening[] = []

  // who: on first sight, then whenever what the hall calls them changes
  const who = whoOf(ctx, s)
  const key = JSON.stringify(who)
  if (!seen) out.push({ kind: "actor.join", ...who })
  else if (ctx.said.get(s.id) !== key) out.push({ kind: "actor.info", ...who })
  ctx.said.set(s.id, key)

  // a call that started: the intent (the moments say only a quest's start)
  if (change.type === "tool") {
    const entry = findTool(s, change.call)
    if (entry && entry.state === "running" && toolBefore !== "running" && toolBefore !== "completed") {
      ctx.stepped.add(`${s.id}:${entry.call}`)
      out.push({ kind: "actor.step", ...workOf(ctx, s, entry) })
    }
  }

  for (const m of moments) {
    switch (m.kind) {
      case "join": // its parent is in the `actor.info` above
        break
      case "quest":
        out.push({ kind: "actor.quest", id: m.id, call: m.call, text: m.text })
        break
      case "deed":
      case "deed-failed": {
        const owner = ctx.model.sessions.get(m.id)
        const entry = findTool(owner, m.call)
        if (!owner || !entry) break
        const key = `${m.id}:${m.call}`
        const stepped = ctx.stepped.delete(key)
        const size = m.kind === "deed" ? (m.size ?? sizeOf(entry.name, entry.input)) : undefined
        out.push({
          kind: "actor.deed",
          ...workOf(ctx, owner, entry),
          failed: m.kind === "deed-failed",
          stepped,
          ...(size !== undefined ? { size } : {}),
          ...(m.kind === "deed-failed" && m.error ? { error: m.error } : {}),
          ...(m.kind === "deed-failed" && m.exit !== undefined ? { exit: m.exit } : {}),
        })
        break
      }
      case "plea":
        out.push({ kind: "actor.plea", id: m.id })
        break
      case "plea-answered":
        out.push({ kind: "actor.answered", id: m.id })
        break
      case "loot":
      case "fail": {
        out.push(m.kind === "loot" ? { kind: "actor.loot", id: m.id } : failOf(m.id, m.error))
        const owner = ctx.model.sessions.get(m.id)
        // a subagent leaves a while after it ends; the guildmaster keeps its seat in the hall
        if (owner?.parentID) ctx.leaving.set(m.id, m.at + ctx.goneMs)
        break
      }
      case "recover":
        ctx.leaving.delete(m.id)
        ctx.gone.delete(m.id)
        out.push({ kind: "actor.recover", id: m.id })
        break
    }
  }

  // a finished session at work again (the moments only say so for a failed one)
  if (wasDone && working(s)) {
    ctx.leaving.delete(s.id)
    ctx.gone.delete(s.id)
    out.push({ kind: "actor.resume", id: s.id })
  }

  // closed by its host (SessionEnd): it leaves CLOSED_MS on, and every subagent of its still here with it
  if (change.type === "status" && change.closed)
    for (const id of partyOf(ctx.model.sessions, s.id)) {
      if (ctx.gone.has(id)) continue
      const due = change.at + CLOSED_MS
      ctx.leaving.set(id, Math.min(ctx.leaving.get(id) ?? due, due))
    }

  if (change.type === "tool" || change.type === "usage" || !seen) {
    const rank = rankOf(experienceOf(s))
    if ((ctx.ranks.get(s.id) ?? "apprentice") !== rank) out.push({ kind: "actor.rank", id: s.id, rank })
    ctx.ranks.set(s.id, rank)
  }
  return out
}

const failOf = (id: string, error: string | undefined): WorldHappening =>
  error ? { kind: "actor.fail", id, error } : { kind: "actor.fail", id }

function fromSea(event: SeaEvent, ctx: NormalizeContext): WorldHappening | undefined {
  const { repo } = event
  switch (event.kind) {
    case "push":
      return {
        kind: "sea.push",
        repo,
        branch: event.branch,
        commits: event.commits,
        author: event.author,
        sha: event.sha,
      }
    case "pr_opened":
    case "pr_updated":
    case "pr_merged":
    case "pr_closed": {
      const state = (
        { pr_opened: "opened", pr_updated: "updated", pr_merged: "merged", pr_closed: "closed" } as const
      )[event.kind]
      return {
        kind: "sea.pr",
        repo,
        n: event.number,
        title: event.title,
        author: event.author,
        branch: event.branch,
        state,
        ...(event.status ? { status: event.status } : {}),
        ...(event.size !== undefined ? { size: event.size } : {}),
        ...(event.url ? { url: event.url } : {}),
      }
    }
    case "ci": {
      const moment = seaMomentOf(event, ctx.finished)
      return {
        kind: "sea.ci",
        repo,
        name: event.name,
        branch: event.branch,
        sha: event.sha,
        state: event.state,
        ...(moment?.kind === "sea-red" || moment?.kind === "sea-green" ? { moment: moment.kind } : {}),
      }
    }
    case "release":
      return { kind: "sea.release", repo, tag: event.tag, ...(event.name ? { name: event.name } : {}) }
    default:
      return undefined
  }
}
