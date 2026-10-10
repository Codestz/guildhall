import { ROUNDS } from "../scene/life/rounds.ts"
import { activeWorld } from "./active.ts"
import { FORGE_BUCKETS, pilesOf, workTreesOf } from "./behaviours.ts"
import { DMath } from "./dmath.ts"
import { FURNITURE } from "./furniture.ts"
import KIT from "./kit.json"
import LANDS from "./lands.json"
import { cellToWorld, HEX_SCALE, MAP_FOR_TESTS as MAP, PIECES, SITES } from "./lands.ts"
import {
  HAND_INS,
  HEARTH,
  HEARTH_SEATS,
  hearthSeat,
  INFIRMARY,
  INFIRMARY_MATS,
  ROOM,
  type Spot,
  STATIONS,
  TAVERN,
} from "./layout.ts"
import { lightsOf, toSegment } from "./lights.ts"
import { WATER_CLEARANCE, wildsOf } from "./wilds.ts"
import { handWorld, type World } from "./world.ts"

/**
 * Where a body may stand: the island's and the keep's obstacles as footprints on the ground, dry
 * level land, and the keep's open floor. Read by the crowds (guild/crowd.ts, world/sharers.ts) and
 * by the tests that keep every standing spot and walk clear (test/support/clearance.ts).
 *
 * Built the first time it's asked for and kept, per world (the active one, world/active.ts, unless
 * one is given): a story that never crowds never pays for it.
 */

/** A body's radius: a spot must keep this far off everything. */
export const BODY = 0.35

export interface Obstacle {
  name: string
  /** Distance from (x, z) to the obstacle's footprint (0 inside). */
  distance(x: number, z: number): number
}

type Bounds = { min: readonly number[]; max: readonly number[] }

/** An oriented footprint: a piece's bounding box at its placement. */
export function box(name: string, bounds: Bounds, x: number, z: number, rot = 0, scale = 1): Obstacle {
  const [x0 = 0, , z0 = 0] = bounds.min
  const [x1 = 0, , z1 = 0] = bounds.max
  const c = DMath.cos(rot)
  const s = DMath.sin(rot)
  return {
    name,
    distance(px, pz) {
      const dx = px - x
      const dz = pz - z
      // World → the piece's own frame (inverse of x' = x c + z s, z' = −x s + z c).
      const lx = (dx * c - dz * s) / scale
      const lz = (dx * s + dz * c) / scale
      const ox = Math.max(x0 - lx, 0, lx - x1)
      const oz = Math.max(z0 - lz, 0, lz - z1)
      return DMath.hypot(ox, oz) * scale
    },
  }
}

export function circle(name: string, x: number, z: number, radius: number): Obstacle {
  return { name, distance: (px, pz) => Math.max(0, DMath.hypot(px - x, pz - z) - radius) }
}

/** The first obstacle `spot` stands too close to, if any. */
export function blocker(spot: Spot, obstacles: readonly Obstacle[], clearance = BODY): Obstacle | undefined {
  return obstacles.find((o) => o.distance(spot[0], spot[1]) < clearance)
}

/** Flat or underfoot pieces nobody walks round. */
const FLAT = /^(hex_|building_dirt|waterlily|waterplant|floor_wood|rug_|fence_|trees_[AB]_cut)/
/** Hex-scale tree clusters: their footprint box is the whole canopy; the trunks stand well inside it. */
const CANOPY = /^trees_/

const ISLAND = new WeakMap<World, Obstacle[]>()
/** Everything standing on the island: decor, the wilds as drawn, the yard's building, piles, lamps. */
export function islandObstacles(world: World = activeWorld() ?? handWorld()): readonly Obstacle[] {
  const known = ISLAND.get(world)
  if (known) return known
  const hand = world.kind === "hand"
  const piles = pilesOf(world)
  const out: Obstacle[] = []
  for (const piece of world.island.decor) {
    if (FLAT.test(piece.piece)) continue
    const bounds = PIECES[piece.piece]
    if (!bounds) continue
    const scale = HEX_SCALE * (piece.scale ?? 1) * (CANOPY.test(piece.piece) ? 0.6 : 1)
    out.push(box(piece.piece, bounds, piece.x, piece.z, piece.rot ?? 0, scale))
  }
  // The wilds as scene/nature/Wilds.tsx places them: off the villagers' rounds (the hand map's
  // village) and the piles.
  const keep = {
    paths: hand
      ? ROUNDS.map((round) => [round.door, ...round.stops, round.door].map((s): Spot => [s.x, s.z]))
      : [],
    spots: Object.values(piles).map((pile): Spot => [pile.x, pile.z]),
  }
  for (const wild of wildsOf(world, keep))
    if (wild.kind !== "grass") out.push(circle(`wild ${wild.kind}`, wild.x, wild.z, wild.radius * 0.7))
  // The yard's building at its widest stage (scene/Island.tsx draws it unturned at the hand map's yard).
  if (hand)
    out.push(
      box("yard building", LANDS.building_scaffolding, SITES.yard.at[0], SITES.yard.at[1], 0, HEX_SCALE),
    )
  out.push(circle("log pile", piles.logs.x, piles.logs.z, 1.9))
  out.push(circle("stone heap", piles.stones.x, piles.stones.z, 1.55))
  out.push(circle("fish rack", piles.fish.x, piles.fish.z, 1.2))
  out.push(circle("book stacks", piles.books.x, piles.books.z, 1.7))
  for (const tree of workTreesOf(world)) out.push(circle("work tree", tree[0], tree[1], 0.45))
  // Lanterns and torches (world/lights.ts), each on whatever it stands on.
  for (const { placement: p } of lightsOf(world)) {
    const bounds = (KIT as Record<string, Bounds>)[p.piece]
    if (bounds) out.push(box(`light ${p.piece}`, bounds, p.x, p.z, p.rot ?? 0, p.scale ?? 1))
  }
  ISLAND.set(world, out)
  return out
}

let KEEP: Obstacle[] | undefined
/** The keep's furniture on the floor, the hearth and the forge's quench buckets. */
export function keepObstacles(): readonly Obstacle[] {
  if (KEEP) return KEEP
  const out: Obstacle[] = []
  for (const piece of FURNITURE) {
    if (FLAT.test(piece.piece) || (piece.y ?? 0) > 0.5) continue
    const bounds = (KIT as Record<string, Bounds>)[piece.piece]
    if (bounds) out.push(box(piece.piece, bounds, piece.x, piece.z, piece.rot ?? 0, piece.scale ?? 1))
  }
  out.push(circle("hearth", HEARTH[0], HEARTH[1], 1.8))
  for (const [x, z] of FORGE_BUCKETS) out.push(box("forge bucket", KIT.bucket_metal, x, z, -0.4, 1))
  KEEP = out
  return out
}

// ---- Dry land ---------------------------------------------------------------------------------

/** Half the width of a river tile's channel, world units (measured from the pack's river tiles). */
const CHANNEL = 2.4
/** Raised ground (adventurers never leave y = 0), and the farm plots' crops. */
const OFF_LAND = new Set(["~", "o", "#", "w", "d"])

/**
 * Level dry land a body can stand on: not the sea, the lake or the beach sloping down to them, not
 * a river's channel (its banks are dry), not raised ground and not in the crops.
 */
export function onDryLand(spot: Spot, world: World = activeWorld() ?? handWorld()): boolean {
  const cell = MAP.cellOf(spot)
  const char = world.terrain.at(cell)
  if (OFF_LAND.has(char) || world.terrain.level(cell) !== 0) return false
  if (char === "r") {
    const centre = cellToWorld(cell)
    for (const dir of MAP.riverLinks.get(cell.join(",")) ?? []) {
      const angle = Math.PI / 6 + (dir * Math.PI) / 3
      const edge: Spot = [centre[0] + DMath.cos(angle) * 5, centre[1] + DMath.sin(angle) * 5]
      if (toSegment(spot, centre, edge) < CHANNEL + BODY) return false
    }
  }
  return !seaNear(spot, world)
}

const SEA = new WeakMap<World, Spot[]>()
/** Within a sea or lake hex's sloping beach (world/wilds.ts WATER_CLEARANCE). */
function seaNear(spot: Spot, world: World): boolean {
  let sea = SEA.get(world)
  if (!sea) {
    sea = world.island.water.filter((w) => ["~", "o"].includes(world.terrain.at(MAP.cellOf(w))))
    SEA.set(world, sea)
  }
  return sea.some((w) => DMath.hypot(w[0] - spot[0], w[1] - spot[1]) < WATER_CLEARANCE)
}

// ---- The keep's floor -------------------------------------------------------------------------

/** Lattice step, world units: two bodies (BODY 0.35) a step apart never touch. */
const STEP = 1
/** A body's radius plus a little: how far a spot keeps off furniture and the hearth. */
const ROOM_FOR_A_BODY = 0.45
/** Off any fixed post (stool, bed, station, hand-in): its owner keeps their place. */
const OFF_POSTS = 0.9

let POSTS: Spot[] | undefined
/** Every fixed place in the keep someone is sent to: stations, stools, beds, hand-ins, the hearth's. */
export function keepPosts(): readonly Spot[] {
  POSTS ??= [
    ...Object.values(STATIONS).flatMap((station) => station.posts),
    ...TAVERN,
    ...INFIRMARY,
    ...INFIRMARY_MATS,
    ...HAND_INS,
    ...Array.from({ length: HEARTH_SEATS }, (_, n) => hearthSeat(n)),
  ].map(([x, z]): Spot => [x, z])
  return POSTS
}

/** Open floor in the keep: a step in from the walls, off the hearth, the furniture and every post. */
export function onKeepFloor(spot: Spot): boolean {
  const [x, z] = spot
  if (Math.abs(x) > ROOM.width / 2 - STEP || Math.abs(z) > ROOM.depth / 2 - STEP) return false
  if (keepPosts().some((s) => DMath.hypot(s[0] - x, s[1] - z) < OFF_POSTS)) return false
  return !keepObstacles().some((o) => o.distance(x, z) < ROOM_FOR_A_BODY)
}

let FLOOR: Spot[] | undefined
/** The keep's open floor as a lattice, a step apart (guild/crowd.ts hands it out). */
export function keepFloor(): readonly Spot[] {
  if (FLOOR) return FLOOR
  FLOOR = []
  for (let x = -ROOM.width / 2 + STEP; x <= ROOM.width / 2 - STEP; x += STEP)
    for (let z = -ROOM.depth / 2 + STEP; z <= ROOM.depth / 2 - STEP; z += STEP)
      if (onKeepFloor([x, z])) FLOOR.push([x, z])
  return FLOOR
}
