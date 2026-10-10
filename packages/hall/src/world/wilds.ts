import { DMath } from "./dmath.ts"
import FOREST from "./forest.json"
import { type Cell, cellToWorld, HEX_SCALE, MAP_FOR_TESTS, PIECES, SITES, toPlot } from "./lands.ts"
import { ROOM, type Spot } from "./layout.ts"
import { type Light, lightsOf, toSegment } from "./lights.ts"
import { handWorld, type Terrain, type World } from "./world.ts"

/**
 * The wilds (ADR 0007, Nature): character-scale trees, bushes, rocks and grass from the Forest
 * Nature Pack (forest.glb, drawn at 1×), so the island reads rich up close where adventurers walk:
 * along the roads, round the job sites, between the village houses and on the shore. The hex pack's
 * 5× canopy stays the interior forest mass. Placed from the map's data, never by hand (like
 * lights.ts): candidates are sampled round each anchor, jittered by a seeded hash of their position,
 * and kept only where they clear the roads, the walking approaches to the work posts, buildings and
 * other decor, water, the keep, the lights and each other. Only level open ground grows wilds.
 * Grown for a world (world/world.ts): the hand map's, or a repo island's (the keep at the origin as
 * on the hand map, but no yard building or graveyard to keep clear of; its districts' landmarks are
 * its sites).
 */

export type WildPiece = keyof typeof FOREST
export type WildKind = "tree" | "bush" | "rock" | "grass"

export interface Wild {
  piece: WildPiece
  kind: WildKind
  x: number
  /** Ground height to stand at: rocks sit a little into the turf instead of on it. */
  y: number
  z: number
  rot: number
  scale: number
  /**
   * Lowest quality that still draws it: 0 everywhere (trees, big bushes and rocks give the island
   * its shape), 1 from Medium, 2 from High (the small fill: grass, pebbles, little bushes).
   */
  detail: 0 | 1 | 2
  /** Radius it keeps clear round itself, world units (its canopy or footprint at its scale). */
  radius: number
}

/** Optional extra ground to keep clear: paths people walk (polylines) and spots things stand on. */
export interface KeepClear {
  paths?: readonly (readonly Spot[])[]
  spots?: readonly Spot[]
}

// ---- Clearance rules (world units, added to the wild's own radius) ---------------------------

/** Half a road's width: nothing grows on the road surface. */
export const ROAD_HALF = 2.6
/** Off a walked line that isn't a road (to a work post, a villager's round). */
const PATH_CLEARANCE = 1.2
/** Room round a work post to swing an axe. */
const POST_CLEARANCE = 2
/** Off a torch or lantern: no canopy over a flame, no bush hiding a lamp's foot. */
const LIGHT_CLEARANCE = 2.4
/** Off any other decor's footprint (fences, crates, hex trees), and more off a building's walls. */
const DECOR_CLEARANCE = 0.6
const BUILDING_CLEARANCE = 1.6
/**
 * From a water hex's centre: its edge is 5 away, and a coast tile's sand slopes down for ~3 more
 * (measured from hex_coast_A: level 3 units in, −0.5 at 2), so anything closer would float.
 */
export const WATER_CLEARANCE = 8
/** From a river hex's centre: its banks are level grass, so just off the hex will do. */
export const RIVER_CLEARANCE = 6
const KEEP_MARGIN = 2.5
/** Off the graveyard's fence (it dresses its own plot; its gate and lanterns stand in front). */
export const GRAVEYARD_CLEARANCE = 1.2
/** Neighbours may overlap a little (a bush at a trunk's foot), never stand inside each other. */
const SPACING = 0.8

/**
 * Ground wilds may grow on: meadow, light woods, village lots, site ground and the grass verges of
 * road hexes (the road surface itself is kept clear by ROAD_HALF). Level ground only.
 */
const GROUND = new Set([".", "f", "v", "V", "s", "="])

// ---- The pieces --------------------------------------------------------------------------

interface Kind {
  pieces: readonly WildPiece[]
  scale: readonly [min: number, max: number]
  /** Share of each piece's footprint it keeps clear (trees: canopy; the trunk is much smaller). */
  reach: number
}
const KINDS: Record<WildKind, Kind> = {
  tree: {
    pieces: ["Tree_1_A", "Tree_2_B", "Tree_3_A", "Tree_4_A", "Tree_4_B"],
    scale: [0.8, 1.1],
    reach: 0.8,
  },
  bush: {
    pieces: ["Bush_1_B", "Bush_1_C", "Bush_1_E", "Bush_2_B", "Bush_3_A", "Bush_4_D"],
    scale: [1, 1.5],
    reach: 1,
  },
  rock: { pieces: ["Rock_1_A", "Rock_1_D", "Rock_2_B", "Rock_2_C", "Rock_3_E"], scale: [0.8, 1.5], reach: 1 },
  grass: {
    pieces: ["Grass_1_B", "Grass_2_B"],
    scale: [1.2, 1.8],
    reach: 1,
  },
}
/** Dead trees belong to the rough places: the quarry and the wizard's hill. */
const BARE: WildPiece = "Tree_Bare_2_A"

/** A piece's footprint radius at scale 1: its widest horizontal reach from its origin. */
function footprint(piece: WildPiece): number {
  const { x0, z0, x1, z1 } = box(FOREST[piece])
  return Math.max(-x0, x1, -z0, z1)
}

/** A manifest bounding box's ground extent. */
function box({ min, max }: { min: number[]; max: number[] }) {
  const [x0 = 0, , z0 = 0] = min
  const [x1 = 0, , z1 = 0] = max
  return { x0, z0, x1, z1 }
}

/** Small enough to drop at lower quality. */
function detailOf(kind: WildKind, piece: WildPiece, radius: number): Wild["detail"] {
  if (kind === "tree" || piece === BARE) return 0
  if (kind === "grass") return 2
  return radius > 0.9 ? 0 : radius > 0.5 ? 1 : 2
}

// ---- Seeded jitter --------------------------------------------------------------------------

/** (x, z, salt) → [0, 1), stable: the same spot always rolls the same. */
export function hash(x: number, z: number, salt: number): number {
  let h = Math.imul(Math.round(x * 16) | 0, 0x27d4eb2d) ^ Math.imul(Math.round(z * 16) | 0, 0x165667b1)
  h = Math.imul(h ^ salt ^ 0x9e3779b9, 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}
const pick = <T>(list: readonly T[], roll: number): T =>
  list[Math.floor(roll * list.length) % list.length] as T

// ---- The map, as obstacles ---------------------------------------------------------------------

/** A world's ground, as what the wilds must keep clear of. */
interface Ground {
  hand: boolean
  terrain: Terrain
  roads: (readonly [Spot, Spot])[]
  sea: Spot[]
  river: Spot[]
  posts: Spot[]
  /** How adventurers reach their posts: straight from the nearest road node. */
  approaches: (readonly [Spot, Spot])[]
  reserved: (readonly [Spot, Spot])[] // lanes sites reserve (a bridge's way), 7.5 off each side
  /** Every placed land piece (buildings, fences, crates, hex trees…) as a circle on the ground. */
  decor: { x: number; z: number; r: number }[]
  lights: readonly Light[]
}

function groundOf(world: World): Ground {
  const hand = world.kind === "hand"
  const { terrain } = world
  const { nodes: graph, edges } = world.roads
  const roads: (readonly [Spot, Spot])[] = edges.flatMap(([a, b]) => {
    const from = graph[a]
    const to = graph[b]
    return from && to ? [[from, to] as const] : []
  })
  // The keep's gate apron: the avenue's drawn stub from the gate up to the road hex nearest it
  // (the hand map's OUT; a repo island's avenue).
  const gate: Spot = [0, ROOM.depth / 2]
  let out: Spot | undefined
  for (const at of Object.values(graph))
    if (
      !out ||
      DMath.hypot(at[0] - gate[0], at[1] - gate[1]) < DMath.hypot(out[0] - gate[0], out[1] - gate[1])
    )
      out = at
  if (out) roads.push([gate, out])
  const nodes = Object.values(graph)
  const isSea = (w: Spot) => ["~", "o"].includes(terrain.at(MAP_FOR_TESTS.cellOf(w)))
  const posts: Spot[] = world.sites.flatMap((site) => site.posts.map((p) => [p[0], p[1]] as Spot))
  return {
    hand,
    terrain,
    roads,
    sea: world.island.water.filter(isSea),
    river: world.island.water.filter((w) => !isSea(w)),
    posts,
    reserved: world.sites.flatMap((site) => site.reserved ?? []),
    approaches: posts.map((post) => {
      let best = nodes[0] as Spot
      for (const node of nodes)
        if (
          DMath.hypot(node[0] - post[0], node[1] - post[1]) <
          DMath.hypot(best[0] - post[0], best[1] - post[1])
        )
          best = node
      return [best, post] as const
    }),
    decor: world.island.decor.map((d) => {
      const { x0, z0, x1, z1 } = box(PIECES[d.piece])
      const scale = HEX_SCALE * (d.scale ?? 1)
      const cx = ((x0 + x1) / 2) * scale
      const cz = ((z0 + z1) / 2) * scale
      const rot = d.rot ?? 0
      return {
        x: d.x + cx * DMath.cos(rot) + cz * DMath.sin(rot),
        z: d.z - cx * DMath.sin(rot) + cz * DMath.cos(rot),
        r:
          (Math.max(x1 - x0, z1 - z0) / 2) * scale +
          (d.piece.startsWith("building_") ? BUILDING_CLEARANCE : 0),
      }
    }),
    lights: lightsOf(world),
  }
}
/** The yard's growing building isn't in decor (scene/Island.tsx swaps it): a home at 1.5×. */
const YARD_RADIUS = 4.5

/** Is the ground at (x, z) level open land wilds may grow on? */
function grows(terrain: Terrain, x: number, z: number): boolean {
  const cell = MAP_FOR_TESTS.cellOf([x, z])
  if (!GROUND.has(terrain.at(cell)) || terrain.level(cell) !== 0) return false
  // A coast open to the sea on three or more sides is mostly beach, low under the grass line.
  return wetSides(terrain, cell) < 3
}

const OPEN_WATER = new Set(["~", "o"])
function wetSides(terrain: Terrain, [q, line]: Cell): number {
  return NEIGHBOURS.filter(([dq, dl]) => OPEN_WATER.has(terrain.at([q + dq, line + dl]))).length
}

function clear(
  ground: Ground,
  x: number,
  z: number,
  r: number,
  placed: readonly Wild[],
  extra: Required<KeepClear>,
): boolean {
  if (Math.abs(x) < ROOM.width / 2 + KEEP_MARGIN + r && Math.abs(z) < ROOM.depth / 2 + KEEP_MARGIN + r)
    return false
  // The footprint stands on growable ground all round, not just at its centre.
  const edge = r * 0.7
  if (
    ![
      [0, 0],
      [edge, 0],
      [-edge, 0],
      [0, edge],
      [0, -edge],
    ].every(([dx = 0, dz = 0]) => grows(ground.terrain, x + dx, z + dz))
  )
    return false
  if (ground.hand && toPlot(x, z) < GRAVEYARD_CLEARANCE + r) return false
  if (ground.sea.some((w) => DMath.hypot(w[0] - x, w[1] - z) < WATER_CLEARANCE + r)) return false
  if (ground.river.some((w) => DMath.hypot(w[0] - x, w[1] - z) < RIVER_CLEARANCE + r)) return false
  if (ground.roads.some(([a, b]) => toSegment([x, z], a, b) < ROAD_HALF + r)) return false
  if (ground.approaches.some(([a, b]) => toSegment([x, z], a, b) < PATH_CLEARANCE + r)) return false
  if (ground.reserved.some(([a, b]) => toSegment([x, z], a, b) < 7.5 + r)) return false
  if (ground.posts.some((p) => DMath.hypot(p[0] - x, p[1] - z) < POST_CLEARANCE + r)) return false
  if (ground.hand) {
    const yard = SITES.yard.at
    if (DMath.hypot(yard[0] - x, yard[1] - z) < YARD_RADIUS + r) return false
  }
  if (ground.decor.some((d) => DMath.hypot(d.x - x, d.z - z) < d.r + DECOR_CLEARANCE + r)) return false
  for (const light of ground.lights)
    if (DMath.hypot(light.placement.x - x, light.placement.z - z) < LIGHT_CLEARANCE + r) return false
  for (const path of extra.paths)
    for (let i = 1; i < path.length; i++)
      if (toSegment([x, z], path[i - 1] as Spot, path[i] as Spot) < PATH_CLEARANCE + r) return false
  if (extra.spots.some((s) => DMath.hypot(s[0] - x, s[1] - z) < POST_CLEARANCE + r)) return false
  return !placed.some((w) => DMath.hypot(w.x - x, w.z - z) < (w.radius + r) * SPACING)
}

// ---- Placement -------------------------------------------------------------------------------

/** What grows where: weights per kind for each kind of anchor. */
export type Mix = Partial<Record<WildKind, number>>
const CLUMP: Mix = { grass: 0.6, bush: 0.25, rock: 0.15 }
const TREELINE: Mix = { tree: 0.75, bush: 0.25 }
const ROADSIDE: Mix = { bush: 0.42, rock: 0.18, grass: 0.4 }
const VILLAGE: Mix = { tree: 0.15, bush: 0.45, grass: 0.4 }
const SHORE: Mix = { rock: 0.55, grass: 0.3, bush: 0.15 }

function kindOf(mix: Mix, roll: number): WildKind {
  let at = 0
  for (const [kind, weight] of Object.entries(mix) as [WildKind, number][]) {
    at += weight
    if (roll < at) return kind
  }
  return "grass"
}

/**
 * The hand map's wilds. Deterministic: the same map always grows the same wilds. `keep` adds ground
 * the scene knows must stay clear (villagers' rounds, trace piles).
 */
export function wilds(keep: KeepClear = {}): Wild[] {
  return wildsOf(handWorld(), keep)
}

/** A world's wilds: deterministic, as `wilds`. */
export function wildsOf(world: World, keep: KeepClear = {}): Wild[] {
  const ground = groundOf(world)
  const { terrain, roads } = ground
  const extra = { paths: keep.paths ?? [], spots: keep.spots ?? [] }
  const placed: Wild[] = []
  const tryAt = (x: number, z: number, mix: Mix, bare = false, companions = true): void => {
    const kind = kindOf(mix, hash(x, z, 1))
    const piece = kind === "tree" && bare ? BARE : pick(KINDS[kind].pieces, hash(x, z, 2))
    const [lo, hi] = KINDS[kind].scale
    const scale = round(lo + (hi - lo) * hash(x, z, 3))
    const radius = round(footprint(piece) * scale * (piece === BARE ? 1 : KINDS[kind].reach))
    // Nudge the candidate a little so rows never line up.
    const jx = round(x + (hash(x, z, 4) - 0.5) * 1.6)
    const jz = round(z + (hash(x, z, 5) - 0.5) * 1.6)
    if (!clear(ground, jx, jz, radius, placed, extra)) return
    placed.push({
      piece,
      kind,
      x: jx,
      y: kind === "rock" ? round(-0.08 * scale) : 0,
      z: jz,
      rot: round(hash(x, z, 6) * Math.PI * 2),
      scale,
      detail: detailOf(kind, piece, radius),
      radius,
    })
    // Things grow in clumps: a little fill (grass, a bush, a pebble) round the foot of each piece.
    if (!companions || kind === "grass") return
    for (let k = 0; k < 2; k++) {
      const angle = hash(jx, jz, 70 + k) * Math.PI * 2
      const reach = radius + 0.5 + hash(jx, jz, 80 + k) * 1.2
      tryAt(jx + DMath.cos(angle) * reach, jz + DMath.sin(angle) * reach, CLUMP, false, false)
    }
  }

  // Roadsides: every few steps along each road, either side, set back by a seeded amount — a
  // row of trees well back from the road first, then the verge's bushes, rocks and grass.
  const alongRoads = (step: number, near: number, far: number, skip: number, mix: Mix) => {
    for (const [a, b] of roads) {
      const dx = b[0] - a[0]
      const dz = b[1] - a[1]
      const length = DMath.hypot(dx, dz) || 1
      const [nx, nz] = [-dz / length, dx / length]
      for (let s = step / 2; s < length; s += step)
        for (const side of [1, -1]) {
          const x0 = a[0] + (dx / length) * s
          const z0 = a[1] + (dz / length) * s
          if (hash(x0, z0, 30 + side + step) < skip) continue
          const back = near + hash(x0, z0, 40 + side + step) * (far - near)
          tryAt(x0 + nx * side * back, z0 + nz * side * back, mix)
        }
    }
  }
  alongRoads(4.5, 5, 9, 0.2, TREELINE)

  // Then the job sites, so the work places get their dressing before the verges take the room.
  // Each site's mix, and whether its trees are dead ones, are the site registry's (the world's).
  for (const site of world.sites) {
    const { mix, barren = false } = site.wilds
    for (let ring = 6; ring <= 16; ring += 2.5)
      for (let k = 0; k < 14; k++) {
        const angle = (k / 14) * Math.PI * 2 + ring * 0.37
        tryAt(site.at[0] + DMath.cos(angle) * ring, site.at[1] + DMath.sin(angle) * ring, mix, barren)
      }
  }

  // The village: a few in every lot, between the houses.
  for (const key of terrain.cells()) {
    const [q, line] = key.split(",").map(Number) as [number, number]
    const char = terrain.at([q, line])
    if (char !== "v" && char !== "V") continue
    const [cx, cz] = cellToWorld([q, line])
    for (let k = 0; k < 9; k++) {
      const angle = hash(cx, cz, 10 + k) * Math.PI * 2
      const reach = 1.5 + hash(cx, cz, 20 + k) * 3.5
      tryAt(cx + DMath.cos(angle) * reach, cz + DMath.sin(angle) * reach, VILLAGE)
    }
  }

  alongRoads(2.4, ROAD_HALF + 0.6, ROAD_HALF + 4, 0.15, ROADSIDE)

  // The shore: land hexes beside the sea or the lake, on the dry side.
  for (const key of terrain.cells()) {
    const [q, line] = key.split(",").map(Number) as [number, number]
    if (!GROUND.has(terrain.at([q, line]))) continue
    if (wetSides(terrain, [q, line]) === 0) continue
    const [cx, cz] = cellToWorld([q, line])
    for (let k = 0; k < 6; k++) {
      const angle = hash(cx, cz, 50 + k) * Math.PI * 2
      const reach = hash(cx, cz, 60 + k) * 3
      tryAt(cx + DMath.cos(angle) * reach, cz + DMath.sin(angle) * reach, SHORE)
    }
  }
  return placed
}

const NEIGHBOURS = [
  [1, 1],
  [0, 2],
  [-1, 1],
  [-1, -1],
  [0, -2],
  [1, -1],
] as const
const round = (value: number): number => Math.round(value * 100) / 100
