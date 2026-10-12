import { SWATCH, swatchV } from "./swatches.ts"

/**
 * The trails' steps (relief/trailCarve.ts): where a trail climbs a ledge's riser, a flight of stone
 * steps leans on the wall, each step a flat tread and a vertical riser. A flight is plain data on the
 * massif (it crosses a Web Worker with it): the point where it meets the riser, the way it climbs,
 * and the two ledges it joins. The mesh builds its faces (`flightFaces`), and the ground a walker
 * stands on reads its treads (`treadAt`), so both agree.
 */

export interface Flight {
  /** Where the top step meets the riser (world x, z). */
  x: number
  z: number
  /** The unit direction of the climb (horizontal), pointing at the riser. */
  dx: number
  dz: number
  /** The ledge's top it starts from and the one it climbs to. */
  lo: number
  hi: number
  /** Where the flight must stop short (a lookout's pad at its foot): its length, else a step's depth for each step. */
  run?: number
}

/** A step is at most this high and this deep (world units); a flight is as wide as WIDTH. */
const RISE = 1
const TREAD = 0.55
const WIDTH = 1.5
/** The top step runs on a little into the wall, just under the ledge's top (never a second surface to fight it). */
const INTO = 0.8
const SUNK = 0.02
/** The flight's base stands this far under the lower ledge, so it never floats. */
const BASE = 1

const stepsOf = (f: Flight): number => Math.max(1, Math.round((f.hi - f.lo) / RISE))
const treadOf = (f: Flight): number => (f.run === undefined ? TREAD : f.run / stepsOf(f))

/** The flight's local frame: `s` along the climb (0 at the riser), `c` across it. */
const frameOf = (f: Flight, x: number, z: number): { s: number; c: number } => ({
  s: (x - f.x) * f.dx + (z - f.z) * f.dz,
  c: -(x - f.x) * f.dz + (z - f.z) * f.dx,
})

/** The height of the flight's step at a world point, or undefined off the flight. */
export function treadAt(f: Flight, x: number, z: number): number | undefined {
  const { s, c } = frameOf(f, x, z)
  const n = stepsOf(f)
  const tread = treadOf(f)
  const length = n * tread
  if (Math.abs(c) > WIDTH / 2 || s < -length || s > INTO) return undefined
  const i = Math.min(n - 1, Math.max(0, Math.floor((s + length) / tread)))
  return f.lo + ((i + 1) * (f.hi - f.lo)) / n
}

type Point = [number, number, number]
export interface FlightFace {
  tri: [Point, Point, Point]
  /** A tread (flat, lit like a ledge's top) or a wall. */
  tread: boolean
}

/** The flight as closed solid's triangles, each wound to face out. */
export function flightFaces(f: Flight): FlightFace[] {
  const n = stepsOf(f)
  const [px, pz] = [-f.dz, f.dx]
  const half = WIDTH / 2
  const yb = f.lo - BASE
  const edges = Array.from({ length: n + 1 }, (_, i) => (i - n) * treadOf(f))
  edges[n] = INTO
  const tops = Array.from(
    { length: n },
    (_, i) => f.lo + ((i + 1) * (f.hi - f.lo)) / n - (i === n - 1 ? SUNK : 0),
  )
  const at = (s: number, c: number, y: number): Point => [f.x + f.dx * s + px * c, y, f.z + f.dz * s + pz * c]
  const out: FlightFace[] = []
  /** A triangle, turned to face `toward` (a vector). */
  const tri = (a: Point, b: Point, c: Point, toward: Point, tread = false): void => {
    const [ux, uy, uz] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const [vx, vy, vz] = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
    const dot =
      (uy * vz - uz * vy) * toward[0] + (uz * vx - ux * vz) * toward[1] + (ux * vy - uy * vx) * toward[2]
    out.push({ tri: dot >= 0 ? [a, b, c] : [a, c, b], tread })
  }
  const quad = (a: Point, b: Point, c: Point, d: Point, toward: Point, tread = false): void => {
    tri(a, b, c, toward, tread)
    tri(a, c, d, toward, tread)
  }
  const down: Point = [0, -1, 0]
  const up: Point = [0, 1, 0]
  const ahead: Point = [f.dx, 0, f.dz]
  const back: Point = [-f.dx, 0, -f.dz]
  for (let i = 0; i < n; i++) {
    const [s0, s1] = [edges[i] as number, edges[i + 1] as number]
    const [top, below] = [tops[i] as number, i === 0 ? yb : (tops[i - 1] as number)]
    quad(at(s0, -half, top), at(s1, -half, top), at(s1, half, top), at(s0, half, top), up, true)
    quad(at(s0, -half, below), at(s0, half, below), at(s0, half, top), at(s0, -half, top), back)
    quad(at(s0, -half, yb), at(s1, -half, yb), at(s1, half, yb), at(s0, half, yb), down)
    for (const side of [-1, 1]) {
      const toward: Point = [px * side, 0, pz * side]
      const [a, b, c, d] = [
        at(s0, side * half, yb),
        at(s1, side * half, yb),
        at(s1, side * half, top),
        at(s0, side * half, top),
      ]
      if (i === 0) {
        tri(a, b, c, toward)
        tri(a, c, d, toward)
      } else {
        const e = at(s0, side * half, tops[i - 1] as number)
        tri(b, c, d, toward)
        tri(b, d, e, toward)
        tri(b, e, a, toward)
      }
    }
  }
  const last = tops[n - 1] as number
  quad(at(INTO, -half, yb), at(INTO, half, yb), at(INTO, half, last), at(INTO, -half, last), ahead)
  return out
}

const TREAD_TEXEL = [SWATCH.slate.u, swatchV(SWATCH.slate, 0.1)] as const
const WALL_TEXEL = [SWATCH.slate.u, swatchV(SWATCH.slate, 0.5)] as const

/** The faces of the flights whose top stands where `inHex` says, each with its texel: stone, the treads lighter. */
export function flightsIn(
  flights: readonly Flight[],
  inHex: (x: number, z: number) => boolean,
): { tri: [Point, Point, Point]; texel: readonly [number, number] }[] {
  return flights
    .filter((f) => inHex(f.x, f.z))
    .flatMap(flightFaces)
    .map(({ tri, tread }) => ({ tri, texel: tread ? TREAD_TEXEL : WALL_TEXEL }))
}
