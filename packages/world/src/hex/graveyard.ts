/**
 * The island's graveyard (plan .probe/v1events Task B): where a failed session's skeleton claws up,
 * keeps vigil and sinks again (sim story/worldEvents.ts `Grave`, render undead/). One an island, near
 * the town, on two open country tiles side by side on one level: the front one beside a road (its gate
 * on that road), the one behind it (`GRAVEYARD_FOOTPRINT`). KayKit's Halloween Bits dress it as V1's
 * did: an iron fence round its outer sides with an arch for its gate, a path from the gate to the crypt
 * at the back, eight graves either side of the path (a headstone on the outside, the dirt on the path's
 * side, so a riser stands facing the path), dead trees, lanterns, candles and bones.
 *
 * `GRAVES` are where the undead stand, in tile space, 0 nearest the gate (the order the graves fill);
 * `strikeSpot` is where a hero stands to strike one (on the path, facing it). The prefab is built from
 * them (`graveyardPrefab`), so the headstones and the graves always agree; data/tiles holds the same
 * prefab as a file (the tile composer's), checked against this one.
 *
 * Pure: `graveyardSite` picks its tiles from the zones (zones.ts calls it last, over the countryside),
 * `placeGraveyard` says where its graves are once the world has turned it to its road (world.ts).
 */
import { hash2 } from "../geom/noise.ts"
import type { HexGrid } from "./grid.ts"
import { HEX_TILE_SIZE, type TilePiece, type TilePrefab, worldSide } from "./tiles.ts"

/** The graveyard's scene prefab (data/tiles/graveyard-yard.json). */
export const GRAVEYARD_SCENE = "graveyard-yard"
/** The tile it also covers: the one behind its front (tile side 1, straight back). */
export const GRAVEYARD_FOOTPRINT: readonly number[] = [1]
/** Graves it holds (sim `SHOW_RULES.graves`). */
export const GRAVE_COUNT = 8

/** A grave in tile space: the middle of its dirt, and the way a riser on it faces (radians, 0 = +z). */
export interface GraveSpot {
  x: number
  z: number
  facing: number
}

const R = HEX_TILE_SIZE
/** Centre to centre of two neighbouring tiles. */
const STEP = R * Math.sqrt(3)
/** The back tile's centre (tile space). */
const BACK_Z = -STEP
/** The graves' column, either side of the path. */
const COLUMN = 1.05
/** A headstone stands this far out behind its dirt. */
const HEAD_OUT = 0.62
/** The rows along the path: three on the front tile, one on the back before the crypt. */
const ROWS = [1.3, 0, -1.3, -4.1]

/** Facing the path from the left column (+x) and from the right (−x). */
const TO_RIGHT = Math.PI / 2
const TO_LEFT = -Math.PI / 2

/** Where the undead stand, 0 nearest the gate: each row's left grave, then its right. */
export const GRAVES: readonly GraveSpot[] = ROWS.flatMap((z) => [
  { x: -COLUMN, z, facing: TO_RIGHT },
  { x: COLUMN, z, facing: TO_LEFT },
])

/** How far in front of a skeleton a hero stands to strike it, metres. */
export const STRIKE_REACH = 0.8

/** Where a hero stands to strike grave `g` (tile space): on the path before it, facing it. */
export function strikeSpot(g: GraveSpot): GraveSpot {
  return {
    x: g.x + Math.sin(g.facing) * STRIKE_REACH,
    z: g.z + Math.cos(g.facing) * STRIKE_REACH,
    facing: g.facing + Math.PI,
  }
}

const H = (id: string) => `kaykit-halloween/${id}`
const piece = (id: string, x: number, z: number, rot: number, scale: number, y?: number): TilePiece => ({
  piece: H(id),
  x: round(x),
  z: round(z),
  rot: round(rot),
  scale,
  pin: true,
  ...(y !== undefined ? { y } : {}),
})
const round = (v: number) => Math.round(v * 1000) / 1000

/** The headstones, grave by grave: a KayKit stone and its scale (all about a hero's height or under). */
const STONES: readonly [string, number][] = [
  ["grave-a", 0.42],
  ["gravestone", 0.48],
  ["grave-b", 0.4],
  ["gravemarker-a", 0.62],
  ["grave-a-destroyed", 0.42],
  ["grave-b", 0.4],
  ["gravemarker-b", 0.62],
  ["grave-a", 0.42],
]
/**
 * The grave's dirt: KayKit's open grave's rim, sunk so its top is just over the turf (it stands on its
 * pit's bottom as imported, and the pit is under the turf), and a mound of fresh earth in it.
 */
const DIRT_SCALE = 0.25
const RIM_TOP = 0.03
const EARTH = "kenney-graveyard/grave"
const EARTH_SCALE = 0.34
/** The fence: three lengths a side (its pieces 2.4 m as imported), a pillar at each corner. */
const FENCE_SCALE = 0.43
const FENCE_INSET = 0.12
/** The arch over the gate (4.22 m wide, 4.41 high as imported): nearly twice a hero. */
const ARCH_SCALE = 0.42
const CRYPT_Z = BACK_Z - 1.03
const CRYPT_SCALE = 0.36

/** The fence along the side of a hex centred at (cx, cz) through tile side `k`, inside it. */
function fenceSide(cx: number, cz: number, k: number, gate: boolean): TilePiece[] {
  const a = ((30 + 60 * k) * Math.PI) / 180
  const apothem = (R * Math.sqrt(3)) / 2 - FENCE_INSET
  const mx = cx + Math.cos(a) * apothem
  const mz = cz - Math.sin(a) * apothem
  // along the side (its corners are 60° apart round the centre)
  const ux = -Math.sin(a)
  const uz = -Math.cos(a)
  const rot = a - Math.PI / 2
  const half = R / 2 - FENCE_INSET * 0.6
  const out: TilePiece[] = []
  if (gate) {
    // the arch in the middle, a length of fence either side of it to the corners
    out.push(piece("arch", mx, mz, rot, ARCH_SCALE))
    for (const s of [-1, 1]) {
      out.push(piece("fence", mx + ux * half * 0.66 * s, mz + uz * half * 0.66 * s, rot, FENCE_SCALE))
      out.push(piece("fence-pillar", mx + ux * half * s, mz + uz * half * s, rot, FENCE_SCALE))
    }
    return out
  }
  for (const f of [-2 / 3, 0, 2 / 3])
    out.push(piece("fence", mx + ux * half * f, mz + uz * half * f, rot, FENCE_SCALE))
  for (const s of [-1, 1])
    out.push(piece("fence-pillar", mx + ux * half * s, mz + uz * half * s, rot, FENCE_SCALE))
  return out
}

/**
 * The graveyard as a tile prefab, from `GRAVES`: its front tile (+z, the gate onto the road) and the
 * one behind it (side 1). Its pieces are pinned (no jitter): the graves are where `GRAVES` says.
 */
export function graveyardPrefab(): TilePrefab {
  const pieces: TilePiece[] = []
  const blockers: NonNullable<TilePrefab["blockers"]>[number][] = []
  // the fence round the outer sides of both tiles, the arch on the front's front (side 4); the side the
  // two tiles share (the front's 1, the back's 4) is open
  for (const k of [3, 4, 5, 0, 2]) pieces.push(...fenceSide(0, 0, k, k === 4))
  for (const k of [5, 0, 1, 2, 3]) pieces.push(...fenceSide(0, BACK_Z, k, false))
  // the path, from the gate to the crypt's door
  const PATHS = ["path-a", "path-b", "path-c", "path-d"]
  let k = 0
  for (let z = 2.2; z > CRYPT_Z + 1.6; z -= 0.86, k++)
    pieces.push(piece(PATHS[k % PATHS.length]!, (k % 2) * 0.06 - 0.03, z, (k * Math.PI) / 2, 0.45, 0.01))
  // the graves: dirt on the path's side, its headstone behind it, its back to the fence
  GRAVES.forEach((g, i) => {
    const out = Math.sign(g.x)
    const [stone, scale] = STONES[i % STONES.length]!
    pieces.push(piece("floor-dirt-grave", g.x, g.z, g.facing, DIRT_SCALE, round(RIM_TOP - 1.53 * DIRT_SCALE)))
    // a mound of fresh earth in it, lying the way its riser lies (Kenney's grave: KayKit has none)
    pieces.push({ ...piece("", g.x, g.z, g.facing, EARTH_SCALE), piece: EARTH })
    pieces.push(piece(stone, g.x + out * HEAD_OUT, g.z, g.facing, scale))
    blockers.push({ x: round(g.x + out * HEAD_OUT), z: g.z, r: 0.38 })
  })
  // the crypt at the back, its door on the path
  pieces.push(piece("crypt", 0, CRYPT_Z, 0, CRYPT_SCALE))
  blockers.push({ x: 0, z: round(CRYPT_Z), r: 1.35 })
  // lanterns either side of its door, candles on two graves, dead trees in the back corners, bones
  for (const s of [-1, 1]) pieces.push(piece("lantern-standing", s * 0.72, CRYPT_Z + 1.75, 0, 0.42))
  pieces.push(piece("candle-triple", -COLUMN - HEAD_OUT + 0.05, 1.3 + 0.42, 0.4, 0.4))
  pieces.push(piece("candle", COLUMN + HEAD_OUT - 0.05, -1.3 - 0.4, 0, 0.4))
  pieces.push(piece("tree-dead-medium", -2.25, BACK_Z - 0.2, 0.6, 0.42))
  pieces.push(piece("tree-dead-small", 2.3, BACK_Z + 0.1, 2.4, 0.42))
  pieces.push(piece("tree-dead-large", 2.2, 0.1, -0.5, 0.36))
  pieces.push(piece("skull", 1.9, BACK_Z - 1.5, 0.9, 0.25))
  pieces.push(piece("bone-a", -0.6, -2.6, 0.7, 0.3))
  pieces.push(piece("ribcage", -1.95, BACK_Z - 1.2, 1.2, 0.28))
  for (const [x, z, r] of [
    [-2.25, BACK_Z - 0.2, 0.25],
    [2.3, BACK_Z + 0.1, 0.25],
    [2.2, 0.1, 0.3],
  ] as const)
    blockers.push({ x, z: round(z), r })
  return {
    id: GRAVEYARD_SCENE,
    name: "Graveyard",
    group: "landmark",
    ground: "grass",
    footprint: [...GRAVEYARD_FOOTPRINT],
    pieces,
    blockers,
  }
}

/** Where the graveyard stands: its front tile, the tile behind it, and the side its gate faces (the road's). */
export interface GraveyardSite {
  tile: number
  cover: number[]
  /** World side (grid DIRS order) of the front tile toward its road: the prefab's front turns there. */
  door: number
}

/** What `graveyardSite` reads of the island and its zones. */
export interface GraveyardInputs {
  grid: HexGrid
  seed: number
  level: ArrayLike<number>
  /** Whether a tile is open country the graveyard may take (no place's, no castle's, dry, unbuilt). */
  open(i: number): boolean
  /** Whether a tile is a road a gate may open onto. */
  road(i: number): boolean
  /** The tile it should be near (the Guildhall's heart, where heroes rest and slump); none: no graveyard. */
  near: number | undefined
  /** The tiles a walker goes by from `near`: the roads, and the Guildhall's own ways and yards. */
  way(i: number): boolean
}

/** How far from `near` the graveyard may be, in steps along the ways. */
const NEAR_MIN = 2
const NEAR_MAX = 30

/**
 * The graveyard's tiles: of every open tile beside a road on its own level whose tile behind (away from
 * the road) is open on that level too, the one whose road is fewest steps along the ways from `near`
 * (a seeded hash between equals): a hero who mends a grave walks there from the Guildhall. Null when
 * there is none within NEAR_MAX steps.
 */
export function graveyardSite(inp: GraveyardInputs): GraveyardSite | null {
  const { grid: g, near } = inp
  if (near === undefined) return null
  // steps along the ways from `near` (breadth first)
  const along = new Int16Array(g.size).fill(-1)
  along[near] = 0
  const queue = [near]
  for (let k = 0; k < queue.length; k++) {
    const a = queue[k]!
    for (const b of g.neighbours(a))
      if (b >= 0 && along[b] === -1 && inp.way(b)) {
        along[b] = along[a]! + 1
        queue.push(b)
      }
  }
  let best: GraveyardSite | null = null
  let bestScore = Number.POSITIVE_INFINITY
  for (let i = 0; i < g.size; i++) {
    if (!inp.open(i)) continue
    const nb = g.neighbours(i)
    for (let door = 0; door < 6; door++) {
      const r = nb[door]!
      if (r < 0 || !inp.road(r) || inp.level[r] !== inp.level[i]) continue
      const d = along[r]! + 1
      if (d <= 0 || d < NEAR_MIN || d > NEAR_MAX) continue
      const cover = GRAVEYARD_FOOTPRINT.map((k) => nb[worldSide(k, door)]!)
      if (!cover.every((j) => j >= 0 && inp.open(j) && inp.level[j] === inp.level[i])) continue
      const score = d + hash2(inp.seed + 61, g.q[i]!, g.r[i]!) * 0.9 + door * 1e-3
      if (score < bestScore) {
        bestScore = score
        best = { tile: i, cover, door }
      }
    }
  }
  return best
}

/** A grave in the world: where its skeleton stands (feet at `y`), facing; where its striker stands. */
export interface WorldGrave {
  x: number
  y: number
  z: number
  facing: number
  strike: { x: number; z: number; facing: number }
}

/** The graveyard as built: its tiles, its gate (the arch's middle) and its graves, 0 nearest the gate. */
export interface HexGraveyard extends GraveyardSite {
  gate: [number, number, number]
  graves: WorldGrave[]
}

/**
 * The graveyard's graves in the world, for a front tile centred at `at` (metres), its ground at `top`,
 * turned `rot` (world.ts `rotOf(door)`): as `placeTile` places a pinned piece.
 */
export function placeGraveyard(
  site: GraveyardSite,
  at: readonly [number, number],
  top: number,
  rot: number,
): HexGraveyard {
  const c = Math.cos(rot)
  const s = Math.sin(rot)
  const world = (x: number, z: number): [number, number] => [at[0] + x * c + z * s, at[1] - x * s + z * c]
  const graves = GRAVES.map((g) => {
    const [x, z] = world(g.x, g.z)
    const k = strikeSpot(g)
    const [sx, sz] = world(k.x, k.z)
    return {
      x,
      y: top,
      z,
      facing: g.facing + rot,
      strike: { x: sx, z: sz, facing: k.facing + rot },
    }
  })
  const [gx, gz] = world(0, (R * Math.sqrt(3)) / 2)
  return { ...site, gate: [gx, top, gz], graves }
}

/**
 * Where heroes strike the graves (sim life graveStrike.ts `GraveKit`): grave `slot`'s strike spot as a
 * stay reached from the walk node on the graveyard's front tile (`node`, `HexWalk.at(tile)`).
 */
export function graveStrikeSpot(
  graveyard: Pick<HexGraveyard, "graves">,
  node: number,
  slot: number,
): { node: number; at: [number, number, number]; facing: number; ground: boolean } | undefined {
  const g = graveyard.graves[slot]
  if (!g || node < 0) return undefined
  return { node, at: [g.strike.x, g.y, g.strike.z], facing: g.strike.facing, ground: true }
}
