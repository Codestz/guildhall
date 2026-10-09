import { type Cell, cellToWorld, MAP_FOR_TESTS } from "../../world/lands.ts"
import type { Spot } from "../../world/layout.ts"

/**
 * What the water needs to know about the island, derived from the map (ADR 0007, Nature): the
 * river's course (source to mouth, for its flow), how far each bit of water is from the shore (for
 * foam and shallows) and which way the river runs there. Pure: the bake in Water.tsx renders the
 * land mask, everything else happens here.
 */

/** Neighbour steps in (q, line), the map's own: the same table as lands.ts. */
const DIRS: readonly Cell[] = [
  [1, 1],
  [0, 2],
  [-1, 1],
  [-1, -1],
  [0, -2],
  [1, -1],
]
const key = ([q, line]: Cell): string => `${q},${line}`
const parse = (id: string): Cell => id.split(",").map(Number) as unknown as Cell

/**
 * The river hexes in order, source first. The source is the end that opens from the lake ('o');
 * the mouth is the other end. Every hex in the course carries the river (or the lake it leaves).
 */
export function riverCells(links = MAP_FOR_TESTS.riverLinks, at = MAP_FOR_TESTS.at): Cell[] {
  const ends = [...links].filter(([, dirs]) => dirs.size === 1).map(([id]) => parse(id))
  if (ends.length !== 2) throw new Error(`river: expected two ends, found ${ends.length}`)
  const [a, b] = ends as [Cell, Cell]
  const source = at(a) === "o" || at(b) !== "o" ? a : b
  const course: Cell[] = [source]
  const seen = new Set([key(source)])
  for (let cell = source; ; ) {
    const next = [...(links.get(key(cell)) ?? [])]
      .map((dir) => DIRS[dir] ?? [0, 0])
      .map(([dq, dl]): Cell => [cell[0] + dq, cell[1] + dl])
      .find((n) => !seen.has(key(n)))
    if (!next) break
    seen.add(key(next))
    course.push(next)
    cell = next
  }
  return course
}

/** Chaikin corner cutting: a polyline rounded `rounds` times, ends kept. */
export function smooth(points: readonly Spot[], rounds = 2): Spot[] {
  let line: Spot[] = [...points]
  for (let round = 0; round < rounds; round++) {
    if (line.length < 3) return line
    const out: Spot[] = [line[0] as Spot]
    for (let i = 0; i < line.length - 1; i++) {
      const [ax, az] = line[i] as Spot
      const [bx, bz] = line[i + 1] as Spot
      out.push([ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25], [ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75])
    }
    out.push(line[line.length - 1] as Spot)
    line = out
  }
  return line
}

/** The river's centre line in world units, source to mouth, rounded. */
export function riverLine(): Spot[] {
  return smooth(riverCells().map(cellToWorld), 3)
}

/**
 * Distance (in texels) from every texel to the nearest `land` texel (0 on land): a two-pass
 * chamfer transform (steps 1 and √2), within a few percent of Euclidean — plenty for foam bands.
 */
export function distanceToLand(land: Uint8Array, width: number, height: number): Float32Array {
  const far = width + height
  const d = new Float32Array(width * height)
  for (let i = 0; i < d.length; i++) d[i] = land[i] ? 0 : far
  const D = Math.SQRT2
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      let v = d[i] as number
      if (v === 0) continue
      if (x > 0) v = Math.min(v, (d[i - 1] as number) + 1)
      if (y > 0) {
        v = Math.min(v, (d[i - width] as number) + 1)
        if (x > 0) v = Math.min(v, (d[i - width - 1] as number) + D)
        if (x < width - 1) v = Math.min(v, (d[i - width + 1] as number) + D)
      }
      d[i] = v
    }
  for (let y = height - 1; y >= 0; y--)
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x
      let v = d[i] as number
      if (v === 0) continue
      if (x < width - 1) v = Math.min(v, (d[i + 1] as number) + 1)
      if (y < height - 1) {
        v = Math.min(v, (d[i + width] as number) + 1)
        if (x < width - 1) v = Math.min(v, (d[i + width + 1] as number) + D)
        if (x > 0) v = Math.min(v, (d[i + width - 1] as number) + D)
      }
      d[i] = v
    }
  return d
}

/** The unit direction of the polyline's nearest segment to (x, z), or undefined beyond `reach`. */
export function flowAt(line: readonly Spot[], x: number, z: number, reach: number): Spot | undefined {
  let best = reach * reach
  let dir: Spot | undefined
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, az] = line[i] as Spot
    const [bx, bz] = line[i + 1] as Spot
    const ex = bx - ax
    const ez = bz - az
    const length2 = ex * ex + ez * ez
    if (length2 === 0) continue
    const t = Math.min(1, Math.max(0, ((x - ax) * ex + (z - az) * ez) / length2))
    const dx = ax + ex * t - x
    const dz = az + ez * t - z
    const distance2 = dx * dx + dz * dz
    if (distance2 < best) {
      best = distance2
      const length = Math.sqrt(length2)
      dir = [ex / length, ez / length]
    }
  }
  return dir
}

/** Shore texture layout: world [-HALF, HALF]² in x and z, `SIZE` texels a side. */
export const SHORE = { half: 120, size: 1024, maxDistance: 10 } as const
/**
 * The extent and resolution of one shore bake: the home island's (SHORE), a far island's patch, or
 * one of a big island's shore tiles (shoreTiles.ts), centred `at` (world xz; the origin if absent).
 */
export type ShoreLayout = { half: number; size: number; at?: Spot }

/**
 * The shore texture's texels from a land mask (row 0 at z = +half, as a top-down render reads
 * back): R distance to land (0–maxDistance world units), G/B the river's flow (0.5 = still), A 255.
 */
export function shoreTexels(
  land: Uint8Array,
  line: readonly Spot[] = riverLine(),
  layout: ShoreLayout = SHORE,
): Uint8Array {
  const { half, size } = layout
  const [ax, az] = layout.at ?? [0, 0]
  const { maxDistance } = SHORE
  const cell = (half * 2) / size
  const distance = distanceToLand(land, size, size)
  const out = new Uint8Array(size * size * 4)
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (const [x, z] of line) {
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minZ = Math.min(minZ, z)
    maxZ = Math.max(maxZ, z)
  }
  const reach = 7
  for (let row = 0; row < size; row++) {
    const z = az + half - (row + 0.5) * cell
    for (let column = 0; column < size; column++) {
      const i = row * size + column
      const x = ax - half + (column + 0.5) * cell
      out[i * 4] = Math.round(Math.min(1, ((distance[i] as number) * cell) / maxDistance) * 255)
      let fx = 0
      let fz = 0
      if (x > minX - reach && x < maxX + reach && z > minZ - reach && z < maxZ + reach) {
        const flow = flowAt(line, x, z, reach)
        if (flow) [fx, fz] = flow
      }
      out[i * 4 + 1] = Math.round((0.5 + 0.5 * fx) * 255)
      out[i * 4 + 2] = Math.round((0.5 + 0.5 * fz) * 255)
      out[i * 4 + 3] = 255
    }
  }
  return out
}

/** A square the open sea leaves out: ±half round `at`. */
export interface Hole {
  at: Spot
  half: number
}

/**
 * The open sea as a grid of `cell`-sized squares out to `radius` (xz pairs, two triangles a cell,
 * counter-clockwise from above), leaving out every square in a hole: a far island's shore patch
 * (world/archipelago.ts) or a shore tile (shoreTiles.ts). Holes and offsets are multiples of
 * `cell`, so a patch drawn with the same grid (`patchSquares`) meets the sea vertex to vertex.
 */
export function seaSquares(radius: number, holes: readonly Hole[], cell: number): Spot[] {
  const out: Spot[] = []
  const n = Math.ceil(radius / cell)
  for (let i = -n; i < n; i++)
    for (let j = -n; j < n; j++) {
      const cx = (i + 0.5) * cell
      const cz = (j + 0.5) * cell
      if (Math.hypot(cx, cz) > radius) continue
      if (holes.some(({ at: [hx, hz], half }) => Math.abs(cx - hx) < half && Math.abs(cz - hz) < half))
        continue
      out.push(...square(i * cell, j * cell, cell))
    }
  return out
}

/** A patch ±half round `at` (the origin if absent) as the same grid of `cell` squares. */
export function patchSquares(half: number, cell: number, [ax, az]: Spot = [0, 0]): Spot[] {
  const out: Spot[] = []
  for (let x = -half; x < half; x += cell)
    for (let z = -half; z < half; z += cell) out.push(...square(ax + x, az + z, cell))
  return out
}

/** One square's two triangles, counter-clockwise seen from above (+y normal). */
function square(x: number, z: number, cell: number): Spot[] {
  return [
    [x, z],
    [x, z + cell],
    [x + cell, z + cell],
    [x, z],
    [x + cell, z + cell],
    [x + cell, z],
  ]
}

/**
 * Bakes kept per key (a world) while something draws them. `hold` marks one in use and returns its
 * release; once nothing holds a key, its bake is freed (`free`) unless `keep` says it stays (the
 * hand-drawn world: one for the session). The check waits for the commit to finish, since an
 * effect re-run (a rebuilt material) releases and takes the same key back at once. Without this
 * a repo's world, grown afresh on every visit, left its bake on the GPU for the session.
 */
export class Bakes<K extends object, T> {
  private made = new Map<K, T | Promise<T>>()
  private users = new Map<K, number>()

  constructor(
    private readonly free: (bake: T) => void,
    private readonly keep: (key: K) => boolean,
  ) {}

  get(key: K): T | Promise<T> | undefined {
    return this.made.get(key)
  }

  set(key: K, bake: T | Promise<T>): void {
    this.made.set(key, bake)
  }

  hold(key: K): () => void {
    this.users.set(key, (this.users.get(key) ?? 0) + 1)
    let released = false
    return () => {
      if (released) return
      released = true
      const left = (this.users.get(key) ?? 1) - 1
      if (left > 0) {
        this.users.set(key, left)
        return
      }
      this.users.delete(key)
      if (this.keep(key)) return
      queueMicrotask(() => {
        const bake = this.made.get(key)
        if (this.users.has(key) || bake === undefined) return
        this.made.delete(key)
        void Promise.resolve(bake).then(this.free, () => {})
      })
    }
  }
}
