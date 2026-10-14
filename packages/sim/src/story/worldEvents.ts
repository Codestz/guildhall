// From V1 hall (legacy/packages/hall/src/guild/events.ts `WorldEvents`, guild/undead.ts `Undead`,
// scene/events/EventsLayer.tsx `LOOK`): the live scheduler, remade as a pure function of the log.
import type { CiState } from "@guildhall/core"
import type { Distance, FocusHint } from "../director/pick.ts"
import type { EventLog } from "../events/log.ts"
import type { WorldEvent } from "../events/world.ts"
import type { Session } from "../guild/model.ts"
import type { ArchetypeId } from "../roster/archetypes.ts"
import type { Body } from "../roster/bodies.ts"
import {
  type EventKind,
  type LedgerContext,
  type LedgerHappening,
  type Renown,
  type RenownFacts,
  RenownLedger,
} from "./renown.ts"
import { type CaptionPart, hash, pick, renownLine } from "./story.ts"
import type { StoryMoment } from "./teller.ts"

/**
 * The world events on stage (plan .probe/v1events/plan.md, Task A): which shows play at run time `t`,
 * as a pure function of the log up to `t`. `worldShows(log, t, opts)` folds the log's events through
 * the Deeds of Renown's rules (story/renown.ts, V1's ledger) and V2's own triggers, and schedules what
 * they earn:
 *
 *   festival    a quest finishes clean (≥ 15 deeds, none failed)                    42 s, the square
 *   ghostship   a session falls after ≥ 6 min, or two fall within 2 min in a quest  36 s, offshore
 *   rainbow     CI's storm clears (the sky is CI's: `weatherOf`) within 4 min         32 s, overhead
 *   raid        a session runs ≥ 45 min (or, live, spends ≥ 2M tokens or $10)       until its quest ends
 *   comet       the 100th / 500th / 1000th deed, the 1000th / 5000th line            15 s, the sky
 *   dragon      three failed commands in a row (one hero), or five failed deeds in   until the streak
 *               three minutes; at most one every 8 min                              breaks (≤ 4 min)
 *   undead      a state, not a one-off: a grave whose skeleton rises when a session fails, a package's
 *               tests fail or CI turns red, keeps vigil, and sinks when the cause is mended (the fixing
 *               hero strikes it once first); a failed deed's minion stands 5 s
 *
 * The scheduling rules (V1's): at most one big show (every kind but undead) starts per `gapMs` (150 s)
 * of run time; each kind has its own cooldown; a show that waits too long for its slot is dropped
 * (`staleMs`); lasting shows (dragon, raid) leave when their cause is over or at their cap. Shows are
 * keyed by the run time on the log's clock (`at`, epoch ms): the same log and `t` give the same shows,
 * whether played through or sought.
 *
 * `since` (default: the log's start) is where watching began: a live hall's opening (its hello's history
 * before it), a seek's landing. What is earned before it counts (cooldowns, milestones, a raid's purse)
 * but never shows; a grave already standing then is simply there (`quiet`: no rise, never announced).
 * So history replays earn but never show, and a seek replays nothing.
 *
 * Nothing here draws or sounds: render tasks read `Show` (kind, start/end, params), the hall announces
 * each show's start (a caption, `showLine`; a motif; a focus hint for the director, `showHint`).
 */

export const SHOW_KINDS = ["undead", "dragon", "comet", "rainbow", "festival", "ghostship", "raid"] as const
export type ShowKind = (typeof SHOW_KINDS)[number]

/** Who a show is about, as the hall named them then. */
export interface ShowWho {
  id: string
  name: string
  color: string
  archetype?: ArchetypeId
  body?: Body
}

/** Where a show's cause was: a hero's place (zone index), a package, a CI branch. */
export interface ShowWhere {
  place?: number
  /** `packages/world`: the package whose tests failed. */
  package?: string
  repo?: string
  branch?: string
}

/** What raised a grave. */
export type GraveCause = "fail" | "test" | "ci" | "deed"

/**
 * A grave of the graveyard (undead shows). Times are run time, ms: the skeleton lies still and claws
 * up from `rise` to `vigil`, keeps vigil, and once its cause is mended (`fixed`) the fixing hero walks
 * over and strikes it (`strike`), it dies again (`sink`) and is gone at the show's `end`.
 */
export interface Grave {
  /** Which grave, 0 nearest the gate: `0 … MAX_GRAVES − 1`, never two at once. */
  slot: number
  cause: GraveCause
  /** A failed deed's flavour skeleton: stands `minionMs` and crumbles, no fixer. */
  minion: boolean
  rise: number
  vigil: number
  /** When its cause was mended (a recover, a passing test, CI green); undefined while it stands. */
  fixed?: number
  /** Who mends it and strikes the grave (absent: it just sinks). */
  fixer?: ShowWho
  /** The fixer's blow (`fixed + strikeMs`), when there is a fixer. */
  strike?: number
  /** When it dies and sinks (after the blow, or at `fixed`). */
  sink?: number
}

export interface ShowParams {
  /** Who it honours or mourns (a festival's hero, a dragon's failing hero, a grave's fallen). */
  who?: ShowWho
  /** The guildmaster whose party earned it. */
  master?: string
  where?: ShowWhere
  /**
   * How big: festival clean deeds · ghostship fallen · dragon failures in the streak · raid minutes
   * · comet the milestone (deeds or lines) · undead the fallen's failures so far.
   */
  size?: number
  grave?: Grave
}

/** One show on stage. */
export interface Show {
  /** Deterministic: the same log gives the same ids (a React key for the render tasks). */
  id: string
  kind: ShowKind
  /** Run time it starts, ms (the log's clock: `clock.at`). */
  start: number
  /** Run time it is gone, ms; `Infinity` while a lasting one's cause is not over (as of `t`). */
  end: number
  /** A lasting show (dragon, raid): when it was told to go (its leaving runs to `end`). */
  leave?: number
  /** The director's weight (V1's scale: 10 a plea, 8 a rise, 6 loot, 1 a routine deed). */
  weight: number
  /** Already under way when watching began: drawn as it stands, never announced. */
  quiet: boolean
  /** Forced (`ext.events.force`): past every rule. */
  forced?: boolean
  /** The deed of renown it answers (every kind but undead): its caption's words. */
  renown?: Renown
  params: ShowParams
}

/** The renown rules' kinds, as shows. */
const OF_RENOWN: Readonly<Record<EventKind, ShowKind>> = {
  festival: "festival",
  "ghost-ship": "ghostship",
  rainbow: "rainbow",
  raid: "raid",
  comet: "comet",
  dragon: "dragon",
}

/** A show's renown kind (its motif, its words), if it has one. */
export function renownKindOf(kind: ShowKind): EventKind | undefined {
  if (kind === "undead") return undefined
  return kind === "ghostship" ? "ghost-ship" : kind
}

/** Lasting shows: they leave when their cause is over, not after a fixed time. */
export const LASTING_SHOWS: ReadonlySet<ShowKind> = new Set<ShowKind>(["dragon", "raid", "undead"])

export const SHOW_RULES = {
  /** Least run time between two big shows starting. */
  gapMs: 150_000,
  /** How long the timed shows play. */
  durationMs: { festival: 42_000, ghostship: 36_000, rainbow: 32_000, comet: 15_000 } as Readonly<
    Partial<Record<ShowKind, number>>
  >,
  /** A lasting show's leaving, from when it is told to go. */
  leaveMs: { dragon: 8_000, raid: 20_000 } as Readonly<Partial<Record<ShowKind, number>>>,
  /** A lasting show leaves after this long whatever happens. */
  capMs: { dragon: 4 * 60_000, raid: 12 * 60_000 } as Readonly<Partial<Record<ShowKind, number>>>,
  /** A show still waiting for its slot this long after it was earned is dropped. */
  staleMs: {
    festival: 45_000,
    ghostship: 60_000,
    rainbow: 40_000,
    comet: 60_000,
    dragon: Number.POSITIVE_INFINITY,
    raid: Number.POSITIVE_INFINITY,
  } as Readonly<Partial<Record<ShowKind, number>>>,
  /** Least run time between two starts of one kind, any party (the dragon: V1's ≤ 1 per 8 min). */
  cooldownMs: {
    festival: 6 * 60_000,
    ghostship: 8 * 60_000,
    rainbow: 8 * 60_000,
    comet: 0,
    dragon: 8 * 60_000,
    raid: 12 * 60_000,
  } as Readonly<Partial<Record<ShowKind, number>>>,
  /** The rainbow: CI's storm must have ended this recently when the sky clears. */
  rainbowWindowMs: 4 * 60_000,
  /** Graves the fallen may hold; minions take free ones, at most `minions` at once. */
  graves: 8,
  minions: 3,
  /** Lying still, then Skeletons_Awaken_Floor (V1). */
  riseMs: 2800,
  /** Skeletons_Death, then down into the earth. */
  sinkMs: 2600,
  /** A failed deed's minion waits this long (the same failure may end its session: the grave tells it). */
  minionGraceMs: 2000,
  minionMs: 5000,
  /** From the mending to the fixer's blow: its walk to the grave. */
  strikeMs: 3000,
  /** From the blow to the sinking. */
  strikeHoldMs: 600,
  /** Who last did good work this recently mends a red CI's grave. */
  fixerMs: 5 * 60_000,
} as const

/** The weight, how long and how wide the director looks when a show starts (V1's `LOOK`, the plan's). */
export const SHOW_LOOK: Readonly<
  Record<ShowKind, { weight: number; ttl: number; distance: Distance; lift?: number }>
> = {
  undead: { weight: 8, ttl: 3500, distance: "mid" },
  dragon: { weight: 8, ttl: 14_000, distance: "map", lift: 30 },
  comet: { weight: 5, ttl: 8000, distance: "map", lift: 45 },
  rainbow: { weight: 6, ttl: 10_000, distance: "map", lift: 50 },
  festival: { weight: 8, ttl: 14_000, distance: "mid" },
  ghostship: { weight: 8, ttl: 16_000, distance: "map" },
  raid: { weight: 7, ttl: 14_000, distance: "mid" },
}

export interface WorldShowOptions {
  /** Where watching began (run time): what starts before it never shows. Default: −∞ (all of it). */
  since?: number
  /** Override the least time between big shows (tests). */
  gapMs?: number
  /**
   * A party's purse (tokens, cost) for the raid's treasury rule. Only a live hall knows it (the session
   * model at its head), so a replay's raid comes from its length alone.
   */
  purse?: (master: string) => { tokens: number; cost: number } | undefined
}

// ─────────────────────────────── the engine ───────────────────────────────

/** Tools that are quests, not deeds (the ledger skips them too). */
const PACKAGE = /\b((?:packages|apps|libs|services|crates|modules|tools|src)\/[\w.@-]+)/

interface Entry {
  show: Show
  /** Run time it was earned (≤ start). */
  earned: number
  /** A lasting show's cause ended at (it leaves then, or at its cap). */
  over?: number
}

interface Standing {
  entry: Entry
  /** Its subject: a hero's id, `ci:<repo>:<branch>`. */
  subject: string
}

/**
 * The incremental engine behind `worldShows`: fed the log's events in order (`feed`), it keeps every
 * show's timeline; `at(t)` reads the shows on stage at `t`, masking what only later events could know.
 * Fed the whole log and read at `t`, it says exactly what `worldShows(log, t)` says (the rules are
 * causal: every decision reads only events at or before its time).
 */
export class ShowEngine {
  private readonly ledger = new RenownLedger()
  private readonly since: number
  private readonly gap: number
  private readonly purse: WorldShowOptions["purse"]
  /** Every show scheduled, in start order of scheduling. */
  private readonly entries: Entry[] = []
  private readonly parents = new Map<string, string | undefined>()
  private readonly whos = new Map<string, ShowWho>()
  private readonly places = new Map<string, number>()
  private readonly failures = new Map<string, number>()
  private lastStart = Number.NEGATIVE_INFINITY
  private readonly lastOf = new Map<ShowKind, number>()
  private readonly ci = new Map<string, CiState>()
  private stormy = false
  private stormEnd: number | undefined
  private rainbows = 0
  private readonly graves: Standing[] = []
  private minionsDue: { id: string; due: number }[] = []
  private minted = 0
  private lastGood: { id: string; at: number } | undefined
  private master = ""
  private fed = 0
  private readonly ctx: LedgerContext

  constructor(opts: WorldShowOptions = {}) {
    this.since = opts.since ?? Number.NEGATIVE_INFINITY
    this.gap = opts.gapMs ?? SHOW_RULES.gapMs
    this.purse = opts.purse
    this.ctx = {
      session: () => undefined,
      party: () => {
        const p = this.purse?.(this.master)
        return p
          ? [{ id: this.master, tokens: p.tokens, cost: p.cost, entries: [] } as unknown as Session]
          : []
      },
    }
  }

  /** Events consumed so far. */
  get count(): number {
    return this.fed
  }

  /** Takes `events[from…]` (a log's events in order): only those after what it already took. */
  feed(events: readonly WorldEvent[], from = this.fed, until = Number.POSITIVE_INFINITY): void {
    for (let i = Math.max(from, this.fed); i < events.length; i++) {
      const ev = events[i] as WorldEvent
      if (ev.at > until) break
      this.flush(ev.at, false)
      this.take(ev)
      this.fed = i + 1
    }
  }

  /** The shows on stage at `t` (start ≤ t < end), oldest first. */
  at(t: number): Show[] {
    this.flush(t, true)
    const out: Show[] = []
    for (const e of this.entries) {
      const s = e.show
      if (s.start > t) continue
      const shown = this.view(e, t)
      if (shown.end > t) out.push(shown)
    }
    return out
  }

  /** Every show scheduled so far (masked as of `t`): for the tests and the book. */
  all(t = Number.POSITIVE_INFINITY): Show[] {
    this.flush(t, true)
    return this.entries.filter((e) => e.show.start <= t).map((e) => this.view(e, t))
  }

  /** A show as `t` knows it: a leave or a mending later than `t` is not known yet. */
  private view(e: Entry, t: number): Show {
    const s = e.show
    if (s.kind === "undead") {
      const g = s.params.grave as Grave
      if (g.minion || g.fixed === undefined || g.fixed <= t)
        return { ...s, params: { ...s.params, grave: { ...g } } }
      const { fixed: _f, fixer: _x, strike: _s, sink: _k, ...standing } = g
      return { ...s, end: Number.POSITIVE_INFINITY, params: { ...s.params, grave: standing } }
    }
    const cap = SHOW_RULES.capMs[s.kind]
    if (cap === undefined) return { ...s }
    const leave = Math.min(e.over ?? Number.POSITIVE_INFINITY, s.start + cap)
    if (leave > t) return { ...s, end: Number.POSITIVE_INFINITY }
    return { ...s, leave, end: leave + (SHOW_RULES.leaveMs[s.kind] ?? 0) }
  }

  // ── the moments ──

  private masterOf(id: string): string {
    let at = id
    for (let k = 0; k < 64; k++) {
      const up = this.parents.get(at)
      if (up === undefined) return at
      at = up
    }
    return at
  }

  private take(ev: WorldEvent): void {
    switch (ev.kind) {
      case "actor.join":
      case "actor.info":
        this.parents.set(ev.id, ev.parent)
        this.whos.set(ev.id, {
          id: ev.id,
          name: ev.name,
          color: ev.color,
          archetype: ev.archetype,
          body: ev.body,
        })
        return
      case "actor.step":
        if (ev.places[0] !== undefined) this.places.set(ev.id, ev.places[0])
        return
      case "actor.deed": {
        if (ev.places[0] !== undefined) this.places.set(ev.id, ev.places[0])
        const tool = ev.tool.toLowerCase()
        if (ev.failed) {
          this.failures.set(ev.id, (this.failures.get(ev.id) ?? 0) + 1)
          if (ev.craft === "test") {
            const pkg = PACKAGE.exec(`${ev.target} ${ev.paths.join(" ")}`)?.[1]
            this.rise(ev.id, "test", ev.at, { ...this.placeWhere(ev.id), ...(pkg ? { package: pkg } : {}) })
          } else this.minionsDue.push({ id: ev.id, due: ev.at + SHOW_RULES.minionGraceMs })
          this.tell(ev, { kind: "deed-failed", tool, call: ev.call })
        } else {
          this.lastGood = { id: ev.id, at: ev.at }
          if (ev.craft === "test") this.mend(ev.id, ev.at, ev.id, "test")
          this.tell(ev, {
            kind: "deed",
            tool,
            call: ev.call,
            ...(ev.size !== undefined ? { size: ev.size } : {}),
          })
        }
        return
      }
      case "actor.fail":
        // the failure that ended a session raises its grave: no minion on top
        this.minionsDue = this.minionsDue.filter((d) => d.id !== ev.id)
        this.rise(ev.id, "fail", ev.at, this.placeWhere(ev.id))
        this.tell(ev, { kind: "fail" })
        return
      case "actor.recover":
        this.mend(ev.id, ev.at, ev.id)
        this.tell(ev, { kind: "recover" })
        return
      case "actor.loot":
        this.mend(ev.id, ev.at, ev.id)
        this.tell(ev, { kind: "loot" })
        return
      case "actor.leave":
        this.mend(ev.id, ev.at, undefined)
        return
      case "sea.ci":
        this.sky(ev)
        return
      default:
        return
    }
  }

  private placeWhere(id: string): ShowWhere {
    const place = this.places.get(id)
    return place !== undefined ? { place } : {}
  }

  /** One moment through the renown ledger, and what it earned or ended. */
  private tell(ev: WorldEvent & { id: string }, happening: Record<string, unknown>): void {
    const who = this.whos.get(ev.id)
    const master = this.masterOf(ev.id)
    this.master = master
    const moment = {
      ...happening,
      id: ev.id,
      agent: "",
      title: who?.name ?? "",
      color: who?.color ?? "",
      master,
      seq: ev.seq,
      at: ev.at,
      live: true,
    } as unknown as StoryMoment
    for (const h of this.ledger.take(moment, this.ctx)) this.happen(h, ev.at)
  }

  private happen(h: LedgerHappening, at: number): void {
    if (h.type === "over") {
      this.over(OF_RENOWN[h.kind], h.master, at)
      return
    }
    const r = h.renown
    // the sky is CI's in V2: the rainbow answers its storm (`sky`), not the deeds' mirrored weather
    if (r.kind === "rainbow") return
    const kind = OF_RENOWN[r.kind]
    const who = r.hero
      ? (this.whos.get(r.hero.id) ?? { id: r.hero.id, name: r.hero.title, color: r.hero.color })
      : undefined
    const place = r.hero ? this.places.get(r.hero.id) : undefined
    this.earn(kind, r.at, r, {
      ...(who ? { who } : {}),
      master: r.master,
      ...(place !== undefined ? { where: { place } } : {}),
      ...sizeOf(kind, r.facts),
    })
  }

  /** CI as weather (`weatherOf`): a storm while a branch's latest run failed; its clearing is the rainbow. */
  private sky(ev: Extract<WorldEvent, { kind: "sea.ci" }>): void {
    const key = `${ev.repo}:${ev.branch}`
    const was = this.ci.get(key)
    this.ci.set(key, ev.state)
    if (ev.state === "failed" && was !== "failed")
      this.rise(`ci:${key}`, "ci", ev.at, { repo: ev.repo, branch: ev.branch })
    if (ev.state === "passed") {
      const fixer =
        this.lastGood && ev.at - this.lastGood.at <= SHOW_RULES.fixerMs ? this.lastGood.id : undefined
      this.mend(`ci:${key}`, ev.at, fixer)
    }
    let storm = false
    let cloudy = false
    for (const state of this.ci.values()) {
      if (state === "failed") storm = true
      else if (state === "queued" || state === "running") cloudy = true
    }
    if (this.stormy && !storm) this.stormEnd = ev.at
    this.stormy = storm
    if (!storm && !cloudy && this.stormEnd !== undefined) {
      const since = ev.at - this.stormEnd
      this.stormEnd = undefined
      if (since <= SHOW_RULES.rainbowWindowMs) {
        const n = ++this.rainbows
        const renown: Renown = {
          kind: "rainbow",
          key: `rainbow:${ev.repo}:${n}`,
          at: ev.at,
          master: "",
          anchored: true,
          facts: {},
        }
        this.earn("rainbow", ev.at, renown, { where: { repo: ev.repo, branch: ev.branch } })
      }
    }
  }

  // ── the big shows ──

  private earn(kind: ShowKind, at: number, renown: Renown, params: ShowParams): void {
    if (at < this.since) return
    const last = this.lastOf.get(kind)
    if (last !== undefined && at - last < (SHOW_RULES.cooldownMs[kind] ?? 0)) return
    const start = Math.max(at, this.lastStart + this.gap)
    if (start - at > (SHOW_RULES.staleMs[kind] ?? Number.POSITIVE_INFINITY)) return
    const duration = SHOW_RULES.durationMs[kind]
    const show: Show = {
      id: `${kind}:${renown.key}`,
      kind,
      start,
      end: duration !== undefined ? start + duration : Number.POSITIVE_INFINITY,
      weight: SHOW_LOOK[kind].weight,
      quiet: false,
      renown,
      params,
    }
    this.entries.push({ show, earned: at })
    this.lastStart = start
    this.lastOf.set(kind, start)
  }

  /** A lasting show's cause is over: it leaves (or, still waiting for its slot, never comes). */
  private over(kind: ShowKind, master: string, at: number): void {
    let dropped = false
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i] as Entry
      if (e.show.kind !== kind || e.show.params.master !== master || e.over !== undefined) continue
      if (e.show.start > at) {
        this.entries.splice(i, 1)
        dropped = true
      } else e.over = at
    }
    if (!dropped) return
    // its slot is free again
    this.lastStart = Number.NEGATIVE_INFINITY
    this.lastOf.clear()
    for (const e of this.entries) {
      if (e.show.kind === "undead") continue
      this.lastStart = Math.max(this.lastStart, e.show.start)
      this.lastOf.set(
        e.show.kind,
        Math.max(this.lastOf.get(e.show.kind) ?? Number.NEGATIVE_INFINITY, e.show.start),
      )
    }
  }

  // ── the graveyard ──

  /** Graves taken at `at` (standing, or not yet gone). */
  private taken(at: number): Set<number> {
    const out = new Set<number>()
    for (const e of this.entries) {
      if (e.show.kind !== "undead" || e.show.start > at || e.show.end <= at) continue
      out.add((e.show.params.grave as Grave).slot)
    }
    return out
  }

  private rise(subject: string, cause: GraveCause, at: number, where: ShowWhere): void {
    const standing = this.graves.find((g) => g.subject === subject)
    if (standing) {
      // a hero whose tests failed now falls: the same grave, a graver cause
      const grave = standing.entry.show.params.grave as Grave
      if (cause === "fail") grave.cause = "fail"
      return
    }
    const taken = this.taken(at)
    let slot = -1
    for (let k = 0; k < SHOW_RULES.graves; k++)
      if (!taken.has(k)) {
        slot = k
        break
      }
    if (slot < 0) return
    const who = this.whos.get(subject)
    const grave: Grave = { slot, cause, minion: false, rise: at, vigil: at + SHOW_RULES.riseMs }
    const show: Show = {
      id: `undead:${subject}#${++this.minted}`,
      kind: "undead",
      start: at,
      end: Number.POSITIVE_INFINITY,
      weight: SHOW_LOOK.undead.weight,
      quiet: at < this.since,
      params: {
        ...(who ? { who } : {}),
        ...(who ? { master: this.masterOf(subject) } : {}),
        where,
        ...(who ? { size: this.failures.get(subject) ?? 0 } : {}),
        grave,
      },
    }
    const entry: Entry = { show, earned: at }
    this.entries.push(entry)
    this.graves.push({ entry, subject })
  }

  /** `subject`'s cause is mended at `at` by `fixer` (none: it just sinks). `only`: a test grave's mending. */
  private mend(subject: string, at: number, fixer: string | undefined, only?: GraveCause): void {
    const i = this.graves.findIndex((g) => g.subject === subject)
    if (i < 0) return
    const standing = this.graves[i] as Standing
    const grave = standing.entry.show.params.grave as Grave
    if (only && grave.cause !== only) return
    this.graves.splice(i, 1)
    const who = fixer ? this.whos.get(fixer) : undefined
    grave.fixed = at
    if (who) {
      grave.fixer = who
      grave.strike = Math.max(at, grave.vigil) + SHOW_RULES.strikeMs
      grave.sink = grave.strike + SHOW_RULES.strikeHoldMs
    } else grave.sink = Math.max(at, grave.vigil)
    standing.entry.show.end = grave.sink + SHOW_RULES.sinkMs
  }

  /** Minions whose grace ran out before `t` (`inclusive`: at `t` too) stand up. */
  private flush(t: number, inclusive: boolean): void {
    if (this.minionsDue.length === 0) return
    const due = this.minionsDue.filter((d) => (inclusive ? d.due <= t : d.due < t))
    if (due.length === 0) return
    this.minionsDue = this.minionsDue.filter((d) => !due.includes(d))
    for (const d of due) {
      if (d.due < this.since) continue
      let minions = 0
      for (const e of this.entries)
        if (
          e.show.kind === "undead" &&
          e.show.params.grave?.minion &&
          e.show.start <= d.due &&
          e.show.end > d.due
        )
          minions++
      if (minions >= SHOW_RULES.minions) continue
      const taken = this.taken(d.due)
      let slot = -1
      for (let k = SHOW_RULES.graves - 1; k >= 0; k--)
        if (!taken.has(k)) {
          slot = k
          break
        }
      if (slot < 0) continue
      const sink = d.due + SHOW_RULES.minionMs
      const who = this.whos.get(d.id)
      this.entries.push({
        earned: d.due,
        show: {
          id: `undead:minion#${++this.minted}`,
          kind: "undead",
          start: d.due,
          end: sink + SHOW_RULES.sinkMs,
          weight: 1,
          quiet: false,
          params: {
            ...(who ? { who, master: this.masterOf(d.id) } : {}),
            where: this.placeWhere(d.id),
            grave: {
              slot,
              cause: "deed",
              minion: true,
              rise: d.due,
              vigil: d.due + SHOW_RULES.riseMs,
              fixed: sink,
              sink,
            },
          },
        },
      })
    }
  }
}

function sizeOf(kind: ShowKind, f: RenownFacts): { size?: number } {
  const size =
    kind === "festival"
      ? f.deeds
      : kind === "ghostship"
        ? f.fallen
        : kind === "dragon"
          ? f.streak
          : kind === "raid"
            ? f.minutes
            : kind === "comet"
              ? (f.deeds ?? f.lines)
              : undefined
  return size !== undefined ? { size } : {}
}

/**
 * The shows on stage at run time `t` (see the top of this file): the log's events up to `t` folded
 * through the rules. Pure: the same log, `t` and options give the same shows.
 */
export function worldShows(
  log: EventLog | readonly WorldEvent[],
  t: number,
  opts: WorldShowOptions = {},
): Show[] {
  const events = Array.isArray(log) ? (log as readonly WorldEvent[]) : (log as EventLog).events
  const engine = new ShowEngine(opts)
  engine.feed(events, 0, t)
  return engine.at(t)
}

// ─────────────────────────────── forcing, hints, words ───────────────────────────────

/** Plausible numbers for a forced show's words (V1's `FORCED_FACTS`). */
const FORCED_FACTS: Readonly<Record<EventKind, RenownFacts>> = {
  festival: { deeds: 18, whole: true },
  "ghost-ship": { fallen: 2, minutes: 9 },
  rainbow: {},
  raid: { spent: "tokens", minutes: 52 },
  comet: { deeds: 100 },
  dragon: { streak: 3, tool: "bash" },
}

/**
 * A show forced now (`ext.events.force`): past every rule, gap and cooldown. A lasting one stays until
 * dismissed; a forced grave rises for `who` (or a nameless one) and keeps vigil until dismissed.
 */
export function forcedShow(kind: ShowKind, at: number, n: number, who?: ShowWho): Show {
  const id = `forced:${kind}:${n}`
  const look = SHOW_LOOK[kind]
  const renownKind = renownKindOf(kind)
  if (!renownKind) {
    return {
      id,
      kind,
      start: at,
      end: Number.POSITIVE_INFINITY,
      weight: look.weight,
      quiet: false,
      forced: true,
      params: {
        ...(who ? { who } : {}),
        where: {},
        grave: {
          slot: n % SHOW_RULES.graves,
          cause: "fail",
          minion: false,
          rise: at,
          vigil: at + SHOW_RULES.riseMs,
        },
      },
    }
  }
  const facts = FORCED_FACTS[renownKind]
  const renown: Renown = {
    kind: renownKind,
    key: id,
    at,
    master: "",
    anchored: false,
    ...(who && renownKind !== "rainbow" && renownKind !== "comet" && renownKind !== "raid"
      ? { hero: { id: who.id, title: who.name, color: who.color } }
      : {}),
    facts,
  }
  const duration = SHOW_RULES.durationMs[kind]
  return {
    id,
    kind,
    start: at,
    end: duration !== undefined ? at + duration : Number.POSITIVE_INFINITY,
    weight: look.weight,
    quiet: false,
    forced: true,
    renown,
    params: { ...(who && renown.hero ? { who } : {}), ...sizeOf(kind, facts) },
  }
}

/** A show told to go at `at` (a dismiss): a lasting one leaves, a grave sinks; a timed one ends now. */
export function dismissed(show: Show, at: number): Show {
  if (show.end <= at) return show
  if (show.kind === "undead") {
    const g = show.params.grave as Grave
    const sink = Math.max(at, g.vigil)
    return {
      ...show,
      end: sink + SHOW_RULES.sinkMs,
      params: { ...show.params, grave: { ...g, fixed: at, sink } },
    }
  }
  const leave = SHOW_RULES.leaveMs[show.kind]
  if (leave !== undefined) return { ...show, leave: at, end: at + leave }
  return { ...show, end: at }
}

/** A director's hint (director/pick.ts `FocusHint`): what to film as a show starts, how hard, how long. */
export type ShowHint = FocusHint

/** The focus hint a show's start yields (the plan's weights and framings; undead: V1's 3.5 s glance). */
export function showHint(show: Show): ShowHint {
  const look = SHOW_LOOK[show.kind]
  return {
    focus: {
      kind: "show",
      id: show.id,
      show: show.kind,
      ...(look.lift !== undefined ? { lift: look.lift } : {}),
    },
    weight: show.kind === "undead" && show.params.grave?.minion ? 1 : look.weight,
    start: show.start,
    ttl: look.ttl,
    distance: look.distance,
  }
}

/**
 * The caption a show's start is told with (V1's words, story.ts `renownLine`); a grave's rise in the
 * same voice. Minions and quiet shows are not told.
 */
export function showLine(show: Show): CaptionPart[] | undefined {
  if (show.quiet) return undefined
  if (show.renown) return renownLine(show.renown)
  const g = show.params.grave
  if (!g || g.minion) return undefined
  const who = show.params.who
  const seed = hash(show.id)
  if (g.cause === "ci") {
    const branch = show.params.where?.branch
    return [
      {
        text: pick(
          [
            `CI turns red${branch ? ` on ${branch}` : ""}. In the graveyard, a skeleton claws its way up.`,
            `The checks fail${branch ? ` on ${branch}` : ""} — and something stirs among the graves.`,
          ],
          seed,
        ),
      },
    ]
  }
  const name: CaptionPart = who ? { text: `the ${who.name}`, color: who.color } : { text: "a hero" }
  if (g.cause === "test") {
    const pkg = show.params.where?.package
    return [
      { text: "The tests fail" },
      ...(pkg ? [{ text: ` in ${pkg}` }] : []),
      { text: " for " },
      name,
      { text: pick([". A skeleton rises to keep watch.", ". A grave in the yard cracks open."], seed) },
    ]
  }
  return [
    { text: "A skeleton rises from the graveyard where " },
    name,
    { text: pick([" fell.", " went down."], seed) },
  ]
}
