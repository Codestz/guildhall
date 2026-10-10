import { DMath } from "../../dmath.ts"
import { type Cell, cellToWorld } from "../../lands.ts"
import { composed, composite } from "../../prefabs/composite/index.ts"
import { instantiate } from "../../prefabs/index.ts"
import { footprintsOf } from "../dress/footprints.ts"
import { cellAt, hash, key, neighbours, rings, step, unkey } from "../hex.ts"
import { AVENUE, GATE, HUB, inBay, KEEP, QUAY, RESERVED } from "./keep.ts"

/**
 * An island's heart: where its main building (a composite landmark, prefabs/composite) stands, and
 * the ground kept clear for it before anything else is planned. An inland heart stands north of the
 * keep, its front to the keep's gate; a coastal one (the harbour fortress, a lighthouse) stands on
 * the coast with its back to open sea. Its hexes are reserved like the keep's: no road, lot, range
 * or lake takes them, and the land is grown round them (plan/mass.ts).
 */

export interface Heart {
  /** The composite's id (prefabs/composite) and the seed that varies it. */
  id: string
  seed: number
  /** The hex it stands on, and its turn (its front is +z: a quarter-turn multiple of a sixth). */
  cell: Cell
  rot: number
  rings: 0 | 1 | 2
  /** The hexes kept clear for it: the anchor, its `rings` rings and one more (room for its corners), the land among them. */
  cells: ReadonlySet<string>
}

/**
 * Land an island needs to carry a composite of each size. The grand castle of a core island needs
 * less, and a coastal composite stands on the shore, not in the middle of the land.
 */
const MIN_LAND = { 0: 0, 1: 120, 2: 200 } as const
const MIN_LAND_SHORE = 130
/** Where an inland heart stands, by its rings: its front clears the keep's room (z = −14 at the front corner). */
const ANCHOR: Readonly<Record<0 | 1 | 2, Cell>> = { 0: [0, -4], 1: [0, -6], 2: [0, -8] }
/** Composites that stand on the coast: the sea wall and the dock, or the lamp that warns the sea. */
const COASTAL = new Set(["harbour-fortress", "islet-lighthouse"])
/** A coastal heart stands this far (world units) from the keep's room, and from the hub's harbour. */
const FROM_KEEP = 30
const FROM_HUB = 44

/** The hexes within `n` rings of a cell. */
export function disc(cell: Cell, n: number): Cell[] {
  const out: Cell[] = []
  for (let q = cell[0] - n; q <= cell[0] + n; q++)
    for (let line = cell[1] - 2 * n; line <= cell[1] + 2 * n; line++)
      if ((q - line) % 2 === 0 && rings([q - cell[0], line - cell[1]]) <= n) out.push([q, line])
  return out
}

/** The turn that puts a heart's back (−z) towards the neighbour `dir` of its hex. */
export const turnToward = (dir: number): number => ((4 - dir + 6) % 6) * (Math.PI / 3)

/** What a heart of this composite is: its rings, and whether it stands on the coast. */
export function kindOf(id: string): { rings: 0 | 1 | 2; coastal: boolean } {
  return { rings: composite(id).rings, coastal: COASTAL.has(id) }
}

const sizeFits = (rings: 0 | 1 | 2, land: number, shore: boolean): boolean =>
  land >= (shore && rings === 2 ? MIN_LAND_SHORE : MIN_LAND[rings])

/** The first of an island's wishes its land can carry, with its anchor's inland hexes (those to be grown first), or none. */
export function inlandChoice(
  wish: readonly string[],
  land: number,
  core: boolean,
): { id: string; cell: Cell; rings: 0 | 1 | 2 } | undefined {
  for (const id of wish) {
    const { rings: n, coastal } = kindOf(id)
    // The core island's grand castle stands inland, with the room of a shore one.
    if (!coastal && sizeFits(n, land, core)) return { id, cell: ANCHOR[n], rings: n }
  }
  return undefined
}

/** The wishes that stand on the coast and whose size the land carries, in order. */
export function coastalWishes(wish: readonly string[], land: number): string[] {
  return wish.filter((id) => {
    const { rings: n, coastal } = kindOf(id)
    return coastal && sizeFits(n, land, true)
  })
}

/** What an inland heart seeds: the anchor's rings and one more (room round it), grown with the keep's ground. */
export const zoneOf = (cell: Cell, n: number): Cell[] => disc(cell, n + 1)

/** An inland heart on `cell`: its hexes reserved. */
export function inlandHeart(id: string, cell: Cell, n: 0 | 1 | 2, seed: number): Heart {
  return { id, seed: seedOf(seed, id), cell, rot: 0, rings: n, cells: new Set(zoneOf(cell, n).map(key)) }
}

/** A composite's own seed (1 or more: 0 is the plain one the catalogue draws), from the island's. */
export const seedOf = (seed: number, id: string): number => 1 + (hash(`heart:${seed}:${id}`) % 65535)

const OFF_LIMITS: ReadonlySet<string> = new Set([
  ...RESERVED,
  ...KEEP.keys(),
  key(HUB),
  key(AVENUE),
  key(GATE),
  key(QUAY),
])

/** The columns and lines a set of hexes spans: [q0, q1, line0, line1]. */
function boxOf(set: ReadonlySet<string>): [number, number, number, number] {
  let [q0, q1, l0, l1] = [
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ]
  for (const id of set) {
    const [q, line] = unkey(id)
    q0 = Math.min(q0, q)
    q1 = Math.max(q1, q)
    l0 = Math.min(l0, line)
    l1 = Math.max(l1, line)
  }
  return [q0, q1, l0, l1]
}

/** Sea hexes that open to the outside: the sea beyond the land, not a lagoon inside it. */
export function openSea(mass: ReadonlySet<string>): Set<string> {
  const [q0, q1, l0, l1] = boxOf(mass)
  const inside = (cell: Cell): boolean =>
    cell[0] >= q0 - 2 && cell[0] <= q1 + 2 && cell[1] >= l0 - 4 && cell[1] <= l1 + 4
  const start: Cell = [q0 - 2, (q0 - 2 - (l0 - 4)) % 2 === 0 ? l0 - 4 : l0 - 5]
  const seen = new Set<string>([key(start)])
  const todo = [start]
  for (let cell = todo.pop(); cell; cell = todo.pop())
    for (const next of neighbours(cell)) {
      const id = key(next)
      if (!seen.has(id) && inside(next) && !mass.has(id)) {
        seen.add(id)
        todo.push(next)
      }
    }
  return seen
}

/** The sea the land encloses (an atoll's lagoon): hexes inside its span that are neither land nor open sea. */
export function enclosedSea(land: ReadonlySet<string>): Set<string> {
  const open = openSea(land)
  const [q0, q1, l0, l1] = boxOf(land)
  const out = new Set<string>()
  for (let q = q0; q <= q1; q++)
    for (let line = l0; line <= l1; line++) {
      const id = key([q, line])
      if ((q - line) % 2 === 0 && !land.has(id) && !open.has(id)) out.add(id)
    }
  return out
}

/** A sea hex's sand slopes this far from its centre (world/wilds.ts WATER_CLEARANCE): no building stands on it. */
const BEACH = 8

/**
 * Whether a coastal heart stands on `mass`: every corner of the composite's buildings and walls is on
 * land and off the beach (the sea beyond the hexes it holds is for its dock), and its back, a dock's
 * hex beyond its rings, looks out over open sea.
 */
export function coastalStands(heart: Heart, mass: ReadonlySet<string>): boolean {
  const { cell, rot, rings: n } = heart
  const made = composed(heart.id, heart.seed)
  const parts = instantiate(made, cellToWorld(cell), rot, "blue")
  const sea = disc(cell, n + 3)
    .filter((h) => !mass.has(key(h)))
    .map((h) => cellToWorld(h))
  for (const shape of footprintsOf(parts))
    for (const [x, z] of shape) {
      if (!mass.has(key(cellAt([x, z])))) return false
      if (sea.some(([sx, sz]) => DMath.hypot(x - (sx as number), z - (sz as number)) < BEACH)) return false
    }
  let behind = cell
  for (let k = 0; k <= n; k++) behind = step(behind, backOf(rot))
  return openSea(mass).has(key(behind))
}

/** The neighbour direction a heart turned `rot` has its back to (the inverse of `turnToward`). */
const backOf = (rot: number): number => (((4 - Math.round(rot / (Math.PI / 3))) % 6) + 6) % 6

/** Hexes at most this many beyond the island's land that a coastal heart may stand in (the land is grown round it). */
const BULGE = 14

/**
 * The places a coastal heart may stand, the best first (at most a few): anchors near the coast of
 * the land grown without it, whose back is to open sea (`rings + 1` hexes behind it), clear of the
 * keep and the harbour and facing the keep; the nearest to the keep first. The land is then grown
 * with the heart's hexes as its first (plan/mass.ts), and `coastalStands` says whether it stood.
 */
export function coastalHearts(id: string, mass: ReadonlySet<string>, seed: number): Heart[] {
  const { rings: n } = kindOf(id)
  const open = openSea(mass)
  const reach = (n + 1) * 10
  const radius = n * 10 + 5.78
  const found: { cost: number; heart: Heart }[] = []
  for (const at of [...mass].sort()) {
    const cell = unkey(at)
    const [ax, az] = cellToWorld(cell)
    const away = DMath.hypot(ax, az)
    if (away < FROM_KEEP + radius) continue
    const [hx, hz] = cellToWorld(HUB)
    if (DMath.hypot(ax - hx, az - hz) < FROM_HUB) continue
    for (let dir = 0; dir < 6; dir++) {
      let sea = cell
      for (let k = 0; k <= n; k++) sea = step(sea, dir)
      if (!open.has(key(sea)) || inBay(sea)) continue
      const rot = turnToward(dir)
      // The front looks to the keep: the hex behind (towards the sea) is further from the origin than the anchor.
      const [sx, sz] = cellToWorld(sea)
      const facing = (DMath.hypot(sx, sz) - away) / reach
      if (facing < 0.3) continue
      // Its hexes: the rings and one more, but not the sea its dock lies in (straight behind it).
      const [sin, cos] = [DMath.sin(rot), DMath.cos(rot)]
      const dock = (h: Cell): boolean => {
        const [x, z] = cellToWorld(h)
        const [dx, dz] = [x - ax, z - az]
        return Math.abs(dx * cos - dz * sin) < 5 && dx * sin + dz * cos < -(n * 10 + 4)
      }
      const zone = zoneOf(cell, n).filter((h) => !dock(h))
      if (disc(cell, n).some((h) => OFF_LIMITS.has(key(h)))) continue
      const outside = zone.filter((h) => !mass.has(key(h)))
      if (outside.length > BULGE) continue
      found.push({
        cost: away - 30 * facing,
        heart: { id, seed: seedOf(seed, id), cell, rot, rings: n, cells: new Set(zone.map(key)) },
      })
    }
  }
  return found
    .sort((a, b) => a.cost - b.cost || (key(a.heart.cell) < key(b.heart.cell) ? -1 : 1))
    .slice(0, 10)
    .map((one) => one.heart)
}
