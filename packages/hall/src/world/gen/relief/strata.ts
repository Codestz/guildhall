import { LEDGE_STEP } from "./style.ts"

/**
 * The hybrid's ledges as true stairs (relief/style.ts, d). Strata's grid heights are ledge heights
 * (multiples of LEDGE_STEP), so a lattice triangle straddling two ledges is a ramp whose two
 * alternating orientations shade as a sawtooth. Here such a triangle is cut at the half-way height
 * between ledges instead: each part is a flat top at its own ledge, and the cut is a vertical riser,
 * one LEDGE_STEP high, facing downhill. Neighbouring triangles cut at the same height along their
 * shared edge, so the stairs are watertight; every top is one flat colour and every riser one
 * colour per ledge band, with one normal each.
 *
 * The trade-off: the grid (`heightAt`, so walkers and trees) still reads the ramp between two ledges,
 * so over that one-lattice-step band it is up to half a ledge off the mesh. On a flat ledge top the
 * two agree exactly, and dressing keeps its trees and rocks to flat ground (dressing.ts).
 */

type Vertex = readonly number[]

export interface Stairs {
  /** Flat tops, each at its ledge's height. */
  tops: [number[], number[], number[]][]
  /** Risers, with the ledge below them and the way they face (downhill, in x, z). */
  walls: { tri: [number[], number[], number[]]; low: number; outward: readonly [number, number] }[]
}

const EPS = 1e-3

/** Whether a height stands on a ledge. */
export const onLedge = (y: number): boolean => Math.abs(y / LEDGE_STEP - Math.round(y / LEDGE_STEP)) < EPS

/** The polygon clipped to heights in [from, to) (Sutherland–Hodgman against the two planes). */
function band(poly: Vertex[], from: number, to: number): Vertex[] {
  const clip = (input: Vertex[], inside: (y: number) => number, level: number): Vertex[] => {
    const out: Vertex[] = []
    for (let k = 0; k < input.length; k++) {
      const a = input[k] as Vertex
      const b = input[(k + 1) % input.length] as Vertex
      const da = inside(a[1] as number)
      const db = inside(b[1] as number)
      if (da >= 0) out.push(a)
      if (da >= 0 !== db >= 0) {
        const t = (level - (a[1] as number)) / ((b[1] as number) - (a[1] as number)) || 0
        out.push([
          (a[0] as number) + ((b[0] as number) - (a[0] as number)) * t,
          level,
          (a[2] as number) + ((b[2] as number) - (a[2] as number)) * t,
        ])
      }
    }
    return out
  }
  return clip(
    clip(poly, (y) => y - from, from),
    (y) => to - y - EPS,
    to,
  )
}

/** A triangle of ledge-height vertices as stairs. `p`, `q`, `r` are [x, y, z, ...]. */
export function stairsOf(p: Vertex, q: Vertex, r: Vertex): Stairs {
  const stairs: Stairs = { tops: [], walls: [] }
  const ys = [p[1], q[1], r[1]] as number[]
  const lo = Math.round(Math.min(...ys) / LEDGE_STEP)
  const hi = Math.round(Math.max(...ys) / LEDGE_STEP)
  const half = LEDGE_STEP / 2
  const corners = [p, q, r]
  // The downhill direction: minus the gradient of the plane the three heights make, in x, z.
  const [ux, uy, uz] = [
    (q[0] as number) - (p[0] as number),
    (q[1] as number) - (p[1] as number),
    (q[2] as number) - (p[2] as number),
  ]
  const [vx, vy, vz] = [
    (r[0] as number) - (p[0] as number),
    (r[1] as number) - (p[1] as number),
    (r[2] as number) - (p[2] as number),
  ]
  const det = ux * vz - uz * vx
  const outward: readonly [number, number] =
    Math.abs(det) < 1e-9 ? [0, 0] : [-(uy * vz - uz * vy) / det, -(ux * vy - uy * vx) / det]
  const slant = Math.hypot(outward[0], outward[1]) || 1
  const down: readonly [number, number] = [outward[0] / slant, outward[1] / slant]

  for (let level = lo; level <= hi; level++) {
    const y = level * LEDGE_STEP
    const piece = band(
      corners.map((c) => [...c]),
      level === lo ? Number.NEGATIVE_INFINITY : y - half,
      level === hi ? Number.POSITIVE_INFINITY : y + half,
    ).map((v): number[] => [v[0] as number, y, v[2] as number, 0])
    for (let k = 1; k + 1 < piece.length; k++) {
      const [a, b, c] = [piece[0], piece[k], piece[k + 1]] as [number[], number[], number[]]
      // Slivers the cuts leave at a corner draw nothing.
      if (
        Math.abs(
          ((b[0] as number) - (a[0] as number)) * ((c[2] as number) - (a[2] as number)) -
            ((b[2] as number) - (a[2] as number)) * ((c[0] as number) - (a[0] as number)),
        ) > 1e-4
      )
        stairs.tops.push([a, b, c])
    }
    if (level === hi) continue
    // The riser between this ledge and the next: where the plane crosses the half-way height.
    const cut: number[][] = []
    const mid = y + half
    for (let k = 0; k < 3; k++) {
      const a = corners[k] as Vertex
      const b = corners[(k + 1) % 3] as Vertex
      if ((a[1] as number) < mid === (b[1] as number) < mid) continue
      const t = (mid - (a[1] as number)) / ((b[1] as number) - (a[1] as number))
      cut.push([
        (a[0] as number) + ((b[0] as number) - (a[0] as number)) * t,
        0,
        (a[2] as number) + ((b[2] as number) - (a[2] as number)) * t,
        0,
      ])
    }
    if (cut.length !== 2) continue
    const [a, b] = cut as [number[], number[]]
    const at = (v: number[], height: number): number[] => [v[0] as number, height, v[2] as number, 0]
    stairs.walls.push({ tri: [at(a, y), at(b, y), at(b, y + LEDGE_STEP)], low: level, outward: down })
    stairs.walls.push({
      tri: [at(a, y), at(b, y + LEDGE_STEP), at(a, y + LEDGE_STEP)],
      low: level,
      outward: down,
    })
  }
  return stairs
}
