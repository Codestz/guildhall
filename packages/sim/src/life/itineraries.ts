import { type Craft, hash } from "@guildhall/core"
import {
  type HeroBoard,
  type HeroPose,
  type HeroSpot,
  type HexIsland,
  type HexWalk,
  heroFrom,
  heroRoute,
  type LifePose,
  type LifeSpot,
  type LifeStay,
  type LifeWalk,
  type Solid,
  solidDistance,
  WALK_MPS,
  type WalkBlocker,
} from "@guildhall/world"
import type { EventLog } from "../events/log.ts"
import { DWELL_MS, emptyWorld, type GuildWorld, placeAt, reduce, type WorldActor } from "../events/reduce.ts"
import type { WorldEvent } from "../events/world.ts"
import {
  BRIEF_MS,
  CHEER_MS,
  type LifeSample,
  PIN_MS,
  type Play,
  playRoutine,
  RISE_MS,
  routineAt,
  SETDOWN_MS,
  STANDUP_MS,
} from "./craft.ts"
import { gaitOf, RUN_FROM, RUN_TOP, WALK_TOP } from "./gait.ts"
import {
  type GraveKit,
  type GraveStrike,
  GraveStrikes,
  STRIKE_LEAD_MS,
  STRIKE_PAUSE_MS,
  STRIKE_WATCH_MS,
  strikeWalkMs,
} from "./graveStrike.ts"

/**
 * The heroes' itineraries (plan-hud-events.md §3.1, L1; decision D): where each hero walks and stands,
 * as steps on the walk graph that `poseAt` samples, made from the world's events. Every change of where
 * a hero should be, at `t0`, appends one walk from where it is at `t0` (a spot, or mid-walk: the node
 * nearest, `heroFrom`) to a free hero spot of the new place (`heroRoute`) and a stay there; nothing
 * before `t0` changes. So the itinerary up to `t` is made from the events up to `t` alone, and a pose
 * is a pure sample: a scrub (planned from the whole log) and a play (planned as the clock passes)
 * give the same pose at every `t`.
 *
 * Where a hero should be:
 *
 *   a subagent      at a spot of its place (the reducer's `placeAt`: the hysteresis rule), working; in
 *                   the Guildhall's gathering while its work names no place; home once it is done or
 *                   failed (the loot comes home); when it leaves the island, it walks home (if it is not
 *                   there) and fades `FADE_AFTER_MS` after it is there;
 *   the Guildmaster (a root session) keeps to a gathering spot while any subagent it sent is at work
 *                   (dispatching), at his own calls there (a quest's summons), and otherwise walks to
 *                   his own work like anyone else; home when done.
 *
 * Once at work at a place it walked to, a hero works there `WORK_DWELL_MS` at least: a move, its loot or
 * its failure heard on the way or meanwhile waits until then (its last call's craft plays if the call is
 * over). A seated hero gets up where it sits (`RISE_MS`) before it walks off. At work it takes the free
 * spot nearest where it comes from; a newcomer's seat is the one nearest its first errand (the board).
 *
 * Spots are booked: a hero holds the spot it walks to from the moment it sets off until it sets off
 * again (a leaver until it fades), and nobody is sent to a spot someone holds. It keeps its own spot
 * at each place it has been (its seat at the Guildhall), when free. When a place's every spot is held,
 * a hero stands on a ring round the place's heart. Pure: no clock but the events' and `advance`'s.
 *
 * What a hero does where it stands (the game-feel plan, task D; craft.ts) is its itinerary's `acts`,
 * planned from the same events and sampled with the steps:
 *
 *   a call         its craft's routine at a work spot (a read is a book, an edit a hammer at an anvil
 *                  or a pencil elsewhere…), lingering `LINGER_MS` after the call ends, then thinking;
 *   a quest        the Guildmaster walks to the notice board (`LifeKit.board`), pins it (`PIN_MS`) and
 *                  beckons; the recruit, seen within `BRIEF_WITHIN` of joining, walks from the gathering
 *                  to stand before him (a briefing spot, beside one or a row behind), is briefed
 *                  (`BRIEF_MS`, a scroll) with those who came with it, all at once, and goes back to
 *                  the gathering (or, its work already leading it away, sets to it where it stands);
 *                  he goes back to his seat after the last briefing (or `BECKON_MS` after pinning when
 *                  nobody comes); quests sent within `BURST_MS` of one another are one pin;
 *   loot           a subagent carries its loot home to the Guildmaster, sets it down and cheers, then
 *                  takes its seat; the Guildmaster's own loot is a cheer;
 *   a failure      a blow and a slump where it stands (`FAIL_HOLD_MS`: at its place, its dwell first),
 *                  then up, home, to slump at its seat;
 *                  standing up again when it recovers;
 *   a plea         waving until answered;
 *   a green CI     everyone standing cheers for `CHEER_MS`;
 *   rest           sitting at the gathering (its spots face each other in pairs).
 *
 * A moment holds the hero (its `hold`): a call heard meanwhile starts its routine once it is over. A
 * moment's follow-up (walking back to its seat) is a timer `advance` fires at its time, like a dwell.
 */

/** The island a planner walks: its walk graph, the heroes' spots and the Guildhall. */
export interface LifeKit {
  walk: HexWalk
  /** A place's hero spots (world `LifePlaces.heroSpots`): work spots, or at the Guildhall its gathering. */
  spots(zone: number): readonly HeroSpot[]
  /** The Guildhall's zone (world `guildhallZone`). */
  home: number
  /** What walks keep clear of (world `LifePlaces.walkNear`). */
  near?: (x: number, z: number, r: number) => readonly WalkBlocker[]
  /** The island, for the node nearest a hero mid-walk (`heroFrom`); without it, every node is looked at. */
  island?: HexIsland
  /** The Guildhall's notice board (world `LifePlaces.heroSpots.board()`); none: no pinning, no briefing. */
  board?: HeroBoard | null
  /** The graveyard's strike spots (graveStrike.ts): with them, a hero who mends a grave strikes it. */
  graves?: GraveKit | null
}

export interface ItineraryOptions {
  /** Walking pace, metres a second (the events' clock is ms). */
  mps?: number
  /** Metres to the walker's right of the way's middle (so heroes meeting pass each other). */
  lane?: number
  /**
   * A long way is run (gait.ts: `RUN_CLIP`, `SPRINT_CLIP` when faster): a walk that would take longer
   * than `within` seconds at `mps` goes as fast as it takes to arrive within them, up to `mps` metres a
   * second and never past `RUN_TOP` (the sprint's legs at their fastest); a pace too quick to walk and
   * too slow to run is run at `RUN_FROM`. None: every way is walked.
   */
  hurry?: { within: number; mps: number }
}

/** A call's routine goes on this long after the call ends, then the hero thinks (ms). */
export const LINGER_MS = 3000
/** The Guildmaster beckons this long after pinning when no recruit comes (ms). */
export const BECKON_MS = 6000
/** A recruit seen within this long of joining is briefed (ms). */
export const BRIEF_WITHIN = 4000
/** A Guildmaster keeps the board this long after he leaves it (his walk back to his seat), ms. */
const BOARD_BACK = 3000
/** Recruits briefed together stand this far apart, side by side or a row further back, metres. */
const BRIEF_ROW = 0.9
/** A recruit stands no nearer a gathering seat than this for its briefing, metres (two bodies). */
const BRIEF_SEAT = 0.8
/** A failure's blow and slump hold the hero where it stands this long before it walks home (ms). */
export const FAIL_HOLD_MS = 5000
/**
 * A hero that walks to a place's work stays at least this long at its work once there (ms): a move, its
 * loot or its failure heard meanwhile waits until then, so every stay at work is seen worked.
 */
export const WORK_DWELL_MS = 3000
/** A leaver fades this long after it is home at the earliest (ms): it is seen arrive, then go. */
export const FADE_AFTER_MS = 2000
/** Quests a Guildmaster sends within this long of the last are pinned with it, one pin (ms). */
export const BURST_MS = 1000
/**
 * A short way (metres) across open ground goes straight, not by the walk graph: nothing solid within
 * `STRAIGHT_ROOM` of the line (the gathering's errands: to the board, to the Guildmaster).
 */
const STRAIGHT = 8
const STRAIGHT_ROOM = 0.25
/** Where a short way blocked straight may turn instead, metres to either side of its middle. */
const STRAIGHT_DOGLEG = [0.6, -0.6, 1.2, -1.2, 1.8, -1.8]

/**
 * A stay at a hero spot: what kind of work it reads as there (its `pose`), when it is a hero spot; a
 * rising stay (`rise`) is a seated hero getting up before it walks off (`RISE_MS`).
 */
export type HeroStay = LifeStay & { pose?: HeroPose; rise?: true }
export type HeroStep = HeroStay | LifeWalk

/** What a hero does from `from` to `to` (ms): a play of craft.ts, a call's craft, a way to face. */
export interface HeroAct {
  from: number
  to: number
  play: Play
  craft?: Craft
  /** Radians to face (the stay's own facing when left out). */
  face?: number
  /** A strike's grave (graveStrike.ts): which slot it strikes. */
  grave?: number
}

/** One hero's itinerary: its steps, ms on the events' clock, and when it is on the island. */
export interface Itinerary {
  id: string
  /** Its steps, in time order; the first starts at its join, the last is a stay that runs on (`to` = ∞). */
  steps: HeroStep[]
  /** When it is drawn: [from, to) spans (to = ∞ while it stays); one per stay on the island. */
  shown: [number, number][]
  /** What it does where it stands, in time order (none of them overlap). */
  acts: HeroAct[]
  /** Its own seed (picks between a place's routines). */
  seed: number
}

/** A hero's pose, and what it is drawn doing there (absent: the body's own clip for the act). */
export interface AgentPose extends LifePose {
  sample?: LifeSample
}

/** What a hero is set to: a place, how it stands there, whether it is leaving. */
interface Want {
  zone: number
  act: "work" | "idle"
  leave: boolean
}

/** A spot, maybe a hero spot's kind of work. */
type Spotted = LifeSpot & { pose?: HeroPose }

/** A Guildmaster's spell at the notice board: pinned until, briefings given, back to its seat at. */
interface BoardSession {
  pinEnd: number
  /** When the last quest was heard (one within `BURST_MS` of it is pinned with it). */
  heard: number
  /** Quests pinned, recruits briefed, and when the last briefing ends. */
  pins: number
  briefs: number
  briefEnd: number
  until: number
  /** The recruits briefed together: when the briefing starts, and who stands for it. */
  cohort: { start: number; tracks: Track[] }
  /** Where the recruits briefed this spell stand (x, z). */
  spots: [number, number][]
}

/** When the Guildmaster leaves the board: half a second after the last briefing, once every quest's recruit came. */
const leaveBoard = (s: BoardSession): number =>
  s.briefs >= s.pins ? s.briefEnd + 500 : Math.max(s.pinEnd + BECKON_MS, s.briefEnd + 500)

interface Track {
  it: Itinerary
  want: Want
  /** The spot it holds (or walks to), as booked. */
  spot: Booked
  /** Where it stands (or will, when its walk ends): its booked spot, or an errand's. */
  here: Spotted
  /** Its own spot at each place it has been: key in `booked`. */
  own: Map<number, string>
  /** Until when a moment holds it (a call's routine waits). */
  hold: number
  /** When it walks back to its booked spot (an errand's end), and what it does from then. */
  timer?: number
  after?: Play
  /** When to look again at where it should be (a move a moment held back). */
  wake?: number
  /** At the notice board. */
  board?: BoardSession
  /** Where it was when it last set off, and when: a second walk planned at that instant starts there too. */
  was?: { at: number; here: Spotted; pose: LifePose | null; seated: boolean }
  /** Until when it stays at the work it walked to (`WORK_DWELL_MS` after it arrives): moves wait. */
  dwell?: number
  /** Its loot or its failure, heard during the dwell: played out when the dwell is over. */
  later?: "loot" | "fail"
  /** The craft of the call it is at (a step heard, its deed not yet), which goes on after a moment. */
  call?: Craft
  /** Briefed at the board: its errand's end is the briefing's. */
  briefed?: boolean
}

interface Booked {
  key: string
  spot: LifeSpot
}

/** How far out round a place's heart a hero stands when its every spot is held, metres. */
const RING = 1.6
/** Rings further out step by this, metres. */
const RING_STEP = 1.1
/** A ring place keeps this far from the place's spots and from the other ring places, metres (two bodies). */
const RING_APART = 1.1

/**
 * The ring places round a place's heart (where heroes stand when its every spot is held), the first `n`:
 * rings of RING, RING + RING_STEP… metres, as many to a ring as fit RING_APART apart, every one
 * RING_APART from the place's own spots and from each other. Pure and in a fixed order.
 */
export function ringPlaces(
  heart: { x: number; z: number },
  spots: readonly { at: readonly number[] }[],
  n: number,
): [number, number][] {
  const out: [number, number][] = []
  const clear = (x: number, z: number) =>
    spots.every((s) => Math.hypot((s.at[0] ?? 0) - x, (s.at[2] ?? 0) - z) >= RING_APART) &&
    out.every(([px, pz]) => Math.hypot(px - x, pz - z) >= RING_APART)
  for (let j = 0; out.length < n && j < 64; j++) {
    const r = RING + j * RING_STEP
    const count = Math.max(6, Math.floor((2 * Math.PI * r) / RING_APART))
    for (let a = 0; a < count && out.length < n; a++) {
      const ang = ((a + (j % 2) * 0.5) / count) * Math.PI * 2 + Math.PI / 8
      const x = heart.x + Math.cos(ang) * r
      const z = heart.z + Math.sin(ang) * r
      if (clear(x, z)) out.push([x, z])
    }
  }
  return out
}

const headingTo = (a: readonly number[], b: readonly number[]) =>
  Math.atan2((b[0] ?? 0) - (a[0] ?? 0), (b[2] ?? 0) - (a[2] ?? 0))

/**
 * The planner: push the world's events in log order (and `advance` the clock between them, live) and
 * read each hero's itinerary. One per stream, like the log.
 */
export class LifePlanner {
  private state: GuildWorld = emptyWorld()
  /** Planned up to (every move due at or before it is made). */
  private now = Number.NEGATIVE_INFINITY
  private readonly tracks = new Map<string, Track>()
  /** Booked spots: who holds each, and until when (a leaver's fade), by key. */
  private readonly booked = new Map<string, { id: string; until: number }>()
  /** Who is at the notice board, until when (one Guildmaster at a time: another's quests go unpinned). */
  private boardBy: { id: string; until: number } | null = null
  private readonly mps: number
  private readonly lane: number
  private readonly hurry: { within: number; mps: number } | undefined
  /** The graves mended as the events come, for their fixers to strike (graveStrike.ts; none without `kit.graves`). */
  private readonly strikes: GraveStrikes | null

  constructor(
    private readonly kit: LifeKit,
    opts: ItineraryOptions = {},
  ) {
    this.mps = (opts.mps ?? WALK_MPS * 1.1) / 1000
    this.lane = opts.lane ?? 0.3
    this.hurry = opts.hurry && { within: opts.hurry.within * 1000, mps: opts.hurry.mps / 1000 }
    this.strikes = kit.graves ? new GraveStrikes() : null
  }

  /**
   * A long way run: its times pressed so it arrives within `hurry.within`, no faster than its run (nor
   * `RUN_TOP`), and run, not walked, once it is quicker than a walk goes (gait.ts `WALK_TOP`).
   */
  private paced(walk: LifeWalk): LifeWalk {
    const h = this.hurry
    const took = walk.to - walk.from
    if (!h || took <= h.within) return walk
    const top = Math.min(h.mps, RUN_TOP / 1000)
    let scale = Math.max(h.within / took, this.mps / top)
    // a pace between the walk's top and the run's foot: run at the run's foot
    const pace = this.mps / scale
    if (pace > WALK_TOP / 1000 && pace < RUN_FROM / 1000) scale = this.mps / Math.min(RUN_FROM / 1000, top)
    if (scale >= 1) return walk
    const times = walk.times.map((t) => walk.from + (t - walk.from) * scale)
    return { ...walk, times, to: times[times.length - 1] as number }
  }

  /** The world after every event pushed. */
  get world(): GuildWorld {
    return this.state
  }

  /** The time planned up to. */
  get at(): number {
    return this.now
  }

  /** Every hero's itinerary, in join order. */
  get itineraries(): ReadonlyMap<string, Itinerary> {
    const out = new Map<string, Itinerary>()
    for (const [id, t] of this.tracks) out.set(id, t.it)
    return out
  }

  itinerary(id: string): Itinerary | undefined {
    return this.tracks.get(id)?.it
  }

  /** Folds one event (in log order) and plans what it changes. One earlier than `at` counts as heard now. */
  push(ev: WorldEvent): void {
    const t = Math.max(ev.at, this.now)
    this.advance(t)
    this.state = reduce(this.state, ev)
    this.review(t)
    this.react(ev, t)
    if (this.strikes) for (const s of this.strikes.take(ev)) this.strikeGrave(s, t)
  }

  /** Plans the moves that fall due by `t` (a dwell running out, an errand's end) with no event to make them. */
  advance(t: number): void {
    for (;;) {
      let due = Number.POSITIVE_INFINITY
      for (const a of this.state.actors.values())
        if (a.pending && !this.tracks.get(a.id)?.want.leave) {
          const s = a.pending.since + DWELL_MS
          if (s > this.now && s < due) due = s
        }
      for (const track of this.tracks.values()) {
        if (track.timer !== undefined && track.timer > this.now && track.timer < due) due = track.timer
        if (track.wake !== undefined && track.wake > this.now && track.wake < due) due = track.wake
      }
      if (due > t) break
      this.now = due
      // (its loot or failure heard during a dwell that runs out now: after the move the dwell held back)
      const later = [...this.tracks.values()].filter((track) => track.later && track.dwell === due)
      this.review(due)
      for (const track of this.tracks.values()) if (track.timer === due) this.fire(track, due)
      for (const track of later) this.later(track, due)
    }
    if (t > this.now) this.now = t
  }

  /**
   * Plans every move still due however far on (a dwell at work running out, a held move, an errand's
   * end) with no event left to come: the end of a log planned whole.
   */
  settle(): void {
    for (let n = 0; n < 100_000; n++) {
      let due = Number.POSITIVE_INFINITY
      for (const a of this.state.actors.values())
        if (a.pending && !this.tracks.get(a.id)?.want.leave) {
          const s = a.pending.since + DWELL_MS
          if (s > this.now && s < due) due = s
        }
      for (const track of this.tracks.values()) {
        if (track.timer !== undefined && track.timer > this.now && track.timer < due) due = track.timer
        if (track.wake !== undefined && track.wake > this.now && track.wake < due) due = track.wake
      }
      if (!Number.isFinite(due)) return
      this.advance(due)
    }
  }

  /** Where hero `id` is at `t` (null: not on the island then). */
  poseAt(id: string, t: number): AgentPose | null {
    const it = this.tracks.get(id)?.it
    return it ? poseAt(it, t) : null
  }

  // ---- planning ----

  private review(t: number): void {
    this.now = Math.max(this.now, t)
    for (const a of this.state.actors.values()) {
      const want = this.wantOf(a, t)
      const track = this.tracks.get(a.id)
      if (!track) {
        if (a.gone !== undefined) continue
        this.join(a, want, t)
        continue
      }
      if (track.want.leave && !want.leave) this.back(track, t)
      const was = track.want
      if (was.zone === want.zone && was.act === want.act && was.leave === want.leave) continue
      // on its way to work, or not long there: it gets there and works a while first (a leave too)
      if (track.dwell !== undefined && track.dwell > t && (was.zone !== want.zone || want.leave)) {
        track.wake = track.dwell
        continue
      }
      // a moment holds it where it is (a briefing, a pin, a cheer): its work's call to go elsewhere waits
      const ended = a.status === "done" || a.status === "failed"
      if (track.hold > t && was.zone !== want.zone && !want.leave && !ended) {
        track.wake = track.hold
        continue
      }
      if (was.zone === want.zone) this.stand(track, want, t)
      else this.move(track, want, t)
      if (want.leave && !was.leave) this.fade(track, t)
    }
  }

  private wantOf(a: WorldActor, t: number): Want {
    const home = this.kit.home
    if (a.gone !== undefined) return { zone: home, act: "idle", leave: true }
    if (a.status === "done" || a.status === "failed") return { zone: home, act: "idle", leave: false }
    const act = a.status === "working" ? "work" : "idle"
    // dispatching, he keeps to the gathering, at his own calls there (the quests he sends are a summons)
    if (a.parent === undefined && this.dispatching(a.id)) return { zone: home, act, leave: false }
    const place = placeAt(a, t)
    if (place === undefined || place === home || (this.kit.walk.hearts[place] ?? -1) < 0)
      return { zone: home, act, leave: false }
    return { zone: place, act: a.status === "waiting" ? "idle" : "work", leave: false }
  }

  /** Whether a guildmaster has a subagent at work. */
  private dispatching(id: string): boolean {
    for (const c of this.state.actors.values())
      if (
        c.parent === id &&
        c.gone === undefined &&
        (c.status === "starting" || c.status === "working" || c.status === "waiting")
      )
        return true
    return false
  }

  private join(a: WorldActor, want: Want, t: number): void {
    const id = a.id
    // a newcomer appears in the Guildhall's gathering and sets off from there
    // (its seat the one nearest where its first errand is, a short walk: the Guildmaster's, the notice
    // board; a recruit's, its briefing)
    const board = this.kit.board
    const errand = a.parent === undefined ? board?.spot.at : board?.brief[0]?.at
    const start = this.book(
      id,
      { zone: this.kit.home, act: "idle", leave: false },
      t,
      new Map(),
      errand,
      true,
    )
    const it: Itinerary = {
      id,
      steps: [stayAt(start.spot, t, "idle")],
      shown: [[t, Number.POSITIVE_INFINITY]],
      acts: [],
      seed: hash("hero", id) >>> 0,
    }
    const own = new Map([[this.kit.home, start.key]])
    const track: Track = {
      it,
      want: { zone: this.kit.home, act: "idle", leave: false },
      spot: start,
      here: start.spot,
      own,
      hold: t,
    }
    this.tracks.set(id, track)
    if (want.zone !== this.kit.home) this.move(track, want, t)
    else if (want.act !== "idle") this.stand(track, want, t)
    this.brief(a, track, t)
  }

  /** Stays where it stands, standing another way (work ⇄ idle). */
  private stand(track: Track, want: Want, t: number): void {
    const { steps } = track.it
    const last = steps[steps.length - 1]!
    // still on its way there: it arrives as it now should stand (a stay that has not begun by `t`)
    if (want.act === track.want.act) {
      // only leaving: it stays as it is
    } else if (last.kind === "stay" && last.from > t) last.act = want.act
    else {
      cut(steps, t)
      steps.push(stayAt(track.here, t, want.act))
    }
    track.want = { ...track.want, act: want.act, leave: want.leave }
  }

  /** Walks from where it is at `t` to a free spot of the place it should be at. */
  private move(track: Track, want: Want, t: number): void {
    this.release(track.spot.key, t)
    // where it sets off from (where a walk planned at this instant set off from, too)
    const from = track.was?.at === t ? track.was.here : (poseBefore(track.it, t) ?? track.here)
    const to = this.book(track.it.id, want, t, track.own, from.at)
    track.own.set(want.zone, to.key)
    track.spot = to
    track.want = want
    track.timer = undefined
    track.board = undefined
    track.wake = undefined
    track.dwell = undefined
    track.briefed = false
    this.atWork(track, this.walkTo(track, to.spot, t, want.act))
  }

  /**
   * It arrives at its work at a place (`arrive`): there it works `WORK_DWELL_MS` at least, its last call's
   * craft if the call is over by then, before anything sends it on.
   */
  private atWork(track: Track, arrive: number): void {
    if (track.want.zone === this.kit.home || track.want.act !== "work" || track.want.leave) return
    const end = arrive + WORK_DWELL_MS
    track.dwell = end
    const { acts } = track.it
    const going = actAt(acts, arrive)
    const last = [...acts].reverse().find((x) => x.play === "craft")
    if (!last) return
    // still at its call when it arrives: the call plays on, its lingering not before the dwell is over
    const runs = going?.play === "craft" && going.to === Number.POSITIVE_INFINITY
    cutActs(acts, arrive)
    acts.push({
      from: arrive,
      to: runs ? Number.POSITIVE_INFINITY : end,
      play: "craft",
      craft: going?.craft ?? last.craft!,
    })
    if (!runs) acts.push({ from: end, to: Number.POSITIVE_INFINITY, play: "think" })
  }

  /**
   * Walks from where it is at `t` (its stay, or where it has got to on a walk) to `to` and stays there,
   * facing `facing` (the spot's own when left out); when it arrives. Nothing before `t` changes.
   */
  private walkTo(track: Track, to: Spotted, t: number, act: "work" | "idle", facing?: number): number {
    const { steps } = track.it
    // a walk planned at this same instant is planned again from where the first started
    const again = track.was?.at === t
    if (again) track.here = track.was!.here
    const pose = again ? track.was!.pose : poseBefore(track.it, t)
    const seated = again ? track.was!.seated : seatedBefore(track.it, t)
    track.was = { at: t, here: track.here, pose, seated }
    const walking = pose?.act === "walk"
    cut(steps, t)
    let from: LifeSpot
    if (walking && pose) {
      from = this.kit.island
        ? heroFrom(this.kit.walk, this.kit.island, pose.at, pose.facing)
        : nearestNode(this.kit.walk, pose.at, pose.facing)
    } else from = track.here
    const there: Spotted = facing === undefined ? to : { ...to, facing }
    const metres = Math.hypot(from.at[0] - to.at[0], from.at[2] - to.at[2])
    // seated (at rest, slumped): it gets up where it sits before it sets off
    let leave = t
    if (seated && !walking && metres >= 1e-6) {
      leave = t + RISE_MS
      steps.push({ ...stayAt(track.here, t, "idle"), to: leave, rise: true })
    }
    track.here = there
    let walk: LifeWalk | null
    const way =
      metres >= 1e-6 && metres < STRAIGHT && !walking && from.ground && to.ground
        ? this.across(from.at, to.at)
        : null
    if (metres < 1e-6) walk = null
    else if (way) walk = this.straight([from.at, ...way], leave)
    else {
      const route = heroRoute(this.kit.walk, from, to, {
        leave,
        mps: this.mps,
        lane: this.lane,
        ...(this.kit.near ? { near: this.kit.near } : {}),
      })
      walk = route && this.paced(route)
    }
    // (no way found: there now, as before, and no getting up for it)
    if (walk) steps.push(walk)
    else if (leave > t) steps.pop()
    const arrive = walk ? walk.to : t
    steps.push(stayAt(there, arrive, act))
    return arrive
  }

  /** Whether the straight line between two points keeps clear of every solid (its ends' own aside). */
  private open(a: readonly number[], b: readonly number[]): boolean {
    const near = this.kit.near
    if (!near || Math.abs((a[1] ?? 0) - (b[1] ?? 0)) > 0.05) return false
    const ax = a[0] ?? 0
    const az = a[2] ?? 0
    const bx = b[0] ?? 0
    const bz = b[2] ?? 0
    const len = Math.hypot(bx - ax, bz - az)
    const solids = near((ax + bx) / 2, (az + bz) / 2, len / 2 + 1).filter(
      (s): s is Solid => "pts" in s && !s.soft,
    )
    const n = Math.ceil(len / 0.15)
    for (let k = 1; k < n; k++) {
      const x = ax + ((bx - ax) * k) / n
      const z = az + ((bz - az) * k) / n
      for (const s of solids) if (solidDistance(s, x, z) < STRAIGHT_ROOM) return false
    }
    return true
  }

  /**
   * A short way across open ground (within the gathering), as the points after its start: straight there,
   * else round what stands between by one turn a little to either side (`STRAIGHT_DOGLEG`); null for none.
   */
  private across(a: readonly number[], b: readonly number[]): [number, number, number][] | null {
    const end: [number, number, number] = [b[0] ?? 0, b[1] ?? 0, b[2] ?? 0]
    if (this.open(a, b)) return [end]
    const ax = a[0] ?? 0
    const az = a[2] ?? 0
    const len = Math.hypot(end[0] - ax, end[2] - az)
    if (len < 1e-6) return null
    // the way's side: across it, from its middle
    const px = -(end[2] - az) / len
    const pz = (end[0] - ax) / len
    for (const off of STRAIGHT_DOGLEG) {
      const mid: [number, number, number] = [
        (ax + end[0]) / 2 + px * off,
        end[1],
        (az + end[2]) / 2 + pz * off,
      ]
      if (this.open(a, mid) && this.open(mid, end)) return [mid, end]
    }
    return null
  }

  /** A walk along `pts` (open ground) from `t`, at the walking pace. */
  private straight(pts: readonly [number, number, number][], t: number): LifeWalk {
    const times = [t]
    for (let k = 1; k < pts.length; k++)
      times.push(
        times[k - 1]! + Math.hypot(pts[k]![0] - pts[k - 1]![0], pts[k]![2] - pts[k - 1]![2]) / this.mps,
      )
    return {
      kind: "walk",
      from: t,
      to: times[times.length - 1]!,
      pts: [...pts],
      times,
      ground: pts.slice(1).map(() => true),
    }
  }

  /** An errand's end: back to its booked spot, doing `after` from then (else nothing in particular). */
  private fire(track: Track, t: number): void {
    track.timer = undefined
    track.board = undefined
    const after = track.after
    track.after = undefined
    if (track.want.leave) {
      // a leaver fades where its errand ends; one that failed walks home first, to slump and go there
      if (after !== "slump") return
      this.walkTo(track, track.spot.spot, t, track.want.act)
      this.act(track, "slump", t)
      this.fade(track, t)
      return
    }
    const a = this.state.actors.get(track.it.id)
    const briefed = track.briefed
    track.briefed = false
    if (briefed && a?.pending && !after && track.want.zone === this.kit.home) {
      // briefed, its work already leading it away: it sets to it where it stands until it goes
      cut(track.it.steps, t)
      track.it.steps.push(stayAt(track.here, t, "work"))
    } else if (track.here !== track.spot.spot) this.walkTo(track, track.spot.spot, t, track.want.act)
    // a moment is over (a call's routine heard meanwhile goes on, and so does the call it was at)
    const now = actAt(track.it.acts, t)
    if (now && now.play !== "craft" && now.play !== "think") {
      cutActs(track.it.acts, t)
      if (track.call && !after) this.act(track, "craft", t, { craft: track.call })
    }
    if (after) this.act(track, after, t)
  }

  /** A leaver fades once home: when its walk there ends (and what it does there is over), or now. */
  private fade(track: Track, t: number): void {
    const last = track.it.steps[track.it.steps.length - 1]!
    // seen home a while first (a stay begun just now, where it stood: no arrival to see)
    const home = last.from < t ? last.from : last.from + FADE_AFTER_MS
    const at = Math.max(t, home, track.hold)
    const span = track.it.shown[track.it.shown.length - 1]!
    span[1] = at
    this.booked.set(track.spot.key, { id: track.it.id, until: at })
  }

  /** A leaver called back to work (a resumed session) is on the island again from `t`. */
  private back(track: Track, t: number): void {
    const span = track.it.shown[track.it.shown.length - 1]!
    if (span[1] <= t) track.it.shown.push([t, Number.POSITIVE_INFINITY])
    else span[1] = Number.POSITIVE_INFINITY
    this.booked.set(track.spot.key, { id: track.it.id, until: Number.POSITIVE_INFINITY })
    track.want = { ...track.want, leave: false }
  }

  private free(key: string, id: string, t: number): boolean {
    const b = this.booked.get(key)
    return !b || b.id === id || b.until <= t
  }

  private release(key: string, t: number): void {
    const b = this.booked.get(key)
    if (b && b.until > t) this.booked.set(key, { id: b.id, until: t })
  }

  /**
   * Books a spot of `want.zone` for `id`: its own there when free, else at work the free one nearest where
   * it sets off from (`near`: the shortest walk in) and at the gathering the first free (its pairs fill in
   * order), else a ring place.
   */
  private book(
    id: string,
    want: Want,
    t: number,
    own: ReadonlyMap<number, string>,
    near?: readonly number[],
    nearAtHome = false,
  ): Booked {
    const spots = this.kit.spots(want.zone)
    const mine = own.get(want.zone)
    let key: string | undefined
    if (mine !== undefined && this.free(mine, id, t)) key = mine
    let best = Number.POSITIVE_INFINITY
    if (key === undefined)
      for (let k = 0; k < spots.length; k++) {
        if (!this.free(`${want.zone}:${k}`, id, t)) continue
        if (!near || (want.zone === this.kit.home && !nearAtHome)) {
          key = `${want.zone}:${k}`
          break
        }
        const s = spots[k]!.at
        // (at the gathering, a seat with open ground to it first: a few steps, not round the court)
        const d =
          Math.hypot(s[0] - (near[0] ?? 0), s[2] - (near[2] ?? 0)) +
          (nearAtHome && !this.across(s, near) ? 3 : 0)
        if (d < best - 1e-9) {
          best = d
          key = `${want.zone}:${k}`
        }
      }
    let k = 0
    while (key === undefined) {
      if (this.free(`${want.zone}:ring${k}`, id, t)) key = `${want.zone}:ring${k}`
      else k++
    }
    this.booked.set(key, { id, until: Number.POSITIVE_INFINITY })
    return { key, spot: this.spotOf(want.zone, key) }
  }

  private spotOf(zone: number, key: string): LifeSpot {
    const tail = key.slice(key.indexOf(":") + 1)
    if (!tail.startsWith("ring")) return this.kit.spots(zone)[Number(tail)] as HeroSpot
    const k = Number(tail.slice(4))
    const node = this.kit.walk.hearts[zone]!
    const n = this.kit.walk.nodes[node]!
    let ring = this.rings.get(zone)
    if (!ring || ring.length <= k) {
      ring = ringPlaces(n, this.kit.spots(zone), Math.max(16, (k + 1) * 2))
      this.rings.set(zone, ring)
    }
    const [x, z] = ring[k] ?? [n.x, n.z]
    return { node, at: [x, n.y, z], facing: Math.atan2(n.x - x, n.z - z), ground: true }
  }

  /** Each place's ring places so far (`ringPlaces`, grown as more are asked for). */
  private readonly rings = new Map<number, [number, number][]>()

  // ---- what heroes do where they stand ----

  /** Sets what a hero does from `from` on (what it was to do from then is dropped). */
  private act(track: Track, play: Play, from: number, extra: Partial<HeroAct> = {}): void {
    cutActs(track.it.acts, from)
    track.it.acts.push({ from, to: Number.POSITIVE_INFINITY, play, ...extra })
  }

  /** The event's moments, once the moves it makes are planned. */
  private react(ev: WorldEvent, t: number): void {
    if (ev.kind === "sea.ci") {
      if (ev.moment === "sea-green") for (const track of this.tracks.values()) this.cheer(track, t)
      return
    }
    if (!("id" in ev)) return
    const track = this.tracks.get(ev.id)
    const a = this.state.actors.get(ev.id)
    if (!track || !a) return
    const at = Math.max(t, track.hold)
    // thinking never cuts short the work it walked to (`WORK_DWELL_MS`)
    const think = (from: number) => Math.max(from, track.dwell ?? from)
    // its loot or its failure while it is on its way to work or not long there: once the dwell is over
    if (
      (ev.kind === "actor.loot" || ev.kind === "actor.fail") &&
      track.dwell !== undefined &&
      track.dwell > t
    ) {
      track.later = ev.kind === "actor.loot" ? "loot" : "fail"
      track.wake = track.dwell
      return
    }
    switch (ev.kind) {
      case "actor.info":
        this.brief(a, track, t)
        return
      case "actor.step":
        track.call = ev.craft
        this.act(track, "craft", at, { craft: ev.craft })
        return
      case "actor.deed":
        track.call = undefined
        // a call heard only as it ended plays from now; either way it lingers, then the hero thinks
        if (!ev.stepped) this.act(track, "craft", at, { craft: ev.craft })
        this.act(track, "think", think(at + LINGER_MS))
        return
      case "actor.quest":
        this.pin(track, t)
        return
      case "actor.plea":
        this.plea(track, t)
        return
      case "actor.answered":
        // on with its way (or a move the plea held back)
        track.hold = Math.min(track.hold, t)
        this.review(t)
        if (track.was?.at !== t && track.here !== track.spot.spot && !track.want.leave) {
          this.act(track, "think", t)
          this.atWork(track, this.walkTo(track, track.spot.spot, t, track.want.act))
        } else this.act(track, "think", think(t))
        return
      case "actor.resume":
        this.act(track, "think", think(at))
        return
      case "actor.recover": {
        // it stands up where it slumped before it sets off (the walk just planned waits)
        const before = track.was?.at === t ? track.was : null
        if (before && before.pose?.act !== "walk") {
          track.here = before.here
          cut(track.it.steps, t)
          track.it.steps.push(stayAt(track.here, t, "idle"))
          track.timer = t + STANDUP_MS
        }
        this.act(track, "standup", t)
        this.act(track, "think", t + STANDUP_MS)
        track.hold = t + STANDUP_MS
        return
      }
      case "actor.loot":
        if (a.parent === undefined) this.cheer(track, t)
        else this.deliver(a, track, t)
        return
      case "actor.fail":
        this.fail(track, t)
        return
      default:
        return
    }
  }

  /** Its loot or its failure heard during its dwell at work, now that the dwell is over. */
  private later(track: Track, t: number): void {
    const later = track.later
    track.later = undefined
    const a = this.state.actors.get(track.it.id)
    if (!a) return
    if (later === "fail") this.fail(track, t)
    else if (a.parent === undefined) this.cheer(track, t)
    else this.deliver(a, track, t)
  }

  /** The Guildmaster sends a quest: to the notice board, pins it, beckons the recruit. */
  private pin(track: Track, t: number): void {
    const board = this.kit.board
    if (!board || track.want.leave || track.want.zone !== this.kit.home) return
    const by = this.boardBy
    if (by && by.id !== track.it.id && by.until > t) return
    const was = track.board
    let session: BoardSession
    if (was && track.here === board.spot && t - was.heard <= BURST_MS) {
      // a burst of quests: pinned with the last, one pin; he waits for each one's recruit
      session = { ...was, heard: t, pins: was.pins + 1 }
    } else {
      const at =
        track.here === board.spot
          ? Math.max(t, was?.pinEnd ?? t)
          : this.walkTo(track, board.spot, t, track.want.act)
      const pinEnd = at + PIN_MS
      this.act(track, "pin", at)
      this.act(track, "beckon", pinEnd, { face: headingTo(board.spot.at, board.brief[0]!.at) })
      session = {
        pinEnd,
        heard: t,
        pins: (was?.pins ?? 0) + 1,
        briefs: was?.briefs ?? 0,
        briefEnd: was?.briefEnd ?? Number.NEGATIVE_INFINITY,
        until: 0,
        cohort: was?.cohort ?? { start: Number.NEGATIVE_INFINITY, tracks: [] },
        spots: was?.spots ?? [],
      }
    }
    session.until = leaveBoard(session)
    track.board = session
    track.hold = session.until
    track.timer = session.until
    this.boardBy = { id: track.it.id, until: session.until + BOARD_BACK }
    track.after = undefined
    // recruits seen just before the quest was heard
    for (const a of this.state.actors.values()) {
      const r = a.parent === track.it.id ? this.tracks.get(a.id) : undefined
      if (r) this.brief(a, r, t)
    }
  }

  /** A new subagent whose Guildmaster is at the board walks to him and is briefed, then sits again. */
  private brief(a: WorldActor, track: Track, t: number): void {
    const board = this.kit.board
    if (!board || a.parent === undefined || t - a.joined > BRIEF_WITHIN || track.want.zone !== this.kit.home)
      return
    if (track.board || track.hold > t || track.it.acts.some((x) => x.play === "brief")) return
    const gm = this.tracks.get(a.parent)
    const session = gm?.board
    if (!gm || !session || gm.here !== board.spot || session.until <= t) return
    // where it stands for it: the free place nearest it of the board's briefing spots and the places a
    // body to either side of them or a row further back (a few steps over open ground first), clear of
    // the solids and the gathering's seats
    const from = track.here.at
    const taken = session.spots
    let spot: Spotted | null = null
    let best = Number.POSITIVE_INFINITY
    for (const at of this.briefPlaces(board)) {
      if (taken.some(([x, z]) => Math.hypot(x - at[0], z - at[2]) < BRIEF_ROW - 0.05)) continue
      const d = Math.hypot(at[0] - from[0], at[2] - from[2]) + (this.across(from, at) ? 0 : 5)
      if (d < best) {
        best = d
        spot = { node: board.spot.node, at, facing: headingTo(at, board.spot.at), ground: true }
      }
    }
    if (!spot) return
    taken.push([spot.at[0], spot.at[2]])
    const arrive = this.walkTo(track, spot, t, "idle")
    // recruits who come together are briefed together: a briefing not yet begun waits for the last
    const cohort = session.cohort
    if (cohort.start <= t) {
      cohort.start = Number.NEGATIVE_INFINITY
      cohort.tracks = []
    }
    const start = Math.max(arrive, session.pinEnd, cohort.start)
    const end = start + BRIEF_MS
    for (const m of cohort.tracks) {
      const begun = m.it.acts.findLast((x) => x.play === "brief")
      if (!begun || begun.from >= start) continue
      cutActs(m.it.acts, begun.from)
      m.it.acts.push({ from: start, to: Number.POSITIVE_INFINITY, play: "brief" })
      m.hold = end
      m.timer = end + 300
    }
    cohort.start = start
    cohort.tracks.push(track)
    this.act(track, "brief", start)
    track.briefed = true
    track.hold = end
    track.timer = end + 300
    track.after = undefined
    // he beckons until the briefing is over, then goes back to his seat (his calls meanwhile wait)
    session.briefs++
    session.briefEnd = Math.max(session.briefEnd, end)
    session.until = leaveBoard(session)
    gm.timer = session.until
    gm.hold = session.until
    this.boardBy = { id: gm.it.id, until: session.until + BOARD_BACK }
    const acts = gm.it.acts
    for (;;) {
      const last = acts[acts.length - 1]
      if (!last || last.from < t || (last.play !== "craft" && last.play !== "think")) break
      acts.pop()
    }
    const last = acts[acts.length - 1]
    if (last?.play === "beckon") last.to = Number.POSITIVE_INFINITY
  }

  /**
   * Where recruits may stand for a briefing (kept): the board's briefing spots, a body to either side of
   * each, then a row further back; those with a body's room from every solid and from the gathering's
   * seats (a seated hero is never stood on).
   */
  private briefPlaces(board: HeroBoard): [number, number, number][] {
    if (this.briefing) return this.briefing
    const seats = this.kit.spots(this.kit.home)
    const out: [number, number, number][] = []
    for (const back of [0, BRIEF_ROW, 2 * BRIEF_ROW])
      for (const side of [0, BRIEF_ROW, -BRIEF_ROW, 2 * BRIEF_ROW, -2 * BRIEF_ROW])
        for (const b of board.brief) {
          // across: the way the briefing spot faces (to the pinning spot), turned a quarter
          const fx = Math.sin(b.facing)
          const fz = Math.cos(b.facing)
          const x = b.at[0] - fx * back + fz * side
          const z = b.at[2] - fz * back - fx * side
          if (seats.some((g) => Math.hypot(g.at[0] - x, g.at[2] - z) < BRIEF_SEAT)) continue
          if (out.some((o) => Math.hypot(o[0] - x, o[2] - z) < 0.05)) continue
          const blockers = this.kit.near?.(x, z, 0.6) ?? []
          if (blockers.some((o) => "pts" in o && !o.soft && solidDistance(o, x, z) < 0.3)) continue
          out.push([x, b.at[1], z])
        }
    this.briefing = out
    return out
  }
  private briefing: [number, number, number][] | null = null

  /** A subagent's loot comes home: carried to the Guildmaster, set down, cheered; then its seat. */
  private deliver(a: WorldActor, track: Track, t: number): void {
    const gm = a.parent !== undefined ? this.tracks.get(a.parent) : undefined
    let to: Spotted | null = null
    if (gm && !gm.want.leave && gm.want.zone === this.kit.home) {
      // before him, on the way from its seat
      const g = gm.here
      const seat = track.spot.spot
      const d = Math.hypot(seat.at[0] - g.at[0], seat.at[2] - g.at[2])
      if (d > 1.2) {
        const f = 0.9 / d
        const at: [number, number, number] = [
          g.at[0] + (seat.at[0] - g.at[0]) * f,
          g.at[1],
          g.at[2] + (seat.at[2] - g.at[2]) * f,
        ]
        to = { node: g.node, at, facing: headingTo(at, g.at), ground: g.ground }
      }
    } else if (this.kit.board) to = this.kit.board.brief[0]!
    this.act(track, "carry", t)
    const arrive = to ? this.walkTo(track, to, t, "idle") : t
    if (!to) {
      // no one to bring it to: set down at its seat once there
      const last = track.it.steps[track.it.steps.length - 1]!
      this.act(track, "deliver", Math.max(t, last.from))
      track.hold = Math.max(t, last.from) + SETDOWN_MS + CHEER_MS
    } else {
      this.act(track, "deliver", arrive)
      track.hold = arrive + SETDOWN_MS + CHEER_MS
      track.timer = track.hold + 200
      track.after = undefined
    }
    // a leaver goes once its loot is down and cheered
    if (track.want.leave) this.fade(track, t)
  }

  /** A failure: the blow and the slump where it stands, then home to slump at its seat. */
  private fail(track: Track, t: number): void {
    const before = track.was?.at === t ? track.was : null
    const pose = before ? before.pose : poseBefore(track.it, t)
    if (pose?.act === "walk") {
      // already on its way (home): it slumps there
      this.act(track, "slump", t)
      return
    }
    // where it stands, not home yet (the walk home just planned waits)
    if (before) track.here = before.here
    const { steps } = track.it
    cut(steps, t)
    steps.push(stayAt(track.here, t, "idle"))
    this.act(track, "fail", t)
    track.hold = t + FAIL_HOLD_MS
    if (track.here !== track.spot.spot) {
      track.timer = track.hold
      track.after = "slump"
    }
    // a leaver is seen slump before it goes (and walks home first: `fire`)
    if (track.want.leave) this.fade(track, t)
  }

  /** A plea: it stops where it is (on its way, too) and waves until it is answered. */
  private plea(track: Track, t: number): void {
    const pose = poseAt(track.it, t)
    if (pose?.act === "walk") {
      const n = this.kit.island
        ? heroFrom(this.kit.walk, this.kit.island, pose.at, pose.facing)
        : nearestNode(this.kit.walk, pose.at, pose.facing)
      cut(track.it.steps, t)
      track.here = { node: n.node, at: pose.at, facing: pose.facing, ground: pose.ground }
      track.it.steps.push(stayAt(track.here, t, "idle"))
      track.timer = undefined
    }
    this.act(track, "plea", Math.max(t, track.hold))
    track.hold = Number.POSITIVE_INFINITY
  }

  // ---- the graveyard (world events Task B's hook, graveStrike.ts): kept apart from the moments above ----

  /**
   * The hero who mended a grave goes to it once what holds it is over (a long way run), squares up,
   * strikes it, watches it go down and goes back to what it was doing. One that would not get there by
   * the grave's deadline (`s.deadline`), or is leaving the island, does not come.
   */
  private strikeGrave(s: GraveStrike, t: number): void {
    const track = this.tracks.get(s.fixer)
    const spot = this.kit.graves?.strike(s.slot)
    if (!track || !spot || track.want.leave || !shownAt(track.it, t)) return
    const leave = Math.max(t, track.hold)
    const way = heroRoute(this.kit.walk, track.here, spot, {
      leave,
      mps: this.mps,
      lane: this.lane,
      ...(this.kit.near ? { near: this.kit.near } : {}),
    })
    const took = strikeWalkMs(way ? pathLength(way) : 0, this.mps)
    if (leave + took + STRIKE_PAUSE_MS + STRIKE_LEAD_MS > s.deadline) return
    this.walkTo(track, spot, leave, "idle")
    const steps = track.it.steps
    const walk = steps[steps.length - 2]
    let arrive = leave
    if (walk?.kind === "walk" && walk.to > walk.from) {
      // its own pace: the way as planned, its times pressed to a run when it is long
      const metres = pathLength(walk)
      const ms = strikeWalkMs(metres, this.mps)
      const scale = ms / (walk.to - walk.from)
      walk.times = walk.times.map((x) => walk.from + (x - walk.from) * scale)
      walk.to = walk.from + ms
      arrive = walk.to
      steps[steps.length - 1]!.from = arrive
    }
    // squares up as it arrives, then swings (craft.ts `strike`)
    this.act(track, "strike", arrive, { grave: s.slot })
    track.hold = arrive + STRIKE_PAUSE_MS + STRIKE_LEAD_MS + STRIKE_WATCH_MS
    track.timer = track.hold
    track.after = undefined
  }

  /** A cheer for `CHEER_MS` (a green CI), then on with what it was doing; not while a moment holds it. */
  private cheer(track: Track, t: number): void {
    if (track.want.leave || track.hold > t || !shownAt(track.it, t)) return
    const going = actAt(track.it.acts, t)
    const was = going && { ...going }
    this.act(track, "cheer", t)
    const end = t + CHEER_MS
    track.it.acts[track.it.acts.length - 1]!.to = end
    if (was && was.to > end && was.play !== "cheer") track.it.acts.push({ ...was, from: end })
    track.hold = end
  }
}

/** A stay at a spot from `t` on. */
function stayAt(spot: Spotted, t: number, act: "work" | "idle"): HeroStay {
  return {
    kind: "stay",
    from: t,
    to: Number.POSITIVE_INFINITY,
    at: spot.at,
    facing: spot.facing,
    act,
    ground: spot.ground,
    ...(spot.clip ? { clip: spot.clip } : {}),
    ...(spot.prop ? { prop: spot.prop } : {}),
    ...(spot.pose ? { pose: spot.pose } : {}),
  }
}

/** Ends an itinerary at `t`: its last step stops there (a walk where it has got to). */
function cut(steps: HeroStep[], t: number): void {
  for (;;) {
    const last = steps[steps.length - 1]
    if (!last || last.from < t) break
    // a step that had not begun by `t` is dropped (never the first)
    if (steps.length === 1) {
      last.to = t
      return
    }
    steps.pop()
  }
  // a walk keeps its way (so where it is at any time before `t` is sampled as before, to the bit)
  const last = steps[steps.length - 1]!
  if (last.to > t) last.to = t
}

/** Ends a hero's acts at `t`: those that had not begun are dropped, the one going on stops there. */
function cutActs(acts: HeroAct[], t: number): void {
  while (acts.length && acts[acts.length - 1]!.from >= t) acts.pop()
  const last = acts[acts.length - 1]
  if (last && last.to > t) last.to = t
}

/** Where a hero is at `t` by the steps begun before `t` (a step planned at `t` itself not yet). */
function poseBefore(it: Itinerary, t: number): LifePose | null {
  let k = stepIndex(it.steps, t)
  while (k > 0 && it.steps[k]!.from >= t) k--
  return k < 0 || !shownAt(it, t) ? null : stepPose(it.steps, t, k)
}

/**
 * Whether a hero sits (at rest, slumped, sitting down) just before `t`, as planned before `t`: what is
 * planned at `t` itself only cuts what went before at `t`, so a moment earlier reads as it was.
 */
function seatedBefore(it: Itinerary, t: number): boolean {
  const clip = poseAt(it, t - 0.01)?.sample?.clip
  return clip === "Sit_Floor_Idle" || clip === "Sit_Floor_Down"
}

/** The act going on at `t`, if any. */
function actAt(acts: readonly HeroAct[], t: number): HeroAct | undefined {
  let lo = 0
  let hi = acts.length - 1
  if (hi < 0 || acts[0]!.from > t) return undefined
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (acts[mid]!.from <= t) lo = mid
    else hi = mid - 1
  }
  const a = acts[lo]!
  return t < a.to ? a : undefined
}

function walkAt(s: LifeWalk, k: number, t: number): [number, number, number] {
  const a = s.pts[k]!
  const b = s.pts[k + 1]!
  const t0 = s.times[k]!
  const t1 = s.times[k + 1]!
  const f = t1 > t0 ? Math.min(1, Math.max(0, (t - t0) / (t1 - t0))) : 0
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]
}

/** The walk node nearest a point, as a start (`heroFrom` without the island's grid). */
function nearestNode(walk: HexWalk, at: [number, number, number], facing: number): LifeSpot {
  let node = -1
  let best = Number.POSITIVE_INFINITY
  for (const [i, n] of walk.nodes.entries()) {
    const d = Math.hypot(n.x - at[0], n.z - at[2])
    if (d < best) {
      best = d
      node = i
    }
  }
  const n = walk.nodes[node]
  return { node, at, facing, ground: n ? n.kind !== "bridge" && n.kind !== "dock" : true }
}

/** Whether an itinerary's hero is on the island at `t`. */
export function shownAt(it: Itinerary, t: number): boolean {
  for (const [a, b] of it.shown) if (t >= a && t < b) return true
  return false
}

/**
 * Where an itinerary's hero is at `t`, and what it is doing there: a pure sample of its steps and acts
 * (null before it joins and while it is gone). Before its first step and after its last, it stands
 * where they begin and end.
 */
export function poseAt(it: Itinerary, t: number): AgentPose | null {
  if (!shownAt(it, t)) return null
  const k = stepIndex(it.steps, t)
  if (k < 0) return null
  const step = it.steps[k]!
  const pose: AgentPose = stepPose(it.steps, t, k)!
  const act = it.acts ? actAt(it.acts, t) : undefined
  if (step.kind === "walk") {
    // walking: the walk's own clip; only the loot it carries shows
    if (act?.play === "carry")
      pose.sample = {
        clip: "Walking_A",
        phase: 0,
        props: playRoutine("carry", undefined, undefined).props.slice(),
      }
    return pose
  }
  const stay = step as HeroStay
  if (stay.rise) {
    // getting up off the ground, then off
    const r = routineAt(playRoutine("rise", undefined, undefined), t - stay.from, stay.facing)
    pose.sample = { clip: r.clip, phase: r.phase, props: r.props }
    return pose
  }
  let play: Play | undefined = act?.play
  // a call's routine (and thinking) only at work; resting at the gathering when nothing else is on
  if ((play === "craft" || play === "think") && stay.act !== "work") play = undefined
  if (play === undefined && stay.act === "work") play = "think"
  if (play === undefined && stay.act === "idle" && stay.pose === "gather") play = "rest"
  if (play === undefined) return pose
  const since = Math.max(stay.from, play === act?.play && act ? act.from : stay.from)
  const facing = act?.face ?? stay.facing
  const r = routineAt(playRoutine(play, act?.craft, stay.pose, it.seed), t - since, facing)
  pose.facing = facing + r.turn
  if (r.dx || r.dz) pose.at = [pose.at[0] + r.dx, pose.at[1], pose.at[2] + r.dz]
  pose.sample = { clip: r.clip, phase: r.phase, props: r.props, ...(r.beat ? { beat: r.beat } : {}) }
  return pose
}

/** The index of the step going on at `t` (clamped to the steps), −1 for none. */
function stepIndex(steps: readonly HeroStep[], t: number): number {
  if (!steps.length) return -1
  let lo = 0
  let hi = steps.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (steps[mid]!.from <= t) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** A pose on a list of steps at `t` (clamped to them), as world `lifePose` with no loop. */
export function stepPose(steps: readonly HeroStep[], t: number, at = stepIndex(steps, t)): LifePose | null {
  if (at < 0) return null
  const s = steps[at]!
  if (s.kind === "stay") {
    const pose: LifePose = { at: s.at, facing: s.facing, act: s.act, indoors: !!s.indoors, ground: s.ground }
    if (s.clip) pose.clip = s.clip
    if (s.prop) pose.prop = s.prop
    return pose
  }
  // a walk cut short keeps its way and ends at `to`, where it had got to; no `from`/`to` on the pose:
  // where a walk ends is not known until it does (a scrub and a play must agree)
  const tt = Math.min(Math.max(t, s.from), s.to)
  const k = segmentAt(s, tt)
  const a = s.pts[k]!
  const b = s.pts[k + 1] ?? a
  const pose: LifePose = {
    at: walkAt(s, k, tt),
    facing: Math.atan2(b[0] - a[0], b[2] - a[2]),
    act: "walk",
    indoors: false,
    ground: s.ground[k] ?? true,
  }
  // a way run (ItineraryOptions.hurry): the whole walk's pace names its gait, so a pose never flickers
  const span = (s.times[s.times.length - 1] as number) - s.from
  const gait = span > 0 ? gaitOf((pathLength(s) / span) * 1000 + 1e-9) : undefined
  if (gait) pose.clip = gait
  return pose
}

const lengths = new WeakMap<LifeWalk, number>()
/** A walk's whole way, metres (kept). */
function pathLength(s: LifeWalk): number {
  let m = lengths.get(s)
  if (m === undefined) {
    m = 0
    for (let k = 1; k < s.pts.length; k++)
      m += Math.hypot(s.pts[k]![0] - s.pts[k - 1]![0], s.pts[k]![2] - s.pts[k - 1]![2])
    lengths.set(s, m)
  }
  return m
}

/** The segment of a walk that time `t` is on. */
function segmentAt(s: LifeWalk, t: number): number {
  let k = 0
  while (k + 2 < s.times.length && s.times[k + 1]! <= t) k++
  return k
}

/** Where a walk has got to at `t` (its end once it is over, or where it was cut short). */
export function walkEnd(s: LifeWalk): [number, number, number] {
  return walkAt(s, segmentAt(s, s.to), s.to)
}

/**
 * Every hero's itinerary from a log (or its events, in order), planned through `until` (by default the
 * last event and the dwell after it) and then every move the events started, however far on: the log is
 * whole, no event is left to come (`LifePlanner.settle`).
 */
export function itineraries(
  log: EventLog | readonly WorldEvent[],
  kit: LifeKit,
  opts: ItineraryOptions & { until?: number } = {},
): Map<string, Itinerary> {
  const events = "events" in log ? log.events : log
  const planner = new LifePlanner(kit, opts)
  for (const ev of events) planner.push(ev)
  const last = events[events.length - 1]
  planner.advance(opts.until ?? (last ? last.at + DWELL_MS : 0))
  planner.settle()
  return new Map(planner.itineraries)
}
