/**
 * The hall's world events (plan .probe/v1events Task A): sim's show engine (story/worldEvents.ts) run
 * from the session's log at its clock, four times a second (never per frame). It keeps one engine per
 * log and per "watching began" (`since`: the hall's opening live, a seek's landing), fed only the new
 * events, so idle it reads a few shows and stops.
 *
 * The rules are a live hall's (sim `SHOW_RULES`) but for a told story's own pacing (`feed.showRules`, the
 * demos' shorter gap between big shows), and the raid's purse is the party's as of each moment
 * (`session.purseAt`), so a replay, a story and a live hall earn it alike.
 *
 * As each show starts (played through, not sought past) it is told (`showLine` through the session's
 * narrator), sounded (the audio engine's renown motif; a grave's toll) and pointed at (the director
 * reads `hints()` beside its own beats, hall/camera.ts). The render tasks read `shows(t)` (B graves,
 * C sky and town, D the sea) and say where their shows stand (`setSite`), which the camera films.
 *
 * `window.guildhall.ext.events`: `force(kind)` starts any show now, `dismiss(kind?)` sends a lasting
 * one home (a grave sinks), `shows()` lists what is on stage, `clear()` ends every show now, `cost()`
 * says what a read costs.
 */
import {
  dismissed,
  type FocusHint,
  forcedShow,
  renownKindOf,
  type Show,
  ShowEngine,
  type ShowKind,
  type ShowWho,
  showHint,
  showLine,
} from "@guildhall/sim"
import { audio } from "../audio/engine.ts"
import type { HallSession } from "./feeds/index.ts"

/** How often the shows are read, ms. */
export const EVENTS_READ_MS = 250
/** A show found this long after its start (a slow tab) is shown, not told. */
const FRESH_MS = 5000
/** The director's fastest skip through a quiet stretch (hud/mount.tsx `SKIP_MAX`): faster is a seek. */
const SKIP_MAX = 8

export type ShowPoint = readonly [x: number, y: number, z: number]
/** Where a show stands on the island (a render task's site: the graveyard, the peaks, the square). */
export type ShowSite = (show: Show) => ShowPoint | null

export interface HallEvents {
  /** The shows on stage at `t` (default: the session clock's), forced ones included. */
  shows(t?: number): readonly Show[]
  /** The director's hints for the shows on stage (story/worldEvents.ts `showHint`). */
  hints(): readonly FocusHint[]
  /** Where the camera films a show's focus: its site's point, lifted for a sky show; null without a site. */
  pointOf(focus: { id: string; show: ShowKind; lift?: number }): ShowPoint | null
  /** A render task says where its kind of show stands (null: it no longer knows). */
  setSite(kind: ShowKind, site: ShowSite | null): void
  /** Called when the shows on stage change (one starts, leaves, is mended or ends). */
  subscribe(fn: () => void): () => void
  force(kind: ShowKind, who?: ShowWho): Show
  dismiss(kind?: ShowKind): void
  clear(): void
  cost(): { reads: number; avgMs: number; maxMs: number; perFrameMs: number }
}

let current: HallEvents | null = null

/** The hall's world events while a session plays (null otherwise): for the render tasks and the camera. */
export const hallEvents = (): HallEvents | null => current

/** A party's purse (live only: the session model is at its head), by its guildmaster. */
function pursesOf(session: HallSession): Map<string, { tokens: number; cost: number }> {
  const sessions = session.model().sessions
  const out = new Map<string, { tokens: number; cost: number }>()
  for (const s of sessions.values()) {
    let root = s
    for (let k = 0; k < 64 && root.parentID; k++) root = sessions.get(root.parentID) ?? root
    const p = out.get(root.id) ?? { tokens: 0, cost: 0 }
    p.tokens += s.tokens
    p.cost += s.cost
    out.set(root.id, p)
  }
  return out
}

/**
 * The world events of `session` (see the top of this file), read when told (`read`: `mountEvents`
 * does it four times a second; a test steps it).
 */
export function createEvents(session: HallSession): HallEvents & { read(): void } {
  const live = session.feed.kind === "live"
  const mountedAt = Date.now()
  let engine: ShowEngine | null = null
  let engineLog: unknown = null
  let since = Number.NEGATIVE_INFINITY
  let jumps = -1
  let lastAt = Number.NEGATIVE_INFINITY
  let lastReal = performance.now()
  let shows: readonly Show[] = []
  let hints: readonly FocusHint[] = []
  let signature = ""
  let purses: Map<string, { tokens: number; cost: number }> | null = null
  const forced: Show[] = []
  /** Earned shows told to go (a dismiss) or ended (a clear), at that time. */
  const dismissedAt = new Map<string, number>()
  const clearedAt = new Map<string, number>()
  const announced = new Set<string>()
  const sites = new Map<ShowKind, ShowSite>()
  const listeners = new Set<() => void>()
  let reads = 0
  let total = 0
  let max = 0
  let nForced = 0

  const at = () => session.clock.get().at
  /** The party's purse as of `at` (the session's book); without one, a live session model's head. */
  const purseOf = (master: string, when: number) => {
    if (session.purseAt) return session.purseAt(master, when)
    if (!live) return undefined
    if (!purses) purses = pursesOf(session)
    return purses.get(master)
  }

  const merged = (t: number): Show[] => {
    const earned = engine?.at(t) ?? []
    const out: Show[] = []
    for (const s0 of [...earned, ...forced]) {
      let s = s0
      const d = dismissedAt.get(s.id)
      if (d !== undefined && d >= s.start && d <= t) s = dismissed(s, d)
      const c = clearedAt.get(s.id)
      if (c !== undefined && c >= s.start && c <= t) s = { ...s, end: Math.min(s.end, c) }
      if (s.start <= t && s.end > t) out.push(s)
    }
    return out
  }

  const tell = (s: Show) => {
    const parts = showLine(s)
    const who = s.params.who
    if (parts)
      session.herald(parts, {
        id: who?.id ?? s.params.master ?? "",
        title: who?.name ?? "",
        color: who?.color ?? "",
        master: s.params.master ?? "",
        at: s.start,
      })
    const kind = renownKindOf(s.kind)
    if (kind) audio.renown(kind)
    else if (!s.params.grave?.minion) audio.spot("toll")
  }

  const read = () => {
    const begin = performance.now()
    const c = session.clock.get()
    const log = session.log()
    // a seek, a scrub, a chapter jump or a loop: watching begins again where the clock landed
    const real = begin - lastReal
    const reach = c.playing ? real * Math.max(1, c.rate) * SKIP_MAX + 1000 : 1
    const jumped = c.jumps !== jumps || c.at < lastAt - 1 || c.at - lastAt > reach
    if (jumped) {
      jumps = c.jumps
      since = live ? Math.max(c.at, mountedAt) : c.at
      engine = null
      announced.clear()
    }
    lastAt = c.at
    lastReal = begin
    if (log !== engineLog) {
      // a new log (the feed started over, the home switched stories): its shows are new ones
      engine = null
      if (engineLog !== null) announced.clear()
    }
    if (!engine) {
      const gap = session.feed.showRules?.gapMs
      engine = new ShowEngine({
        since,
        purse: purseOf,
        ...(gap !== undefined ? { gapMs: gap } : {}),
      })
      engineLog = log
    }
    purses = null
    engine.feed(log.events)
    shows = merged(c.at)
    hints = shows.filter((s) => !s.quiet && s.start >= since).map(showHint)
    for (const s of shows) {
      if (s.quiet || announced.has(s.id)) continue
      announced.add(s.id)
      if (c.at - s.start < FRESH_MS) tell(s)
    }
    const next = shows.map((s) => `${s.id}:${s.end}:${s.params.grave?.fixed ?? ""}`).join("|")
    const took = performance.now() - begin
    reads++
    total += took
    max = Math.max(max, took)
    if (next !== signature) {
      signature = next
      for (const fn of [...listeners]) fn()
    }
  }

  const firstHero = (): ShowWho | undefined => {
    const world = session.snapshot().world
    for (const a of world.actors.values())
      if (a.gone === undefined && a.parent !== undefined)
        return { id: a.id, name: a.name, color: a.color, archetype: a.archetype, body: a.body }
    return undefined
  }

  const api: HallEvents & { read(): void } = {
    shows: (t) => (t === undefined || t === at() ? shows : merged(t)),
    hints: () => hints,
    pointOf(focus) {
      const show = shows.find((s) => s.id === focus.id)
      const p = show ? sites.get(focus.show)?.(show) : null
      return p ? [p[0], p[1] + (focus.lift ?? 0), p[2]] : null
    },
    setSite(kind, site) {
      if (site) sites.set(kind, site)
      else sites.delete(kind)
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    force(kind, who) {
      const show = forcedShow(kind, at(), ++nForced, who ?? firstHero())
      forced.push(show)
      read()
      return show
    },
    dismiss(kind) {
      const t = at()
      for (const s of shows) {
        if (kind ? s.kind !== kind : s.end !== Number.POSITIVE_INFINITY) continue
        const i = forced.indexOf(forced.find((f) => f.id === s.id) as Show)
        if (i >= 0) forced[i] = dismissed(forced[i] as Show, t)
        else dismissedAt.set(s.id, t)
      }
      read()
    },
    clear() {
      const t = at()
      for (const s of shows) clearedAt.set(s.id, t)
      forced.length = 0
      read()
    },
    cost: () => ({
      reads,
      avgMs: reads ? total / reads : 0,
      maxMs: max,
      // four reads a second spread over sixty frames
      perFrameMs: reads ? ((total / reads) * (1000 / EVENTS_READ_MS)) / 60 : 0,
    }),
    read,
  }
  return api
}

/** Runs the world events from `session` four times a second, as `hallEvents()` and `ext.events`. Returns the unmount. */
export function mountEvents(session: HallSession): () => void {
  const api = createEvents(session)
  api.read()
  const timer = setInterval(api.read, EVENTS_READ_MS)
  current = api
  const ext = (typeof window === "undefined" ? undefined : window.guildhall?.ext) as
    | Record<string, unknown>
    | undefined
  if (ext)
    ext.events = {
      api,
      force: (kind: ShowKind) => api.force(kind).id,
      dismiss: (kind?: ShowKind) => api.dismiss(kind),
      clear: () => api.clear(),
      cost: () => api.cost(),
      /** What is on stage, in seconds from the log's start: for shots and the console. */
      shows: () => {
        const origin = session.origin() ?? 0
        const s = (ms: number | undefined) =>
          ms === undefined ? undefined : Number.isFinite(ms) ? Math.round(ms - origin) / 1000 : null
        return api.shows().map((show) => ({
          id: show.id,
          kind: show.kind,
          start: s(show.start),
          end: s(show.end),
          quiet: show.quiet,
          forced: show.forced === true,
          who: show.params.who?.name,
          where: show.params.where,
          size: show.params.size,
          ...(show.params.grave
            ? {
                grave: {
                  ...show.params.grave,
                  rise: s(show.params.grave.rise),
                  vigil: s(show.params.grave.vigil),
                  fixed: s(show.params.grave.fixed),
                  strike: s(show.params.grave.strike),
                  sink: s(show.params.grave.sink),
                  fixer: show.params.grave.fixer?.name,
                },
              }
            : {}),
        }))
      },
    }
  return () => {
    clearInterval(timer)
    if (current === api) current = null
    if (ext && (ext.events as { api?: HallEvents } | undefined)?.api === api) delete ext.events
  }
}
