import type { Session } from "@guildhall/core"
import { type Moment, sizeOf } from "./moments.ts"

/**
 * Secret world events and the Deeds of Renown (docs/research/roadmap.md S6). Rare world events
 * that answer *real* repo moments, so watching long enough rewards you — Messenger's hidden UFOs,
 * Bruno Simon's cryptic achievements, our own "Deeds of Renown". Two halves, both pure (no React,
 * no three, no WebAudio):
 *
 *   RenownLedger   the rules. Fed moments in order (live or rebuilt alike) it says which deeds of
 *                  renown were *earned* and when a lasting one (the raid, the dragon) is *over*.
 *                  `renownOf(history, sessions)` runs it over a whole history: the Legends book's
 *                  list, the same after a seek as after playing through.
 *   WorldEvents    the live scheduler. Hangs a ledger on the store's moment stream and turns only
 *                  *live* earnings into shows, at most one big show every `gap` ms of real time,
 *                  each kind on its own cooldown. Rebuilt moments (a seek, a loop, a load) are
 *                  caught up silently: they earn, they never show.
 *
 * The events (each justified in docs/ideas.md):
 *
 *   festival    a quest finishes clean: ≥ 15 deeds, not one failed (or the whole quest: every deed
 *               of the party, no failures, no falls) → lanterns and bunting in the square,
 *               fireworks over the keep by night, confetti by day
 *   ghost-ship  a session falls after a long run (≥ 6 min), or two adventurers fall within 2 min in
 *               one quest → the green ghost ship glides past in the mist
 *   rainbow     the sky clears after a storm: the weather (mirrored from environment.ts's maths over
 *               the moments) goes from storm or rain to clear within 4 min → a rainbow over the island
 *   raid        a very expensive or very long session (≥ 2M tokens, ≥ $10, or ≥ 45 min) → a pirate
 *               ship anchors offshore with its black flag up, and sails off when the quest ends
 *   comet       a milestone: the 100th / 500th / 1000th deed, the 1000th / 5000th line written →
 *               shooting stars by night, a comet by day
 *   dragon      a red streak: three failed commands in a row from one adventurer, or five failed
 *               deeds in three minutes → a dragon circles the peaks until the streak breaks
 */

export const EVENT_KINDS = ["festival", "ghost-ship", "rainbow", "raid", "comet", "dragon"] as const
export type EventKind = (typeof EVENT_KINDS)[number]

/** Who a deed of renown honours (or mourns), named as the hall named them then. */
export interface Hero {
  id: string
  title: string
  color: string
}

/** One deed of renown, earned. */
export interface Renown {
  kind: EventKind
  /** Unique and deterministic: the same history earns the same keys. */
  key: string
  /** Run time it was earned, ms (for a reconciled one: the last moment's). */
  at: number
  /** The guildmaster whose party earned it. */
  master: string
  /** Earned on a moment (`at` is that moment's) rather than reconciled from the party's totals. */
  anchored: boolean
  hero?: Hero
  /** The numbers its words quote. */
  facts: RenownFacts
}

export interface RenownFacts {
  /** festival: clean deeds · comet: the milestone's count. */
  deeds?: number
  /** comet: lines written milestone. */
  lines?: number
  /** festival: the whole quest, not one adventurer's. */
  whole?: boolean
  /** ghost-ship: how many fell · dragon: failures in the streak. */
  fallen?: number
  streak?: number
  /** ghost-ship / raid: how long the run was, minutes. */
  minutes?: number
  /** raid: why — "tokens" | "cost" | "time". */
  spent?: "tokens" | "cost" | "time"
  /** dragon: the failing tool (`bash`). */
  tool?: string
}

/** What the ledger needs beyond the moments: the sessions as they stand (for the raid and totals). */
export interface LedgerContext {
  session(id: string): Session | undefined
  /** The followed party (root first not required). */
  party(): readonly Session[]
}

/** What one step of the ledger made happen. */
export type LedgerHappening =
  | { type: "earned"; renown: Renown }
  | { type: "over"; kind: EventKind; master: string }

// ─────────────────────────────── the rules' numbers ───────────────────────────────

export const RULES = {
  /** Festival: a quest's clean deeds. */
  festivalDeeds: 15,
  /** Ghost ship: a fall after this long a run, or this many falls inside `ghostWindowMs`. */
  ghostRunMs: 6 * 60_000,
  ghostFalls: 2,
  ghostWindowMs: 120_000,
  /** Rainbow: the sky must clear within this long of the last storm or rain. */
  rainbowWindowMs: 4 * 60_000,
  /** Raid: the treasury's limits. */
  raidTokens: 2_000_000,
  raidCost: 10,
  raidRunMs: 45 * 60_000,
  /** Comet milestones. */
  deedMilestones: [100, 500, 1000] as readonly number[],
  lineMilestones: [1000, 5000] as readonly number[],
  /** Dragon: failed commands in a row from one adventurer, or failed deeds inside the window. */
  dragonRun: 3,
  dragonBurst: 5,
  dragonWindowMs: 180_000,
  /** A burst dragon leaves after this long with no new failure. */
  dragonCalmMs: 90_000,
  /** Run time between two earnings of one kind in one party. */
  cooldownMs: {
    festival: 6 * 60_000,
    "ghost-ship": 8 * 60_000,
    rainbow: 8 * 60_000,
    raid: Number.POSITIVE_INFINITY,
    comet: 0,
    dragon: 8 * 60_000,
  } as Record<EventKind, number>,
} as const

/** Tools that run commands: a red streak is these failing in a row. */
const RUNS = new Set(["bash", "shell"])
const QUESTS = new Set(["task", "subagent"])

// ─────────────────────────────── weather, mirrored ───────────────────────────────
// The rainbow needs "the weather went from storm to clear" in a form a seek can rebuild. The
// environment (guild/environment.ts) is computed from the live model ~10×/s and keeps no history,
// so the ledger reads the same signal from the moments with the same numbers: health from the
// recent deeds (failures weigh twice, fading over 2 min, 3 imagined successes), storm pressure
// from a fall (full for 45 s, gone at 100 s; a recovery ends it) or a burst of failed deeds, and
// the worst of the last 10 s. Keep these in step with environment.ts.

const HEALTH_WINDOW_MS = 120_000
const HEALTH_PRIOR = 3
const FAILURE_WEIGHT = 2
const GLOOM_AT_HEALTH = 0.4
const CLOUDY_GLOOM = 0.12
const RAIN_GLOOM = 0.5
const STORM_FULL_MS = 45_000
const STORM_FADE_MS = 100_000
const BURST_WINDOW_MS = 20_000
const BURST_FAILURES = 4
const STORM_PRESSURE = 0.5
const HOLD_STEP_MS = 2500
const HOLD_SAMPLES = 5
const KEEP_MS = HEALTH_WINDOW_MS + HOLD_STEP_MS * HOLD_SAMPLES

export type Sky = "clear" | "cloudy" | "rain" | "storm"
const SKY_RANK: Record<Sky, number> = { clear: 0, cloudy: 1, rain: 2, storm: 3 }

interface Verdict {
  at: number
  ok: boolean
}

const fade = (age: number, window: number): number => (age < 0 || age >= window ? 0 : 1 - age / window)

function stormAfter(age: number): number {
  if (age < 0 || age >= STORM_FADE_MS) return 0
  if (age < STORM_FULL_MS) return 1
  return 1 - (age - STORM_FULL_MS) / (STORM_FADE_MS - STORM_FULL_MS)
}

/** The sky at run time `t` from recent deed verdicts and unrecovered falls. */
export function skyAt(t: number, verdicts: readonly Verdict[], falls: Iterable<number>): Sky {
  let ok = 0
  let failed = 0
  let burst = 0
  for (const v of verdicts) {
    const age = t - v.at
    const weight = fade(age, HEALTH_WINDOW_MS) ** 2
    if (v.ok) ok += weight
    else {
      failed += weight * FAILURE_WEIGHT
      burst += fade(age, BURST_WINDOW_MS)
    }
  }
  let storm = Math.min(1, burst / BURST_FAILURES)
  for (const at of falls) storm = Math.max(storm, stormAfter(t - at))
  const health = (ok + HEALTH_PRIOR) / (ok + failed + HEALTH_PRIOR)
  const gloom = Math.min(1, (1 - health) / (1 - GLOOM_AT_HEALTH))
  if (storm >= STORM_PRESSURE) return "storm"
  if (gloom >= RAIN_GLOOM) return "rain"
  if (gloom >= CLOUDY_GLOOM) return "cloudy"
  return "clear"
}

/** The worst sky over the last 10 s, as the environment holds it. */
export function heldSkyAt(t: number, verdicts: readonly Verdict[], falls: Iterable<number>): Sky {
  let worst: Sky = "clear"
  const list = [...falls]
  for (let k = 0; k < HOLD_SAMPLES; k++) {
    const sky = skyAt(t - k * HOLD_STEP_MS, verdicts, list)
    if (SKY_RANK[sky] > SKY_RANK[worst]) worst = sky
  }
  return worst
}

// ─────────────────────────────── the ledger ───────────────────────────────

interface SessionTally {
  firstAt: number
  /** Deeds since its last quest ended (a call-back starts a new count). */
  ok: number
  failed: number
  /** Failed commands in a row. */
  runStreak: number
}

interface PartyTally {
  firstAt: number
  ended: boolean
  deeds: number
  lines: number
  failedDeeds: number
  fallen: number
  /** Session falls lately (for "several fall in one quest"). */
  falls: { id: string; at: number }[]
  /** Unrecovered falls: session → when. */
  standing: Map<string, number>
  verdicts: Verdict[]
  /** Failed deeds lately (the burst dragon). */
  failures: number[]
  /** The sky has been stormy or rainy since this run time (rainbow), else undefined. */
  troubledAt: number | undefined
  last: Partial<Record<EventKind, number>>
  count: Partial<Record<EventKind, number>>
  milestones: Set<string>
  raided: boolean
  raidOver: boolean
  dragon: { session: string | undefined; lastFailAt: number } | undefined
}

/** What a party keeps across a live hello's rebuild (see `RenownLedger.reset`). */
interface Carried {
  firstAt: number
  milestones: Set<string>
  raided: boolean
  last: Partial<Record<EventKind, number>>
  count: Partial<Record<EventKind, number>>
}

function partyTally(at: number, carried?: Carried): PartyTally {
  if (carried)
    return {
      ...partyTally(Math.min(at, carried.firstAt)),
      milestones: new Set(carried.milestones),
      raided: carried.raided,
      // Its raid was earned before the hello: no ship is on stage to send away.
      raidOver: carried.raided,
      last: { ...carried.last },
      count: { ...carried.count },
    }
  return {
    firstAt: at,
    ended: false,
    deeds: 0,
    lines: 0,
    failedDeeds: 0,
    fallen: 0,
    falls: [],
    standing: new Map(),
    verdicts: [],
    failures: [],
    troubledAt: undefined,
    last: {},
    count: {},
    milestones: new Set(),
    raided: false,
    raidOver: false,
    dragon: undefined,
  }
}

/**
 * The rules, as a ledger. Feed it every moment in order with `take` (live and rebuilt alike: the
 * rules never read `live` or `seq`), and call `settle` when the party's totals may have moved
 * without a moment (usage) or after a rebuild that history could not fully replay (it keeps at most
 * 1000 moments): it reconciles the comet's counts with the sessions and checks the treasury.
 */
export class RenownLedger {
  readonly earned: Renown[] = []
  private parties = new Map<string, PartyTally>()
  private sessions = new Map<string, SessionTally>()
  private lastAt = 0

  /**
   * What each party already earned once, kept across a `carry` reset (a live hello rebuilds from at
   * most 1000 moments: replayed from the clipped history alone, the raid's clock and the comet's
   * counts would start late and earn the same deeds again — review-2 #9).
   */
  private carried = new Map<string, Carried>()
  private carriedSessions = new Map<string, number>()

  /** Start over. `carry`: the same run goes on (a live hello), so what was earned stays earned. */
  reset(carry = false): void {
    if (carry) {
      for (const [master, p] of this.parties) {
        const was = this.carried.get(master)
        this.carried.set(master, {
          firstAt: Math.min(p.firstAt, was?.firstAt ?? p.firstAt),
          milestones: new Set([...(was?.milestones ?? []), ...p.milestones]),
          raided: p.raided || (was?.raided ?? false),
          last: { ...was?.last, ...p.last },
          count: { ...was?.count, ...p.count },
        })
      }
      for (const [id, t] of this.sessions)
        this.carriedSessions.set(id, Math.min(t.firstAt, this.carriedSessions.get(id) ?? t.firstAt))
    } else {
      this.carried.clear()
      this.carriedSessions.clear()
    }
    this.earned.length = 0
    this.parties.clear()
    this.sessions.clear()
    this.lastAt = 0
  }

  take(m: Moment, ctx: LedgerContext): LedgerHappening[] {
    const out: LedgerHappening[] = []
    this.lastAt = Math.max(this.lastAt, m.at)
    let party = this.parties.get(m.master)
    if (!party) {
      party = partyTally(m.at, this.carried.get(m.master))
      this.parties.set(m.master, party)
    }
    let tally = this.sessions.get(m.id)
    if (!tally) {
      tally = {
        firstAt: Math.min(m.at, this.carriedSessions.get(m.id) ?? m.at),
        ok: 0,
        failed: 0,
        runStreak: 0,
      }
      this.sessions.set(m.id, tally)
    }
    const hero: Hero = { id: m.id, title: m.title, color: m.color }

    switch (m.kind) {
      case "deed": {
        if (QUESTS.has(m.tool)) break
        tally.ok++
        party.deeds++
        party.verdicts.push({ at: m.at, ok: true })
        const before = party.lines
        party.lines += m.size ?? 0
        if (RUNS.has(m.tool)) {
          tally.runStreak = 0
          if (party.dragon && party.dragon.session === m.id) out.push(this.over(party, "dragon", m.master))
        }
        for (const n of RULES.deedMilestones)
          if (party.deeds === n) this.milestone(out, party, m, `deeds-${n}`, { deeds: n }, true)
        for (const n of RULES.lineMilestones)
          if (before < n && party.lines >= n) this.milestone(out, party, m, `lines-${n}`, { lines: n }, true)
        break
      }
      case "deed-failed": {
        tally.failed++
        party.failedDeeds++
        party.verdicts.push({ at: m.at, ok: false })
        party.failures.push(m.at)
        while ((party.failures[0] ?? m.at) < m.at - RULES.dragonWindowMs) party.failures.shift()
        if (RUNS.has(m.tool)) tally.runStreak++
        if (party.dragon) party.dragon.lastFailAt = m.at
        else {
          const run = tally.runStreak >= RULES.dragonRun
          const burst = party.failures.length >= RULES.dragonBurst
          if ((run || burst) && this.ready(party, "dragon", m.at)) {
            party.dragon = { session: run ? m.id : undefined, lastFailAt: m.at }
            out.push(
              this.earn(party, "dragon", m.master, m.at, true, run ? hero : undefined, {
                streak: run ? tally.runStreak : party.failures.length,
                ...(run ? { tool: m.tool } : {}),
              }),
            )
          }
        }
        break
      }
      case "fail": {
        party.fallen++
        party.standing.set(m.id, m.at)
        party.falls.push({ id: m.id, at: m.at })
        while ((party.falls[0]?.at ?? m.at) < m.at - RULES.ghostWindowMs) party.falls.shift()
        const several = new Set(party.falls.map((f) => f.id)).size
        const ran = m.at - tally.firstAt
        if (party.dragon?.session === m.id) out.push(this.over(party, "dragon", m.master))
        if (
          (several >= RULES.ghostFalls || ran >= RULES.ghostRunMs) &&
          this.ready(party, "ghost-ship", m.at)
        ) {
          out.push(
            this.earn(party, "ghost-ship", m.master, m.at, true, hero, {
              fallen: several,
              minutes: Math.round(ran / 60_000),
            }),
          )
        }
        if (m.id === m.master) this.end(out, party, m.master)
        break
      }
      case "recover":
        party.standing.delete(m.id)
        break
      case "loot": {
        if (party.dragon?.session === m.id) out.push(this.over(party, "dragon", m.master))
        const whole = m.id === m.master
        const clean = whole
          ? party.deeds >= RULES.festivalDeeds && party.failedDeeds === 0 && party.fallen === 0
          : tally.ok >= RULES.festivalDeeds && tally.failed === 0
        if (clean && this.ready(party, "festival", m.at))
          out.push(
            this.earn(party, "festival", m.master, m.at, true, hero, {
              deeds: whole ? party.deeds : tally.ok,
              ...(whole ? { whole: true } : {}),
            }),
          )
        // A call-back is a new quest: its deeds count afresh.
        tally.ok = 0
        tally.failed = 0
        if (whole) this.end(out, party, m.master)
        break
      }
      default:
        break
    }

    // Weather, mirrored: the rainbow when the sky clears after storm or rain.
    if (m.kind === "deed" || m.kind === "deed-failed" || m.kind === "fail" || m.kind === "recover") {
      while ((party.verdicts[0]?.at ?? m.at) < m.at - KEEP_MS) party.verdicts.shift()
      const sky = heldSkyAt(m.at, party.verdicts, party.standing.values())
      if (sky === "storm" || sky === "rain") party.troubledAt = m.at
      else if (party.troubledAt !== undefined) {
        const since = m.at - party.troubledAt
        if (since > RULES.rainbowWindowMs) party.troubledAt = undefined
        else if (sky === "clear") {
          party.troubledAt = undefined
          if (this.ready(party, "rainbow", m.at)) out.push(this.earn(party, "rainbow", m.master, m.at, true))
        }
      }
    }

    // A burst dragon leaves once the failures stop.
    const dragon = party.dragon
    if (dragon && dragon.session === undefined && m.at - dragon.lastFailAt > RULES.dragonCalmMs)
      out.push(this.over(party, "dragon", m.master))

    this.treasury(out, party, m.master, ctx, m.at)
    return out
  }

  /**
   * The party's totals, which can move without a moment: the treasury (tokens, cost) and, after a
   * rebuild from a clipped history, the comet's counts. Earns what they now say.
   */
  settle(ctx: LedgerContext): LedgerHappening[] {
    const out: LedgerHappening[] = []
    const party = ctx.party()
    const root = party.find((s) => !s.parentID)
    if (!root) return out
    const tally = this.parties.get(root.id)
    if (!tally) return out
    let deeds = 0
    let lines = 0
    for (const s of party)
      for (const e of s.entries) {
        if (e.kind !== "tool" || e.state !== "completed" || QUESTS.has(e.name)) continue
        deeds++
        lines += sizeOf(e.name, e.input) ?? 0
      }
    if (deeds > tally.deeds) {
      for (const n of RULES.deedMilestones)
        if (deeds >= n && tally.deeds < n)
          this.milestone(out, tally, undefined, `deeds-${n}`, { deeds: n }, false)
      tally.deeds = deeds
    }
    if (lines > tally.lines) {
      for (const n of RULES.lineMilestones)
        if (lines >= n && tally.lines < n)
          this.milestone(out, tally, undefined, `lines-${n}`, { lines: n }, false)
      tally.lines = lines
    }
    this.treasury(out, tally, root.id, ctx, this.lastAt)
    return out
  }

  /** Earned so far, for this party (or all when `master` is absent), in order. */
  of(master?: string): Renown[] {
    return master === undefined ? [...this.earned] : this.earned.filter((r) => r.master === master)
  }

  private treasury(
    out: LedgerHappening[],
    party: PartyTally,
    master: string,
    ctx: LedgerContext,
    at: number,
  ) {
    if (party.raided) return
    const long = at - party.firstAt >= RULES.raidRunMs
    let tokens = 0
    let cost = 0
    for (const s of ctx.party()) {
      tokens += s.tokens
      cost += s.cost
    }
    // The party in view is someone else's: its purse is not this one's.
    const root = ctx.party().find((s) => !s.parentID)
    const ours = root?.id === master
    const spent: RenownFacts["spent"] | undefined =
      ours && tokens >= RULES.raidTokens
        ? "tokens"
        : ours && cost >= RULES.raidCost
          ? "cost"
          : long
            ? "time"
            : undefined
    if (!spent) return
    party.raided = true
    out.push(
      this.earn(party, "raid", master, at, false, undefined, {
        spent,
        minutes: Math.round((at - party.firstAt) / 60_000),
      }),
    )
    // Totals can say so after the quest ended: earned for the book, but no ship sails in.
    if (party.ended) out.push(this.over(party, "raid", master))
  }

  private milestone(
    out: LedgerHappening[],
    party: PartyTally,
    m: Moment | undefined,
    name: string,
    facts: RenownFacts,
    anchored: boolean,
  ) {
    if (party.milestones.has(name)) return
    party.milestones.add(name)
    const master = m?.master ?? this.masterOf(party)
    out.push(this.earn(party, "comet", master, m?.at ?? this.lastAt, anchored, undefined, facts, name))
  }

  private masterOf(party: PartyTally): string {
    for (const [master, tally] of this.parties) if (tally === party) return master
    return ""
  }

  private ready(party: PartyTally, kind: EventKind, at: number): boolean {
    const last = party.last[kind]
    return last === undefined || at - last >= RULES.cooldownMs[kind]
  }

  private earn(
    party: PartyTally,
    kind: EventKind,
    master: string,
    at: number,
    anchored: boolean,
    hero?: Hero,
    facts: RenownFacts = {},
    name?: string,
  ): LedgerHappening {
    party.last[kind] = at
    const n = (party.count[kind] ?? 0) + 1
    party.count[kind] = n
    const renown: Renown = {
      kind,
      key: `${kind}:${master}:${name ?? n}`,
      at,
      master,
      anchored,
      ...(hero ? { hero } : {}),
      facts,
    }
    this.earned.push(renown)
    return { type: "earned", renown }
  }

  private over(party: PartyTally, kind: "dragon" | "raid", master: string): LedgerHappening {
    if (kind === "dragon") party.dragon = undefined
    else party.raidOver = true
    return { type: "over", kind, master }
  }

  private end(out: LedgerHappening[], party: PartyTally, master: string) {
    party.ended = true
    if (party.raided && !party.raidOver) out.push(this.over(party, "raid", master))
    if (party.dragon) out.push(this.over(party, "dragon", master))
  }
}

/**
 * Every deed of renown a history earns, for the party under the root of `sessions`. Pure: the same
 * history and sessions give the same list whether they were played through or rebuilt by a seek.
 */
export function renownOf(history: readonly Moment[], sessions: readonly Session[]): Renown[] {
  const root = sessions.find((s) => !s.parentID)
  if (!root) return []
  const byId = new Map(sessions.map((s) => [s.id, s]))
  const ctx: LedgerContext = { session: (id) => byId.get(id), party: () => sessions }
  const ledger = new RenownLedger()
  for (const m of history) ledger.take(m, ctx)
  ledger.settle(ctx)
  return ledger.of(root.id)
}

// ─────────────────────────────── the live scheduler ───────────────────────────────

/** A world event on stage. */
export interface Show {
  /** Grows by one per show: a React key. */
  id: number
  kind: EventKind
  renown: Renown
  /** Real ms (the scheduler's clock) it started. */
  started: number
  /** A lasting show told to go (the quest ended, the streak broke, a seek, its cap). */
  leaving: boolean
  /** Forced by the probe hook, not earned. */
  forced: boolean
}

/** Shows that last as long as their cause (they leave when told), not a fixed time. */
export const LASTING: ReadonlySet<EventKind> = new Set(["raid", "dragon"])

export interface WorldEventOptions {
  /** Least real time between two shows starting, ms ("at most one big event every few minutes"). */
  gap?: number
  /** A queued show is dropped after this long unstarted, real ms (lasting ones wait for their end). */
  stale?: Partial<Record<EventKind, number>>
  /** A lasting show leaves after this long whatever happens, real ms. */
  cap?: Partial<Record<EventKind, number>>
}

const DEFAULT_STALE: Record<EventKind, number> = {
  festival: 45_000,
  "ghost-ship": 60_000,
  rainbow: 40_000,
  raid: Number.POSITIVE_INFINITY,
  comet: 60_000,
  dragon: Number.POSITIVE_INFINITY,
}
const DEFAULT_CAP: Record<EventKind, number> = {
  festival: Number.POSITIVE_INFINITY,
  "ghost-ship": Number.POSITIVE_INFINITY,
  rainbow: Number.POSITIVE_INFINITY,
  raid: 12 * 60_000,
  comet: Number.POSITIVE_INFINITY,
  dragon: 4 * 60_000,
}

/** The stream the scheduler reads: the store's `moments` (guild/moments.ts). */
export interface MomentSource {
  readonly history: readonly Moment[]
  on(fn: (moment: Moment) => void): () => void
  onRebuild(fn: (epoch: number, continued: boolean) => void): () => void
}

/**
 * The live scheduler (see the top of the file). Earnings from live moments queue a show; a show
 * starts when the last one started at least `gap` ms ago and no timed show is still on stage.
 * Lasting shows (raid, dragon) leave when the ledger says their cause is over, on a rebuild, or at
 * their cap. Nothing here draws: the scene reads `shows` and calls `done(id)` when a show's
 * animation has finished; `onStart` listeners caption it, sound it and point the camera.
 */
export class WorldEvents {
  readonly ledger = new RenownLedger()
  shows: Show[] = []
  /** Bumps on every change to `shows` (for useSyncExternalStore). */
  version = 0
  /** Shows forced by the probe hook (never earned): kept across rebuilds so the book can show them. */
  readonly forced: Renown[] = []
  private queue: { renown: Renown; since: number }[] = []
  private lastStart = Number.NEGATIVE_INFINITY
  private cursor = 0
  private stale = false
  private nextId = 1
  private listeners = new Set<() => void>()
  private starts = new Set<(show: Show) => void>()
  private readonly gap: number
  private readonly staleMs: Record<EventKind, number>
  private readonly capMs: Record<EventKind, number>

  constructor(
    private readonly ctx: LedgerContext,
    private readonly clock: () => number = () => performance.now(),
    options: WorldEventOptions = {},
  ) {
    this.gap = options.gap ?? 150_000
    this.staleMs = { ...DEFAULT_STALE, ...options.stale }
    this.capMs = { ...DEFAULT_CAP, ...options.cap }
  }

  /** Hang it on a moment stream. Returns the unsubscribe. */
  attach(source: MomentSource): () => void {
    const off = source.on((moment) => this.hear(moment, source))
    const offRebuild = source.onRebuild((_, continued) => this.rebuild(continued))
    this.stale = true
    this.catchUp(source, Number.POSITIVE_INFINITY)
    return () => {
      off()
      offRebuild()
    }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  snapshot = (): number => this.version

  /** Called as each show starts (caption, sound, camera). */
  onStart(listener: (show: Show) => void): () => void {
    this.starts.add(listener)
    return () => this.starts.delete(listener)
  }

  /** A live moment: catch up on anything rebuilt before it (silently), then take it as news. */
  hear(moment: Moment, source: MomentSource): void {
    this.catchUp(source, moment.seq)
    this.cursor = Math.max(this.cursor, moment.seq)
    this.apply(this.ledger.take(moment, this.ctx), moment.live)
  }

  /**
   * History is thrown away: the ledger starts over, nothing queued survives, lasting shows go.
   * `continued` (a live hello): the ledger keeps what was already earned, so nothing shows twice.
   */
  rebuild(continued = false): void {
    this.ledger.reset(continued)
    this.queue = []
    this.cursor = 0
    this.stale = true
    let changed = false
    for (const show of this.shows)
      if (LASTING.has(show.kind) && !show.leaving && !show.forced) {
        show.leaving = true
        changed = true
      }
    if (changed) this.changed()
  }

  /**
   * ~4 Hz from the scene: catches up after a rebuild (silently), checks the treasury, starts what
   * may start, and sends lasting shows home at their cap.
   */
  tick(source: MomentSource): void {
    if (this.stale) {
      this.catchUp(source, Number.POSITIVE_INFINITY)
      this.apply(this.ledger.settle(this.ctx), false)
      this.stale = false
    } else this.apply(this.ledger.settle(this.ctx), true)
    const now = this.clock()
    this.queue = this.queue.filter((q) => now - q.since < this.staleMs[q.renown.kind])
    let changed = false
    for (const show of this.shows)
      if (!show.leaving && now - show.started > this.capMs[show.kind]) {
        show.leaving = true
        changed = true
      }
    const next = this.queue[0]
    if (next && this.open(now)) {
      this.queue.shift()
      this.start(next.renown, false, now)
      return
    }
    if (changed) this.changed()
  }

  /** The scene's animation for a show has finished. */
  done(id: number): void {
    const before = this.shows.length
    this.shows = this.shows.filter((s) => s.id !== id)
    if (this.shows.length !== before) this.changed()
  }

  /** Tell a lasting show to go (probe, or the scene's own reasons). */
  dismiss(kind: EventKind): void {
    let changed = false
    for (const show of this.shows)
      if (show.kind === kind && !show.leaving) {
        show.leaving = true
        changed = true
      }
    if (changed) this.changed()
  }

  /**
   * PROBE only (scripts/shot.ts): start a show now, past every rule, gap and cooldown. It is kept in
   * `forced` (shown in the book, marked as such), never in the ledger.
   */
  force(kind: EventKind, facts: RenownFacts = {}, hero?: Hero): Show {
    const party = this.ctx.party()
    const root = party.find((s) => !s.parentID)
    const renown: Renown = {
      kind,
      key: `forced:${kind}:${this.forced.length + 1}`,
      at: 0,
      master: root?.id ?? "",
      anchored: false,
      ...(hero ? { hero } : {}),
      facts: { ...FORCED_FACTS[kind], ...facts },
    }
    this.forced.push(renown)
    return this.start(renown, true, this.clock())
  }

  private open(now: number): boolean {
    if (now - this.lastStart < this.gap) return false
    return !this.shows.some((s) => !LASTING.has(s.kind) && !s.forced)
  }

  private start(renown: Renown, forced: boolean, now: number): Show {
    const show: Show = { id: this.nextId++, kind: renown.kind, renown, started: now, leaving: false, forced }
    if (!forced) this.lastStart = now
    this.shows = [...this.shows, show]
    this.changed()
    for (const listener of this.starts) listener(show)
    return show
  }

  private apply(happenings: readonly LedgerHappening[], live: boolean): void {
    let changed = false
    for (const h of happenings) {
      if (h.type === "earned") {
        if (!live) continue
        if (this.queue.some((q) => q.renown.kind === h.renown.kind)) continue
        this.queue.push({ renown: h.renown, since: this.clock() })
        continue
      }
      this.queue = this.queue.filter((q) => !(q.renown.kind === h.kind && q.renown.master === h.master))
      for (const show of this.shows)
        if (show.kind === h.kind && show.renown.master === h.master && !show.leaving && !show.forced) {
          show.leaving = true
          changed = true
        }
    }
    if (changed) this.changed()
  }

  /** Feed the ledger, silently, every moment of history it has not seen up to (not including) `until`. */
  private catchUp(source: MomentSource, until: number): void {
    const history = source.history
    let i = history.length
    while (i > 0 && (history[i - 1]?.seq ?? 0) > this.cursor) i--
    for (; i < history.length; i++) {
      const m = history[i] as Moment
      if (m.seq >= until) break
      this.cursor = m.seq
      this.apply(this.ledger.take(m, this.ctx), false)
    }
  }

  private changed(): void {
    this.version++
    for (const listener of this.listeners) listener()
  }
}

/** Plausible numbers for a forced show's words. */
const FORCED_FACTS: Record<EventKind, RenownFacts> = {
  festival: { deeds: 18, whole: true },
  "ghost-ship": { fallen: 2, minutes: 9 },
  rainbow: {},
  raid: { spent: "tokens", minutes: 52 },
  comet: { deeds: 100 },
  dragon: { streak: 3, tool: "bash" },
}

/** The store-shaped thing `worldEventsOf` hangs a scheduler on. */
export interface EventHost {
  readonly moments: MomentSource
  sessionOf(id: string): Session | undefined
  party(): Session[]
}

const hung = new WeakMap<EventHost, WorldEvents>()

/**
 * The store's one scheduler, made (and hung on its moments) the first time anyone asks — the scene
 * layer, the Legends book. It caches the party for a quarter second: `settle` asks for it ~4×/s.
 */
export function worldEventsOf(host: EventHost): WorldEvents {
  let events = hung.get(host)
  if (!events) {
    let cached: readonly Session[] = []
    let cachedAt = Number.NEGATIVE_INFINITY
    events = new WorldEvents({
      session: (id) => host.sessionOf(id),
      party: () => {
        const now = performance.now()
        if (now - cachedAt > 250) {
          cached = host.party()
          cachedAt = now
        }
        return cached
      },
    })
    // A seek changes the party under the cache: read it afresh.
    host.moments.onRebuild(() => {
      cachedAt = Number.NEGATIVE_INFINITY
    })
    events.attach(host.moments)
    hung.set(host, events)
  }
  return events
}
