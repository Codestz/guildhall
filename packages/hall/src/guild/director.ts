import type { Moment, MomentKind } from "./moments.ts"

/**
 * Director v2 (roadmap S4): the Bard as a broadcast director. Pure: no three.js, no React, no DOM.
 * The store feeds it live moments and hints; the camera (scene/CameraRig.tsx) asks it a few times a
 * second which shot to run, and films that shot.
 *
 * Interest is kept per **subject**: an adventurer (their session id) or a place in the world (a
 * grave, a site, wherever a secret event happens). A subject's score is
 *
 *   impulse (moments, decaying with TAU_MS) + steady (what they are doing now) + hint (TTL'd)
 *   × off-screen bonus × recently-shown penalty × boredom (current subject only) + novelty
 *
 * and the director cuts when the best subject beats the current one by a margin, never before
 * MIN_SHOT_MS (no ping-pong). Each beat picks its shot: establishing, follow, close-up, reaction,
 * two-shot or medium. See docs/ideas.md "Director v2" for the table in words.
 *
 * Other modules ask for attention with `hint(subject, weight, ttlMs, options)`: the graveyard's
 * rises do (store.ts), and secret events (guild/events) are meant to. Weights use the same scale as
 * WEIGHTS below: 10 is a plea (the user must act), 8 a rise, 6 loot, 1 a routine deed.
 */

/** The kinds of shot the director calls. */
export type ShotKind = "establishing" | "follow" | "close" | "reaction" | "two-shot" | "medium"

/** Calm ≈ the original Bard (eases toward store.focus, turntables when quiet); Cinematic = this. */
export type DirectorStyle = "calm" | "cinematic"

/**
 * A place to film: anything that is not an adventurer. One record per key: hinting the same key
 * again refreshes it. The key is `key`, else `label`, else the point itself (rounded).
 */
export interface Place {
  key?: string
  /** A name for it (scene/events passes `label`); used as the key when `key` is absent. */
  label?: string
  x: number
  /**
   * Height to aim at, world units above the ground (default 0: the shot frames the ground). A sky
   * event (the dragon over the peaks, the rainbow, a comet shower) gives one: the camera tilts up
   * to it, and comes back down to the ground when the shot ends.
   */
  y?: number
  z: number
  /** Ground radius the shot should hold, world units (default 4). */
  radius?: number
}

/** The record key of a place. */
export function placeKey(place: Place): string {
  return place.key ?? place.label ?? `place:${Math.round(place.x)},${Math.round(place.z)}`
}

/** An adventurer's session id, or a place. */
export type Subject = string | Place

export interface HintOptions {
  /** The shot to film it with (default: close for weight ≥ 7, else medium). */
  shot?: ShotKind
  /**
   * An adventurer whose live interest this hint takes over: their story is told here now (a fall
   * is told by the rise in the graveyard). Their impulse moves into the hint, and they drop out.
   */
  absorbs?: string
}

/** Why a subject is interesting: the beat that set its shot. */
export type Beat = MomentKind | "rise" | "hint" | "burst" | "work" | "reaction" | "establishing"

/**
 * Impulse added by each live moment (decays with TAU_MS). The scoring table, in one place.
 * `deed` also adds up to +2 for its size (lines written / 40).
 */
export const WEIGHTS: Record<MomentKind | "rise", number> = {
  plea: 10,
  rise: 8,
  quest: 7,
  fail: 6,
  recover: 6,
  join: 6,
  loot: 6,
  "deed-failed": 4,
  leave: 2,
  deed: 1,
  "plea-answered": 0,
  // The sea's moments have no one to film: scene/seas hints the harbour, a place, instead.
  "sea-push": 0,
  "sea-merged": 0,
  "sea-red": 0,
  "sea-green": 0,
  "sea-release": 0,
}

/** Score held for as long as an adventurer is in a phase (not decaying). */
export const STEADY: Record<string, number> = {
  waiting: 6,
  loot: 2.5,
  working: 0.6,
  leaving: 0.8,
  idle: 0.3,
  resting: 0.2,
  failed: 0,
}

/** Impulses halve in ~4 s. */
export const TAU_MS = 6000
/** No shot is shorter than this. */
export const MIN_SHOT_MS = 4000
/** A plea or a rise (score ≥ URGENT) may cut in this early: the bottom of the 3–4 s range. */
export const MIN_SHOT_URGENT_MS = 3000
/** With prefers-reduced-motion: fewer cuts. */
export const MIN_SHOT_CALM_MS = 6000
/** A challenger must beat the current subject by this factor plus STICK_ADD to take the camera. */
export const STICK = 1.3
export const STICK_ADD = 0.5
/** Shown within this long (and not current): scored down, so the camera doesn't bounce back. */
export const RECENT_MS = 12_000
export const RECENT_FACTOR = 0.6
/** The current subject gets less interesting the longer it is held (×e^(−held/BORED_MS)). */
export const BORED_MS = 30_000
/** Held this long on one subject: an establishing shot clears the palate. */
export const LONG_HOLD_MS = 22_000
/** Unseen adventurers gain up to NOVELTY_MAX, reached after NOVELTY_MS unseen. */
export const NOVELTY_MAX = 1.2
export const NOVELTY_MS = 30_000
/** Off-screen subjects worth a look (score ≥ 1) get this bonus. */
export const OFFSCREEN = 1.25
/** Below this nobody is worth a shot: wide establishing with a slow turntable. */
export const QUIET_SCORE = 0.9
/** A subject this hot may break a chain (two-shot → follow, loot → reaction). */
export const URGENT = 9
/** A quest's join within this long makes a two-shot of dispatcher and dispatched. */
const PARTNER_MS = 3000
/** Deed impulse that counts as a burst at a site. */
const BURST = 3
/** Impulse left on a subject once the camera has cut away from it (its beat was shown). */
const TOLD = 0.4
/** A hint fades out over this long after its TTL. */
const HINT_FADE_MS = 1000

/** Beats calm enough that a fresh dispatch is better filmed as the dispatcher's two-shot. */
const ROUTINE: ReadonlySet<Beat> = new Set<Beat>(["join", "deed", "burst", "work"])

/** The shot for a beat. Exported for the tests: this is the shot language. */
export function shotFor(beat: Beat, context: { partner?: boolean; walking?: boolean } = {}): ShotKind {
  switch (beat) {
    case "plea":
    case "fail":
    case "rise":
    case "recover":
    case "deed-failed":
    case "loot":
      return "close"
    case "reaction":
      return "reaction"
    case "quest":
      return context.partner ? "two-shot" : "medium"
    case "join":
    case "leave":
      return "follow"
    case "establishing":
      return "establishing"
    default:
      return context.walking ? "follow" : "medium"
  }
}

/** What the director knows about the stage when it decides. The camera supplies it. */
export interface Stage {
  /** Adventurers on stage now (store.views). */
  views: readonly { id: string; phase: string; master: boolean }[]
  /** Writes where an adventurer is now into `out`; false when unknown (not on stage yet). */
  locate(id: string, out: Point): boolean
  /** Is an adventurer walking (far from where they are going)? */
  walking(id: string): boolean
  /** Is a ground point inside the current frame? */
  onScreen(x: number, z: number): boolean
}

export interface Point {
  x: number
  z: number
}

/** The shot being run. One object, mutated in place: read it, don't keep it. */
export interface Shot {
  kind: ShotKind
  /** Subject key ("" for the establishing wide). */
  key: string
  /** The adventurer filmed, if it is one. */
  id: string | undefined
  /** A two-shot's second adventurer. */
  partner: string | undefined
  /** Where a place (or the establishing centre) is. */
  x: number
  z: number
  /** Height the shot aims at above the ground: a lifted place's `y`, else 0. */
  y: number
  /** A place's radius. */
  radius: number
  beat: Beat
  /** When it began (director clock). */
  since: number
  /** Increments on every cut: the camera starts a transition when it changes. */
  cut: number
}

interface Rec {
  key: string
  id: string | undefined
  place: Place | undefined
  impulse: number
  impulseAt: number
  beat: Beat
  beatAt: number
  /** Deed impulse gathered recently (for bursts), decaying like impulse. */
  deeds: number
  hint: number
  hintUntil: number
  hintShot: ShotKind | undefined
  partner: string | undefined
  partnerAt: number
  /** Who sent them (from their join), for the two-shot. */
  parent: string | undefined
  lastShown: number
  // per update
  steady: number
  located: boolean
  x: number
  z: number
  total: number
}

const point: Point = { x: 0, z: 0 }

export class Director {
  /** The director's clock, ms: the store's real elapsed time (pace and fast-forward don't touch it). */
  now = 0
  readonly shot: Shot = {
    kind: "establishing",
    key: "",
    id: undefined,
    partner: undefined,
    x: 0,
    z: 10,
    y: 0,
    radius: 0,
    beat: "establishing",
    since: Number.NEGATIVE_INFINITY,
    cut: 0,
  }
  /** Fewer cuts (prefers-reduced-motion). */
  calm = false
  /**
   * Who may be filmed: the followed party's session ids, or null for everyone on stage (all
   * parties, scored together). Places (the graveyard, world events) are always in scope.
   */
  scope: ReadonlySet<string> | null = null

  private recs: Rec[] = []
  private byKey = new Map<string, Rec>()
  /** The next shot a chain asks for once the current one has run its length. */
  private chain: { key: string; beat: Beat } | undefined
  /** Parties (root ids) whose first quest has been seen since the last rebuild: each opens wide. */
  private opened = new Set<string>()
  private establishPending = false

  /** Ask for attention: `weight` (WEIGHTS scale) for `ttlMs`, then it fades. */
  hint(subject: Subject, weight: number, ttlMs: number, options: HintOptions = {}): void {
    const rec = typeof subject === "string" ? this.rec(subject) : this.placeRec(subject)
    const absorbed = options.absorbs ? this.byKey.get(options.absorbs) : undefined
    if (absorbed && absorbed !== rec) {
      weight += this.decayed(absorbed.impulse, absorbed.impulseAt)
      absorbed.impulse = 0
      absorbed.deeds = 0
    }
    rec.hint = Math.max(this.hintOf(rec), weight)
    rec.hintUntil = Math.max(rec.hintUntil, this.now + ttlMs)
    rec.hintShot = options.shot ?? (weight >= 7 ? "close" : "medium")
    this.setBeat(rec, "hint", weight)
  }

  /** A live moment (store: `moments.on`). Rebuilt moments are history and are ignored. */
  take(moment: Moment): void {
    if (!moment.live) return
    const weight = WEIGHTS[moment.kind]
    if (weight === 0) return
    const rec = this.rec(moment.id)
    if (moment.kind === "deed") {
      const size = moment.size === undefined ? 0 : Math.min(2, moment.size / 40)
      this.add(rec, weight + size)
      rec.deeds = this.decayed(rec.deeds, rec.impulseAt) + weight + size
      if (rec.deeds >= BURST) this.setBeat(rec, "burst", BURST)
      else this.setBeat(rec, "deed", weight)
      return
    }
    this.add(rec, weight)
    this.setBeat(rec, moment.kind, weight)
    if (moment.kind === "quest") {
      // A party's first quest opens wide (unless the camera is already wide, or it isn't filmed).
      if (!this.opened.has(moment.master)) {
        this.opened.add(moment.master)
        if (this.shot.kind !== "establishing" && this.inScope(moment.id)) this.establishPending = true
      }
    } else if (moment.kind === "join" && moment.parent) {
      rec.parent = moment.parent
      const parent = this.byKey.get(moment.parent)
      if (parent && parent.beat === "quest" && this.now - parent.beatAt < PARTNER_MS) {
        parent.partner = moment.id
        parent.partnerAt = this.now
      }
    }
    // Loot coming home: after the close-up, a reaction cut to whoever sent them.
    if (moment.kind === "loot" && moment.parent && this.shot.id === moment.id) {
      this.chain = { key: moment.parent, beat: "reaction" }
    } else if (moment.kind === "loot" && moment.parent) {
      rec.partner = moment.parent
      rec.partnerAt = this.now
    }
  }

  /** History was rebuilt (seek, loop, load): forget everything, including hints. */
  rebuild(): void {
    this.recs = []
    this.byKey.clear()
    this.chain = undefined
    this.opened.clear()
    this.establishPending = false
    this.restart()
  }

  /** Take a fresh look now (the Bard was just handed back): the next update cuts. */
  restart(): void {
    this.shot.since = Number.NEGATIVE_INFINITY
    this.shot.key = "\u0000"
  }

  /** Highest live interest from moments and hints (not steady work): a beat is playing. */
  excitement(): number {
    let top = 0
    for (let i = 0; i < this.recs.length; i++) {
      const rec = this.recs[i] as Rec
      top = Math.max(top, this.decayed(rec.impulse, rec.impulseAt), this.hintOf(rec))
    }
    return top
  }

  /** The subject's score as of the last update (for tests and the stats overlay). */
  scoreOf(key: string): number {
    return this.byKey.get(key)?.total ?? 0
  }

  /** Decide: keep the shot or cut. Returns the shot (the same object every time). */
  update(stage: Stage): Shot {
    const now = this.now
    const shot = this.shot
    const minShot = this.calm ? MIN_SHOT_CALM_MS : MIN_SHOT_MS
    const held = now - shot.since

    // 1. Score everyone.
    for (let i = 0; i < this.recs.length; i++) (this.recs[i] as Rec).steady = 0
    for (const view of stage.views)
      if (this.inScope(view.id)) this.rec(view.id).steady = STEADY[view.phase] ?? 0
    let best: Rec | undefined
    let current: Rec | undefined
    let sumX = 0
    let sumZ = 0
    let located = 0
    for (let i = this.recs.length - 1; i >= 0; i--) {
      const rec = this.recs[i] as Rec
      const impulse = this.decayed(rec.impulse, rec.impulseAt)
      const hint = this.hintOf(rec)
      if (rec.place) {
        rec.located = true
        rec.x = rec.place.x
        rec.z = rec.place.z
      } else {
        // Out of scope (another party, while one is followed) counts as off stage.
        rec.located = this.inScope(rec.key) && stage.locate(rec.key, point)
        rec.x = point.x
        rec.z = point.z
      }
      const isCurrent = rec.key === shot.key || rec.key === shot.partner
      if (!rec.located) {
        rec.total = 0
        if (impulse < 0.05 && hint <= 0 && rec.steady === 0 && !isCurrent) this.drop(i)
        continue
      }
      if (!rec.place) {
        sumX += rec.x
        sumZ += rec.z
        located++
      }
      const base = impulse + rec.steady + hint
      let total = base
      if (base >= 1 && !stage.onScreen(rec.x, rec.z)) total *= OFFSCREEN
      if (rec.key === shot.key) total *= Math.exp(-Math.max(0, held) / BORED_MS)
      else if (now - rec.lastShown < RECENT_MS) total *= RECENT_FACTOR
      if (!rec.place && rec.steady > 0) total += NOVELTY_MAX * Math.min(1, (now - rec.lastShown) / NOVELTY_MS)
      rec.total = total
      if (rec.key === shot.key) current = rec
      if (!best || total > best.total) best = rec
      if (impulse < 0.05 && hint <= 0 && rec.steady === 0 && !isCurrent) this.drop(i)
    }
    const centreX = located > 0 ? (sumX / located) * 0.5 : 0
    const centreZ = located > 0 ? (sumZ / located + 10) * 0.5 : 10

    // 2. Decide.
    const urgent = best !== undefined && best.total >= URGENT && best !== current
    const early = urgent && !this.calm && held >= MIN_SHOT_URGENT_MS
    if (held >= minShot || early || shot.key === "\u0000") {
      const chained = this.chain && this.byKey.get(this.chain.key)
      if (this.establishPending && !urgent) {
        this.establishPending = false
        this.cutTo(undefined, "establishing", centreX, centreZ, stage)
      } else if (chained?.located && !urgent) {
        const beat = this.chain?.beat ?? "reaction"
        this.chain = undefined
        this.cutTo(chained, beat, centreX, centreZ, stage)
      } else if (!best || best.total < QUIET_SCORE) {
        // A sky event's wide has run its course: back down to the ground's wide.
        if (shot.kind !== "establishing" || shot.y !== 0)
          this.cutTo(undefined, "establishing", centreX, centreZ, stage)
      } else if (shot.kind === "establishing") {
        this.cutTo(best, best.beat, centreX, centreZ, stage)
      } else if (!current?.located) {
        this.cutTo(best, best.beat, centreX, centreZ, stage)
      } else if (pleading(current) && !pleading(best)) {
        // An open plea on camera holds until it is answered: the user must act, so the film waits.
        if (held >= LONG_HOLD_MS) this.cutTo(undefined, "establishing", centreX, centreZ, stage)
      } else if (best !== current && best.total > current.total * STICK + STICK_ADD) {
        this.cutTo(best, best.beat, centreX, centreZ, stage)
      } else if (held >= LONG_HOLD_MS) {
        this.cutTo(undefined, "establishing", centreX, centreZ, stage)
      }
    }

    // 3. The shot follows its subject; whoever is in it has been shown.
    if (shot.key === "") {
      shot.x = centreX
      shot.z = centreZ
    } else {
      const rec = this.byKey.get(shot.key)
      if (rec?.located) {
        rec.lastShown = now
        shot.x = rec.x
        shot.z = rec.z
        shot.y = rec.place?.y ?? 0
        // The subject on camera has a new beat (it pleads, it falls): reframe, without a cut.
        if (rec.beatAt > shot.since && rec.beat !== shot.beat && !shot.partner) {
          shot.beat = rec.beat
          shot.kind =
            rec.beat === "hint" && rec.hintShot
              ? rec.hintShot
              : shotFor(rec.beat, { walking: shot.id ? stage.walking(shot.id) : false })
        }
      }
      if (shot.partner) {
        const partner = this.byKey.get(shot.partner)
        if (partner) partner.lastShown = now
      }
      // A follow or two-shot whose walker has arrived settles to medium (same subject, no cut).
      if (shot.kind === "follow" && shot.id && !stage.walking(shot.id) && now - shot.since > minShot)
        shot.kind = "medium"
    }
    return shot
  }

  // ── internals ──

  private inScope(id: string): boolean {
    return this.scope === null || this.scope.has(id)
  }

  private cutTo(subject: Rec | undefined, why: Beat, cx: number, cz: number, stage: Stage): void {
    const shot = this.shot
    let rec = subject
    let beat = why
    // A fresh join is filmed from its dispatcher first: the two-shot, then the follow.
    if (rec?.parent && ROUTINE.has(beat)) {
      const parent = this.byKey.get(rec.parent)
      if (parent?.located && parent.partner === rec.key && this.now - parent.partnerAt < MIN_SHOT_MS * 3) {
        rec = parent
        beat = "quest"
      }
    }
    // What was on camera has been told: its impulse mostly spent, so the camera doesn't come back.
    const leaving = this.byKey.get(shot.key)
    if (leaving && leaving !== rec) {
      leaving.impulse = this.decayed(leaving.impulse, leaving.impulseAt) * TOLD
      leaving.impulseAt = this.now
    }
    shot.cut++
    shot.since = this.now
    shot.partner = undefined
    shot.radius = 0
    shot.y = 0
    if (!rec) {
      shot.kind = "establishing"
      shot.key = ""
      shot.id = undefined
      shot.beat = "establishing"
      shot.x = cx
      shot.z = cz
      return
    }
    const partner =
      rec.partner && this.now - rec.partnerAt < MIN_SHOT_MS * 3 ? this.byKey.get(rec.partner) : undefined
    const twoShot = beat === "quest" && partner?.located === true
    shot.key = rec.key
    shot.id = rec.place ? undefined : rec.key
    shot.beat = beat
    shot.x = rec.x
    shot.z = rec.z
    shot.y = rec.place?.y ?? 0
    shot.radius = rec.place?.radius ?? 4
    shot.kind =
      beat === "hint" && rec.hintShot
        ? rec.hintShot
        : shotFor(beat, { partner: twoShot, walking: shot.id ? stage.walking(shot.id) : false })
    rec.lastShown = this.now
    this.chain = undefined
    if (twoShot && partner) {
      shot.partner = partner.key
      // Then follow the dispatched out of the gate.
      this.chain = { key: partner.key, beat: "join" }
    } else if (beat === "loot" && partner) {
      this.chain = { key: partner.key, beat: "reaction" }
    }
    if (beat === "reaction" || beat === "quest") rec.partner = undefined
  }

  private rec(id: string): Rec {
    const found = this.byKey.get(id)
    if (found) return found
    const rec = blank(id, undefined)
    this.recs.push(rec)
    this.byKey.set(id, rec)
    return rec
  }

  private placeRec(place: Place): Rec {
    const key = placeKey(place)
    const found = this.byKey.get(key)
    if (found) {
      found.place = place
      return found
    }
    const rec = blank(key, place)
    this.recs.push(rec)
    this.byKey.set(key, rec)
    return rec
  }

  private drop(i: number): void {
    const rec = this.recs[i] as Rec
    const last = this.recs.pop() as Rec
    if (last !== rec) this.recs[i] = last
    this.byKey.delete(rec.key)
  }

  private add(rec: Rec, weight: number): void {
    rec.impulse = this.decayed(rec.impulse, rec.impulseAt) + weight
    rec.impulseAt = this.now
  }

  /** A new beat takes over the record's shot only if it matters as much as what is left of the old. */
  private setBeat(rec: Rec, beat: Beat, weight: number): void {
    const old = rec.beat in WEIGHTS ? WEIGHTS[rec.beat as MomentKind] : rec.beat === "hint" ? rec.hint : 1
    const left = old * Math.exp(-(this.now - rec.beatAt) / TAU_MS)
    if (weight >= left * 0.5 || rec.beat === "work") {
      rec.beat = beat
      rec.beatAt = this.now
    }
  }

  private decayed(value: number, at: number): number {
    return value <= 0 ? 0 : value * Math.exp(-(this.now - at) / TAU_MS)
  }

  private hintOf(rec: Rec): number {
    if (rec.hint <= 0) return 0
    if (this.now < rec.hintUntil) return rec.hint
    return rec.hint * Math.max(0, 1 - (this.now - rec.hintUntil) / HINT_FADE_MS)
  }
}

/** Someone still waiting on the user (a plea not yet answered). */
function pleading(rec: Rec | undefined): boolean {
  return rec !== undefined && rec.steady >= (STEADY.waiting ?? 6)
}

function blank(key: string, place: Place | undefined): Rec {
  return {
    key,
    id: place ? undefined : key,
    place,
    impulse: 0,
    impulseAt: 0,
    beat: "work",
    beatAt: Number.NEGATIVE_INFINITY,
    deeds: 0,
    hint: 0,
    hintUntil: 0,
    hintShot: undefined,
    partner: undefined,
    partnerAt: Number.NEGATIVE_INFINITY,
    parent: undefined,
    lastShown: Number.NEGATIVE_INFINITY,
    steady: 0,
    located: false,
    x: 0,
    z: 0,
    total: 0,
  }
}

// ── replay fast-forward ──

/** Quiet this long (run time) before a replay speeds up. */
export const FF_QUIET_MS = 4000
/** Back at 1× this long (run time) before the next beat. */
export const FF_LEAD_MS = 2500
/** Run time per step of speed-up past the lead: 4 s ahead → 2×, 5.5 s → 3×, 7 s → 4×. */
const FF_RAMP_MS = 1500
export const FF_MAX = 4
/** Easing time constants, real ms: speeds up gently, brakes quicker. */
const FF_UP_MS = 900
const FF_DOWN_MS = 300
/** Excitement (moments, hints) at or above this keeps 1×: a rise, a secret event. */
export const FF_CALM_BELOW = 5

/**
 * How fast a replay should run right now, as a multiple of the viewer's pace. 1 unless this is a
 * replay, the director allows it, nothing is happening (no beat for FF_QUIET_MS, no plea, nothing
 * exciting) and the next beat is far enough ahead to speed up and still be back at 1× for it.
 */
export function fastForwardGoal(input: {
  replay: boolean
  enabled: boolean
  /** Run ms since the last beat. */
  sinceBeat: number
  /** Run ms until the next beat (the run's end counts as one). */
  untilBeat: number
  /** A plea is open or something exciting is on (director.excitement()). */
  busy: boolean
}): number {
  if (!input.replay || !input.enabled || input.busy) return 1
  if (input.sinceBeat < FF_QUIET_MS) return 1
  return Math.min(FF_MAX, Math.max(1, 1 + (input.untilBeat - FF_LEAD_MS) / FF_RAMP_MS))
}

/** Eases the fast-forward multiple toward its goal over `realMs`. */
export function easeSpeed(current: number, goal: number, realMs: number): number {
  const tau = goal > current ? FF_UP_MS : FF_DOWN_MS
  const next = goal + (current - goal) * Math.exp(-realMs / tau)
  return Math.abs(next - goal) < 0.01 ? goal : next
}

/** Beats a fast-forward must slow down for, from the store's timeline markers (run ms, sorted). */
export function beatTimes(markers: readonly { at: number; kind: string }[], duration: number): number[] {
  const out = markers.filter((m) => m.kind !== "walk").map((m) => m.at)
  out.push(duration)
  return out.sort((a, b) => a - b)
}

// ── HUD-aware framing ──

/**
 * What the HUD covers, px from each edge of the canvas. hud/Hud.tsx writes it when panels open or
 * close; the camera reads it to land subjects in the clear area, not under the dossier or roster.
 */
export const hudInsets = { left: 0, right: 0, top: 0, bottom: 0 }

/**
 * Where the subject should sit, as an offset from the screen centre in NDC (−1…1, y up), and the
 * clear area's size as a share of the screen. Pure.
 */
export function clearFrame(
  width: number,
  height: number,
  insets: { left: number; right: number; top: number; bottom: number },
  out: { x: number; y: number; w: number; h: number },
): typeof out {
  const left = Math.min(insets.left, width * 0.45)
  const right = Math.min(insets.right, width * 0.45)
  const top = Math.min(insets.top, height * 0.4)
  const bottom = Math.min(insets.bottom, height * 0.5)
  const cx = (left + (width - right)) / 2
  const cy = (top + (height - bottom)) / 2
  out.x = width > 0 ? (cx / width) * 2 - 1 : 0
  out.y = height > 0 ? 1 - (cy / height) * 2 : 0
  out.w = width > 0 ? (width - left - right) / width : 1
  out.h = height > 0 ? (height - top - bottom) / height : 1
  return out
}
