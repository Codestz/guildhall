/**
 * Life on the hex island (pure; decisions.md "Hex plan go", "Polish round"): the townsfolk of every
 * place and the agents, each a loop of steps on the walk graph (walk.ts) that render samples by time.
 *
 * Spots (spots.ts): people do things only at spots: they work at a work spot of their place, facing
 * its way, playing its clip and holding its prop, sit only on a seat, and meet on their place's square
 * at a slot of their own (rings round the well). Every spot and slot is reserved by one person, so
 * nobody stacks; walks keep clear of the blockers (carts, stalls, houses) on the way.
 *
 * Townsfolk: a few per place, more the more it is built up, in the roles its kind needs (farmers on a
 * farm, miners at the mine, fishers on the docks, merchants at the market, guards at the castle and the
 * camp, monks at the monastery…). Each has a home (a door of their place), a work spot and a slot on
 * their place's square, and a day in hours: asleep indoors at night, to work in the morning, the square
 * at noon, work again, the square (or a bench) in the evening, home. Guards and the night watch keep
 * the night shift. The day loops at 24 h.
 *
 * Agents: heroes idling at the Guildhall (the castle; the town's square when there is none) and walking
 * errands to a place and back, working there at a spot of its own: a loop in seconds built from a list
 * of errands (scripted for now; repo events drive it later).
 */
import { hash2 } from "../geom/noise.ts"
import { discSolid, type Solid, SolidGrid } from "./collide.ts"
import { DRILLS, pairedDrill } from "./drills.ts"
import { hexAt, hexCentre } from "./grid.ts"
import { type HeroPool, heroSpotPool } from "./heroes.ts"
import { type HexIsland, kindOf } from "./island.ts"
import { CHOP_TRIP, cyclesSpan, PROPS, type RoutineAt, routineFor, spotFrame } from "./routines.ts"
import { HARD, type PlacedSpot, type TileFurniture, tileFurniture } from "./spots.ts"
import { HEX_TILE_SIZE, opensEvening, type SpotHours, spotWindows } from "./tiles.ts"
import { clearWay, type HexWalk, type HexWalkNode, type WalkBlocker, walledIn } from "./walk.ts"
import type { HexDoorway, HexWorld } from "./world.ts"
import { type HexZones, useOf, type ZoneKind } from "./zones.ts"

export type LifeAct = "walk" | "work" | "idle"
export type Vec3 = [number, number, number]

/** What a stay at a spot plays and holds (left out: the role's own clip for the act, and its props). */
interface SpotDoing {
  /** A rig clip to play there instead of the role's clip for the act. */
  clip?: string
  /** A prop held there (catalog id). */
  prop?: string
  /** Metres over the ground (or deck) the feet are: a seat. */
  lift?: number
  /** A routine played there in place of a clip (drills.ts): a duel's side, a dummy, a drill line. */
  drill?: DrillAt
  /**
   * A work routine played there (routines.ts): a loop of clips with props and beats, sampled by
   * `routineSample(routine, seconds into the stay)`.
   */
  routine?: RoutineAt
}

/** Which routine a spot plays, which side of it, and where on the shared clock. */
export interface DrillAt {
  /** A routine of DRILLS. */
  id: string
  /** Its side (a duel's 0 or 1; 0 for one-sided routines). */
  side: number
  /** Seconds added to the shared clock: one per duel pair, per drill line, or per spot. */
  at: number
  /**
   * A duel's pair, the same for both its sides (the lower spot's index): whether both are there now is
   * the renderer's to see (alone, a side plays the routine's `solo`).
   */
  pair?: number
}

/** Standing at one spot from `from` to `to`. */
export interface LifeStay extends SpotDoing {
  kind: "stay"
  from: number
  to: number
  at: Vec3
  facing: number
  act: "work" | "idle"
  /** At home: not drawn. */
  indoors?: boolean
  /** On the ground (snap to it), or on a deck (keep `at[1]`). */
  ground: boolean
}

/** Walking: `pts[k]` is reached at `times[k]`; segment k is on the ground when `ground[k]`. */
export interface LifeWalk {
  kind: "walk"
  from: number
  to: number
  pts: Vec3[]
  times: number[]
  ground: boolean[]
  /** Something carried in the arms on the way (catalog id: a basket of fish, a log). */
  carry?: string
}

export type LifeStep = LifeStay | LifeWalk

export interface LifePose extends SpotDoing {
  at: Vec3
  /** Radians about +y; 0 faces +z. */
  facing: number
  act: LifeAct
  indoors: boolean
  ground: boolean
  /** Walking: where the walk starts and ends (the spots or doors it goes from and to). */
  from?: Vec3
  to?: Vec3
  /** Walking: what is carried (a carry walk). */
  carry?: string
  /** At a stay: when it began (the loop's unit), for a routine's time into it. */
  since?: number
}

export interface Folk {
  id: number
  /** An NPC recipe id (data/npcs). */
  role: string
  /** Zone index of the place they live in. */
  zone: number
  /** Their day in hours, 0–24. */
  day: LifeStep[]
  /** The prop their work spot hands them (catalog id), if it names one. */
  prop?: string
}

/** Metres a second at walk speed. */
export const WALK_MPS = 1.2

/** The roles a place of each kind is lived in by, with their weights. */
export const PLACE_ROLES: Readonly<Record<ZoneKind, readonly [string, number][]>> = {
  town: [
    ["merchant", 3],
    ["smith", 2],
    ["tavern-keeper", 1],
    ["farmer", 2],
    ["guard", 1],
    ["night-watch", 1],
  ],
  harbour: [
    ["fisher", 3],
    ["merchant", 1],
  ],
  castle: [["guard", 1]],
  market: [
    ["merchant", 3],
    ["tavern-keeper", 1],
  ],
  farm: [["farmer", 1]],
  fishing: [
    ["fisher", 3],
    ["farmer", 1],
  ],
  mine: [
    ["miner", 3],
    ["smith", 1],
  ],
  lumber: [["lumberjack", 1]],
  monastery: [
    ["monk", 3],
    ["farmer", 1],
  ],
  camp: [
    ["guard", 2],
    ["archer", 2],
  ],
  hamlet: [["farmer", 1]],
}

/**
 * The people a scene brings to the place it stands in, beyond what the place's buildings hold: a
 * training arena its soldiers and knights, enough with the place's guards to fill its rings, dummies
 * and drill line by day.
 */
export const SCENE_FOLK: Readonly<Record<string, readonly [string, number][]>> = {
  "training-arena": [
    ["soldier", 13],
    ["knight", 3],
  ],
}

/** People a place holds: a couple, plus most of a person per building, capped. */
export const peopleFor = (kind: ZoneKind, buildings: number): number =>
  kind === "castle"
    ? // the Guildhall's garrison grows with it: posts, rounds, drill and the yard's work (curtain.ts, castleyard.ts)
      Math.min(12, 3 + buildings * 2)
    : kind === "camp"
      ? Math.min(8, 3 + buildings)
      : // a monastery keeps a few brothers however few its buildings: its cloister, graves and bell
        kind === "monastery"
        ? Math.max(5, Math.round(1.5 + buildings * 0.7))
        : Math.max(2, Math.min(36, Math.round(1.5 + buildings * 0.7)))

/** Where a stay is: a point on a node's tile, the way to face, on the ground or a deck; what it does there. */
export interface LifeSpot extends SpotDoing {
  node: number
  at: Vec3
  facing: number
  ground: boolean
}

const onDeck = (n: HexWalkNode) => n.kind === "bridge" || n.kind === "dock"
/** Heading (radians, 0 = +z) looking from a to b. */
const headingTo = (ax: number, az: number, bx: number, bz: number) => Math.atan2(bx - ax, bz - az)

/** Spot k of up to 6 round a node, `r` metres out, facing its centre (or `face`). */
export function spotAt(walk: HexWalk, node: number, k: number, r = 1.4, face?: number): LifeSpot {
  const n = walk.nodes[node]!
  if (r === 0) return { node, at: [n.x, n.y, n.z], facing: face ?? 0, ground: !onDeck(n) }
  const a = (k * Math.PI) / 3 + Math.PI / 6 + Math.floor(k / 6) * 0.5
  const rr = r * (1 + 0.25 * (Math.floor(k / 6) % 2))
  const x = n.x + Math.cos(a) * rr
  const z = n.z + Math.sin(a) * rr
  return { node, at: [x, n.y, z], facing: face ?? headingTo(x, z, n.x, n.z), ground: !onDeck(n) }
}

/** Metres along the walk graph from one node to another (straight across when no route joins them). */
function routeLength(walk: HexWalk, a: number, b: number): number {
  const path = walk.route(a, b) ?? [a, b]
  let m = 0
  for (let k = 1; k < path.length; k++) {
    const p = walk.nodes[path[k - 1]!]!
    const q = walk.nodes[path[k]!]!
    m += Math.hypot(q.x - p.x, q.z - p.z)
  }
  return m
}

/** Hours a castle guard stands at a post between rounds of the wall. */
const ROUND_EVERY = 0.7

/** How far inside its face a doorway's spot is: someone going in is through the door when they vanish. */
const IN_DOOR = 0.2

/**
 * Home, at a door node: in the building's doorway (world doorways, from its mesh), facing in, so whoever
 * goes home walks up to the door and through it; the node itself when the building has none.
 */
export function doorSpot(walk: HexWalk, node: number, doorways: ReadonlyMap<number, HexDoorway>): LifeSpot {
  const n = walk.nodes[node]!
  const d = doorways.get(n.tile)
  if (!d) return spotAt(walk, node, 0, 0)
  const x = d.x - Math.sin(d.facing) * IN_DOOR
  const z = d.z - Math.cos(d.facing) * IN_DOOR
  return { node, at: [x, n.y, z], facing: d.facing + Math.PI, ground: true }
}

/** A step through a door: someone goes in (`enter`) or comes out at time `t` (the loop's unit), at `at`. */
export interface DoorPass {
  t: number
  at: Vec3
  enter: boolean
}

/**
 * The times a loop goes through a door (decisions.md "doors are dynamic"): a walk that ends in a stay
 * indoors goes in when it arrives, a stay indoors that a walk follows comes out when it ends (a loop's
 * last stay and its first step are one, across the loop's end). In time order.
 */
export function doorPasses(steps: readonly LifeStep[]): DoorPass[] {
  const out: DoorPass[] = []
  const n = steps.length
  for (let k = 0; k < n; k++) {
    const s = steps[k]!
    const next = steps[(k + 1) % n]!
    if (s.kind === "walk" && next.kind === "stay" && next.indoors)
      out.push({ t: s.to, at: next.at, enter: true })
    else if (s.kind === "stay" && s.indoors && next.kind === "walk")
      out.push({ t: k === n - 1 ? next.from : s.to, at: s.at, enter: false })
  }
  return out.sort((a, b) => a.t - b.t)
}

/** The way through the nodes of `path`, each point pushed `lane` metres to the walker's right. */
export function laneLine(walk: HexWalk, path: readonly number[], lane: number): Vec3[] {
  const p = path.map((i) => walk.nodes[i]!)
  return p.map((n, k) => {
    const a = p[Math.max(0, k - 1)]!
    const b = p[Math.min(p.length - 1, k + 1)]!
    const dx = b.x - a.x
    const dz = b.z - a.z
    const l = Math.hypot(dx, dz) || 1
    // to one side of the way (the same side for everyone), so people meeting pass each other
    return [n.x - (dz / l) * lane, n.y, n.z + (dx / l) * lane] as Vec3
  })
}

/** Blockers near a point, for keeping walks clear of them (TileFurniture's `solidsNear`). */
export type NearBlockers = (x: number, z: number, r: number) => readonly WalkBlocker[]

/** Builds a loop of steps in some time unit (hours for a day, seconds for an agent). */
export class LoopBuilder {
  readonly steps: LifeStep[] = []
  /** Short trips walked already (`direct`), by their ends: walked again the same way. */
  private readonly trips = new Map<string, LifeWalk>()
  private here: LifeSpot
  private since: number
  private act: "work" | "idle"
  private indoors: boolean
  constructor(
    private readonly walk: HexWalk,
    /** Metres per time unit. */
    private readonly pace: number,
    private readonly lane: number,
    start: LifeSpot,
    as: { act: "work" | "idle"; indoors?: boolean },
    /** Blockers the walks keep clear of. */
    private readonly near?: NearBlockers,
    /** Look as far as it takes for a clean way round them (an agent's few walks). */
    private readonly thorough = false,
  ) {
    this.here = start
    this.since = 0
    this.act = as.act
    this.indoors = !!as.indoors
  }

  get spot(): LifeSpot {
    return this.here
  }

  /**
   * Stays where it is until `until`, then walks to `to` and stays there as `as`; returns the arrival time.
   * `carry`: something carried on the way (a carry walk); `direct`: a short way on one node is walked
   * straight (round the blockers), not by the node's middle, and the same trip again the same way.
   */
  go(
    until: number,
    to: LifeSpot,
    as: { act: "work" | "idle"; indoors?: boolean },
    how: { carry?: string; direct?: boolean } = {},
  ): number {
    const leave = Math.max(until, this.since)
    this.flush(leave)
    let t = leave
    if (to.node !== this.here.node || to.at[0] !== this.here.at[0] || to.at[2] !== this.here.at[2]) {
      const key = how.direct ? `${this.here.at.join()}>${to.at.join()}` : ""
      const same = key ? this.trips.get(key) : undefined
      if (same) {
        // the same short trip again (a woodcutter's to the pile): its way, moved in time
        const times = same.times.map((x) => x - same.from + leave)
        t = times.at(-1)!
        const again: LifeWalk = { ...same, from: leave, to: t, times }
        if (how.carry) again.carry = how.carry
        else delete again.carry
        this.steps.push(again)
        this.here = to
        this.since = t
        this.act = as.act
        this.indoors = !!as.indoors
        return t
      }
      const straight = !!how.direct && to.node === this.here.node
      const path = straight ? [to.node] : this.walk.route(this.here.node, to.node)
      const nodes = path ?? [this.here.node, to.node]
      const line = laneLine(this.walk, nodes, this.lane)
      const flags = nodes.map((i) => !onDeck(this.walk.nodes[i]!))
      let pts: Vec3[] = [this.here.at, ...line.slice(1, -1), to.at]
      if (nodes.length === 1 && !straight) pts.splice(1, 0, line[0]!)
      let ground: boolean[] = []
      for (let k = 1; k < pts.length; k++) {
        // a segment is on a deck when either end is
        const fa = flags[Math.min(flags.length - 1, k - 1)]!
        const fb = flags[Math.min(flags.length - 1, k)]!
        ground.push(fa && fb)
      }
      if (this.near)
        ({ pts, ground } = clearWay(pts, ground, this.near, {
          from: this.indoors,
          to: !!as.indoors,
          thorough: this.thorough,
        }))
      const times = [t]
      for (let k = 1; k < pts.length; k++) {
        const a = pts[k - 1]!
        const b = pts[k]!
        t += Math.hypot(b[0] - a[0], b[2] - a[2]) / this.pace
        times.push(t)
      }
      const step: LifeWalk = { kind: "walk", from: leave, to: t, pts, times, ground }
      if (key) this.trips.set(key, step)
      this.steps.push(how.carry ? { ...step, carry: how.carry } : step)
    }
    this.here = to
    this.since = t
    this.act = as.act
    this.indoors = !!as.indoors
    return t
  }

  /** Ends the loop at `end`: stays where it is until then. */
  close(end: number): LifeStep[] {
    this.flush(end)
    return this.steps
  }

  private flush(to: number) {
    if (to <= this.since) return
    const { clip, prop, lift, drill, routine } = this.here
    this.steps.push({
      kind: "stay",
      from: this.since,
      to,
      at: this.here.at,
      facing: this.here.facing,
      act: this.act,
      ground: this.here.ground,
      ...(this.indoors ? { indoors: true } : {}),
      ...(clip ? { clip } : {}),
      ...(prop ? { prop } : {}),
      ...(lift ? { lift } : {}),
      ...(drill ? { drill } : {}),
      ...(routine && this.act === "work" ? { routine } : {}),
    })
    this.since = to
  }
}

/** Where someone is at time `t` in a loop of `period` (24 for a day). */
export function lifePose(steps: readonly LifeStep[], t: number, period: number): LifePose {
  const h = ((t % period) + period) % period
  let lo = 0
  let hi = steps.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (steps[mid]!.from <= h) lo = mid
    else hi = mid - 1
  }
  const s = steps[lo]!
  if (s.kind === "stay") {
    const pose: LifePose = {
      at: s.at,
      facing: s.facing,
      act: s.act,
      indoors: !!s.indoors,
      ground: s.ground,
      since: s.from,
    }
    if (s.clip) pose.clip = s.clip
    if (s.prop) pose.prop = s.prop
    if (s.lift) pose.lift = s.lift
    if (s.drill) pose.drill = s.drill
    if (s.routine) pose.routine = s.routine
    return pose
  }
  let k = 0
  while (k + 2 < s.times.length && s.times[k + 1]! <= h) k++
  const a = s.pts[k]!
  const b = s.pts[k + 1]!
  const t0 = s.times[k]!
  const t1 = s.times[k + 1]!
  const f = t1 > t0 ? Math.min(1, Math.max(0, (h - t0) / (t1 - t0))) : 0
  return {
    at: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f],
    facing: headingTo(a[0], a[2], b[0], b[2]),
    act: "walk",
    indoors: false,
    ground: s.ground[k] ?? true,
    from: s.pts[0]!,
    to: s.pts[s.pts.length - 1]!,
    ...(s.carry ? { carry: s.carry } : {}),
  }
}

/**
 * A hero's walk (plan-hud-events.md L1): from where it is (`from`: a stay, or `heroFrom` for a point
 * mid-walk) to a spot (a hero spot, the Guildhall's gathering), leaving at `leave` and walking `mps` in
 * the loop's time unit, on the walk graph and round the blockers `near` gives (LifePlaces `walkNear`). The
 * walk as a step `lifePose` samples; null when it is there already.
 */
export function heroRoute(
  walk: HexWalk,
  from: LifeSpot,
  to: LifeSpot,
  opts: { leave?: number; mps?: number; lane?: number; near?: NearBlockers } = {},
): LifeWalk | null {
  const b = new LoopBuilder(
    walk,
    opts.mps ?? WALK_MPS * 1.1,
    opts.lane ?? 0.3,
    from,
    { act: "idle" },
    opts.near,
    true,
  )
  b.go(opts.leave ?? 0, to, { act: "work" })
  const step = b.steps.find((s) => s.kind === "walk")
  return step?.kind === "walk" ? step : null
}

/**
 * A point as a start for `heroRoute` (a pose sampled mid-walk, when a hero is sent elsewhere): on the
 * walk node nearest it, its own tile's or a neighbour's first, else any. Facing kept.
 */
export function heroFrom(walk: HexWalk, h: HexIsland, at: Vec3, facing = 0): LifeSpot {
  const g = h.grid
  const { q, r } = hexAt(at[0] / HEX_TILE_SIZE, at[2] / HEX_TILE_SIZE)
  const i = g.index(q, r)
  const round = i < 0 ? [] : [i, ...g.neighbours(i).filter((j) => j >= 0)]
  let node = -1
  let best = Number.POSITIVE_INFINITY
  const consider = (c: number) => {
    if (c < 0) return
    const n = walk.nodes[c]!
    const d = Math.hypot(n.x - at[0], n.z - at[2])
    if (d < best - 1e-9) {
      best = d
      node = c
    }
  }
  for (const j of round) {
    consider(walk.at(j))
    consider(walk.door(j))
  }
  if (node < 0) for (let c = 0; c < walk.nodes.length; c++) consider(c)
  const n = node >= 0 ? walk.nodes[node] : undefined
  return { node, at, facing, ground: n ? !onDeck(n) : true }
}

const BUILT = new Set<string>(["building", "farmstead", "homestead", "landmark"])
const roadLike = (z: HexZones, i: number) => {
  const u = useOf(z, i)
  return u === "road" || u === "bridge" || u === "square"
}
const WATER_KINDS = new Set<string>(["sea", "shallows", "lake", "river"])
/** Land a path may cross onto (no water, no bare rock). */
const dry = (h: HexIsland, i: number) => {
  const k = kindOf(h, i)
  return !WATER_KINDS.has(k) && k !== "rock" && k !== "cliff"
}

/** The tiles people of a place work on that the roads do not reach (for hexWalk's `reach`). */
export function workTiles(h: HexIsland, z: HexZones): number[] {
  const g = h.grid
  const out = new Set<number>()
  for (const zone of z.zones) {
    const kinds = PLACE_ROLES[zone.kind].map(([r]) => r)
    for (const i of zone.tiles)
      for (const j of g.neighbours(i)) {
        if (j < 0) continue
        if (useOf(z, j) === "dock" && kinds.includes("fisher")) out.add(j)
        if (kindOf(h, j) === "forest" && zone.kind === "lumber") out.add(j)
      }
    if (kinds.includes("farmer")) for (const f of fieldsNear(h, z, zone.tile, 4)) out.add(f)
    // a place's tiles no street runs beside (a house up a lane, the castle's wards): a way out to them,
    // so the seats and work on them are reached; a building's way ends on the open ground before it
    for (const i of zone.tiles) {
      const nb = g.neighbours(i)
      if (nb.some((j) => j >= 0 && roadLike(z, j)) || roadLike(z, i)) continue
      const u = useOf(z, i)
      if (!BUILT.has(u)) {
        if (dry(h, i)) out.add(i)
        continue
      }
      // the open neighbour in front first (side 4, where an unturned building faces), then round
      for (const d of [4, 3, 5, 2, 0, 1]) {
        const j = nb[d]!
        if (j < 0 || BUILT.has(useOf(z, j)) || !dry(h, j) || Math.abs(h.level[j]! - h.level[i]!) > 1) continue
        out.add(j)
        break
      }
    }
  }
  // the campsite on the nature lake's shore: campers and fishers walk out to it
  for (let i = 0; i < g.size; i++) if (useOf(z, i) === "campsite") out.add(i)
  return [...out].sort((a, b) => a - b)
}

const steps = (h: HexIsland, a: number, b: number) => {
  const g = h.grid
  const dq = g.q[a]! - g.q[b]!
  const dr = g.r[a]! - g.r[b]!
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2
}

/** Field tiles within `r` steps of a tile, nearest first (at most 8). */
function fieldsNear(h: HexIsland, z: HexZones, tile: number, r: number): number[] {
  const out: number[] = []
  for (let i = 0; i < h.grid.size; i++) if (useOf(z, i) === "field" && steps(h, i, tile) <= r) out.push(i)
  return out.sort((a, b) => steps(h, a, tile) - steps(h, b, tile) || a - b).slice(0, 8)
}

/** Scenes people go out of their way to for a chat or a seat at midday and in the evening, and by how far (m). */
const GATHERING = new Set(["town-hall-plaza"])
const GATHER_PULL = 45

/** How much further from its place's heart a spot made for a role may be and still come before anyone's (m). */
const OWN_SPOT_REACH = 10

/** Roles whose work is from dawn to late morning (fishers on the quay): a spot open then will do. */
const DAWN_ROLES = new Set(["fisher"])

/** Seeded number in [0, 1). */
const rnd = (seed: number, a: number, b: number) => hash2(seed, a, b)

/** A meeting slot apart from the next one, metres; the first ring's gap round what it circles. */
const SLOT_GAP = 0.95
const RING_GAP = 0.8

/**
 * The island's spots, its places' meeting slots, and who has reserved which: one book for the
 * townsfolk and the agents, so nobody is given a spot or a slot someone else already holds.
 */
export interface LifePlaces {
  furniture: TileFurniture
  /** The node a spot is reached from (−1: unreachable). */
  nodeOf(spot: number): number
  /**
   * Whether a spot is left out for being walled in (collide.ts: buildings, walls and fences close it off
   * from the ground round it, e.g. a yard with no gap a body passes): nobody is sent there.
   */
  walled(spot: number): boolean
  /** A spot as a stay. */
  lifeSpot(spot: number): LifeSpot
  /** Reserved spots (indices into `furniture.spots`). */
  taken: Set<number>
  /** A zone's meeting slots round its square (or the Guildhall), nearest the middle first. */
  slots(zone: number): LifeSpot[]
  /** Reserved slots by zone (indices into `slots(zone)`). */
  slotTaken: Map<number, Map<number, number>>
  /**
   * The free spots near a zone a role may use, nearest its heart first (kinds: work by default). With
   * `when` (day hours [from, to]) only spots open then (their `hours`) and not booked for any of it.
   */
  free(
    zone: number,
    role: string | null,
    kinds?: readonly PlacedSpot["kind"][],
    when?: readonly [number, number],
  ): number[]
  /** Every reachable spot near a zone, taken or not, nearest its heart first. */
  spotsOf(zone: number): readonly number[]
  /**
   * Work made up for a place's people its spots do not hold (planFolk gives it out): beside someone's
   * work, chores before a door, the place's open ground; a body's room from every spot, slot and other.
   * The heroes' pool keeps off it, as it does off every townsfolk's spot.
   */
  madeUp(zone: number): readonly MadeUp[]
  /** Where a woodcutter at a felling spot lays the logs (stands, facing the pile), if there is room. */
  pileOf(spot: number): LifeSpot | undefined
  /** Books a spot for part of the day (hours, `from` < `to`; may run past 24). */
  book(spot: number, from: number, to: number): void
  /** Reserves a slot of a zone for someone: the least used, first in order. */
  takeSlot(zone: number): LifeSpot | undefined
  /** The prefab standing on a tile (none: bare, or a scene's other part). */
  prefabOf(tile: number): string | undefined
  /** A duel spot's other side (its tile's spot of the same `pair`), −1 for none. */
  partner(spot: number): number
  /**
   * What a walk keeps clear of: the solids, and every place people stand a while (a spot, a slot round a
   * square), so nobody's way runs through someone standing at theirs.
   */
  walkNear(x: number, z: number, r: number): readonly WalkBlocker[]
  /**
   * A place's hero spots (heroes.ts): the pool set aside for the agents, new spots no townsfolk is ever
   * given (none of `furniture.spots`), so the townsfolk's days are the same with or without it. Empty
   * unless `lifePlaces` was asked for some (`heroSpots`); at the Guildhall, the gathering before its hall
   * (and `heroSpots.board()`, its notice board).
   */
  heroSpots: HeroPool
}

/** Work made up for someone (LifePlaces `madeUp`): where, whose work it is beside, the door it is before. */
export interface MadeUp {
  spot: LifeSpot
  /** Beside a spot made for these roles (anyone else there is a hand: the "help" routine). */
  roles?: readonly string[]
  /** Chores before the door of this tile. */
  door?: number
}

/** Made-up work keeps this far from every spot, slot and other made-up work, metres. */
const MADE_APART = 0.85
/** Made-up work a place keeps at most. */
const MADE_MAX = 10
/** Where chores are before a door, in its frame (x right, z out from it). */
const CHORES: readonly (readonly [number, number])[] = [
  [0.9, 1.2],
  [-0.9, 1.2],
  [0, 1.6],
  [1.4, 0.8],
  [-1.4, 0.8],
]

/** The room a person standing at a spot or a slot takes, as far as walks are concerned, metres. */
const STANDING_R = 0.3

/**
 * Whether a spot open `hours` (a window [from, to), wrapping past midnight when to < from, or several) is
 * open all of [a, b] within one of its windows.
 */
export function openFor(hours: SpotHours | undefined, a: number, b: number): boolean {
  if (!hours) return true
  return spotWindows(hours).some(([s, e]) => {
    const span = (((e - s) % 24) + 24) % 24 || 24
    const into = (((a - s) % 24) + 24) % 24
    return into + (b - a) <= span + 1e-9
  })
}

/**
 * The places of an island: its furniture, slots and the reservation book (empty). `heroSpots`: how many
 * hero spots each place sets aside for the agents (heroes.ts; at least two when asked for any, up to twice
 * as many at the Guildhall's gathering), worked out per place when first asked for.
 */
export function lifePlaces(
  h: HexIsland,
  z: HexZones,
  w: Pick<HexWorld, "tiles" | "pieces"> &
    Partial<Pick<HexWorld, "stairAt" | "stairs" | "bridges" | "doorways">>,
  walk: HexWalk,
  opts: { heroSpots?: number } = {},
): LifePlaces {
  const g = h.grid
  const furniture = tileFurniture(g, w)
  const tileOf = new Map(w.tiles.map((t) => [t.i, t]))
  const nodes = new Map<number, number>()
  /** Whether the straight way from a node to a spot crosses water (a lake, a river, the sea) off its docks and bridges. */
  const wet = (a: { x: number; z: number }, b: { x: number; z: number }): boolean => {
    const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.5)
    for (let k = 1; k < n; k++) {
      const x = a.x + ((b.x - a.x) * k) / n
      const zz = a.z + ((b.z - a.z) * k) / n
      const { q, r } = hexAt(x / HEX_TILE_SIZE, zz / HEX_TILE_SIZE)
      const i = g.index(q, r)
      if (i < 0) return true
      const u = useOf(z, i)
      // a quay's deck over the shallows is walked like a dock
      if (WATER_KINDS.has(kindOf(h, i)) && u !== "dock" && u !== "bridge" && w.stairAt?.(x, zz) == null)
        return true
    }
    return false
  }
  /** How many big blockers (a house, a well, a cart) the straight way from a node to a spot cuts through. */
  const inTheWay = (a: { x: number; z: number }, b: { x: number; z: number }): number => {
    const len = Math.hypot(b.x - a.x, b.z - a.z)
    if (len < 1e-6) return 0
    const ux = (b.x - a.x) / len
    const uz = (b.z - a.z) / len
    let n = 0
    for (const d of furniture.near((a.x + b.x) / 2, (a.z + b.z) / 2, len / 2 + 1)) {
      if (d.r < 0.6 || Math.hypot(b.x - d.x, b.z - d.z) < d.r || Math.hypot(a.x - d.x, a.z - d.z) < d.r)
        continue
      const t = (d.x - a.x) * ux + (d.z - a.z) * uz
      if (t > 0 && t < len && Math.abs((d.x - a.x) * -uz + (d.z - a.z) * ux) < d.r) n++
    }
    return n
  }
  const walled = new Set<number>()
  /** The buildings, walls and fences near a point (what walls a place in; props are stepped round). */
  const hardNear = (x: number, zz: number, r: number) =>
    furniture.solidsNear(x, zz, r).filter((o) => HARD(o.kind))
  /** Whether a wall, a building or a fence stands across the straight way from a node to a spot. */
  const cutOff = (a: { x: number; z: number }, b: { x: number; z: number }): boolean => {
    const len = Math.hypot(b.x - a.x, b.z - a.z)
    for (let k = 1; k < len / 0.2; k++) {
      const x = a.x + ((b.x - a.x) * k * 0.2) / len
      const zz = a.z + ((b.z - a.z) * k * 0.2) / len
      if (furniture.blocked(x, zz, 0.2, HARD)) return true
    }
    return false
  }
  const nodeOf = (spot: number): number => {
    let n = nodes.get(spot)
    if (n !== undefined) return n
    const s = furniture.spots[spot]!
    // its tile's node or door; else the nearest node or door two tiles round it (or round the tile it
    // stands over: a scene's spot out on its footprint), on that ground's level or a step off it
    n = walk.at(s.tile) >= 0 ? walk.at(s.tile) : walk.door(s.tile)
    if (n < 0) {
      const { q, r } = hexAt(s.x / HEX_TILE_SIZE, s.z / HEX_TILE_SIZE)
      const under = g.index(q, r)
      const level = h.level[under >= 0 ? under : s.tile]!
      const round = new Set<number>()
      for (const i of [s.tile, under]) {
        if (i < 0) continue
        round.add(i)
        for (const j of g.neighbours(i)) {
          if (j < 0) continue
          round.add(j)
          for (const k of g.neighbours(j)) if (k >= 0) round.add(k)
        }
      }
      let best = Infinity
      for (const j of round) {
        if (Math.abs(h.level[j]! - level) > 1) continue
        for (const c of [walk.at(j), walk.door(j)]) {
          if (c < 0) continue
          const node = walk.nodes[c]!
          const d = Math.hypot(node.x - s.x, node.z - s.z)
          if (d >= HEX_TILE_SIZE * 2.6 || wet(node, s)) continue
          // the nearest, a house or a well in the straight way counting as a few metres more
          const cost = d + 2.5 * inTheWay(node, s)
          if (cost < best - 1e-9) {
            best = cost
            n = c
          }
        }
      }
    }
    // a spot walled in (a seat in a closed yard, a post behind a gate too narrow to pass) is offered
    // to nobody
    if (n >= 0 && cutOff(walk.nodes[n]!, s) && walledIn(s.x, s.z, hardNear, 12, walk.nodes[n]!)) {
      walled.add(spot)
      n = -1
    }
    nodes.set(spot, n)
    return n
  }
  const lifeSpot = (spot: number): LifeSpot => {
    const s = furniture.spots[spot]!
    const node = walk.nodes[nodeOf(spot)]!
    const deck = useOf(z, s.tile) === "dock" || onDeck(node)
    const out: LifeSpot = { node: nodeOf(spot), at: [s.x, node.y, s.z], facing: s.facing, ground: !deck }
    if (s.clip) out.clip = s.clip
    if (s.prop) out.prop = s.prop
    // a deck's spot stands on the deck (its height is the node's); elsewhere `y` lifts off the ground
    if (s.y && !deck) out.lift = s.y
    const drill = s.drill ? drillAt(spot, s.drill) : undefined
    if (drill) out.drill = drill
    return out
  }
  // ---- drills: a duel's two sides found by their pair name on the tile ----
  const mates = new Map<number, number>()
  {
    const first = new Map<string, number>()
    for (const [k, s] of furniture.spots.entries()) {
      if (!s.pair) continue
      const key = `${s.tile}:${s.pair}`
      const other = first.get(key)
      if (other === undefined) first.set(key, k)
      else {
        mates.set(k, other)
        mates.set(other, k)
      }
    }
  }
  const partner = (spot: number) => mates.get(spot) ?? -1
  /** Where a spot's routine is on the shared clock: a pair's or a line's one offset, else its own. */
  const drillAt = (spot: number, id: string): DrillAt | undefined => {
    const d = DRILLS[id]
    if (!d) return undefined
    const s = furniture.spots[spot]!
    const off = (a: number, b: number) => rnd(h.spec.seed + 77, a, b) * d.period
    if (pairedDrill(id)) {
      const mate = partner(spot)
      // a duel with its other side left out (walled in, dropped): its solo
      if (mate < 0) return { id: d.solo ?? id, side: 0, at: off(spot, 1) }
      const pair = Math.min(spot, mate)
      // the tile's bouts on its clock (the spectators cheer on it), spread evenly over a bout
      const pairs = [
        ...new Set(
          furniture.on(s.tile).flatMap((k) => (furniture.spots[k]!.pair ? [furniture.spots[k]!.pair!] : [])),
        ),
      ].sort()
      const k = Math.max(0, pairs.indexOf(s.pair ?? ""))
      return {
        id,
        side: spot < mate ? 0 : 1,
        at: (off(s.tile, 3) + (k * d.period) / pairs.length) % d.period,
        pair,
      }
    }
    return { id, side: 0, at: d.sync === "tile" ? off(s.tile, 3) : off(spot, 4) }
  }
  const taken = new Set<number>()
  const near = (zi: number): number[] => {
    const zone = z.zones[zi]!
    const tiles = new Set<number>()
    for (const i of zone.tiles) {
      tiles.add(i)
      for (const j of g.neighbours(i)) if (j >= 0) tiles.add(j)
    }
    for (const f of fieldsNear(h, z, zone.tile, 4)) tiles.add(f)
    return [...tiles].flatMap((i) => furniture.on(i))
  }
  const nearCache = new Map<number, number[]>()
  const booked = new Map<number, [number, number][]>()
  const isBooked = (k: number, a: number, b: number) =>
    // a day's booking also blocks the same hours a day on (an evening running past midnight)
    (booked.get(k) ?? []).some(([s, e]) => [-24, 0, 24].some((d) => s + d < b && a < e + d))
  const book = (k: number, a: number, b: number) => {
    const list = booked.get(k)
    if (list) list.push([a, b])
    else booked.set(k, [[a, b]])
  }
  const spotsOf = (zi: number): number[] => {
    let list = nearCache.get(zi)
    if (!list) {
      const heart = walk.nodes[walk.hearts[zi]!]
      list = near(zi).filter((k) => nodeOf(k) >= 0)
      if (heart) {
        const d = (k: number) => Math.hypot(furniture.spots[k]!.x - heart.x, furniture.spots[k]!.z - heart.z)
        list.sort((a, b) => d(a) - d(b) || a - b)
      }
      nearCache.set(zi, list)
    }
    return list
  }
  const free = (
    zi: number,
    role: string | null,
    kinds: readonly PlacedSpot["kind"][] = ["work"],
    when?: readonly [number, number],
  ) => {
    return spotsOf(zi).filter((k) => {
      const s = furniture.spots[k]!
      if (taken.has(k) || !kinds.includes(s.kind)) return false
      if (when && (!openFor(s.hours, when[0], when[1]) || isBooked(k, when[0], when[1]))) return false
      return role === null || !s.roles || s.roles.includes(role)
    })
  }

  const slotCache = new Map<number, LifeSpot[]>()
  const slots = (zi: number): LifeSpot[] => {
    const have = slotCache.get(zi)
    if (have) return have
    const zone = z.zones[zi]!
    const heartNode = walk.hearts[zi]!
    const out: LifeSpot[] = []
    slotCache.set(zi, out)
    if (heartNode < 0) return out
    const heart = walk.nodes[heartNode]!
    const ht = tileOf.get(zone.tile)
    // round the well (or whatever stands on the square), else the square's middle
    const middle = furniture.near(heart.x, heart.z, HEX_TILE_SIZE * 0.9).sort((a, b) => b.r - a.r)[0]
    const cx = middle && middle.r > 0.5 ? middle.x : heart.x
    const cz = middle && middle.r > 0.5 ? middle.z : heart.z
    const r0 = (middle && middle.r > 0.5 ? middle.r : 0.4) + RING_GAP
    const top = ht?.top ?? heart.y
    const walkable = (x: number, zz: number): number => {
      const { q, r } = hexAt(x / HEX_TILE_SIZE, zz / HEX_TILE_SIZE)
      const tile = g.index(q, r)
      if (tile < 0) return -1
      const node = walk.at(tile)
      if (node < 0) return -1
      const n = walk.nodes[node]!
      if (n.kind !== "square" && n.kind !== "road") return -1
      if (Math.abs((tileOf.get(tile)?.top ?? n.y) - top) > 0.3) return -1
      return node
    }
    for (let ring = 0, r = r0; ring < 8 && out.length < 48; ring++, r += RING_GAP) {
      const n = Math.max(4, Math.floor((2 * Math.PI * r) / SLOT_GAP))
      const a0 = ring * 0.37
      for (let k = 0; k < n; k++) {
        const a = a0 + (k / n) * Math.PI * 2
        const x = cx + Math.cos(a) * r
        const zz = cz + Math.sin(a) * r
        const node = walkable(x, zz)
        if (node < 0) continue
        if (furniture.near(x, zz, 0.3).length || furniture.blocked(x, zz, 0.3)) continue
        // nobody's slot on someone's spot
        if (spotGrid().near(x, zz, 0).length) continue
        if (w.stairAt?.(x, zz) != null) continue
        if (out.some((s) => Math.hypot(s.at[0] - x, s.at[2] - zz) < SLOT_GAP * 0.9)) continue
        out.push({ node, at: [x, walk.nodes[node]!.y, zz], facing: headingTo(x, zz, cx, cz), ground: true })
      }
    }
    return out
  }
  let spots: SolidGrid | null = null
  /** Every spot as a disc as wide as a slot's room. */
  const spotGrid = () => {
    spots ??= new SolidGrid(furniture.spots.map((sp) => discSolid("blocker", sp.x, sp.z, SLOT_GAP * 0.9, 0)))
    return spots
  }
  const slotTaken = new Map<number, Map<number, number>>()
  const takeSlot = (zi: number): LifeSpot | undefined => {
    const list = slots(zi)
    if (!list.length) return undefined
    let used = slotTaken.get(zi)
    if (!used) {
      used = new Map()
      slotTaken.set(zi, used)
    }
    let best = 0
    for (let k = 1; k < list.length; k++) if ((used.get(k) ?? 0) < (used.get(best) ?? 0)) best = k
    used.set(best, (used.get(best) ?? 0) + 1)
    return list[best]
  }
  const prefabOf = (tile: number) => tileOf.get(tile)?.prefab ?? undefined
  let standing: SolidGrid | null = null
  const walkNear = (x: number, zz: number, r: number): readonly WalkBlocker[] => {
    if (!standing) {
      const discs: Solid[] = []
      for (const sp of furniture.spots)
        if (sp.kind !== "sleep") discs.push(discSolid("blocker", sp.x, sp.z, STANDING_R, 0))
      for (const zi of z.zones.keys())
        for (const sl of slots(zi)) discs.push(discSolid("blocker", sl.at[0], sl.at[2], STANDING_R, 0))
      for (const d of discs) d.soft = true
      standing = new SolidGrid(discs)
    }
    const a = furniture.solidsNear(x, zz, r)
    const b = standing.near(x, zz, r)
    return b.length ? [...a, ...b] : a
  }
  const isWalled = (spot: number) => {
    nodeOf(spot)
    return walled.has(spot)
  }
  // ---- made-up work and woodcutters' piles: worked out for the whole island at once, in zone order,
  // from the place alone (who will need it is planFolk's), so the heroes' pool keeps off them too ----
  let made: { byZone: Map<number, MadeUp[]>; piles: Map<number, LifeSpot> } | null = null
  const madeAll = () => {
    if (made) return made
    const pts: { x: number; z: number }[] = []
    const byZone = new Map<number, MadeUp[]>()
    const piles = new Map<number, LifeSpot>()
    made = { byZone, piles }
    /** Whether a body may stand at (x, z) a while: dry open ground on `level`, off every solid, spot and slot. */
    const roomAt = (
      x: number,
      zz: number,
      level: number,
      zi: number,
      slotsToo = true,
      apart = MADE_APART,
    ): boolean => {
      const { q, r } = hexAt(x / HEX_TILE_SIZE, zz / HEX_TILE_SIZE)
      const tile = g.index(q, r)
      if (tile < 0 || !dry(h, tile) || h.level[tile] !== level) return false
      const u = useOf(z, tile)
      if (u === "dock" || u === "bridge" || BUILT.has(u)) return false
      if (w.stairAt?.(x, zz) != null) return false
      if (furniture.blocked(x, zz, apart * 0.38)) return false
      const near = (px: number, pz: number) => Math.hypot(px - x, pz - zz) < apart
      for (const k of spotsOf(zi)) if (near(furniture.spots[k]!.x, furniture.spots[k]!.z)) return false
      if (slotsToo) for (const sl of slots(zi)) if (near(sl.at[0], sl.at[2])) return false
      for (const m of pts) if (near(m.x, m.z)) return false
      return true
    }
    // a woodcutter's pile behind each felling spot, where there is room (the pile half a metre on from
    // where they stand to lay a log on it)
    for (const [k, s] of furniture.spots.entries()) {
      if (s.clip !== "Chopping" || nodeOf(k) < 0) continue
      const zi = Math.max(0, (z.zoneOf[s.tile] ?? 1) - 1)
      const base = lifeSpot(k)
      if (!base.ground) continue
      const first = rnd(h.spec.seed + 31, k, 0) < 0.5 ? 1 : -1
      for (const [ox, oz, flip] of PILE_AT.flatMap(
        ([a, b]) =>
          [
            [a, b, first],
            [a, b, -first],
          ] as const,
      )) {
        const len = Math.hypot(ox, oz)
        const [px, pz] = spotFrame(s.x, s.z, s.facing, ox * flip, oz)
        if (!roomAt(px, pz, h.level[s.tile]!, zi, true, PILE_APART)) continue
        const f = (len - PILE_AHEAD) / len
        const [sx, sz] = spotFrame(s.x, s.z, s.facing, ox * flip * f, oz * f)
        if (furniture.blocked(sx, sz, 0.25)) continue
        pts.push({ x: px, z: pz }, { x: sx, z: sz })
        piles.set(k, {
          node: base.node,
          at: [sx, base.at[1], sz],
          facing: headingTo(sx, sz, px, pz),
          ground: true,
          routine: { id: "stack", seed: 0 },
        })
        break
      }
    }
    for (const [zi, zone] of z.zones.entries()) {
      const out: MadeUp[] = []
      byZone.set(zi, out)
      if (walk.hearts[zi]! < 0 || !zone.tiles.length || zone.kind === "castle") continue
      // as many as the place may lack: its people less its own work spots, and a couple more
      const roles = PLACE_ROLES[zone.kind].map(([r]) => r)
      const people =
        peopleFor(zone.kind, zone.buildings) +
        zone.tiles.reduce(
          (n, i) => n + (SCENE_FOLK[prefabOf(i) ?? ""] ?? []).reduce((a, [, c]) => a + c, 0),
          0,
        )
      const list = spotsOf(zi).filter((k) => {
        const s = furniture.spots[k]!
        return (
          (s.kind === "work" || s.kind === "stand") &&
          !s.drill &&
          (!s.roles || s.roles.some((r) => roles.includes(r)))
        )
      })
      // (the spots planFolk gives as work: work spots, and seats made for a role)
      const own = spotsOf(zi).filter((k) => {
        const s = furniture.spots[k]!
        return z.zoneOf[s.tile] === zi + 1 && (s.kind === "work" || (s.kind === "sit" && !!s.roles))
      }).length
      const want = Math.min(MADE_MAX, Math.max(0, people - own) + 4)
      const push = (m: MadeUp) => {
        pts.push({ x: m.spot.at[0], z: m.spot.at[2] })
        out.push(m)
      }
      // beside someone's work, on either hand or behind: the place's own roles' spots first
      for (const k of list) {
        if (out.length >= want) break
        const s = furniture.spots[k]!
        const base = lifeSpot(k)
        if (!base.ground || base.lift) continue
        for (const [ox, oz] of BESIDE) {
          const [x, zz] = spotFrame(s.x, s.z, s.facing, ox, oz)
          if (!roomAt(x, zz, h.level[s.tile]!, zi)) continue
          const spot: LifeSpot = { node: base.node, at: [x, base.at[1], zz], facing: s.facing, ground: true }
          if (s.clip) spot.clip = s.clip
          if (s.prop) spot.prop = s.prop
          push(s.roles ? { spot, roles: s.roles } : { spot })
          break
        }
      }
      // chores before a door of the place (a sweep, the firewood): a hand's work
      for (const i of zone.tiles) {
        if (out.length >= want) break
        const node = walk.door(i)
        const d = w.doorways?.find((dd) => dd.tile === i)
        if (node < 0 || !d) continue
        const level = h.level[i]!
        for (const [ox, oz] of CHORES) {
          const [x, zz] = spotFrame(d.x, d.z, d.facing, ox, oz)
          const { q, r } = hexAt(x / HEX_TILE_SIZE, zz / HEX_TILE_SIZE)
          const tile = g.index(q, r)
          if (tile < 0 || tile === i || h.level[tile] !== level || !roomAt(x, zz, level, zi)) continue
          const n = walk.nodes[node]!
          push({
            spot: {
              node,
              at: [x, n.y, zz],
              facing: d.facing + Math.PI,
              ground: true,
              routine: { id: "help", seed: 0 },
            },
            door: i,
          })
          break
        }
      }
      // the open ground of the place, or just off it on its level, by a node of its tiles (a second
      // time among its square's slots: a place of one bare square)
      for (const coded of [...zone.tiles, ...zone.tiles.map((t) => -1 - t)]) {
        if (out.length >= want) break
        const late = coded < 0
        const i = late ? -1 - coded : coded
        const node = walk.at(i) >= 0 ? walk.at(i) : walk.door(i)
        if (node < 0) continue
        const n = walk.nodes[node]!
        const round = [i, ...g.neighbours(i).filter((j) => j >= 0 && h.level[j] === h.level[i])]
        for (let k = 0; k < 12 * round.length && out.length < want; k++) {
          const j = round[Math.floor(k / 12)]!
          const [cx, cz] = hexCentre({ q: g.q[j]!, r: g.r[j]! })
          const ox = j === i ? n.x : cx * HEX_TILE_SIZE
          const oz = j === i ? n.z : cz * HEX_TILE_SIZE
          const a = ((k % 12) * Math.PI) / 3 + (k % 12 >= 6 ? Math.PI / 6 : 0)
          const rr = k % 12 >= 6 ? 2.1 : j === i ? 1.4 : 0.6
          const x = ox + Math.cos(a) * rr
          const zz = oz + Math.sin(a) * rr
          if (!roomAt(x, zz, h.level[i]!, zi, !late)) continue
          // facing away from the way, at whatever stands there
          push({
            spot: {
              node,
              at: [x, n.y, zz],
              facing: headingTo(n.x, n.z, x, zz),
              ground: !onDeck(n),
              routine: { id: "help", seed: 0 },
            },
          })
        }
      }
    }
    return made
  }
  const heroSpots = heroSpotPool(
    {
      h,
      z,
      w,
      walk,
      furniture,
      slots,
      stands: () => {
        const { byZone, piles } = madeAll()
        const extra = [...byZone.values()].flat().map((m) => ({ x: m.spot.at[0], z: m.spot.at[2] }))
        for (const p of piles.values()) extra.push({ x: p.at[0], z: p.at[2] })
        return [...folkStands(h, z, walk), ...extra]
      },
      home: guildhallZone(walk, z),
    },
    opts.heroSpots ?? 0,
  )
  return {
    furniture,
    nodeOf,
    walled: isWalled,
    lifeSpot,
    taken,
    slots,
    slotTaken,
    free,
    spotsOf,
    madeUp: (zi) => madeAll().byZone.get(zi) ?? [],
    pileOf: (spot) => madeAll().piles.get(spot),
    book,
    takeSlot,
    prefabOf,
    partner,
    walkNear,
    heroSpots,
  }
}
/** Where someone goes for a break: home, a seat, a stall's customer side, a neighbour's door, a square, the tavern. */
export type Outing = "home" | "sit" | "market" | "talk" | "square" | "tavern"

/**
 * Lunch, by weight: most eat out, spread over the place's seats, stalls and doorsteps; few at the well;
 * some at a canteen's garden (its seats open at noon too; a plain tavern's only in the evening).
 */
export const LUNCH: readonly [Outing, number][] = [
  ["sit", 0.22],
  ["market", 0.18],
  ["tavern", 0.2],
  ["square", 0.14],
  ["talk", 0.12],
  ["home", 0.14],
]
/** The evening, by weight: the tavern's garden first, then benches, doorsteps, home. */
export const EVENING: readonly [Outing, number][] = [
  ["tavern", 0.56],
  ["sit", 0.13],
  ["talk", 0.1],
  ["square", 0.06],
  ["home", 0.15],
]
/** People on one place's square at once at most (round its well); the rest go elsewhere. */
export const SQUARE_CAP = 5
/** How far (metres, heart to heart) people go to another place's seats or square; the tavern, further. */
const OUT_REACH = 55
const TAVERN_REACH = 110

/** Outings in a seeded order: drawn by weight one after another (the rest are the fallbacks). */
function outingOrder(
  choices: readonly [Outing, number][],
  r: (salt: number) => number,
  salt: number,
): Outing[] {
  const left = [...choices]
  const out: Outing[] = []
  for (let k = 0; left.length; k++) {
    let pick = r(salt + k) * left.reduce((s, [, w]) => s + w, 0)
    let at = left.length - 1
    for (const [i, [, w]] of left.entries()) {
      if (pick < w) {
        at = i
        break
      }
      pick -= w
    }
    out.push(left.splice(at, 1)[0]![0])
  }
  return out
}

/**
 * Everyone living on the island, their days laid out. `pace` is metres an hour of the day (a sped-up
 * day walks slower per hour so people walk at a natural speed on screen). `places` is the reservation
 * book to share with the agents (planned first, so their spots are already taken); a fresh one if left out.
 *
 * The day spreads people by hour and place: lunch on a bench, as a customer at a stall, at a
 * neighbour's door, on a square (at most SQUARE_CAP round any one well) or at home; the evening in the
 * tavern's garden (its seats open from five), on a bench, at a door or home. Every spot is booked only
 * for the hours it is used and only when its `hours` allow, so one bench serves lunch and the evening.
 *
 * Work (task A, routines.ts): everyone has some. At a spot they play its routine (a fisher's casts, a
 * miner's swings and throws); someone the place's spots do not hold is given work of their own (a castle
 * guard a post on the rounds, a hand beside someone at the same work, chores by their door). A
 * woodcutter carries a log to a pile behind them every CHOP_TRIP rounds, a fisher the full basket to a
 * market stall before lunch: carry walks (`LifeWalk.carry`). `secPerHour`: screen seconds to a day hour
 * (180 at SPEEDUP 20), what a routine's seconds are planned in.
 */
export function planFolk(
  h: HexIsland,
  z: HexZones,
  w: Pick<HexWorld, "tiles" | "pieces"> & Partial<Pick<HexWorld, "stairAt" | "doorways">>,
  walk: HexWalk,
  opts: { seed: number; pace: number; places?: LifePlaces; secPerHour?: number },
): Folk[] {
  const { seed, pace } = opts
  // screen seconds to a day hour (a routine runs on screen seconds: SPEEDUP 20 by default)
  const secPerHour = opts.secPerHour ?? 180
  const places = opts.places ?? lifePlaces(h, z, w, walk)
  const doorways = new Map((w.doorways ?? []).map((d) => [d.tile, d]))
  const near = places.walkNear
  const spots = places.furniture.spots
  const folk: Folk[] = []
  // the places round each place, nearest first (by heart): where people go out to
  const hearts = z.zones.map((_, i) => walk.nodes[walk.hearts[i]!])
  const around = (zi: number, reach: number): number[] => {
    const a = hearts[zi]
    if (!a) return [zi]
    const d = (j: number) => Math.hypot(hearts[j]!.x - a.x, hearts[j]!.z - a.z)
    return z.zones
      .map((_, j) => j)
      .filter((j) => hearts[j] && z.zones[j]!.tiles.length && d(j) <= reach)
      .sort((p, q) => d(p) - d(q) || p - q)
  }
  // people on each place's square, by meal
  const onSquare = new Map<string, number>()
  /** A free spot for an outing near `zi` open over [a, b], among the nearest few to (x, z); booked. */
  const outingSpot = (
    out: Exclude<Outing, "home" | "square">,
    zi: number,
    role: string,
    a: number,
    b: number,
    x: number,
    zz: number,
    pick: number,
  ): LifeSpot | undefined => {
    const kinds: PlacedSpot["kind"][] =
      out === "sit" ? ["sit"] : out === "talk" ? ["talk"] : out === "market" ? ["stand"] : ["sit", "talk"]
    const seen = new Set<number>()
    const found: number[] = []
    // the evening goes further for its tavern; a lunch break has no time to
    for (const zj of around(zi, out === "tavern" && a >= 16 ? TAVERN_REACH : OUT_REACH))
      for (const k of places.free(zj, role, kinds, [a, b])) {
        if (seen.has(k)) continue
        seen.add(k)
        const s = spots[k]!
        // a tavern's seats are the ones that open in the evening (a canteen's at lunch as well): a tavern
        // outing goes only to them, any other outing never does
        if ((out === "tavern") !== opensEvening(s.hours)) continue
        found.push(k)
      }
    if (!found.length) return undefined
    // a gathering place of their own (the town hall's plaza) draws its people from further off than a doorstep
    const d = (k: number) =>
      Math.hypot(spots[k]!.x - x, spots[k]!.z - zz) -
      (z.zoneOf[spots[k]!.tile] === zi + 1 && GATHERING.has(places.prefabOf(spots[k]!.tile) ?? "")
        ? GATHER_PULL
        : 0)
    found.sort((p, q) => d(p) - d(q) || p - q)
    // one of the nearest few, so neighbours do not all crowd the first bench
    const k = found[Math.floor(pick * Math.min(4, found.length))]!
    places.book(k, a, b)
    return places.lifeSpot(k)
  }
  /** A slot on a square near `zi` with room for one more at this meal. */
  const squareSlot = (zi: number, meal: string): LifeSpot | undefined => {
    for (const zj of around(zi, OUT_REACH)) {
      const key = `${zj}:${meal}`
      if ((onSquare.get(key) ?? 0) >= SQUARE_CAP || !places.slots(zj).length) continue
      onSquare.set(key, (onSquare.get(key) ?? 0) + 1)
      return places.takeSlot(zj)
    }
    return undefined
  }
  /** A castle's rounds (castleRounds), from a start of each guard's own. */
  const rounds = (zi: number, pick: number): LifeSpot[] => {
    const out = castleRounds(h, z, walk, zi)
    const k0 = Math.floor(pick * out.length)
    return [...out.slice(k0), ...out.slice(0, k0)]
  }
  // ---- work made for those the place's spots do not hold (lifePlaces `madeUp`) ----
  /** A castle's rounds points held as posts, by zone. */
  const posted = new Map<number, Set<number>>()
  /** Made-up work given out. */
  const given = new Set<MadeUp>()
  /**
   * Work for someone with no spot: a castle guard's post on the rounds; else made-up work of their place
   * (`LifePlaces.madeUp`): beside someone at their own work first, chores by their own door, else any.
   */
  const extraWork = (
    zi: number,
    role: string,
    pick: number,
    homeTile: number,
  ): { spot: LifeSpot; post?: boolean } | undefined => {
    const zone = z.zones[zi]!
    if (zone.kind === "castle" && (role === "guard" || role === "night-watch")) {
      const points = castleRounds(h, z, walk, zi)
      const used = posted.get(zi) ?? new Set<number>()
      posted.set(zi, used)
      // spread over the wall: from a start of their own, the next point no other post is beside (then any)
      for (let j = 0; j < points.length * 2; j++) {
        const k = (Math.floor(pick * points.length) + j) % points.length
        const beside = used.has((k + 1) % points.length) || used.has((k + points.length - 1) % points.length)
        if (used.has(k) || (j < points.length && beside)) continue
        used.add(k)
        const p = points[k]!
        // a post looks into the court, its back to the wall
        return { spot: { ...p, facing: p.facing + Math.PI }, post: true }
      }
    }
    // (the next place's when theirs is all given out)
    let left: MadeUp[] = []
    for (const zj of around(zi, OUT_REACH)) {
      left = places.madeUp(zj).filter((m) => !given.has(m))
      if (left.length) break
    }
    const m =
      left.find((c) => c.roles?.includes(role)) ??
      left.find((c) => c.door === homeTile) ??
      left.find((c) => c.door === undefined) ??
      left[0]
    if (!m) return undefined
    given.add(m)
    const spot: LifeSpot = { ...m.spot }
    // another's work: a hand at it rather than their routine
    if (m.roles && !m.roles.includes(role)) {
      delete spot.clip
      delete spot.prop
      spot.routine = { id: "help", seed: 0 }
    }
    return { spot }
  }
  /** A customer's place at a market stall near a place, free at `at` for a delivery (booked). */
  const stallFor = (zi: number, at: number, pick: number): LifeSpot | undefined => {
    const found: number[] = []
    for (const zj of around(zi, TAVERN_REACH))
      for (const k of places.free(zj, null, ["stand"], [at, at + 0.6]))
        if (/market/.test(places.prefabOf(spots[k]!.tile) ?? "") && !found.includes(k)) found.push(k)
    if (!found.length) return undefined
    const k = found[Math.floor(pick * Math.min(3, found.length))]!
    places.book(k, at, at + 0.6)
    return places.lifeSpot(k)
  }
  for (const [zi, zone] of z.zones.entries()) {
    const heart = walk.hearts[zi]!
    if (heart < 0 || !zone.tiles.length) continue
    const homes = zone.tiles.filter((i) => walk.door(i) >= 0).map((i) => walk.door(i))
    const roles = PLACE_ROLES[zone.kind]
    const total = roles.reduce((s, [, n]) => s + n, 0)
    const n = peopleFor(zone.kind, zone.buildings)
    // the people a scene of the place brings with it (a training arena's soldiers and knights)
    const extra = zone.tiles.flatMap((i) =>
      (SCENE_FOLK[places.prefabOf(i) ?? ""] ?? []).flatMap(([role, k]) => Array<string>(k).fill(role)),
    )
    for (let p = 0; p < n + extra.length; p++) {
      // roles in proportion to their weights, the first of each kind always present
      let pick = (p + 0.5) * (total / n)
      let wanted = extra[p - n] ?? roles[0]![0]
      for (const [r, wt] of p < n ? roles : []) {
        if (pick < wt) {
          wanted = r
          break
        }
        pick -= wt
      }
      const id = folk.length
      const r = (salt: number) => rnd(seed + 900 + salt, id, zi)
      const nightly = (role: string) => role === "night-watch" || (role === "guard" && r(5) < 0.4)
      // the hours they are at work (the night shift's run past midnight; fishers' from dawn to late morning)
      const shift = (role: string): [number, number] =>
        nightly(role) ? [18, 30] : DAWN_ROLES.has(role) ? [5.5, 11.5] : [9, 16]
      // their work spot: a free one open on their shift for the role, else for another role the place
      // has; none: no work
      // (a spot made for the role before one anyone may use a few steps nearer: a monk to the cloister
      // before the well)
      /** How far a spot is walked to from the place's heart, metres (its node by the walk graph, then straight). */
      const out = (k: number) => {
        const path = walk.route(heart, places.nodeOf(k))
        if (!path) return Infinity
        let m = 0
        for (let j = 1; j < path.length; j++) {
          const a = walk.nodes[path[j - 1]!]!
          const b = walk.nodes[path[j]!]!
          m += Math.hypot(b.x - a.x, b.z - a.z)
        }
        const n = walk.nodes[path.at(-1)!]!
        return m + Math.hypot(spots[k]!.x - n.x, spots[k]!.z - n.z)
      }
      const workFor = (rr: string): number | undefined => {
        // (a bench of a scene, made for a role, to watch from: last, once the rings and the line are full)
        const sits = (k: number) => (spots[k]!.kind === "sit" ? 1 : 0)
        const list = places
          .free(zi, rr, ["work", "sit"], shift(rr))
          .filter((k) => spots[k]!.kind === "work" || !!spots[k]!.roles)
          .sort((a, b) => sits(a) - sits(b))
        // a dawn role (a fisher) to a spot that opens at dawn for it first: the quay's edge, wherever it is
        if (DAWN_ROLES.has(rr)) {
          const dawn = list.find(
            (k) => spots[k]!.roles?.includes(rr) && (spotWindows(spots[k]!.hours)[0]?.[0] ?? 9) < 7,
          )
          if (dawn !== undefined) return dawn
        }
        // a duel's side whose other side is held already before any other: pairs fill two by two
        const mine = (k: number) => !!spots[k]!.roles?.includes(rr)
        const own =
          list.find((k) => mine(k) && places.taken.has(places.partner(k))) ?? list.find((k) => mine(k))
        return own !== undefined && list[0] !== undefined && out(own) - out(list[0]) < OWN_SPOT_REACH
          ? own
          : list[0]
      }
      let role = wanted
      let spot = workFor(role)
      for (const [rr] of roles) {
        if (spot !== undefined) break
        const other = workFor(rr)
        if (other !== undefined) {
          role = rr
          spot = other
        }
      }
      if (spot !== undefined) places.taken.add(spot)
      const night = nightly(role)
      // a duel's two sides keep one day between them (start, lunch and where, the evening), so the
      // partner is there whenever they are, and a pair is never left to shadow-box
      const mate = spot !== undefined && spots[spot]!.pair ? places.partner(spot) : -1
      const sr = (salt: number) =>
        mate >= 0 ? rnd(seed + 900 + salt, 100000 + Math.min(spot!, mate), zi) : r(salt)
      const homeNode = homes.length ? homes[Math.floor(r(1) * homes.length)]! : heart
      const homeSpot: LifeSpot = homes.length
        ? doorSpot(walk, homeNode, doorways)
        : spotAt(walk, heart, Math.floor(r(1) * 6), HOMELESS_R)
      const indoors = homes.length > 0
      // no spot of the place's left for anyone: work made for them (a castle guard's post on the
      // rounds, a hand beside someone at the same work, chores by their door)
      const made =
        spot === undefined
          ? extraWork(zi, role, r(19), homes.length ? walk.nodes[homeNode]!.tile : -1)
          : undefined
      const work =
        spot !== undefined ? places.lifeSpot(spot) : (made?.spot ?? places.takeSlot(zi) ?? homeSpot)
      const working = spot !== undefined || made !== undefined
      const workAct = working ? "work" : "idle"
      // the routine played at work (routines.ts), drawn by a seed of their own
      if (working && !work.drill && !work.routine) {
        const id = routineFor(
          role,
          spot !== undefined
            ? spots[spot]!
            : { kind: made?.post ? "stand" : "work", ...(work.clip ? { clip: work.clip } : {}) },
          spot !== undefined ? places.prefabOf(spots[spot]!.tile) : undefined,
          // (a monk's spot by a tower: the bell's)
          role === "monk" &&
            spot !== undefined &&
            w.pieces.some(
              (p) =>
                p.piece.includes("building-tower") &&
                Math.hypot(p.x - spots[spot]!.x, p.z - spots[spot]!.z) < BELL_REACH,
            ),
        )
        if (id) work.routine = { id, seed: Math.floor(r(21) * 2 ** 30) }
      } else if (work.routine) work.routine = { ...work.routine, seed: Math.floor(r(21) * 2 ** 30) }
      const open = spot !== undefined ? spotWindows(spots[spot]!.hours)[0] : undefined
      const lane = 0.25 + r(3) * 0.35
      const prop = work.prop
      /** Where an outing over [a, b] takes them (and whether indoors); the first of `order` that has room. */
      const outing = (order: Outing[], a: number, b: number, meal: string, salt: number) => {
        for (const out of order) {
          if (out === "home") {
            if (indoors) return { at: homeSpot, indoors: true }
            continue
          }
          const at =
            out === "square"
              ? squareSlot(zi, meal)
              : outingSpot(out, zi, role, a, b, work.at[0], work.at[2], r(salt))
          if (at) return { at, indoors: false }
        }
        return { at: indoors ? homeSpot : work, indoors }
      }
      if (night) {
        // the night shift: on watch from dusk to dawn, home to sleep in the morning, out in the afternoon
        const patrol = role === "night-watch" ? patrolSpots(walk, z, zi, r(6)) : [work]
        const b = new LoopBuilder(walk, pace * (0.9 + r(4) * 0.2), lane, work, { act: workAct }, near)
        let t = b.go(6.2 + r(7) * 0.6, homeSpot, { act: "idle", indoors })
        const out0 = 15.5 + r(8)
        const out1 = out0 + 1.5
        const away = outing(
          outingOrder(
            LUNCH.filter(([o]) => o !== "home"),
            r,
            40,
          ),
          out0,
          out1,
          "afternoon",
          50,
        )
        t = b.go(out0, away.at, { act: "idle", indoors: away.indoors })
        // back on watch when the outing's booking ends (a late arrival does not stay past it)
        t = b.go(out1, work, { act: workAct })
        // a round of the streets now and then until dawn
        for (let k = 0; t < 22 && patrol.length > 1; k++)
          t = b.go(t + 0.4, patrol[k % patrol.length]!, { act: "idle" })
        b.go(t + 0.2, work, { act: workAct })
        folk.push({ id, role, zone: zi, day: b.close(24), ...(prop ? { prop } : {}) })
        continue
      }
      const b = new LoopBuilder(
        walk,
        pace * (0.9 + sr(4) * 0.2),
        lane,
        homeSpot,
        { act: "idle", indoors },
        near,
      )
      // to work (not before their spot opens; a dawn spot at its opening), lunch out somewhere of their
      // own, back unless their spot has closed by then (a fisher's morning), the evening out
      const start =
        open && open[0] < 6 ? open[0] + 0.3 + sr(10) * 0.9 : Math.max(6 + sr(10) * 1.2, open?.[0] ?? 0)
      let t = b.go(start, work, { act: workAct })
      const close = open && open[1] > open[0] ? open[1] - 0.1 : 24
      // a castle guard at a post walks the wall now and then (rounds), back to the post between
      const post = (spot !== undefined && spots[spot]!.kind === "stand") || !!made?.post
      const walks = zone.kind === "castle" && role === "guard" && post ? rounds(zi, r(18)) : []
      const round = (until: number) => {
        for (let k = 0; walks.length > 1 && t + ROUND_EVERY + 1 < until; k += 2) {
          t = b.go(t + ROUND_EVERY, walks[k % walks.length]!, { act: "idle" })
          t = b.go(t + 0.05, walks[(k + 1) % walks.length]!, { act: "idle" })
          t = b.go(t + 0.05, work, { act: workAct })
        }
      }
      // a woodcutter carries a log to the pile every CHOP_TRIP rounds of blows (routines.ts)
      const pile = work.routine?.id === "chop" && spot !== undefined ? places.pileOf(spot) : undefined
      const chopH = work.routine ? cyclesSpan(work.routine, CHOP_TRIP) / secPerHour : 0
      const chop = (until: number) => {
        // (a trip there and back is a few metres: well inside 0.05 h)
        for (let k = 0; pile && k < 200 && t + chopH + 0.05 < until; k++) {
          t = b.go(t + chopH, pile, { act: "work" }, { carry: PROPS.log, direct: true })
          t = b.go(t + STACK_S / secPerHour, work, { act: workAct }, { direct: true })
        }
      }
      round(Math.min(11.2 + sr(11) * 1.5, close))
      const lunch0 = Math.max(t + 1, Math.min(11.2 + sr(11) * 1.5, close))
      chop(lunch0)
      const lunch1 = lunch0 + 0.8 + sr(12) * 0.5
      // a fisher's full basket to a stall on the market before lunch
      const stall = work.routine?.id === "fish" ? stallFor(zi, lunch0 - DELIVER_H, r(23)) : undefined
      if (stall) {
        stall.routine = { id: "deliver", seed: Math.floor(r(24) * 2 ** 30) }
        t = b.go(Math.max(t, lunch0 - DELIVER_H), stall, { act: "work" }, { carry: PROPS.basket })
      }
      const noon = outing(outingOrder(LUNCH, r, 20), lunch0, lunch1 + 0.4, "lunch", 30)
      t = b.go(stall ? Math.max(lunch0, t + 0.06) : lunch0, noon.at, { act: "idle", indoors: noon.indoors })
      // back to work (a late arrival from a long way off stays no longer than its seat was booked)
      if (close > lunch1 + 0.5) {
        t = b.go(Math.max(lunch1, Math.min(t + 0.3, lunch1 + 0.4)), work, { act: workAct })
        round(Math.min(16.5 + sr(13) * 1.2, close))
        chop(Math.min(16.5 + sr(13) * 1.2, close))
      }
      // (an hour's work at least once back, but never past the spot's closing)
      const eve0 = Math.max(Math.min(t + 1, close), Math.min(16.5 + sr(13) * 1.2, close))
      // the tavern keeps people late (lit by the lanterns); elsewhere home by dusk, a few later
      const order = outingOrder(EVENING, r, 60)
      const late = r(14) < 0.25 ? 21 + r(15) : 18.8 + r(16) * 1.2
      const tavernLate = 20.5 + r(17) * 2.5
      let eve: { at: LifeSpot; indoors: boolean } | undefined
      let eve1 = late
      for (const out of order) {
        if (out === "home") {
          if (!indoors) continue
          eve = { at: homeSpot, indoors }
          break
        }
        // talk spots close at eight: a chat by the door ends by then
        const end = out === "tavern" ? tavernLate : out === "talk" ? Math.min(late, 19.8) : late
        const got = outing([out], eve0, end, "evening", 70)
        if (got.at === homeSpot || got.at === work) continue
        eve = got
        eve1 = end
        break
      }
      eve ??= { at: homeSpot, indoors }
      t = b.go(eve0, eve.at, { act: "idle", indoors: eve.indoors })
      // home when the booking ends (one who got there late does not stay past it), and before midnight
      // however far the evening took them (the day loops at 24)
      if (!eve.indoors) {
        const back = (routeLength(walk, eve.at.node, homeSpot.node) * 1.15 + 2) / (pace * 0.9)
        t = b.go(Math.min(eve1, 23.8 - back), homeSpot, { act: "idle", indoors })
      }
      folk.push({ id, role, zone: zi, day: b.close(24), ...(prop ? { prop } : {}) })
    }
  }
  return folk
}

/**
 * A castle's rounds: points just inside its curtain wall (its walled court and yard tiles' nodes, a step
 * toward the wall), in order round the castle.
 */
function castleRounds(h: HexIsland, z: HexZones, walk: HexWalk, zi: number): LifeSpot[] {
  const zone = z.zones[zi]!
  const inZone = new Set(zone.tiles)
  const heart = walk.nodes[walk.hearts[zi]!]!
  const out: { spot: LifeSpot; a: number }[] = []
  for (const i of zone.tiles) {
    const n = walk.at(i)
    if (n < 0) continue
    const nb = h.grid.neighbours(i)
    const walled = [0, 1, 2, 3, 4, 5].filter((d) => nb[d]! < 0 || !inZone.has(nb[d]!))
    if (!walled.length) continue
    const node = walk.nodes[n]!
    // toward the middle of its walled sides, short of the wall
    let sx = 0
    let sz = 0
    for (const d of walled) {
      sx += Math.cos((Math.PI / 3) * d)
      sz -= Math.sin((Math.PI / 3) * d)
    }
    const l = Math.hypot(sx, sz) || 1
    const x = node.x + (sx / l) * 0.9
    const zz = node.z + (sz / l) * 0.9
    out.push({
      spot: { node: n, at: [x, node.y, zz], facing: Math.atan2(sx, sz), ground: true },
      a: Math.atan2(zz - heart.z, x - heart.x),
    })
  }
  out.sort((p, q) => p.a - q.a)
  return out.map((o) => o.spot)
}

/** Where a woodcutter's pile may go, in their spot's frame (x right, z ahead): behind them, to one side. */
const PILE_AT: readonly (readonly [number, number])[] = [
  [0.8, -1.3],
  [1.4, -0.5],
  [0, -1.5],
  [1.6, -1.2],
  [2, 0],
]
/** A pile keeps this far from every spot and slot, metres (woods are thick with felling spots). */
const PILE_APART = 0.6
/** How far before the pile a woodcutter stands to lay a log on it, metres. */
const PILE_AHEAD = 0.55
/** Seconds a log takes to lay on the pile (routines.ts "stack": one PickUp). */
const STACK_S = 1.4
/** A monk working this near a tower rings its bell, metres. */
const BELL_REACH = 1.6
/** Hours before lunch a fisher sets off with the basket to the market. */
const DELIVER_H = 0.35

/** Where a hand stands beside someone's work spot, in its frame (x right, z ahead): either hand, then behind. */
const BESIDE: readonly (readonly [number, number])[] = [
  [0.95, 0],
  [-0.95, 0],
  [0.9, -0.7],
  [-0.9, -0.7],
  [0, -1.1],
  [1.5, 0.2],
  [-1.5, 0.2],
]

/** Where a place with no doors puts its people's homes: round its heart (`planFolk`), 2.4 m out. */
const HOMELESS_R = 2.4

/**
 * Every point townsfolk stand at that is no spot and no slot (planFolk): the castles' rounds, and the
 * homes round the heart of a place with no doors. The hero spots keep off them too.
 */
function folkStands(h: HexIsland, z: HexZones, walk: HexWalk): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = []
  for (const [zi, zone] of z.zones.entries()) {
    const heart = walk.hearts[zi]!
    if (heart < 0 || !zone.tiles.length) continue
    if (zone.kind === "castle")
      for (const s of castleRounds(h, z, walk, zi)) out.push({ x: s.at[0], z: s.at[2] })
    if (!zone.tiles.some((i) => walk.door(i) >= 0))
      for (let k = 0; k < 6; k++) {
        const s = spotAt(walk, heart, k, HOMELESS_R)
        out.push({ x: s.at[0], z: s.at[2] })
      }
  }
  return out
}

/** A round of the town's streets for the night watch: a few road nodes out from the heart. */
function patrolSpots(walk: HexWalk, z: HexZones, zi: number, r: number): LifeSpot[] {
  const zone = z.zones[zi]!
  const nodes = zone.tiles.map((i) => walk.at(i)).filter((n) => n >= 0 && walk.nodes[n]!.kind === "road")
  if (nodes.length < 2) return []
  const heart = walk.nodes[walk.hearts[zi]!]!
  const angle = (n: number) => Math.atan2(walk.nodes[n]!.z - heart.z, walk.nodes[n]!.x - heart.x)
  const sorted = nodes.sort((a, b) => angle(a) - angle(b))
  const step = Math.max(1, Math.floor(sorted.length / 5))
  const out: LifeSpot[] = []
  for (let k = Math.floor(r * step); k < sorted.length; k += step) out.push(spotAt(walk, sorted[k]!, 0, 0))
  return out
}

/** An agent: who, what class of hero, the colour of its banner. */
export interface AgentSpec {
  id: string
  name: string
  /** KayKit adventurer: mage, knight, ranger, barbarian, rogue. */
  hero: string
  colour: string
}

/** One errand: go to the nearest place of this kind (or zone index), work there `work` seconds, come back. */
export interface AgentErrand {
  place: ZoneKind | number
  work: number
  /** Seconds idling at the Guildhall before setting off. */
  idle: number
  /**
   * A scene to work at (a knight hero sparring at the training arena): the place that has one, at one
   * of its spots (a duel's side first), wherever it landed; else the errand's place as usual.
   */
  scene?: string
}

/** The zone agents call home: the castle (the Guildhall), else the town. */
export function guildhallZone(walk: HexWalk, z: HexZones): number {
  const castle = z.zones.findIndex((zz, i) => zz.kind === "castle" && walk.hearts[i]! >= 0)
  if (castle >= 0) return castle
  return Math.max(
    0,
    z.zones.findIndex((zz) => zz.kind === "town"),
  )
}

/** Agents rest at least this far apart at the great hall, metres. */
const AGENTS_APART = 1.3
/** The castle's heart tile (from tier 3): where the agents rest between errands. */
export const GREAT_HALL = "great-hall"

/**
 * An agent's loop in seconds: idle at the Guildhall (a seat or talking place of the great hall's own,
 * else a slot round the castle's heart) and walk each errand
 * there and back, working at a free spot of the place (its role's first, then one anyone may use).
 * With `places` the spots and slots are reserved in that book (plan agents before the townsfolk);
 * without, rings round the hearts stand in. Returns the steps and the loop's length.
 */
export function agentLoop(
  walk: HexWalk,
  z: HexZones,
  errands: readonly AgentErrand[],
  opts: { slot: number; mps?: number; role?: string; places?: LifePlaces },
): { steps: LifeStep[]; period: number } {
  const mps = opts.mps ?? WALK_MPS * 1.1
  const { places } = opts
  const home = guildhallZone(walk, z)
  // in the great hall itself: a seat or a talking place of its own there (not the guards' posts), else
  // a slot round the heart
  // (one each, and none right beside another agent's: who leaves would brush past who stays)
  const spots = places?.furniture.spots
  const beside = (k: number) =>
    [...(places?.taken ?? [])].some(
      (o) =>
        places!.prefabOf(spots![o]!.tile) === GREAT_HALL &&
        Math.hypot(spots![o]!.x - spots![k]!.x, spots![o]!.z - spots![k]!.z) < AGENTS_APART,
    )
  const inHall = places
    ?.free(home, null, ["sit", "talk", "stand"])
    .find((k) => !spots![k]!.roles && places.prefabOf(spots![k]!.tile) === GREAT_HALL && !beside(k))
  if (inHall !== undefined) places!.taken.add(inHall)
  const hall =
    (inHall !== undefined ? places!.lifeSpot(inHall) : places?.takeSlot(home)) ??
    spotAt(walk, walk.hearts[home]!, opts.slot, 1.3)
  const b = new LoopBuilder(walk, mps, 0.3, hall, { act: "idle" }, places?.walkNear, true)
  let t = 0
  for (const [k, e] of errands.entries()) {
    const hasScene = (i: number) =>
      !!e.scene && !!places && z.zones[i]!.tiles.some((j) => places.prefabOf(j) === e.scene)
    let zi = typeof e.place === "number" ? e.place : -1
    if (zi < 0 && e.scene) zi = z.zones.findIndex((_, i) => walk.hearts[i]! >= 0 && hasScene(i))
    if (zi < 0 && typeof e.place !== "number")
      zi = z.zones.findIndex((zz, i) => zz.kind === e.place && walk.hearts[i]! >= 0)
    if (zi < 0 || walk.hearts[zi]! < 0) continue
    let station: LifeSpot | undefined
    if (places) {
      const atScene = e.scene
        ? places.free(zi, opts.role ?? null).filter((s) => places.prefabOf(spots![s]!.tile) === e.scene)
        : []
      const spot =
        atScene.find((s) => places.partner(s) >= 0) ??
        atScene[0] ??
        places.free(zi, opts.role ?? null)[0] ??
        places.free(zi, null, ["stand", "talk"])[0] ??
        places.free(zi, null)[0]
      if (spot !== undefined) {
        places.taken.add(spot)
        station = places.lifeSpot(spot)
      } else station = places.takeSlot(zi)
    }
    station ??= spotAt(walk, walk.hearts[zi]!, (opts.slot + k * 2 + 3) % 6, 1.5)
    t = b.go(t + e.idle, station, { act: "work" })
    t = b.go(t + e.work, hall, { act: "idle" })
  }
  const period = t + 4
  return { steps: b.close(period), period }
}
