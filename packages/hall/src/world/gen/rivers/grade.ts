import type { Cell } from "../../lands.ts"
import type { Spot } from "../../layout.ts"
import {
  channelLine,
  type Fall,
  fallHeights,
  GRADE_STEP,
  type Point3,
  type Reach,
  type RiverHex,
  surfaceY,
  TERRACE,
  type Waterways,
} from "../../waterways.ts"
import { key } from "../hex.ts"

/**
 * Rivers that run down a mountain (terrain 2c, after the water layer sorted them): over a massif
 * the water layer's reaches are flat patches a terrace apart, a stair of pools and small falls.
 * Here every run of river hexes over a massif becomes a graded reach instead — a surface that
 * follows the ground down the channel, smoothed and never rising, so the water runs the slope as
 * one stream (carve.ts cuts the bed to it; scene/nature/ribbonMesh.ts draws it). A fall stays only
 * at a real ledge: a hex edge the water layer had a fall on where the ground itself drops over
 * LEDGE in a short run. Where a run meets the lowland's flat water (or the sea) its surface comes
 * down to that water's level, so the stream arrives rather than steps. Pure; reads the relief's
 * heights before they are carved.
 */

/** A fall needs the ground to drop this far over the two samples round a hex edge (a short run). */
const LEDGE = 2 * TERRACE
/** ...and its water to drop at least this far (else it is one stream after all). */
const MIN_DROP = TERRACE
/** The ground's samples are averaged over this many either side, so the surface doesn't follow every lump. */
const SMOOTH = 2
/** Where a run comes down to the water ahead, over this many samples. */
const RAMP = 4

/** The ground as grading sees it, before the relief is carved. */
export interface GradeGround {
  /** Its height at a world point: the relief's under a massif, the terrace's elsewhere. */
  heightAt(x: number, z: number): number
  /** Whether a hex lies under a massif. */
  relief(cell: Cell): boolean
  /** A hex's terrace level (a river hex's own), 0 at sea. */
  level(cell: Cell): number
  /** Whether a hex is under a lake (whose water lies lower than a river's on its level). */
  lake?(cell: Cell): boolean
}

const same = (a: Cell | undefined, b: Cell | undefined): boolean => !!a && !!b && key(a) === key(b)

/** Reaches the water layer gave one course, in order: each starts where the one before ended. */
function chainsOf(rivers: readonly Reach[]): Reach[][] {
  const chains: Reach[][] = []
  for (const reach of rivers) {
    const chain = chains.at(-1)
    const tail = chain?.at(-1)
    if (chain && tail && same(reach.prev, tail.hexes.at(-1)?.cell) && same(tail.next, reach.hexes[0]?.cell))
      chain.push(reach)
    else chains.push([reach])
  }
  return chains
}

/** `waters` with its reaches over massifs graded, and a fall kept only where the ground has a ledge. */
export function gradeWaters(waters: Waterways, ground: GradeGround): Waterways {
  if (!waters.rivers.some((reach) => reach.hexes.some((hex) => ground.relief(hex.cell)))) return waters
  const legacy = new Map(waters.falls.map((fall) => [`${key(fall.from)}>${key(fall.to)}`, fall]))
  const fallAt = (from: Cell | undefined, to: Cell | undefined) =>
    from && to ? legacy.get(`${key(from)}>${key(to)}`) : undefined
  const rivers: Reach[] = []
  const falls: Fall[] = []
  const regraded = new Set<Fall>()
  /** Each graded hex's surface, for a river that joins it. */
  const graded = new Map<string, Point3[]>()
  const joined = (cell: Cell, [x, z]: Spot): number => {
    const grade = graded.get(key(cell))
    if (!grade) return surfaceY(ground.lake?.(cell) ? "lake" : "river", ground.level(cell))
    const near = (p: Point3) => Math.hypot(p[0] - x, p[2] - z)
    return grade.reduce((best, p) => (near(p) < near(best) ? p : best))[1]
  }

  for (const chain of chainsOf(waters.rivers)) {
    const hexes = chain.flatMap((reach) => reach.hexes)
    const origin = chain.flatMap((reach, n) => reach.hexes.map(() => n))
    const wet = (m: number) => ground.relief((hexes[m] as RiverHex).cell)
    for (let i = 0; i < hexes.length; ) {
      // A run: hexes over a massif together, or hexes of one flat reach outside them.
      let j = i
      while (j + 1 < hexes.length && wet(j + 1) === wet(i) && (wet(i) || origin[j + 1] === origin[i])) j++
      const run = hexes.slice(i, j + 1)
      const prev = hexes[i - 1]?.cell ?? chain[0]?.prev
      const next = hexes[j + 1]?.cell ?? (chain.at(-1)?.next as Cell)
      if (!wet(i))
        rivers.push({ level: (hexes[i] as RiverHex).level, hexes: run, ...(prev ? { prev } : {}), next })
      else {
        const down = hexes[j + 1]
        const made = gradeRun(run, {
          ground,
          prev,
          next,
          yUp: hexes[i - 1] ? surfaceY("river", (hexes[i - 1] as RiverHex).level) : undefined,
          yDown: (to) => (down ? surfaceY("river", down.level) : joined(next, to)),
          fallIn: fallAt(prev, run[0]?.cell),
          fallOut: fallAt(run.at(-1)?.cell, next),
          fallBetween: (k) => fallAt(run[k - 1]?.cell, run[k]?.cell),
        })
        for (const reach of made.reaches) {
          rivers.push(reach)
          for (const hex of reach.hexes) graded.set(key(hex.cell), reach.grade as Point3[])
        }
        falls.push(...made.falls)
        for (const fall of made.regraded) regraded.add(fall)
      }
      i = j + 1
    }
  }
  return { ...waters, rivers, falls: [...waters.falls.filter((fall) => !regraded.has(fall)), ...falls] }
}

interface Run {
  ground: GradeGround
  /** The cells upstream of the run (absent at a spring) and downstream of it. */
  prev: Cell | undefined
  next: Cell
  /** The flat river above the run (absent at a spring), and the water below it at its exit point. */
  yUp: number | undefined
  yDown(exit: Spot): number
  /** The water layer's falls into and out of the run, and before its k-th hex. */
  fallIn: Fall | undefined
  fallOut: Fall | undefined
  fallBetween(k: number): Fall | undefined
}

/** A run of massif river hexes as graded reaches (split at its ledges), and the falls at its ledges. */
function gradeRun(hexes: RiverHex[], run: Run): { reaches: Reach[]; falls: Fall[]; regraded: Fall[] } {
  const n = hexes.length
  // The channel sampled every ≤ GRADE_STEP, a sample on each hex edge: sample `cut[k - 1]` is edge k's.
  const pts: Spot[] = []
  const cut: number[] = []
  hexes.forEach((hex, k) => {
    const part = resample(channelLine([hex]))
    pts.push(...(k === 0 ? part : part.slice(1)))
    if (k < n - 1) cut.push(pts.length - 1)
  })
  const last = pts.length - 1
  const edgeAt = (k: number): number => (k === 0 ? 0 : k === n ? last : (cut[k - 1] as number))
  const height = (p: Spot) => run.ground.heightAt(p[0], p[1])
  const g = pts.map(height)
  // The ground a step past either end of the run, for a ledge at its ends.
  const past = (a: Spot, b: Spot): Spot => {
    const d = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1
    return [a[0] + ((a[0] - b[0]) / d) * GRADE_STEP, a[1] + ((a[1] - b[1]) / d) * GRADE_STEP]
  }
  /** The ground a step above and below sample m: a fall's lip and its foot. */
  const lip = (m: number) => (m > 0 ? (g[m - 1] as number) : height(past(pts[0] as Spot, pts[1] as Spot)))
  const foot = (m: number) =>
    m < last ? (g[m + 1] as number) : height(past(pts[last] as Spot, pts[last - 1] as Spot))

  const fallsAt = (k: number): Fall | undefined =>
    k === 0 ? run.fallIn : k === n ? run.fallOut : run.fallBetween(k)
  const edges = Array.from({ length: n + 1 }, (_, k) => k)
  const regraded = edges.flatMap((k) => fallsAt(k) ?? [])
  /** The edges where the water layer's fall stands on a ledge of the ground. */
  const ledges = new Set(edges.filter((k) => fallsAt(k) && lip(edgeAt(k)) - foot(edgeAt(k)) > LEDGE))

  const reaches: Reach[] = []
  const falls: Fall[] = []
  const splits = edges.filter((k) => k === 0 || k === n || ledges.has(k))
  /** The water the stream came from at its start: the flat river above, or the lip of a ledge. */
  let above: number | undefined = ledges.has(0) ? undefined : run.yUp
  for (let s = 0; s + 1 < splits.length; s++) {
    const [k0, k1] = [splits[s] as number, splits[s + 1] as number]
    const [lo, hi] = [edgeAt(k0), edgeAt(k1)]
    const slope = g.slice(lo, hi + 1)
    // A ledge holds the ground at its lip and at its foot: the water leaves one and lands on the other.
    if (ledges.has(k0)) slope[0] = foot(lo)
    if (ledges.has(k1)) slope[slope.length - 1] = lip(hi)
    const below = k1 === n ? run.yDown(pts[hi] as Spot) : undefined
    const arrive = ledges.has(k1) ? undefined : below
    let surface = descend(slope, ledges.has(k0) ? undefined : above, below, arrive)

    if (ledges.has(k0)) {
      const lipY = k0 === 0 ? (run.fallIn ? fallHeights(run.fallIn).top : undefined) : above
      const fall = fallsAt(k0) as Fall
      // A ledge whose water barely drops is no fall: the stream goes on from the water above.
      if (lipY !== undefined && lipY - (surface[0] as number) >= MIN_DROP)
        falls.push({ ...fall, topY: lipY, bottomY: surface[0] as number })
      else surface = descend(slope, lipY, below, arrive)
    }
    if (ledges.has(k1) && k1 === n) {
      const fall = fallsAt(n) as Fall
      const bottom = fallHeights(fall).bottom
      const lipY = surface.at(-1) as number
      if (lipY - bottom >= MIN_DROP) falls.push({ ...fall, topY: lipY, bottomY: bottom })
      else surface = descend(slope, surface[0], below, below)
    }
    above = surface.at(-1)

    const prev = k0 > 0 ? hexes[k0 - 1]?.cell : run.prev
    reaches.push({
      level: (hexes[k0] as RiverHex).level,
      hexes: hexes.slice(k0, k1),
      ...(prev ? { prev } : {}),
      next: k1 < n ? (hexes[k1] as RiverHex).cell : run.next,
      grade: surface.map((y, m): Point3 => [(pts[lo + m] as Spot)[0], y, (pts[lo + m] as Spot)[1]]),
    })
  }
  return { reaches, falls, regraded }
}

/**
 * The surface down a stretch of ground: smoothed, never rising, starting at `start` (else the
 * ground's own height), kept above `floor`, and brought down to land on `arrive` if there is one.
 */
function descend(
  ground: readonly number[],
  start: number | undefined,
  floor: number | undefined,
  arrive: number | undefined,
): number[] {
  const smooth = ground.map((_, m) => {
    let sum = 0
    let count = 0
    for (let d = -SMOOTH; d <= SMOOTH; d++) {
      const v = ground[m + d]
      if (v !== undefined) {
        sum += v
        count++
      }
    }
    return sum / count
  })
  let y = start ?? (smooth[0] as number)
  const flat = smooth.map((s, m) => {
    if (m > 0) y = Math.min(y, s)
    return Math.max(y, floor ?? Number.NEGATIVE_INFINITY)
  })
  if (arrive === undefined) return flat
  const lead = flat.length - 1 - RAMP
  return flat.map((v, m) => {
    const t = Math.min(1, Math.max(0, (m - lead) / RAMP))
    return v + (arrive - v) * t * t * (3 - 2 * t)
  })
}

/** A polyline as points ≤ GRADE_STEP apart, its ends included. */
function resample(line: readonly Spot[]): Spot[] {
  const lengths = [0]
  for (let i = 1; i < line.length; i++) {
    const [a, b] = [line[i - 1] as Spot, line[i] as Spot]
    lengths.push((lengths[i - 1] as number) + Math.hypot(b[0] - a[0], b[1] - a[1]))
  }
  const total = lengths.at(-1) as number
  const count = Math.max(1, Math.ceil(total / GRADE_STEP))
  const out: Spot[] = []
  let i = 1
  for (let m = 0; m <= count; m++) {
    const at = (total * m) / count
    while (i < line.length - 1 && (lengths[i] as number) < at) i++
    const [a, b] = [line[i - 1] as Spot, line[i] as Spot]
    const span = (lengths[i] as number) - (lengths[i - 1] as number)
    const t = span === 0 ? 0 : (at - (lengths[i - 1] as number)) / span
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
  }
  return out
}
