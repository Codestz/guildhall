import {
  type HeroSpot,
  type HexIsland,
  type HexWalk,
  heroFrom,
  heroRoute,
  type LifePose,
  type LifeSpot,
  type LifeStay,
  type LifeStep,
  type LifeWalk,
  WALK_MPS,
  type WalkBlocker,
} from "@guildhall/world"
import type { EventLog } from "../events/log.ts"
import { DWELL_MS, emptyWorld, type GuildWorld, placeAt, reduce, type WorldActor } from "../events/reduce.ts"
import type { WorldEvent } from "../events/world.ts"

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

/** One hero's itinerary: its steps, ms on the events' clock, and when it is on the island. */
export interface Itinerary {
  id: string
  /** Its steps, in time order; the first starts at its join, the last is a stay that runs on (`to` = ∞). */
  steps: LifeStep[]
  /** When it is drawn: [from, to) spans (to = ∞ while it stays); one per stay on the island. */
  shown: [number, number][]
}

/** What a hero is set to: a place, how it stands there, whether it is leaving. */
interface Want {
  zone: number
  act: "work" | "idle"
  leave: boolean
}

interface Track {
  it: Itinerary
  want: Want
  /** The spot it holds (or walks to), as booked. */
  spot: Booked
  /** Its own spot at each place it has been: key in `booked`. */
  own: Map<number, string>
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
  }

  /** Plans the moves that fall due by `t` (a dwell running out) with no event to make them. */
  advance(t: number): void {
    for (;;) {
      let due = Number.POSITIVE_INFINITY
      for (const a of this.state.actors.values())
        if (a.pending && !this.tracks.get(a.id)?.want.leave) {
          const s = a.pending.since + DWELL_MS
          if (s > this.now && s < due) due = s
        }
      if (due > t) break
      this.now = due
      this.review(due)
    }
    if (t > this.now) this.now = t
  }

  /** Where hero `id` is at `t` (null: not on the island then). */
  poseAt(id: string, t: number): LifePose | null {
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
        this.join(a.id, want, t)
        continue
      }
      if (track.want.leave && !want.leave) this.back(track, t)
      const was = track.want
      if (was.zone === want.zone && was.act === want.act && was.leave === want.leave) continue
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
    if (place === undefined || place === home || (this.kit.walk.hearts[place] ?? -1) < 0)
      return { zone: home, act: "idle", leave: false }
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

  private join(id: string, want: Want, t: number): void {
    // a newcomer appears in the Guildhall's gathering and sets off from there
    const start = this.book(id, { zone: this.kit.home, act: "idle", leave: false }, t, new Map())
    const it: Itinerary = {
      id,
      steps: [stayAt(start.spot, t, "idle")],
      shown: [[t, Number.POSITIVE_INFINITY]],
    }
    const own = new Map([[this.kit.home, start.key]])
    const track: Track = { it, want: { zone: this.kit.home, act: "idle", leave: false }, spot: start, own }
    this.tracks.set(id, track)
    if (want.zone !== this.kit.home) this.move(track, want, t)
    else if (want.act !== "idle") this.stand(track, want, t)
  }

  /** Stays at its spot, standing another way (work ⇄ idle). */
  private stand(track: Track, want: Want, t: number): void {
    const { steps } = track.it
    const last = steps[steps.length - 1]!
    // still on its way there: it arrives as it now should stand (a stay that has not begun by `t`)
    if (last.kind === "stay" && last.from > t) last.act = want.act
    else {
      cut(steps, t)
      steps.push(stayAt(track.spot.spot, t, want.act))
    }
    track.want = { ...track.want, act: want.act, leave: want.leave }
  }

  /** Walks from where it is at `t` to a free spot of the place it should be at. */
  private move(track: Track, want: Want, t: number): void {
    const { steps } = track.it
    const pose = poseAt(track.it, t)
    const walking = pose?.act === "walk"
    cut(steps, t)
    let from: LifeSpot
    if (walking && pose) {
      from = this.kit.island
        ? heroFrom(this.kit.walk, this.kit.island, pose.at, pose.facing)
        : nearestNode(this.kit.walk, pose.at, pose.facing)
    } else from = track.spot.spot
    this.release(track.spot.key, t)
    const to = this.book(track.it.id, want, t, track.own)
    track.own.set(want.zone, to.key)
    track.spot = to
    track.want = want
    const route = heroRoute(this.kit.walk, from, to.spot, {
      leave: t,
      mps: this.mps,
      lane: this.lane,
      ...(this.kit.near ? { near: this.kit.near } : {}),
    })
    const walk = route && this.paced(route)
    if (walk) steps.push(walk)
    steps.push(stayAt(to.spot, walk ? walk.to : t, want.act))
  }

  /** A leaver fades once home: when its walk there ends, or now. */
  private fade(track: Track, t: number): void {
    const last = track.it.steps[track.it.steps.length - 1]!
    const at = Math.max(t, last.from)
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
}

/** A stay at a spot from `t` on. */
function stayAt(spot: LifeSpot, t: number, act: "work" | "idle"): LifeStay {
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
  }
}

/** Ends an itinerary at `t`: its last step stops there (a walk where it has got to). */
function cut(steps: LifeStep[], t: number): void {
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
 * Where an itinerary's hero is at `t`: a pure sample of its steps (null before it joins and while it is
 * gone). Before its first step and after its last, it stands where they begin and end.
 */
export function poseAt(it: Itinerary, t: number): LifePose | null {
  if (!shownAt(it, t)) return null
  return stepPose(it.steps, t)
}

/** A pose on a list of steps at `t` (clamped to them), as world `lifePose` with no loop. */
export function stepPose(steps: readonly LifeStep[], t: number): LifePose | null {
  if (!steps.length) return null
  let lo = 0
  let hi = steps.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (steps[mid]!.from <= t) lo = mid
    else hi = mid - 1
  }
  const s = steps[lo]!
  if (s.kind === "stay") {
    const pose: LifePose = { at: s.at, facing: s.facing, act: s.act, indoors: !!s.indoors, ground: s.ground }
    if (s.clip) pose.clip = s.clip
    if (s.prop) pose.prop = s.prop
    return pose
  }
  // a walk cut short keeps its way and ends at `to`, where it had got to; no `from`/`to` on the pose:
  // where a walk ends is not known until it does (a scrub and a play must agree)
  const at = Math.min(Math.max(t, s.from), s.to)
  const k = segmentAt(s, at)
  const a = s.pts[k]!
  const b = s.pts[k + 1] ?? a
  const pose: LifePose = {
    at: walkAt(s, k, at),
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
