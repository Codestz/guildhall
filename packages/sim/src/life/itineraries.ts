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
  routineAt,
  SETDOWN_MS,
  STANDUP_MS,
} from "./craft.ts"

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
 *                   there) and fades on arrival;
 *   the Guildmaster (a root session) sits at a gathering spot while any subagent it sent is at work
 *                   (dispatching), and otherwise walks to its own work like anyone else; home when done.
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
 *                  to stand before him, is briefed (`BRIEF_MS`, a scroll) and goes back to the gathering
 *                  until its work leads it away; he goes back to his seat after the last briefing (or
 *                  `BECKON_MS` after pinning when nobody comes);
 *   loot           a subagent carries its loot home to the Guildmaster, sets it down and cheers, then
 *                  takes its seat; the Guildmaster's own loot is a cheer;
 *   a failure      a blow and a slump where it stands (`FAIL_HOLD_MS`), then home to slump at its seat;
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
}

export interface ItineraryOptions {
  /** Walking pace, metres a second (the events' clock is ms). */
  mps?: number
  /** Metres to the walker's right of the way's middle (so heroes meeting pass each other). */
  lane?: number
  /**
   * A long way is run (`RUN_CLIP`): a walk that would take longer than `within` seconds at `mps` goes
   * as fast as it takes to arrive within them, up to `mps` metres a second. None: every way is walked.
   */
  hurry?: { within: number; mps: number }
}

/** The clip a hero's pose names while it runs (faster than `RUN_FROM` m/s): KayKit's run. */
export const RUN_CLIP = "Running_A"
/** From this pace on (metres a second) a hero runs. */
export const RUN_FROM = 1.6

/** A call's routine goes on this long after the call ends, then the hero thinks (ms). */
export const LINGER_MS = 3000
/** The Guildmaster beckons this long after pinning when no recruit comes (ms). */
export const BECKON_MS = 6000
/** A recruit seen within this long of joining is briefed (ms). */
export const BRIEF_WITHIN = 4000
/** A Guildmaster keeps the board this long after he leaves it (his walk back to his seat), ms. */
const BOARD_BACK = 3000
/** A row of recruits further back from the board than the last, metres. */
const BRIEF_ROW = 0.9
/** A failure's blow and slump hold the hero where it stands this long before it walks home (ms). */
export const FAIL_HOLD_MS = 5000
/**
 * A short way (metres) across open ground goes straight, not by the walk graph: nothing solid within
 * `STRAIGHT_ROOM` of the line (the gathering's errands: to the board, to the Guildmaster).
 */
const STRAIGHT = 8
const STRAIGHT_ROOM = 0.25

/** A stay at a hero spot: what kind of work it reads as there (its `pose`), when it is a hero spot. */
export type HeroStay = LifeStay & { pose?: HeroPose }
export type HeroStep = HeroStay | LifeWalk

/** What a hero does from `from` to `to` (ms): a play of craft.ts, a call's craft, a way to face. */
export interface HeroAct {
  from: number
  to: number
  play: Play
  craft?: Craft
  /** Radians to face (the stay's own facing when left out). */
  face?: number
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
  /** Quests pinned, recruits briefed, and when the last briefing ends. */
  pins: number
  briefs: number
  briefEnd: number
  until: number
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
  was?: { at: number; here: Spotted; pose: LifePose | null }
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

  constructor(
    private readonly kit: LifeKit,
    opts: ItineraryOptions = {},
  ) {
    this.mps = (opts.mps ?? WALK_MPS * 1.1) / 1000
    this.lane = opts.lane ?? 0.3
    this.hurry = opts.hurry && { within: opts.hurry.within * 1000, mps: opts.hurry.mps / 1000 }
  }

  /** A long way run: its times pressed so it arrives within `hurry.within` (no faster than its run). */
  private paced(walk: LifeWalk): LifeWalk {
    const h = this.hurry
    const took = walk.to - walk.from
    if (!h || took <= h.within) return walk
    const scale = Math.max(h.within / took, this.mps / h.mps)
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
      this.review(due)
      for (const track of this.tracks.values()) if (track.timer === due) this.fire(track, due)
    }
    if (t > this.now) this.now = t
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
    if (a.parent === undefined && this.dispatching(a.id)) return { zone: home, act: "idle", leave: false }
    const place = placeAt(a, t)
    const act = a.status === "working" ? "work" : "idle"
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
    const start = this.book(id, { zone: this.kit.home, act: "idle", leave: false }, t, new Map())
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
    const to = this.book(track.it.id, want, t, track.own)
    track.own.set(want.zone, to.key)
    track.spot = to
    track.want = want
    track.timer = undefined
    track.board = undefined
    track.wake = undefined
    this.walkTo(track, to.spot, t, want.act)
  }

  /**
   * Walks from where it is at `t` (its stay, or where it has got to on a walk) to `to` and stays there,
   * facing `facing` (the spot's own when left out); when it arrives. Nothing before `t` changes.
   */
  private walkTo(track: Track, to: Spotted, t: number, act: "work" | "idle", facing?: number): number {
    const { steps } = track.it
    // a walk planned at this same instant is planned again from where the first started
    if (track.was?.at === t) track.here = track.was.here
    const pose = track.was?.at === t ? track.was.pose : poseBefore(track.it, t)
    track.was = { at: t, here: track.here, pose }
    const walking = pose?.act === "walk"
    cut(steps, t)
    let from: LifeSpot
    if (walking && pose) {
      from = this.kit.island
        ? heroFrom(this.kit.walk, this.kit.island, pose.at, pose.facing)
        : nearestNode(this.kit.walk, pose.at, pose.facing)
    } else from = track.here
    const there: Spotted = facing === undefined ? to : { ...to, facing }
    track.here = there
    const metres = Math.hypot(from.at[0] - to.at[0], from.at[2] - to.at[2])
    let walk: LifeWalk | null
    if (metres < 1e-6) walk = null
    else if (metres < STRAIGHT && !walking && from.ground && to.ground && this.open(from.at, to.at))
      walk = this.straight(from, to, t)
    else {
      const route = heroRoute(this.kit.walk, from, to, {
        leave: t,
        mps: this.mps,
        lane: this.lane,
        ...(this.kit.near ? { near: this.kit.near } : {}),
      })
      walk = route && this.paced(route)
    }
    if (walk) steps.push(walk)
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

  /** A short way across open ground (within the gathering): straight there. */
  private straight(from: LifeSpot, to: LifeSpot, t: number): LifeWalk {
    const metres = Math.hypot(from.at[0] - to.at[0], from.at[2] - to.at[2])
    return {
      kind: "walk",
      from: t,
      to: t + metres / this.mps,
      pts: [from.at, to.at],
      times: [t, t + metres / this.mps],
      ground: [from.ground && to.ground],
    }
  }

  /** An errand's end: back to its booked spot, doing `after` from then (else nothing in particular). */
  private fire(track: Track, t: number): void {
    track.timer = undefined
    track.board = undefined
    if (track.want.leave) return
    const after = track.after
    track.after = undefined
    if (track.here !== track.spot.spot) this.walkTo(track, track.spot.spot, t, track.want.act)
    // a moment is over (a call's routine heard meanwhile goes on)
    const now = actAt(track.it.acts, t)
    if (now && now.play !== "craft" && now.play !== "think") cutActs(track.it.acts, t)
    if (after) this.act(track, after, t)
  }

  /** A leaver fades once home: when its walk there ends (and what it does there is over), or now. */
  private fade(track: Track, t: number): void {
    const last = track.it.steps[track.it.steps.length - 1]!
    const at = Math.max(t, last.from, track.hold)
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

  /** Books a spot of `want.zone` for `id`: its own there when free, else the first free, else a ring place. */
  private book(id: string, want: Want, t: number, own: ReadonlyMap<number, string>): Booked {
    const spots = this.kit.spots(want.zone)
    const mine = own.get(want.zone)
    let key: string | undefined
    if (mine !== undefined && this.free(mine, id, t)) key = mine
    if (key === undefined)
      for (let k = 0; k < spots.length; k++)
        if (this.free(`${want.zone}:${k}`, id, t)) {
          key = `${want.zone}:${k}`
          break
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
    switch (ev.kind) {
      case "actor.info":
        this.brief(a, track, t)
        return
      case "actor.step":
        this.act(track, "craft", at, { craft: ev.craft })
        return
      case "actor.deed":
        // a call heard only as it ended plays from now; either way it lingers, then the hero thinks
        if (!ev.stepped) this.act(track, "craft", at, { craft: ev.craft })
        this.act(track, "think", at + LINGER_MS)
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
        if (track.was?.at !== t && track.here !== track.spot.spot && !track.want.leave)
          this.walkTo(track, track.spot.spot, t, track.want.act)
        this.act(track, "think", t)
        return
      case "actor.resume":
        this.act(track, "think", at)
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

  /** The Guildmaster sends a quest: to the notice board, pins it, beckons the recruit. */
  private pin(track: Track, t: number): void {
    const board = this.kit.board
    if (!board || track.want.leave || track.want.zone !== this.kit.home) return
    const by = this.boardBy
    if (by && by.id !== track.it.id && by.until > t) return
    const at =
      track.here === board.spot
        ? Math.max(t, track.board?.pinEnd ?? t)
        : this.walkTo(track, board.spot, t, track.want.act)
    const pinEnd = at + PIN_MS
    this.act(track, "pin", at)
    this.act(track, "beckon", pinEnd, { face: headingTo(board.spot.at, board.brief[0]!.at) })
    const was = track.board
    const session: BoardSession = {
      pinEnd,
      pins: (was?.pins ?? 0) + 1,
      briefs: was?.briefs ?? 0,
      briefEnd: was?.briefEnd ?? Number.NEGATIVE_INFINITY,
      until: 0,
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
    // more recruits than briefing spots: the next row stands a body further back
    const k = session.briefs
    const first = board.brief[k % board.brief.length]!
    const back = Math.floor(k / board.brief.length) * BRIEF_ROW
    const spot: Spotted =
      back === 0
        ? first
        : {
            ...first,
            at: [
              first.at[0] - Math.sin(first.facing) * back,
              first.at[1],
              first.at[2] - Math.cos(first.facing) * back,
            ],
          }
    const arrive = this.walkTo(track, spot, t, "idle")
    const start = Math.max(arrive, session.pinEnd)
    const end = start + BRIEF_MS
    this.act(track, "brief", start)
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
      return
    }
    this.act(track, "deliver", arrive)
    track.hold = arrive + SETDOWN_MS + CHEER_MS
    track.timer = track.hold + 200
    track.after = undefined
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
  // a way run (ItineraryOptions.hurry): the whole walk's pace says so, so a pose never flickers
  const span = (s.times[s.times.length - 1] as number) - s.from
  if (span > 0 && (pathLength(s) / span) * 1000 >= RUN_FROM) pose.clip = RUN_CLIP
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
 * Every hero's itinerary from a log (or its events, in order), planned through `until` (by default
 * the last event and the dwell after it, so a move the last events started is made).
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
  return new Map(planner.itineraries)
}
