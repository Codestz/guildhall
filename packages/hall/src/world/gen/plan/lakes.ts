import { cellToWorld } from "../../lands.ts"
import { key, neighbours, noise, rings, unkey } from "../hex.ts"
import type { PlanDistrict } from "../plan.ts"
import { COAST_TILES, fit } from "../tiles.ts"
import { RESERVED } from "./keep.ts"
import type { Owners } from "./land.ts"
import { type Tier, tierOf } from "./tier.ts"
import { CLEAR } from "./zones.ts"

/**
 * Generator v2's valley lakes (terrain v2 §2.3, third attempt): like the ranges, a lake's ground is
 * reserved in the plan before any road, lot or field, because after them there is no room left. A
 * basin of 6-14 hexes of level ground lies inland (two hexes of land at least between it and the
 * sea), a few hexes from a range's foot, ringed by a shore of open meadow, with a corridor of
 * level ground up to the range for the stream that feeds it. Roads keep off it (plan/roads.ts),
 * lots and fields never grow on it (plan/ground.ts), and the rivers (rivers/lakes.ts) then run the
 * stream down into the basin and out of it to the sea.
 */

/** A lake's reserved ground, by hex key. */
export interface PlanLake {
  /** The basin: level ground left for the water. */
  cells: string[]
  /** The ring of open land round it: meadow, sand and reeds. */
  shore: string[]
  /** The stream's way from the range down to the basin, the range side first. */
  inlet: string[]
  /** The outlet's way from the basin to the coast, the basin side first: level meadow, for the stream out. */
  outlet: string[]
  /** The range hex the stream comes down from (beside the first inlet hex). */
  foot: string
}

/** Lakes a tier gets, at most (a hamlet has no range for a stream to come down). */
const COUNT: Readonly<Record<Tier, number>> = { hamlet: 0, village: 1, town: 1, city: 2 }
/** A basin holds this many hexes, at least and at most. */
const SIZE = [6, 14] as const
/** Hexes from the sea to a basin hex, counting the coast hex as one: two hexes of land lie between. */
const INLAND = 3
/** How far a basin lies from the nearest range hex, in hexes: its foot. */
const FOOT = [3, 6] as const
/** A basin this far or farther leaves the range's foothills alone; nearer ones are tried only when none lies so far. */
const FAR = 4
/** Lakes lie at least this many hexes apart. */
const APART = 10

/** Every hex a lake keeps: its basin, shore and inlet. */
export const keepOf = (lakes: readonly PlanLake[]): Set<string> =>
  new Set(lakes.flatMap((lake) => [...lake.cells, ...lake.shore, ...lake.inlet, ...lake.outlet]))

const apart = (a: string, b: string): number => {
  const [p, q] = [unkey(a), unkey(b)]
  return rings([p[0] - q[0], p[1] - q[1]])
}

/** The lakes' ground, in the order they are chosen; none where no foot has room for one. Deterministic. */
export function reserveLakes(
  districts: readonly PlanDistrict[],
  owner: Owners,
  ranges: readonly ReadonlySet<string>[],
  seed: number,
): PlanLake[] {
  const want = COUNT[tierOf(districts.reduce((sum, d) => sum + d.folder.files, 0))]
  const mountains = new Set(ranges.flatMap((range) => [...range]))
  if (want === 0 || mountains.size === 0) return []
  const depth = depthOf(owner)
  const squares = new Set<string>()
  for (const { square } of districts) {
    squares.add(key(square))
    for (const next of neighbours(square)) squares.add(key(next))
  }
  // Open ground a lake or its stream may take: unbuilt, off the keep, a range and the squares.
  const free = (id: string): boolean => {
    if (!owner.has(id) || RESERVED.has(id) || squares.has(id) || mountains.has(id)) return false
    const [x, z] = cellToWorld(unkey(id))
    return Math.hypot(x, z) >= CLEAR * 0.8
  }
  const from = reachFrom(mountains, ranges.length > 1 ? (ranges[0] as ReadonlySet<string>) : new Set(), free)
  const lakes: PlanLake[] = []
  const taken = new Set<string>()
  const rank = (id: string): number =>
    noise(seed, unkey(id), "lake") +
    ((from.get(id)?.distance ?? 0) < FAR ? 1 : 0) +
    (from.get(id)?.main ? 2 : 0)
  const seeds = [...from.keys()]
    .filter((id) => {
      const near = from.get(id)?.distance ?? 0
      return near >= FOOT[0] && near <= FOOT[1] && (depth.get(id) ?? 0) >= INLAND
    })
    .sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : 1))
  for (const id of seeds) {
    if (lakes.length >= want) break
    if (lakes.some((lake) => lake.cells.some((c) => apart(c, id) < APART))) continue
    const lake = basinAt(id, seed, { free, depth, from, taken, mountains })
    if (!lake) continue
    lakes.push(lake)
    for (const c of keepOf([lake])) taken.add(c)
  }
  return lakes
}

/** Hexes of land from the sea: a coast hex is 1. */
function depthOf(owner: Owners): Map<string, number> {
  const depth = new Map<string, number>()
  let edge = [...owner.keys()].filter((id) => neighbours(unkey(id)).some((n) => !owner.has(key(n))))
  for (const id of edge) depth.set(id, 1)
  for (let d = 2; edge.length > 0; d++) {
    const next: string[] = []
    for (const id of edge)
      for (const n of neighbours(unkey(id))) {
        const nid = key(n)
        if (owner.has(nid) && !depth.has(nid)) {
          depth.set(nid, d)
          next.push(nid)
        }
      }
    edge = next
  }
  return depth
}

/** How each free hex within FOOT's reach is joined to a range: its distance from it and the hex before it. */
interface Reach {
  distance: number
  before: string
  /** Whether it is the main range's (a lake keeps off its foot while another range has room: the backbone keeps its height). */
  main: boolean
}

/** Breadth-first from the range hexes outward over free ground: the corridors a stream could take. */
function reachFrom(
  mountains: ReadonlySet<string>,
  main: ReadonlySet<string>,
  free: (id: string) => boolean,
): Map<string, Reach> {
  const out = new Map<string, Reach>()
  let edge = [...mountains].sort()
  for (let distance = 1; distance <= FOOT[1] && edge.length > 0; distance++) {
    const next: string[] = []
    for (const id of edge)
      for (const n of neighbours(unkey(id))) {
        const nid = key(n)
        if (out.has(nid) || !free(nid)) continue
        out.set(nid, { distance, before: id, main: out.get(id)?.main ?? main.has(id) })
        next.push(nid)
      }
    edge = next
  }
  return out
}

interface Ground {
  free: (id: string) => boolean
  depth: ReadonlyMap<string, number>
  from: ReadonlyMap<string, Reach>
  taken: ReadonlySet<string>
  mountains: ReadonlySet<string>
}

/** A lake entered at `entry`, its stream coming down the corridor `from` found; undefined when the ground has no room. */
function basinAt(entry: string, seed: number, ground: Ground): PlanLake | undefined {
  const { free, depth, from, taken, mountains } = ground
  const stream: string[] = []
  let foot = entry
  for (let id = from.get(entry)?.before; id !== undefined; id = from.get(id)?.before) {
    if (mountains.has(id)) {
      foot = id
      break
    }
    stream.unshift(id)
  }
  if (!mountains.has(foot) || stream.length === 0) return undefined
  const streamed = new Set(stream)
  const beside = new Set(stream.slice(1).flatMap((id) => neighbours(unkey(id)).map(key)))
  const lastStream = stream[stream.length - 1] as string
  const far = (id: string): number => Math.min(...[...mountains].map((m) => apart(m, id)))
  const roomy = (id: string): boolean =>
    free(id) && !taken.has(id) && !streamed.has(id) && (depth.get(id) ?? 0) >= INLAND && far(id) >= FOOT[0]
  const valid = (id: string): boolean => free(id) && !taken.has(id) && (depth.get(id) ?? 0) >= 2
  // A basin hex has open ground all round it, for the shore.
  const fits = (id: string): boolean =>
    roomy(id) && !beside.has(id) && neighbours(unkey(id)).every((n) => valid(key(n)) || streamed.has(key(n)))
  // Grown round a middle set away from the range, so the stream meets the lake's upstream end.
  const size = SIZE[0] + Math.floor(noise(seed, unkey(entry), "size") * (SIZE[1] - SIZE[0] + 1))
  const [fx, fz] = cellToWorld(unkey(foot))
  const [ex, ez] = cellToWorld(unkey(entry))
  const heading = Math.hypot(ex - fx, ez - fz) || 1
  const radius = Math.max(0, 5.25 * Math.sqrt(size) - 5)
  const mid = [ex + ((ex - fx) / heading) * radius, ez + ((ez - fz) / heading) * radius] as const
  const reach = (id: string): number => {
    const [x, z] = cellToWorld(unkey(id))
    return Math.hypot(x - mid[0], z - mid[1]) + noise(seed, unkey(id), "shape") * 2.5
  }
  const cells = new Set([entry])
  const ring = (): string[] => [
    ...new Set([...cells].flatMap((id) => neighbours(unkey(id)).map(key)).filter((id) => !cells.has(id))),
  ]
  while (cells.size < size) {
    const next = ring()
      .filter(fits)
      .sort((a, b) => reach(a) - reach(b) || (a < b ? -1 : 1))[0]
    if (!next) break
    cells.add(next)
  }
  // A shore hex whose wet sides are not one run takes no lakeshore tile: it joins the lake.
  for (let pass = 0; pass < 6; pass++) {
    const nook = ring().filter((id) => !streamed.has(id) && !fit(COAST_TILES, contact(id, cells)))
    if (nook.length === 0) break
    if (nook.some((id) => !fits(id)) || cells.size + nook.length > SIZE[1]) return undefined
    for (const id of nook) cells.add(id)
  }
  const shore = ring().filter((id) => !streamed.has(id))
  const touching = neighbours(unkey(lastStream)).some((n) => cells.has(key(n)))
  if (cells.size < SIZE[0] || !touching || !shore.every(valid) || !stream.every(valid)) return undefined
  // The stream meets the water at its last hex alone: no earlier one lies beside the basin.
  if (stream.slice(0, -1).some((id) => neighbours(unkey(id)).some((n) => cells.has(key(n))))) return undefined
  const out = outletOf(cells, entry, shore, { free, depth, taken, streamed })
  if (!out) return undefined
  const sorted = (ids: Iterable<string>): string[] => [...ids].sort()
  return { cells: sorted(cells), shore: sorted(shore), inlet: stream, outlet: out, foot }
}

/**
 * The outlet's corridor: the shortest way over open ground from the basin's far side (away from
 * the stream's entry) to a coast hex, its first hex on the shore and the rest clear of the basin.
 */
function outletOf(
  cells: ReadonlySet<string>,
  entry: string,
  shore: readonly string[],
  ground: Pick<Ground, "free" | "depth" | "taken"> & { streamed: ReadonlySet<string> },
): string[] | undefined {
  const { free, depth, taken, streamed } = ground
  const farthest = Math.max(...[...cells].map((id) => apart(id, entry)))
  const starts = shore
    .filter((id) =>
      neighbours(unkey(id)).some((n) => cells.has(key(n)) && apart(key(n), entry) >= farthest - 1),
    )
    .sort()
  const back = new Map<string, string | undefined>(starts.map((id) => [id, undefined]))
  let edge = starts
  while (edge.length > 0) {
    const goal = edge.find((id) => depth.get(id) === 1)
    if (goal) {
      const path: string[] = []
      for (let at: string | undefined = goal; at !== undefined; at = back.get(at)) path.unshift(at)
      return path
    }
    const next: string[] = []
    for (const id of edge)
      for (const n of neighbours(unkey(id))) {
        const nid = key(n)
        const beside = neighbours(n).some((m) => cells.has(key(m)))
        if (back.has(nid) || cells.has(nid) || beside || streamed.has(nid) || !free(nid) || taken.has(nid))
          continue
        back.set(nid, id)
        next.push(nid)
      }
    edge = next
  }
  return undefined
}

/** The edges of `id` that open onto `wet`. */
const contact = (id: string, wet: ReadonlySet<string>): number[] =>
  neighbours(unkey(id)).flatMap((n, dir) => (wet.has(key(n)) ? [dir] : []))
