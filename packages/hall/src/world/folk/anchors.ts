import type { District } from "../gen/dress.ts"
import { GATE, type Spot } from "../layout.ts"
import type { Venue } from "../venues.ts"
import type { World } from "../world.ts"

/**
 * What an island has for folk to go to, read once from its world: the squares, the quay, the
 * fields, the mine, the market, the inn and the runs of its curtain wall. Everything is optional;
 * an island without a wall has no watch on it, one without a field no farmers.
 */

/** A straight run of the curtain wall: the ends of its walk (a pace in from each tower) and its inside. */
export interface WallRun {
  from: Spot
  to: Spot
  /** Unit vector pointing to the inside of the wall (its pieces' +z). */
  inside: Spot
  pieces: number
}

export interface Anchors {
  /** Each district's square (its road node), by district id. */
  squares: ReadonlyMap<string, Spot>
  districts: ReadonlyMap<string, District>
  /** The hub's square, and the quay running south off it. */
  hub: Spot | undefined
  dock: Spot | undefined
  fields: readonly Spot[]
  mine: Venue | undefined
  /** The market halls, the nearest to the quay first. */
  markets: readonly Venue[]
  inn: Venue | undefined
  runs: readonly WallRun[]
  /** Where the avenue meets the keep's gate. */
  gate: Spot
}

/** A wall piece is 10 along and 4 through; its walk is kept this far from either end. */
const PIECE = 10
const PACE = 3.2
/** Pieces of one run stand this far apart at most (they are laid 10 apart). */
const JOINED = PIECE * 1.15

const distance = (a: Spot, b: Spot | undefined): number => (b ? Math.hypot(a[0] - b[0], a[1] - b[1]) : 0)

const known = new WeakMap<World, Anchors>()

export function anchorsOf(world: World): Anchors {
  let anchors = known.get(world)
  if (!anchors) {
    anchors = read(world)
    known.set(world, anchors)
  }
  return anchors
}

function read(world: World): Anchors {
  const districts = new Map((world.repo?.districts ?? []).map((district) => [district.id, district]))
  const squares = new Map<string, Spot>()
  for (const district of districts.values()) {
    const square = world.roads.nodes[district.node]
    if (square) squares.set(district.id, square)
  }
  const venues = world.venues ?? []
  const quay = world.island.landmarks.find((mark) => mark.kind === "dock")
  const dock: Spot | undefined = quay ? [quay.x, quay.z] : undefined
  const hub = districts.get("/")?.node ? world.roads.nodes[districts.get("/")?.node as string] : undefined
  return {
    squares,
    districts,
    hub,
    dock,
    fields: world.island.fields.map((field): Spot => [field.x, field.z]),
    mine: venues.find((venue) => venue.kind === "mine"),
    markets: venues
      .filter((venue) => venue.kind === "market")
      .sort((a, b) => distance(a.at, dock) - distance(b.at, dock)),
    inn: venues.find((venue) => venue.kind === "tavern"),
    runs: wallRuns(world),
    gate: [GATE[0], GATE[1]],
  }
}

/** The curtain wall's straight pieces gathered into runs: same turn, each within a piece of the next. */
function wallRuns(world: World): WallRun[] {
  // The gates are roofed higher than the walk: the watch keeps to the plain runs.
  const pieces = world.island.decor.filter((d) => d.piece === "wall_straight")
  const used = new Set<number>()
  const runs: WallRun[] = []
  pieces.forEach((first, i) => {
    if (used.has(i)) return
    const turn = first.rot ?? 0
    const group = [i]
    used.add(i)
    for (let n = 0; n < group.length; n++) {
      const a = pieces[group[n] as number]
      if (!a) continue
      pieces.forEach((b, j) => {
        if (used.has(j) || Math.abs((b.rot ?? 0) - turn) > 0.01) return
        if (Math.hypot(a.x - b.x, a.z - b.z) <= JOINED) {
          used.add(j)
          group.push(j)
        }
      })
    }
    // Along the run: the pieces lie along the local x axis, turned by `turn`.
    const along: Spot = [Math.cos(turn), -Math.sin(turn)]
    const ordered = group
      .map((j) => pieces[j])
      .filter((p) => p !== undefined)
      .sort((a, b) => a.x * along[0] + a.z * along[1] - (b.x * along[0] + b.z * along[1]))
    const head = ordered[0]
    const tail = ordered[ordered.length - 1]
    if (!head || !tail) return
    const reach = PIECE / 2 - PACE / 2
    runs.push({
      from: [head.x - along[0] * reach, head.z - along[1] * reach],
      to: [tail.x + along[0] * reach, tail.z + along[1] * reach],
      inside: [Math.sin(turn), Math.cos(turn)],
      pieces: ordered.length,
    })
  })
  return runs.sort((a, b) => b.pieces - a.pieces)
}
