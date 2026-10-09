import { TERRACE } from "../../waterways.ts"
import { cellAt } from "../hex.ts"
import { CIRCUM, type HeightGrid, pointOf, RES, ROW } from "./lattice.ts"
import type { Peak, Saddle } from "./ridges.ts"

/**
 * Makes a massif's skeleton agree with its finished ground. The skeleton's heights were asks: the
 * slope limit clips a peak a small footprint cannot hold, and a saddle (a pass) can end up higher
 * than a summit it joins. Here every peak's height is read from the ground (the highest vertex
 * within a hex and a half of where its crest met), the tallest vertex of all is a peak, peaks are
 * ordered tallest first, and each saddle is cut down to lie below both of its peaks, or, where the
 * ground cannot give (the rim is fixed), the lower peak is merged away. The cut is made in the
 * grid, so the mesh and `heightAt` see it too.
 */

/** A peak is the highest vertex within this far of where its crest met, world units. */
const REACH = 1.5 * CIRCUM
/** A saddle lies at least this far below the lower of its peaks. */
const DEPTH = TERRACE
/** A saddle that cannot be cut this far below its lower peak merges that peak away. */
const LEAST = 0.5
/** How steeply the ground climbs out of a cut saddle (rise over run): a pass, not a trench. */
const CUT = 0.8

export interface Summits {
  peaks: Peak[]
  saddles: Saddle[]
}

type Spot2 = readonly [number, number]

/** The lattice vertex nearest a world point. */
function vertexOf([x, z]: Spot2): [number, number] {
  const j = Math.round((z * RES) / ROW)
  return [Math.round((x * RES) / CIRCUM - j / 2), j]
}

/** The skeleton's peaks and saddles, as the ground stands (the grid is lowered at the saddles). */
export function settle(
  grid: HeightGrid,
  fixed: (i: number, j: number) => boolean,
  asked: readonly Peak[],
  saddles: readonly Saddle[],
): Summits {
  const span = Math.ceil(REACH / (CIRCUM / RES)) + 1
  const summit = (peak: Peak): Peak => {
    const [i, j] = vertexOf(peak.at)
    let best: Peak = { ...peak, height: Number.NEGATIVE_INFINITY }
    for (let dj = -span; dj <= span; dj++)
      for (let di = -span; di <= span; di++) {
        const h = grid.get(i + di, j + dj)
        const at = pointOf(i + di, j + dj)
        if (h > best.height && Math.hypot(at[0] - peak.at[0], at[1] - peak.at[1]) <= REACH)
          best = { ...peak, at, height: h }
      }
    return best
  }
  const groundAt = ([x, z]: Spot2, fallback: number): number => grid.heightAt(x, z) ?? fallback

  let peaks = asked.map((peak) => {
    const found = summit(peak)
    return found.height === Number.NEGATIVE_INFINITY
      ? { ...peak, height: groundAt(peak.at, peak.height) }
      : found
  })
  const alive = peaks.map(() => true)
  const joined = (): { saddle: Saddle; a: number; b: number }[] =>
    saddles
      .map((saddle) => ({ saddle, a: saddle.between[0], b: saddle.between[1] }))
      .filter(({ a, b }) => alive[a] && alive[b])
  for (let round = 0; round <= peaks.length; round++) {
    for (const { saddle, a, b } of joined())
      cut(grid, fixed, saddle.at, Math.min(peaks[a]?.height ?? 0, peaks[b]?.height ?? 0) - DEPTH)
    peaks = peaks.map((peak) => ({ ...peak, height: groundAt(peak.at, peak.height) }))
    let merged = false
    for (const { saddle, a, b } of joined()) {
      const low = (peaks[a]?.height ?? 0) <= (peaks[b]?.height ?? 0) ? a : b
      if (groundAt(saddle.at, 0) > (peaks[low]?.height ?? 0) - LEAST) {
        alive[low] = false
        merged = true
      }
    }
    if (!merged) break
  }

  // The tallest vertex is always a peak; the peaks stand tallest first, the saddles follow them.
  const kept = peaks.map((peak, from) => ({ peak, from })).filter(({ from }) => alive[from])
  let top = Number.NEGATIVE_INFINITY
  let topAt: Spot2 = [0, 0]
  for (let j = grid.j0; j < grid.j0 + grid.height; j++)
    for (let i = grid.i0; i < grid.i0 + grid.width; i++) {
      const h = grid.get(i, j)
      if (h > top) {
        top = h
        topAt = pointOf(i, j)
      }
    }
  const crown: Peak = { cell: cellAt([topAt[0], topAt[1]]), at: [topAt[0], topAt[1]], height: top }
  const under = kept.find(({ peak }) => Math.hypot(peak.at[0] - topAt[0], peak.at[1] - topAt[1]) <= REACH)
  if (!under) kept.push({ peak: crown, from: -1 })
  else if (under.peak.height < top) under.peak = { ...under.peak, at: crown.at, height: top }
  kept.sort((p, q) => q.peak.height - p.peak.height || p.from - q.from)
  const now = new Map(kept.map(({ from }, to) => [from, to]))
  return {
    peaks: kept.map(({ peak }) => peak),
    saddles: saddles.flatMap((saddle) => {
      const a = now.get(saddle.between[0])
      const b = now.get(saddle.between[1])
      return a === undefined || b === undefined
        ? []
        : [{ ...saddle, height: groundAt(saddle.at, saddle.height), between: [a, b] as const }]
    }),
  }
}

/** Lowers the grid round `at` to at most `ceiling`, climbing out of the cut at CUT; the fixed vertices stay. */
function cut(grid: HeightGrid, fixed: (i: number, j: number) => boolean, at: Spot2, ceiling: number): void {
  const [i, j] = vertexOf(at)
  const span = Math.ceil((3 * ROW) / CUT / (CIRCUM / RES))
  for (let dj = -span; dj <= span; dj++)
    for (let di = -span; di <= span; di++) {
      const h = grid.get(i + di, j + dj)
      if (Number.isNaN(h) || fixed(i + di, j + dj)) continue
      const [x, z] = pointOf(i + di, j + dj)
      grid.set(i + di, j + dj, Math.min(h, ceiling + CUT * Math.hypot(x - at[0], z - at[1])))
    }
}
