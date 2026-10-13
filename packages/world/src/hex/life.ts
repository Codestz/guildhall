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
import { hexAt } from "./grid.ts"
import { type HexIsland, kindOf } from "./island.ts"
import { type PlacedSpot, type TileFurniture, tileFurniture } from "./spots.ts"
import { HEX_TILE_SIZE, opensEvening, type SpotHours, spotWindows } from "./tiles.ts"
import { clearWay, type HexWalk, type HexWalkNode } from "./walk.ts"
import type { HexWorld } from "./world.ts"
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
}

export type LifeStep = LifeStay | LifeWalk

export interface LifePose extends SpotDoing {
  at: Vec3
  /** Radians about +y; 0 faces +z. */
  facing: number
  act: LifeAct
  indoors: boolean
  ground: boolean
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

/** People a place holds: a couple, plus most of a person per building, capped. */
export const peopleFor = (kind: ZoneKind, buildings: number): number =>
  kind === "castle" || kind === "camp"
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

/** Blockers near a point, for keeping walks clear of them (TileFurniture's `near`). */
export type NearBlockers = TileFurniture["near"]

/** Builds a loop of steps in some time unit (hours for a day, seconds for an agent). */
export class LoopBuilder {
  readonly steps: LifeStep[] = []
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
  ) {
    this.here = start
    this.since = 0
    this.act = as.act
    this.indoors = !!as.indoors
  }

  get spot(): LifeSpot {
    return this.here
  }

  /** Stays where it is until `until`, then walks to `to` and stays there as `as`; returns the arrival time. */
  go(until: number, to: LifeSpot, as: { act: "work" | "idle"; indoors?: boolean }): number {
    const leave = Math.max(until, this.since)
    this.flush(leave)
    let t = leave
    if (to.node !== this.here.node || to.at[0] !== this.here.at[0] || to.at[2] !== this.here.at[2]) {
      const path = this.walk.route(this.here.node, to.node)
      const nodes = path ?? [this.here.node, to.node]
      const line = laneLine(this.walk, nodes, this.lane)
      const flags = nodes.map((i) => !onDeck(this.walk.nodes[i]!))
      let pts: Vec3[] = [this.here.at, ...line.slice(1, -1), to.at]
      if (nodes.length === 1) pts.splice(1, 0, line[0]!)
      let ground: boolean[] = []
      for (let k = 1; k < pts.length; k++) {
        // a segment is on a deck when either end is
        const fa = flags[Math.min(flags.length - 1, k - 1)]!
        const fb = flags[Math.min(flags.length - 1, k)]!
        ground.push(fa && fb)
      }
      if (this.near) ({ pts, ground } = clearWay(pts, ground, this.near))
      const times = [t]
      for (let k = 1; k < pts.length; k++) {
        const a = pts[k - 1]!
        const b = pts[k]!
        t += Math.hypot(b[0] - a[0], b[2] - a[2]) / this.pace
        times.push(t)
      }
      this.steps.push({ kind: "walk", from: leave, to: t, pts, times, ground })
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
    const { clip, prop, lift } = this.here
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
    const pose: LifePose = { at: s.at, facing: s.facing, act: s.act, indoors: !!s.indoors, ground: s.ground }
    if (s.clip) pose.clip = s.clip
    if (s.prop) pose.prop = s.prop
    if (s.lift) pose.lift = s.lift
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
  }
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
  /** Books a spot for part of the day (hours, `from` < `to`; may run past 24). */
  book(spot: number, from: number, to: number): void
  /** Reserves a slot of a zone for someone: the least used, first in order. */
  takeSlot(zone: number): LifeSpot | undefined
  /** The prefab standing on a tile (none: bare, or a scene's other part). */
  prefabOf(tile: number): string | undefined
}

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

/** The places of an island: its furniture, slots and the reservation book (empty). */
export function lifePlaces(
  h: HexIsland,
  z: HexZones,
  w: Pick<HexWorld, "tiles" | "pieces"> & Partial<Pick<HexWorld, "stairAt">>,
  walk: HexWalk,
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
    return out
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
  const free = (
    zi: number,
    role: string | null,
    kinds: readonly PlacedSpot["kind"][] = ["work"],
    when?: readonly [number, number],
  ) => {
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
    return list.filter((k) => {
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
        if (furniture.near(x, zz, 0.3).length) continue
        if (w.stairAt?.(x, zz) != null) continue
        if (out.some((s) => Math.hypot(s.at[0] - x, s.at[2] - zz) < SLOT_GAP * 0.9)) continue
        out.push({ node, at: [x, walk.nodes[node]!.y, zz], facing: headingTo(x, zz, cx, cz), ground: true })
      }
    }
    return out
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
  return { furniture, nodeOf, lifeSpot, taken, slots, slotTaken, free, book, takeSlot, prefabOf }
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
 */
export function planFolk(
  h: HexIsland,
  z: HexZones,
  w: Pick<HexWorld, "tiles" | "pieces"> & Partial<Pick<HexWorld, "stairAt">>,
  walk: HexWalk,
  opts: { seed: number; pace: number; places?: LifePlaces },
): Folk[] {
  const { seed, pace } = opts
  const places = opts.places ?? lifePlaces(h, z, w, walk)
  const near = places.furniture.near
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
  for (const [zi, zone] of z.zones.entries()) {
    const heart = walk.hearts[zi]!
    if (heart < 0 || !zone.tiles.length) continue
    const homes = zone.tiles.filter((i) => walk.door(i) >= 0).map((i) => walk.door(i))
    const roles = PLACE_ROLES[zone.kind]
    const total = roles.reduce((s, [, n]) => s + n, 0)
    const n = peopleFor(zone.kind, zone.buildings)
    for (let p = 0; p < n; p++) {
      // roles in proportion to their weights, the first of each kind always present
      let pick = (p + 0.5) * (total / n)
      let wanted = roles[0]![0]
      for (const [r, wt] of roles) {
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
        const list = places.free(zi, rr, ["work"], shift(rr))
        // a dawn role (a fisher) to a spot that opens at dawn for it first: the quay's edge, wherever it is
        if (DAWN_ROLES.has(rr)) {
          const dawn = list.find(
            (k) => spots[k]!.roles?.includes(rr) && (spotWindows(spots[k]!.hours)[0]?.[0] ?? 9) < 7,
          )
          if (dawn !== undefined) return dawn
        }
        const own = list.find((k) => spots[k]!.roles?.includes(rr))
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
      const homeNode = homes.length ? homes[Math.floor(r(1) * homes.length)]! : heart
      const homeSpot: LifeSpot = homes.length
        ? spotAt(walk, homeNode, 0, 0)
        : spotAt(walk, heart, Math.floor(r(1) * 6), 2.4)
      const indoors = homes.length > 0
      const work = spot !== undefined ? places.lifeSpot(spot) : (places.takeSlot(zi) ?? homeSpot)
      const workAct = spot !== undefined ? "work" : "idle"
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
        t = b.go(Math.max(t + 0.3, out1), work, { act: workAct })
        // a round of the streets now and then until dawn
        for (let k = 0; t < 22 && patrol.length > 1; k++)
          t = b.go(t + 0.4, patrol[k % patrol.length]!, { act: "idle" })
        b.go(t + 0.2, work, { act: workAct })
        folk.push({ id, role, zone: zi, day: b.close(24), ...(prop ? { prop } : {}) })
        continue
      }
      const b = new LoopBuilder(
        walk,
        pace * (0.9 + r(4) * 0.2),
        lane,
        homeSpot,
        { act: "idle", indoors },
        near,
      )
      // to work (not before their spot opens; a dawn spot at its opening), lunch out somewhere of their
      // own, back unless their spot has closed by then (a fisher's morning), the evening out
      const start =
        open && open[0] < 6 ? open[0] + 0.3 + r(10) * 0.9 : Math.max(6 + r(10) * 1.2, open?.[0] ?? 0)
      let t = b.go(start, work, { act: workAct })
      const close = open && open[1] > open[0] ? open[1] - 0.1 : 24
      const lunch0 = Math.max(t + 1, Math.min(11.2 + r(11) * 1.5, close))
      const lunch1 = lunch0 + 0.8 + r(12) * 0.5
      const noon = outing(outingOrder(LUNCH, r, 20), lunch0, lunch1 + 0.4, "lunch", 30)
      t = b.go(lunch0, noon.at, { act: "idle", indoors: noon.indoors })
      if (close > lunch1 + 0.5) t = b.go(Math.max(t + 0.3, lunch1), work, { act: workAct })
      const eve0 = Math.max(t + 1, Math.min(16.5 + r(13) * 1.2, close))
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
      if (!eve.indoors) t = b.go(Math.max(t + 0.3, eve1), homeSpot, { act: "idle", indoors })
      folk.push({ id, role, zone: zi, day: b.close(24), ...(prop ? { prop } : {}) })
    }
  }
  return folk
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
  const inHall = places
    ?.free(home, null, ["sit", "talk", "stand"])
    .find(
      (k) =>
        !places.furniture.spots[k]!.roles && places.prefabOf(places.furniture.spots[k]!.tile) === GREAT_HALL,
    )
  if (inHall !== undefined) places!.taken.add(inHall)
  const hall =
    (inHall !== undefined ? places!.lifeSpot(inHall) : places?.takeSlot(home)) ??
    spotAt(walk, walk.hearts[home]!, opts.slot, 1.3)
  const b = new LoopBuilder(walk, mps, 0.3, hall, { act: "idle" }, places?.furniture.near)
  let t = 0
  for (const [k, e] of errands.entries()) {
    const zi =
      typeof e.place === "number"
        ? e.place
        : z.zones.findIndex((zz, i) => zz.kind === e.place && walk.hearts[i]! >= 0)
    if (zi < 0 || walk.hearts[zi]! < 0) continue
    let station: LifeSpot | undefined
    if (places) {
      const spot =
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
