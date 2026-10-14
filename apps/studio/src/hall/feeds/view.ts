/**
 * The session as the HUD draws it (ui never sees the sim, plan §3.5): the world at the clock's time read
 * into plain props for the Roster, the Pleas, a hero's Dossier, the session Chronicle and the timeline's
 * beats. Pure: no React, no DOM.
 */
import {
  type Entry,
  firstWords,
  type GuildModel,
  type GuildWorld,
  heroes,
  pathsOf,
  pleas,
  type HeroView as SimHero,
  toolTarget,
  type WorldEvent,
} from "@guildhall/sim"
import type {
  ChronicleEntry,
  DossierProps,
  EntryKind,
  FilePlace,
  HeroView,
  PartyView,
  Phase,
  PleaView,
  TimelineMarker,
  TranscriptLine,
} from "@guildhall/ui"
import type { FeedChapter } from "./feed.ts"

/** A zone's name on the island (`the village of world`), or the hall's for undefined. */
export type PlaceName = (zone: number | undefined) => string

/** The hall, where every hero starts and where work that names no file is done. */
export const HALL = "the Guildhall"

const PHASE: Record<SimHero["status"], Phase> = {
  starting: "idle",
  working: "working",
  waiting: "waiting",
  done: "loot",
  failed: "failed",
}

/** Who leads a hero's party: its guildmaster (the top of its parent chain). */
function masterOf(world: GuildWorld, id: string): string {
  let at = id
  for (let k = 0; k < 64; k++) {
    const parent = world.actors.get(at)?.parent
    if (parent === undefined || !world.actors.has(parent)) return at
    at = parent
  }
  return at
}

/** A hero as the Roster draws it. */
export function heroView(world: GuildWorld, h: SimHero, place: PlaceName): HeroView {
  const where = place(h.place)
  const heading = h.heading !== undefined ? place(h.heading) : undefined
  const intent = h.intent?.running ? h.intent : undefined
  return {
    id: h.id,
    name: h.name,
    ...(h.agent && h.agent !== "agent" ? { source: h.agent } : {}),
    family: h.body,
    banner: h.color,
    ...(h.root ? { master: true } : {}),
    party: masterOf(world, h.id),
    // a guildmaster done with its quest rests in the hall; a subagent done carries its loot home
    phase: h.root && h.status === "done" ? "resting" : PHASE[h.status],
    // the roster's second line: the deed in hand, else where they are (or are bound)
    doing: intent
      ? `${intent.craft} · ${intent.target || intent.tool}`
      : heading
        ? `bound for ${heading}`
        : where === HALL
          ? `in ${HALL}`
          : `at ${where}`,
    place: heading ? `${where} → ${heading}` : where,
    rank: h.rank,
  }
}

/** Everyone on the island at `t`, the Roster's way. */
export function rosterOf(world: GuildWorld, t: number, place: PlaceName): HeroView[] {
  return heroes(world, t).map((h) => heroView(world, h, place))
}

/** One party per guildmaster on the island: its banner, and its quest's first words as its name. */
export function partiesOf(world: GuildWorld, t: number): PartyView[] {
  return heroes(world, t)
    .filter((h) => h.root)
    .map((h) => ({ id: h.id, name: h.task ? firstWords(h.task) : h.name, colour: h.color }))
}

/** Who waits on a human, longest first, with what they ask. */
export function pleaViews(world: GuildWorld, t: number, place: PlaceName): PleaView[] {
  const cast = new Map(heroes(world, t).map((h) => [h.id, h]))
  return pleas(world).flatMap((p) => {
    const h = cast.get(p.id)
    if (!h) return []
    const ask = h.intent ? `${h.intent.tool} · ${h.intent.target}` : undefined
    return [{ hero: heroView(world, h, place), ...(ask ? { ask } : {}) }]
  })
}

/** `…/guildhall/packages/world/src/hex/life.ts` → `packages/world/src/hex/life.ts` (from the repo's folder on). */
export function shortPath(path: string, repo: string): string {
  const parts = path.split(/[\\/]+/)
  const at = parts.lastIndexOf(repo)
  // a worktree's checkout sits inside the repo's folder: from the checkout's own root on
  const tree = parts.lastIndexOf("worktrees")
  const from = tree > at && tree >= 0 ? tree + 2 : at >= 0 ? at + 1 : Math.max(0, parts.length - 3)
  return parts.slice(from).join("/") || path
}

/**
 * A hero up close at `t`: its quest, its purse, the files its calls named and where each is, and its
 * transcript up to `t` (the model holds the head; lines after `t` are left out, calls still running at
 * `t` read as running).
 */
export function dossierOf(
  world: GuildWorld,
  model: GuildModel,
  id: string,
  t: number,
  place: PlaceName,
  opts: { repo: string; placeOf?: (path: string) => number | undefined },
): Omit<DossierProps, "onClose"> | null {
  const h = heroes(world, t, { gone: true }).find((x) => x.id === id)
  if (!h) return null
  const s = model.sessions.get(id)
  const parties = partiesOf(world, t)
  const hero = heroView(world, h, place)
  const party = parties.length > 1 ? parties.find((p) => p.id === hero.party) : undefined
  const entries: Entry[] = (s?.entries ?? []).filter((e) => e.at <= t)
  const transcript: TranscriptLine[] = entries.map((e): TranscriptLine => {
    if (e.kind === "tool") {
      const done = e.ended !== undefined && e.ended <= t
      return {
        kind: "tool",
        key: e.call,
        name: e.name,
        target: toolTarget(e.name, e.input),
        state: done ? e.state : e.state === "pending" ? "pending" : "running",
        ...(done && e.summary ? { note: e.summary } : {}),
      }
    }
    if (e.kind === "prompt") return { kind: "prompt", key: e.key, text: e.text, first: e.first }
    return { kind: e.kind, key: e.key, text: e.text }
  })
  const files = new Map<string, FilePlace>()
  for (const e of entries) {
    if (e.kind !== "tool") continue
    for (const path of pathsOf(e.input)) {
      const short = shortPath(path, opts.repo)
      const had = files.get(short)
      if (had) had.deeds = (had.deeds ?? 0) + 1
      else files.set(short, { path: short, place: place(opts.placeOf?.(path)), deeds: 1 })
    }
  }
  return {
    hero,
    ...(party ? { party } : {}),
    ...(h.task ? { quest: h.task } : {}),
    ledger: {
      tokens: s?.tokens ?? 0,
      cost: s?.cost ?? 0,
      deeds: h.deeds,
      ms: Math.max(0, t - (s?.started ?? t)),
    },
    ...(s?.model ? { model: s.model } : {}),
    files: [...files.values()].sort((a, b) => (b.deeds ?? 0) - (a.deeds ?? 0)).slice(0, 24),
    transcript,
  }
}

/** The timeline's beats, at ms from the session's start: quests sent, loot home, pleas, failed deeds. */
export function markersOf(events: readonly WorldEvent[], origin: number, max = 240): TimelineMarker[] {
  const out: TimelineMarker[] = []
  for (const e of events) {
    const kind =
      e.kind === "actor.quest"
        ? "quest"
        : e.kind === "actor.loot"
          ? "loot"
          : e.kind === "actor.plea"
            ? "plea"
            : e.kind === "actor.deed" && e.failed
              ? "fail"
              : null
    if (kind) out.push({ at: e.at - origin, kind })
  }
  if (out.length <= max) return out
  // too many to tell apart on a bar: every plea and failure, and an even share of the rest
  const loud = out.filter((m) => m.kind === "plea" || m.kind === "fail")
  const rest = out.filter((m) => m.kind !== "plea" && m.kind !== "fail")
  const every = Math.ceil(rest.length / Math.max(1, max - loud.length))
  return [...loud, ...rest.filter((_, k) => k % every === 0)].sort((a, b) => a.at - b.at)
}

const ENTRY: Partial<Record<WorldEvent["kind"], EntryKind>> = {
  "actor.join": "join",
  "actor.quest": "quest",
  "actor.plea": "plea",
  "actor.loot": "loot",
  "actor.fail": "fail",
  "actor.deed": "deed",
}

/** A session chronicle line, and what makes a repeat of it the same moment (`groupRepeats`). */
export interface SessionEntry extends ChronicleEntry {
  /** Lines with one `same` in a row are one moment told again (`bash failed` three times). */
  same: string
  /** The line as a repeat tells it, without what differs between them (a failed deed's target). */
  short: string
}

/**
 * Where to start reading `events` (sorted by time) for the newest `max` lines at `t`: a binary search
 * for the first event after `t`, then `slack` times `max` back (every event is at most one line).
 */
function windowOf(events: readonly WorldEvent[], t: number, max: number, slack = 8): [number, number] {
  let lo = 0
  let hi = events.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if ((events[mid] as WorldEvent).at <= t) lo = mid + 1
    else hi = mid
  }
  return [Math.max(0, lo - max * slack), lo]
}

/**
 * The session's chronicle up to `t`, oldest first, at ms from its start (V1's Chronicle): who joined,
 * the quests sent, pleas, loot and falls, and every deed with its tool and target (a failed one in red,
 * its error's first words after it). The newest `max` lines.
 */
export function chronicleOf(
  events: readonly WorldEvent[],
  world: GuildWorld,
  t: number,
  origin: number,
  max = 80,
): SessionEntry[] {
  const out: SessionEntry[] = []
  const [from, to] = windowOf(events, t, max)
  for (let k = from; k < to; k++) {
    const e = events[k] as WorldEvent
    const failed = e.kind === "actor.deed" && e.failed
    const kind = failed ? "fail" : ENTRY[e.kind]
    if (!kind || !("id" in e)) continue
    const a = world.actors.get(e.id)
    let text = ""
    let short = ""
    let same = `${e.kind}|${e.id}`
    if (e.kind === "actor.join") text = e.parent ? "joins the party" : "takes the seat in the great hall"
    else if (e.kind === "actor.quest") text = `sends a quest: ${firstWords(e.text)}`
    else if (e.kind === "actor.plea") text = "awaits your word"
    else if (e.kind === "actor.loot") text = "brings the loot home"
    else if (e.kind === "actor.fail") text = `falls${e.error ? `: ${firstWords(e.error)}` : ""}`
    else if (e.kind === "actor.deed") {
      const tool = e.tool.toLowerCase()
      same = `${same}|${tool}|${e.failed}`
      if (e.failed) {
        short = `${tool} failed`
        text = `${short}${e.target ? `: ${e.target}` : e.error ? `: ${firstWords(e.error)}` : ""}`
      } else {
        short = tool
        text = e.target ? `${tool} ${e.target}` : tool
        same = `${same}|${e.target}`
      }
    }
    if (e.kind !== "actor.deed") same = `${same}|${text}`
    out.push({
      key: `s${e.seq}`,
      at: e.at - origin,
      kind,
      who: a?.name ?? "Someone",
      banner: a?.color ?? "var(--brass)",
      text,
      hero: e.id,
      party: masterOf(world, e.id),
      same,
      short: short || text,
    })
  }
  return out.slice(-max)
}

/** Repeats further apart than this (session ms) are separate moments. */
export const REPEAT_MS = 90_000

/**
 * The chronicle with each run of repeats told once (V1 "beyond parity": `Artisan II bash failed ×3`):
 * lines with the same `same`, each within `REPEAT_MS` of the last and with nothing else of that hero's
 * between, become the newest of them, its text the short form with the count. The grouped line takes
 * the newest's key, so a toast for it comes up again at each repeat. Oldest first, as given.
 */
export function groupRepeats<E extends SessionEntry>(entries: readonly E[], within = REPEAT_MS): E[] {
  const out: (E | null)[] = []
  const count: number[] = []
  const lastOf = new Map<string, number>()
  for (const e of entries) {
    const at = e.hero ? lastOf.get(e.hero) : undefined
    const prev = at !== undefined ? out[at] : undefined
    let n = 1
    if (at !== undefined && prev && prev.same === e.same && e.at - prev.at <= within) {
      // the run moves up to its newest line
      n = (count[at] ?? 1) + 1
      out[at] = null
    }
    if (e.hero) lastOf.set(e.hero, out.length)
    out.push(n > 1 ? { ...e, text: `${e.short} ×${n}` } : e)
    count.push(n)
  }
  return out.filter((e): e is E => e !== null)
}

/** The beats a bar keeps (user 10-13: fewer ticks), most telling first. */
const LOUDNESS: Record<TimelineMarker["kind"], number> = {
  plea: 0,
  fail: 1,
  release: 2,
  quest: 3,
  born: 4,
  loot: 5,
}

/**
 * A few of `markers` over a bar from `start`, `len` long: the most telling first (pleas, failures, acts
 * and majors, quests), each at least `gap` of the bar from those kept, at most `max`. In time order.
 */
export function fewMarkers<M extends TimelineMarker>(
  markers: readonly M[],
  start: number,
  len: number,
  gap = 0.02,
  max = 24,
): M[] {
  const room = Math.max(1, len) * gap
  const kept: M[] = []
  const ranked = [...markers].sort((a, b) => LOUDNESS[a.kind] - LOUDNESS[b.kind] || a.at - b.at)
  for (const m of ranked) {
    if (kept.length >= max) break
    if (m.at < start || m.at > start + len) continue
    if (kept.some((k) => Math.abs(k.at - m.at) < room)) continue
    kept.push(m)
  }
  return kept.sort((a, b) => a.at - b.at)
}

/** A told story's acts as the bar's beats, at ms from its start. */
export function actMarkers(chapters: readonly FeedChapter[]): TimelineMarker[] {
  return chapters.map((c) => ({ at: c.at, kind: "release", label: `${c.numeral} · ${c.title}` }))
}
