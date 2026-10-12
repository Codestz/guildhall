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
import { HEX_TILE_SIZE } from "./tiles.ts"
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
  }
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
  /** The free spots near a zone a role may use, nearest its heart first (kinds: work by default). */
  free(zone: number, role: string | null, kinds?: readonly PlacedSpot["kind"][]): number[]
  /** Reserves a slot of a zone for someone: the least used, first in order. */
  takeSlot(zone: number): LifeSpot | undefined
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
  const nodeOf = (spot: number): number => {
    let n = nodes.get(spot)
    if (n !== undefined) return n
    const s = furniture.spots[spot]!
    // its tile's node or door; else the nearest of its neighbours'
    n = walk.at(s.tile) >= 0 ? walk.at(s.tile) : walk.door(s.tile)
    if (n < 0) {
      let best = Infinity
      for (const j of g.neighbours(s.tile)) {
        if (j < 0) continue
        for (const c of [walk.at(j), walk.door(j)]) {
          if (c < 0) continue
          const d = Math.hypot(walk.nodes[c]!.x - s.x, walk.nodes[c]!.z - s.z)
          if (d < best && d < HEX_TILE_SIZE * 2.2) {
            best = d
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
  const free = (zi: number, role: string | null, kinds: readonly PlacedSpot["kind"][] = ["work"]) => {
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
  return { furniture, nodeOf, lifeSpot, taken, slots, slotTaken, free, takeSlot }
}

/**
 * Everyone living on the island, their days laid out. `pace` is metres an hour of the day (a sped-up
 * day walks slower per hour so people walk at a natural speed on screen). `places` is the reservation
 * book to share with the agents (planned first, so their spots are already taken); a fresh one if left out.
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
  const folk: Folk[] = []
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
      // their work spot: a free one for the role, else for another role the place has; none: no work
      let role = wanted
      let spot = places.free(zi, role)[0]
      for (const [r] of roles) {
        if (spot !== undefined) break
        const other = places.free(zi, r)[0]
        if (other !== undefined) {
          role = r
          spot = other
        }
      }
      if (spot !== undefined) places.taken.add(spot)
      const id = folk.length
      const r = (salt: number) => rnd(seed + 900 + salt, id, zi)
      const homeNode = homes.length ? homes[Math.floor(r(1) * homes.length)]! : heart
      const homeSpot: LifeSpot = homes.length
        ? spotAt(walk, homeNode, 0, 0)
        : spotAt(walk, heart, Math.floor(r(1) * 6), 2.4)
      const indoors = homes.length > 0
      const meet = places.takeSlot(zi) ?? homeSpot
      const work = spot !== undefined ? places.lifeSpot(spot) : meet
      const workAct = spot !== undefined ? "work" : "idle"
      // the evening on a bench now and then, if one near is free
      const seat = r(17) < 0.4 ? places.free(zi, role, ["sit"])[0] : undefined
      if (seat !== undefined) places.taken.add(seat)
      const evening = seat !== undefined ? places.lifeSpot(seat) : meet
      const lane = 0.25 + r(3) * 0.35
      const night = role === "night-watch" || (role === "guard" && r(5) < 0.4)
      const prop = work.prop
      if (night) {
        // the night shift: on watch from dusk to dawn, home to sleep in the morning, the square after
        const patrol = role === "night-watch" ? patrolSpots(walk, z, zi, r(6)) : [work]
        const b = new LoopBuilder(walk, pace * (0.9 + r(4) * 0.2), lane, work, { act: workAct }, near)
        let t = b.go(6.2 + r(7) * 0.6, homeSpot, { act: "idle", indoors })
        t = b.go(15.5 + r(8), evening, { act: "idle" })
        t = b.go(t + 1.5, work, { act: workAct })
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
      let t = b.go(6 + r(10) * 1.2, work, { act: workAct })
      t = b.go(Math.max(t + 1, 11.7 + r(11) * 0.6), meet, { act: "idle" })
      t = b.go(Math.max(t + 0.3, 12.8 + r(12) * 0.5), work, { act: workAct })
      t = b.go(Math.max(t + 1, 16.5 + r(13) * 1.2), evening, { act: "idle" })
      // the evening out; a few stay out late (lit by the lanterns)
      const late = r(14) < 0.25 ? 21.5 + r(15) : 18.8 + r(16) * 1.6
      t = b.go(Math.max(t + 0.3, late), homeSpot, { act: "idle", indoors })
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

/**
 * An agent's loop in seconds: idle at the Guildhall (a slot of its own there) and walk each errand
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
  const hall = places?.takeSlot(home) ?? spotAt(walk, walk.hearts[home]!, opts.slot, 1.3)
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
