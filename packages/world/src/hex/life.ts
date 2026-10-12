/**
 * Life on the hex island (pure; decisions.md "Hex plan go"): the townsfolk of every place and the
 * agents, each a loop of steps on the walk graph (walk.ts) that render samples by time.
 *
 * Townsfolk: a few per place, more the more it is built up, in the roles its kind needs (farmers on a
 * farm, miners at the mine, fishers on the docks, merchants at the market, guards at the castle and the
 * camp, monks at the monastery…). Each has a home (a door of their place), a work station (a spot at
 * the tile their work is on) and their place's square, and a day in hours: asleep indoors at night, to
 * work in the morning, the square at noon, work again, the square in the evening, home. Guards and the
 * night watch keep the night shift. The day loops at 24 h.
 *
 * Agents: heroes walking errands from the Guildhall square (the town's heart) to a place and back, a
 * loop in seconds built from a list of errands (scripted for now; repo events drive it later).
 */
import { hash2 } from "../geom/noise.ts"
import { type HexIsland, kindOf } from "./island.ts"
import type { HexWalk, HexWalkNode } from "./walk.ts"
import type { HexWorld } from "./world.ts"
import { type HexZones, useOf, type ZoneKind } from "./zones.ts"

export type LifeAct = "walk" | "work" | "idle"
export type Vec3 = [number, number, number]

/** Standing at one spot from `from` to `to`. */
export interface LifeStay {
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

export interface LifePose {
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

/** Where a stay is: a point on a node's tile, the way to face, on the ground or a deck. */
export interface LifeSpot {
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
      const pts: Vec3[] = [this.here.at, ...line.slice(1, -1), to.at]
      if (nodes.length === 1) pts.splice(1, 0, line[0]!)
      const ground: boolean[] = []
      const times = [t]
      for (let k = 1; k < pts.length; k++) {
        const a = pts[k - 1]!
        const b = pts[k]!
        t += Math.hypot(b[0] - a[0], b[2] - a[2]) / this.pace
        times.push(t)
        // a segment is on a deck when either end is
        const fa = flags[Math.min(flags.length - 1, k - 1)]!
        const fb = flags[Math.min(flags.length - 1, k)]!
        ground.push(fa && fb)
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
    this.steps.push({
      kind: "stay",
      from: this.since,
      to,
      at: this.here.at,
      facing: this.here.facing,
      act: this.act,
      ground: this.here.ground,
      ...(this.indoors ? { indoors: true } : {}),
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
  if (s.kind === "stay")
    return { at: s.at, facing: s.facing, act: s.act, indoors: !!s.indoors, ground: s.ground }
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

/** A role's work spots in a place, nearest the heart first. */
function workSpots(
  h: HexIsland,
  z: HexZones,
  w: Pick<HexWorld, "tiles">,
  walk: HexWalk,
  zi: number,
  role: string,
): LifeSpot[] {
  const zone = z.zones[zi]!
  const g = h.grid
  const heart = walk.hearts[zi]!
  const tileOf = new Map(w.tiles.map((t) => [t.i, t]))
  const ring = (node: number, n: number, r = 1.4) =>
    Array.from({ length: n }, (_, k) => spotAt(walk, node, k, r))
  const prefabDoors = (ids: readonly string[]) =>
    w.tiles
      .filter((t) => t.prefab && ids.includes(t.prefab) && z.zoneOf[t.i] === zi + 1 && walk.door(t.i) >= 0)
      .map((t) => {
        const d = walk.door(t.i)
        const n = walk.nodes[d]!
        // at the door, facing in
        return spotAt(walk, d, 0, 0, headingTo(n.x, n.z, t.x, t.z))
      })
  const tiles = (pick: (i: number) => boolean) =>
    zone.tiles.flatMap((i) => [...g.neighbours(i)].filter((j) => j >= 0 && pick(j)))
  switch (role) {
    case "fisher": {
      const docks = [...new Set(tiles((j) => useOf(z, j) === "dock" && walk.at(j) >= 0))]
      // at the dock's end, facing the sea (away from the land it hangs off)
      return docks.flatMap((j) => {
        const node = walk.at(j)
        const n = walk.nodes[node]!
        const land = zone.tiles.find((i) => [...g.neighbours(i)].includes(j))
        const lt = land !== undefined ? tileOf.get(land) : undefined
        const face = lt ? headingTo(lt.x, lt.z, n.x, n.z) : 0
        return [0, 1].map((k) => {
          const s = spotAt(walk, node, k * 3, 0.9, face)
          return { ...s, facing: face }
        })
      })
    }
    case "farmer": {
      const fields = fieldsNear(h, z, zone.tile, 4).filter((f) => walk.at(f) >= 0)
      if (fields.length) return fields.flatMap((f) => ring(walk.at(f), 3, 1.2))
      break
    }
    case "lumberjack": {
      const woods = [...new Set(tiles((j) => kindOf(h, j) === "forest" && walk.at(j) >= 0))]
      if (woods.length) return woods.flatMap((j) => ring(walk.at(j), 2, 1.3))
      break
    }
    case "merchant": {
      const stalls = zone.tiles.filter((i) => useOf(z, i) === "market" && walk.door(i) < 0)
      const spots = prefabDoors(["market"])
      for (const i of stalls) {
        // a stall tile is not on the graph: stand at the square's edge toward it
        const t = tileOf.get(i)
        const n = walk.nodes[heart]
        if (!t || !n) continue
        const f = 2.2 / Math.max(1e-6, Math.hypot(t.x - n.x, t.z - n.z))
        const at: Vec3 = [n.x + (t.x - n.x) * f, n.y, n.z + (t.z - n.z) * f]
        spots.push({ node: heart, at, facing: headingTo(n.x, n.z, t.x, t.z), ground: true })
      }
      if (spots.length) return spots
      break
    }
    case "smith": {
      const spots = prefabDoors(["smithy", "forge"])
      if (spots.length) return spots
      break
    }
    case "tavern-keeper": {
      const spots = prefabDoors(["tavern", "inn"])
      if (spots.length) return spots
      break
    }
  }
  return heart >= 0 ? ring(heart, 6, 1.6) : []
}

/** Seeded number in [0, 1). */
const rnd = (seed: number, a: number, b: number) => hash2(seed, a, b)

/**
 * Everyone living on the island, their days laid out. `pace` is metres an hour of the day (a sped-up
 * day walks slower per hour so people walk at a natural speed on screen).
 */
export function planFolk(
  h: HexIsland,
  z: HexZones,
  w: Pick<HexWorld, "tiles">,
  walk: HexWalk,
  opts: { seed: number; pace: number },
): Folk[] {
  const { seed, pace } = opts
  const folk: Folk[] = []
  const used = new Map<string, number>()
  const take = (spots: readonly LifeSpot[], salt: number): LifeSpot | undefined => {
    if (!spots.length) return undefined
    // the least used spot, ties by a seeded pick: nobody shares a spot until all are taken
    let best: LifeSpot | undefined
    let bn = Infinity
    const off = Math.floor(rnd(seed + 51, salt, 0) * spots.length)
    for (let k = 0; k < spots.length; k++) {
      const s = spots[(k + off) % spots.length]!
      const key = `${s.at[0].toFixed(2)},${s.at[2].toFixed(2)}`
      const n = used.get(key) ?? 0
      if (n < bn) {
        bn = n
        best = s
      }
    }
    const key = `${best!.at[0].toFixed(2)},${best!.at[2].toFixed(2)}`
    used.set(key, (used.get(key) ?? 0) + 1)
    return best
  }
  for (const [zi, zone] of z.zones.entries()) {
    const heart = walk.hearts[zi]!
    if (heart < 0 || !zone.tiles.length) continue
    const homes = zone.tiles.filter((i) => walk.door(i) >= 0).map((i) => walk.door(i))
    const roles = PLACE_ROLES[zone.kind]
    const total = roles.reduce((s, [, n]) => s + n, 0)
    const n = peopleFor(zone.kind, zone.buildings)
    const square = Array.from({ length: 18 }, (_, k) => spotAt(walk, heart, k, 2.1))
    const spotsOf = new Map<string, LifeSpot[]>()
    for (let p = 0; p < n; p++) {
      // roles in proportion to their weights, the first of each kind always present
      let pick = (p + 0.5) * (total / n)
      let role = roles[0]![0]
      for (const [r, wt] of roles) {
        if (pick < wt) {
          role = r
          break
        }
        pick -= wt
      }
      if (!spotsOf.has(role)) spotsOf.set(role, workSpots(h, z, w, walk, zi, role))
      const id = folk.length
      const r = (salt: number) => rnd(seed + 900 + salt, id, zi)
      const homeNode = homes.length ? homes[Math.floor(r(1) * homes.length)]! : heart
      const homeSpot: LifeSpot = homes.length
        ? spotAt(walk, homeNode, 0, 0)
        : spotAt(walk, heart, Math.floor(r(1) * 6), 2.4)
      const work = take(spotsOf.get(role)!, id) ?? homeSpot
      const meet = square[Math.floor(r(2) * square.length)]!
      const lane = 0.25 + r(3) * 0.35
      const indoors = homes.length > 0
      const night = role === "night-watch" || (role === "guard" && r(5) < 0.4)
      if (night) {
        // the night shift: on watch from dusk to dawn, home to sleep in the morning, the square after
        const patrol = role === "night-watch" ? patrolSpots(walk, z, zi, r(6)) : [work]
        const b = new LoopBuilder(walk, pace * (0.9 + r(4) * 0.2), lane, work, { act: "work" })
        let t = b.go(6.2 + r(7) * 0.6, homeSpot, { act: "idle", indoors })
        t = b.go(15.5 + r(8), meet, { act: "idle" })
        t = b.go(t + 1.5, work, { act: "work" })
        // a round of the streets now and then until dawn
        for (let k = 0; t < 22 && patrol.length > 1; k++)
          t = b.go(t + 0.4, patrol[k % patrol.length]!, { act: "idle" })
        b.go(t + 0.2, work, { act: "work" })
        folk.push({ id, role, zone: zi, day: b.close(24) })
        continue
      }
      const b = new LoopBuilder(walk, pace * (0.9 + r(4) * 0.2), lane, homeSpot, { act: "idle", indoors })
      let t = b.go(6 + r(10) * 1.2, work, { act: "work" })
      t = b.go(Math.max(t + 1, 11.7 + r(11) * 0.6), meet, { act: "idle" })
      t = b.go(Math.max(t + 0.3, 12.8 + r(12) * 0.5), work, { act: "work" })
      t = b.go(Math.max(t + 1, 16.5 + r(13) * 1.2), meet, { act: "idle" })
      // the evening on the square; a few stay out late (lit by the lanterns)
      const late = r(14) < 0.25 ? 21.5 + r(15) : 18.8 + r(16) * 1.6
      t = b.go(Math.max(t + 0.3, late), homeSpot, { act: "idle", indoors })
      folk.push({ id, role, zone: zi, day: b.close(24) })
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

/**
 * An agent's loop in seconds: idle at the Guildhall (the town's square) and walk each errand there and
 * back. Returns the steps and the loop's length.
 */
export function agentLoop(
  walk: HexWalk,
  z: HexZones,
  errands: readonly AgentErrand[],
  opts: { slot: number; mps?: number },
): { steps: LifeStep[]; period: number } {
  const mps = opts.mps ?? WALK_MPS * 1.1
  const town = Math.max(
    0,
    z.zones.findIndex((zz) => zz.kind === "town"),
  )
  const hall = spotAt(walk, walk.hearts[town]!, opts.slot, 1.3)
  const b = new LoopBuilder(walk, mps, 0.3, hall, { act: "idle" })
  let t = 0
  for (const [k, e] of errands.entries()) {
    const zi =
      typeof e.place === "number"
        ? e.place
        : z.zones.findIndex((zz, i) => zz.kind === e.place && walk.hearts[i]! >= 0)
    if (zi < 0 || walk.hearts[zi]! < 0) continue
    const station = spotAt(walk, walk.hearts[zi]!, (opts.slot + k * 2 + 3) % 6, 1.5)
    t = b.go(t + e.idle, station, { act: "work" })
    t = b.go(t + e.work, hall, { act: "idle" })
  }
  const period = t + 4
  return { steps: b.close(period), period }
}
