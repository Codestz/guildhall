/**
 * The petitioners at the quay (PROTOCOL.md §7, V1's docket): every open issue brings someone to the
 * harbour's quay, who queues there until an issue closes, when the first in the queue is served and
 * walks off satisfied and the rest shuffle forward. Two pure parts:
 *
 *   petitionLane      where the queue stands on an island: a straight line of places on the quay's stone
 *                     deck, each clear of every solid, spot and hero spot, the front furthest from the
 *                     quay's door; the way in from that door to its back, and the way off from its front,
 *                     aside the queue and back in. Planned once, in the build worker, with the townsfolk.
 *   petitionerPoses   who stands where at a moment: from the queue's counts and times (sim
 *                     `Petitioners`: when each still waiting came, how many were served and when the
 *                     latest were) and nothing else, so a seek, a replay and a played clock agree.
 *
 * The queue is anonymous and first come first served: whichever issue closes, the one at the front is
 * the one served. Only `PETITION_CAP` stand in it; the rest wait unseen and come out of the door as
 * places free up. Each is drawn on a figure of its own (its arrival's ordinal, mod `PETITION_FIGURES`),
 * so a petitioner keeps its look while it moves up.
 */
import { walkwayAt } from "./collide.ts"
import { doorSpot, type LifePlaces, type LifePose, type LifeSpot, LoopBuilder, type Vec3 } from "./life.ts"
import { HEX_TILE_SIZE } from "./tiles.ts"
import type { HexWalk } from "./walk.ts"
import type { HexDoorway, HexWorld } from "./world.ts"

/** The most who stand in the queue. */
export const PETITION_CAP = 6
/** The most served who are still seen leaving at once. */
export const PETITION_LEAVING = 3
/** Figures the petitioners are drawn on: the queue's and the leavers'. */
export const PETITION_FIGURES = PETITION_CAP + PETITION_LEAVING
/** Metres between two in the queue. */
export const PETITION_GAP = 0.85
/** Their walking pace, metres a second (the townsfolk's: lifePlan LIFE_MPS). */
export const PETITION_MPS = 0.8
/** How long the one served stands and cheers before walking off, ms. */
export const CHEER_MS = 1800
/** The clip the one served cheers with. */
export const CHEER_CLIP = "Cheering"
/** The prefab whose quay they queue on. */
const QUAY = "harbour-quay"
/** A place keeps this far from every spot (someone working there), metres. */
const SPOT_KEEP = 0.8
/** A body this wide stands at a place. */
const BODY_R = 0.3
/** The ways in and off keep this far from the places they pass (a body's room), metres. */
const KEEP_R = 0.5
/** The grid a queue's front is looked for on (metres), and the ways it may run back from there. */
const GRID = 0.25
const ANGLES = 36
/** How the queue may turn from one place to the next, straightest first (radians). */
const TURNS = [0, 0.35, -0.35, 0.7, -0.7]
/** The grid the places' tests are kept on, metres. */
const MEMO = 0.1
/** The last stretch of a way before its door is indoors (through it). */
const IN_DOOR = 0.3
/** How far out of its door a way from it starts (the door spot faces in), metres. */
const OUT_DOOR = 0.9

/** What the queue reads (sim `Petitioners`: the same fields). */
export interface PetitionQueue {
  /** When each one still waiting came, first come first. */
  waiting: readonly number[]
  /** How many have been served in all. */
  served: number
  /** When the latest were served, oldest first. */
  lately: readonly number[]
}

export interface PetitionLane {
  /** The quay's tile. */
  tile: number
  /** The queue's places, the front first; each faces the way the queue looks (to its front and past it). */
  places: { at: Vec3; facing: number }[]
  /** The way in: from the quay's door (indoors) to the last place, as walked. */
  approach: Vec3[]
  /** The way off: from the front, aside the queue, back to the door and in. */
  exit: Vec3[]
}

const headingTo = (ax: number, az: number, bx: number, bz: number) => Math.atan2(bx - ax, bz - az)

/**
 * Where the queue stands on the island's harbour quay (the first `harbour-quay` scene), or null with
 * none, or none that fits even three. `cap` places at most, as many as fit.
 */
export function petitionLane(o: {
  world: Pick<HexWorld, "tiles" | "decks" | "heightAt">
  walk: HexWalk
  places: Pick<LifePlaces, "furniture" | "walkNear" | "heroNear">
  doorways: readonly HexDoorway[]
  cap?: number
}): PetitionLane | null {
  const { world, walk, places } = o
  const quay = world.tiles.filter((t) => t.prefab === QUAY).sort((a, b) => a.i - b.i)[0]
  if (!quay) return null
  const R = HEX_TILE_SIZE
  const cx = quay.x
  const cz = quay.z
  const doorNode = walk.door(quay.i)
  if (doorNode < 0) return null
  const door = doorSpot(walk, doorNode, new Map(o.doorways.map((d) => [d.tile, d])))
  /** Just out of the door: a way from it goes round the building from here, not through it. */
  const step: Vec3 = [
    door.at[0] - Math.sin(door.facing) * OUT_DOOR,
    door.at[1],
    door.at[2] - Math.cos(door.facing) * OUT_DOOR,
  ]
  const decks = world.decks.filter(
    (d) => Math.hypot((d.ax + d.bx) / 2 - cx, (d.az + d.bz) / 2 - cz) < R * 2.5,
  )
  const { furniture } = places
  const spots = furniture.spots.filter((s) => Math.hypot(s.x - cx, s.z - cz) < R * 3)
  const onDeck = (x: number, z: number) => decks.some((d) => walkwayAt(d, x, z) !== null)
  const onQuay = (x: number, z: number) =>
    Math.hypot(x - cx, z - cz) < R * 0.8 && Math.abs(world.heightAt(x, z) - quay.top) < 0.05
  /** A body stands here whole: on the deck or the quay's own ground, all round it. */
  const standable = (x: number, z: number, r: number) => {
    for (const [dx, dz] of [
      [0, 0],
      [r, 0],
      [-r, 0],
      [0, r],
      [0, -r],
    ] as const)
      if (!onDeck(x + dx, z + dz) && !onQuay(x + dx, z + dz)) return false
    return true
  }
  const clear = (x: number, z: number, r: number) =>
    !furniture.blocked(x, z, r) &&
    !spots.some((s) => Math.hypot(s.x - x, s.z - z) < SPOT_KEEP) &&
    !places.heroNear(x, z, r) &&
    Math.hypot(door.at[0] - x, door.at[2] - z) > 1.2
  /** A test memoised on a fine grid (the lines' points fall between the fronts' grid). */
  const memo = (test: (x: number, z: number) => boolean) => {
    const seen = new Map<number, boolean>()
    return (x: number, z: number) => {
      const ix = Math.round(x / MEMO)
      const iz = Math.round(z / MEMO)
      const key = (ix + 50_000) * 100_000 + iz + 50_000
      let v = seen.get(key)
      if (v === undefined) {
        v = test(ix * MEMO, iz * MEMO)
        seen.set(key, v)
      }
      return v
    }
  }
  const fits = memo((x, z) => standable(x, z, BODY_R) && clear(x, z, BODY_R))

  interface Candidate {
    at: [number, number][]
    bends: number
    score: number
  }
  const want = Math.max(3, o.cap ?? PETITION_CAP)
  const found: Candidate[] = []
  // fronts on a grid over the quay's stone and ground, every way back from each; the queue runs back a
  // gap at a time, as straight as it can and bending where it must (never folding back on itself)
  const reach = R * 2.2
  for (let gx = -reach; gx <= reach + 1e-6; gx += GRID)
    for (let gz = -reach; gz <= reach + 1e-6; gz += GRID) {
      const fx = cx + gx
      const fz = cz + gz
      if (!fits(fx, fz)) continue
      for (let k = 0; k < ANGLES; k++) {
        let ang = (k / ANGLES) * Math.PI * 2
        const at: [number, number][] = [[fx, fz]]
        let bends = 0
        while (at.length < want) {
          const [px, pz] = at[at.length - 1]!
          let next: [number, number] | null = null
          for (const turn of TURNS) {
            const a = ang + turn
            const x = px + Math.sin(a) * PETITION_GAP
            const z = pz + Math.cos(a) * PETITION_GAP
            if (!fits(x, z)) continue
            if (
              at.some(([qx, qz], q) => q < at.length - 1 && Math.hypot(qx - x, qz - z) < PETITION_GAP * 0.98)
            )
              continue
            next = [x, z]
            ang = a
            if (turn !== 0) bends++
            break
          }
          if (!next) break
          at.push(next)
        }
        if (at.length < 3) continue
        const [bx, bz] = at[at.length - 1]!
        // the longest queue; then its back nearest the door, the fewest bends, its front out over the water
        const score =
          at.length * 100 -
          Math.hypot(bx - door.at[0], bz - door.at[2]) -
          bends * 1.5 +
          (onDeck(fx, fz) ? 2 : 0)
        found.push({ at, bends, score })
      }
    }
  if (!found.length) return null
  found.sort((a, b) => b.score - a.score)
  /** The way between two points, round the solids and the queue's places `keep` (the door's ends indoors). */
  const way = (from: Vec3, to: Vec3, keep: readonly Vec3[]): Vec3[] => {
    const start: LifeSpot = { node: door.node, at: from, facing: 0, ground: true }
    const end: LifeSpot = { node: door.node, at: to, facing: 0, ground: true }
    const discs = keep.map((p) => ({ x: p[0], z: p[2], r: KEEP_R }))
    const near = (x: number, z: number, r: number) => [
      ...places.walkNear(x, z, r),
      ...discs.filter((d) => Math.hypot(d.x - x, d.z - z) < r + d.r),
    ]
    const b = new LoopBuilder(walk, 1, 0.3, start, { act: "idle" }, near, true)
    b.go(0, end, { act: "idle" }, { direct: true })
    const s = b.steps.find((w) => w.kind === "walk")
    return s?.kind === "walk" ? s.pts.map((p) => [p[0], p[1], p[2]] as Vec3) : [from, to]
  }
  /** Whether a way keeps a body's room off each of `keep`. */
  const keepsOff = (pts: readonly Vec3[], keep: readonly Vec3[]) => {
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1]!
      const b = pts[k]!
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / 0.2))
      for (let j = 0; j <= n; j++) {
        const x = a[0] + ((b[0] - a[0]) * j) / n
        const z = a[2] + ((b[2] - a[2]) * j) / n
        if (keep.some((p) => Math.hypot(p[0] - x, p[2] - z) < KEEP_R + 0.05)) return false
      }
    }
    return true
  }
  for (const c of found.slice(0, 12)) {
    const at: Vec3[] = c.at.map(([x, z]) => [x, quay.top, z])
    const back = at[at.length - 1]!
    const front = at[0]!
    const approach = [door.at, ...way(step, back, at.slice(0, -1))]
    if (!keepsOff(approach.slice(1), at.slice(0, -1))) continue
    const exit = [...way(front, step, at.slice(1)), door.at]
    if (!keepsOff(exit, at.slice(1))) continue
    return {
      tile: quay.i,
      // each faces the one ahead of it (the front, the way the queue looks)
      places: at.map((p, k) => {
        const ahead = at[Math.max(0, k - 1)]!
        const behind = at[Math.max(1, k)]!
        const [ax, az] = k === 0 ? [front[0] * 2 - behind[0], front[2] * 2 - behind[2]] : [ahead[0], ahead[2]]
        return { at: p, facing: headingTo(p[0], p[2], ax, az) }
      }),
      approach,
      exit,
    }
  }
  return null
}

/** A polyline measured: its points and the metres along it to each. */
interface Measured {
  pts: readonly Vec3[]
  at: number[]
  length: number
}

const measured = (pts: readonly Vec3[]): Measured => {
  const at = [0]
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1]!
    const b = pts[k]!
    at.push(at[k - 1]! + Math.hypot(b[0] - a[0], b[2] - a[2]))
  }
  return { pts, at, length: at[at.length - 1]! }
}

/** The point `s` metres along a polyline, and the way it runs there. */
function along(m: Measured, s: number): { at: Vec3; heading: number } {
  const { pts, at } = m
  const d = Math.max(0, Math.min(m.length, s))
  let k = 1
  while (k < pts.length - 1 && at[k]! < d) k++
  const a = pts[k - 1]!
  const b = pts[k] ?? a
  const span = at[k]! - at[k - 1]!
  const f = span > 0 ? (d - at[k - 1]!) / span : 0
  return {
    at: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f],
    heading: headingTo(a[0], a[2], b[0], b[2]),
  }
}

/** A lane's ways, measured once (petitionerPoses keeps them by lane). */
interface Tracks {
  /** Front to back along the places, then back out to the door: a waiting one's way, `s` metres from the front. */
  queue: Measured
  exit: Measured
}
const tracked = new WeakMap<PetitionLane, Tracks>()
function tracksOf(lane: PetitionLane): Tracks {
  let t = tracked.get(lane)
  if (!t) {
    const back = lane.approach.slice(0, -1).reverse()
    t = { queue: measured([...lane.places.map((p) => p.at), ...back]), exit: measured(lane.exit) }
    tracked.set(lane, t)
  }
  return t
}

/**
 * Who stands where at time `t` (ms on the queue's clock: a session's), one entry per figure
 * (`PETITION_FIGURES`): null where a figure is not out. The queue's `cap` (at most the lane's places)
 * stand in it; whoever comes beyond waits unseen until a place frees.
 */
export function petitionerPoses(
  lane: PetitionLane,
  q: PetitionQueue,
  t: number,
  cap = PETITION_CAP,
): (LifePose | null)[] {
  const out: (LifePose | null)[] = new Array(PETITION_FIGURES).fill(null)
  const n = Math.min(cap, lane.places.length, PETITION_CAP)
  if (n <= 0) return out
  const { queue, exit } = tracksOf(lane)
  const pace = PETITION_MPS / 1000
  const lately = q.lately.filter((x) => x <= t)
  const L = lately.length
  // the queue moves up once the one served has had its cheer and stepped off (the serving's time and
  // CHEER_MS): until then everyone keeps their place
  const moved = lately.map((x) => x + CHEER_MS)
  const M = moved.filter((x) => x <= t).length
  const pending = L - M
  /** When the m-th serving (1-based, all time) moved the queue up, −∞ when too long ago to be kept. */
  const movedAt = (m: number) => {
    const k = m - 1 - (q.served - L)
    return k >= 0 ? moved[k]! : Number.NEGATIVE_INFINITY
  }
  const facing = lane.places[0]!.facing
  /** When the last one came out of the door: the next steps out a gap behind it. */
  let stepped = Number.NEGATIVE_INFINITY
  // the waiting, front first, each at its place as it was before the servings still to move the queue
  for (let i = 0; i < Math.min(n - pending, q.waiting.length); i++) {
    const ordinal = q.served + i
    const m = ordinal - n + 1
    let came = Math.max(q.waiting[i]!, m <= 0 ? Number.NEGATIVE_INFINITY : movedAt(m))
    if (came > t) continue
    if (Number.isFinite(came)) {
      came = Math.max(came, stepped + PETITION_GAP / pace)
      stepped = came
    }
    // walk forward from where it was: out of the door when it came, else settled before the latest servings
    let s: number
    let from: number
    /** The first moving up it walks for (index into `moved`). */
    let k0: number
    if (Number.isFinite(came)) {
      s = queue.length
      from = came
      k0 = moved.filter((x) => x <= came).length
    } else if (M === 0) {
      s = (i + pending) * PETITION_GAP
      from = t
      k0 = 0
    } else {
      // where it stood before the first moving up kept, and its place after it
      s = Math.min(n - 1, i + L) * PETITION_GAP
      from = moved[0]!
      k0 = 1
    }
    let index = i + L - k0
    for (let k = k0; k < M; k++) {
      const x = moved[k]!
      s = Math.max(index * PETITION_GAP, s - (x - from) * pace)
      index--
      from = x
    }
    const target = index * PETITION_GAP
    s = Math.max(target, s - (t - from) * pace)
    const walking = s - target > 0.02
    const p = along(queue, s)
    out[ordinal % PETITION_FIGURES] = {
      at: p.at,
      facing: walking ? p.heading + Math.PI : lane.places[Math.min(index, n - 1)]!.facing,
      act: walking ? "walk" : "idle",
      indoors: s > queue.length - IN_DOOR,
      ground: true,
    }
  }
  // the latest served, cheering at the front and then walking off
  for (let j = 0; j < Math.min(PETITION_LEAVING, L); j++) {
    const at = lately[L - 1 - j]!
    const ordinal = q.served - 1 - j
    const e = (t - at - CHEER_MS) * pace
    if (e >= exit.length) continue
    if (e < 0) {
      out[ordinal % PETITION_FIGURES] = {
        at: lane.places[0]!.at,
        facing: facing + Math.PI,
        act: "idle",
        clip: CHEER_CLIP,
        indoors: false,
        ground: true,
      }
      continue
    }
    const p = along(exit, e)
    out[ordinal % PETITION_FIGURES] = {
      at: p.at,
      facing: p.heading,
      act: "walk",
      indoors: e > exit.length - IN_DOOR,
      ground: true,
    }
  }
  return out
}
