import type { Cell } from "../../lands.ts"
import type { Spot } from "../../layout.ts"
import { TERRACE } from "../../waterways.ts"
import { key, step } from "../hex.ts"
import { shapingOf, sharpen } from "./facets.ts"
import { CIRCUM, CORNERS, centreOf, HeightGrid, pointOf, RES, ROW } from "./lattice.ts"
import { type Peak, type Ridge, type Saddle, skeletonOf } from "./ridges.ts"
import { type Source, spread } from "./spread.ts"
import type { ReliefStyle } from "./style.ts"
import { settle } from "./summits.ts"

/**
 * A massif's height field (terrain v2 §1.2–§2.2) on the lattice: the rim takes the neighbouring
 * hexes' tops exactly (or the sea cliff's −1.5 facing the sea), the skeleton's crests rise from it,
 * the flanks fall off each crest with the distance to the rim, ridged noise breaks them up, and the
 * result is pulled towards TERRACE ledges so the mountain speaks the hex kit's terrace language.
 */

/** Where a massif meets the sea: below the waterline, so the shore bake sees a cliff. */
export const SEA_RIM = -1.5
/** How far the strata pull a height towards its nearest ledge (0 smooth, 1 terraced). */
const LEDGE = 0.65
/** How sharply a flank falls from its crest: 1 a cone, higher a sharper ridge. */
const FLANK = 1.7
/** A crest is this wide a crown, world units each side, before its flank starts falling. */
const CROWN = 3
/** Blur passes over the relief (the nearest-crest creases between neighbouring vertices). */
const SOFTEN = 3
/** Lumps the slope limit's planes are broken up by after it (world units, two scales). */
const LUMPS = [1.3, 2.2] as const
/** Ridged-noise amplitude, share of the peak. */
const ROUGH = 0.07
/** Gully depth, world units, and the width (units) of the noise they follow: valley lines cut down the flanks. */
const GULLY = 2.6
const GULLY_SCALE = 7
/** Ledges only settle ground this gentle (rise over a lattice step): a slope keeps its own smooth facets. */
const BENCH = 0.6
/** The steepest a flank may fall, rise over run (56°): taller than that is a cliff, which only the rim's own step makes. */
const GRADE = 1.5
/** The steepest a small massif's flank may be made (65°), to keep its peak. */
const MOST = 2.2
/** Gauss–Seidel passes that blur the rim's heights into the base (the creases between nearest rims). */
const BLUR = 12

export interface Massif {
  id: number
  cells: Cell[]
  keys: ReadonlySet<string>
  /** The main peak's height, world units: what the footprint can hold of the height asked for. */
  height: number
  peaks: Peak[]
  ridges: Ridge[]
  saddles: Saddle[]
  grid: HeightGrid
  /** Steepness (rise over run) at each lattice vertex, smoothed: what the mesh paints grass, rock and walls by. */
  slope: Float32Array
}

const SIX = [
  [1, 0],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [0, -1],
  [1, -1],
] as const

const smooth = (x: number): number => {
  const t = Math.min(1, Math.max(0, x))
  return t * t * (3 - 2 * t)
}

/** An integer hash of a lattice point to [0, 1) (no strings, no closures: it runs per vertex). */
function lattice(seed: number, i: number, j: number, salt: number): number {
  let h = Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1) ^ Math.imul(seed ^ salt, 0x9e3779b1)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** Value noise in [0, 1) at a world point. */
export function valueNoise(seed: number, x: number, z: number, salt: number): number {
  const x0 = Math.floor(x)
  const z0 = Math.floor(z)
  const u = smooth(x - x0)
  const v = smooth(z - z0)
  return (
    (lattice(seed, x0, z0, salt) * (1 - u) + lattice(seed, x0 + 1, z0, salt) * u) * (1 - v) +
    (lattice(seed, x0, z0 + 1, salt) * (1 - u) + lattice(seed, x0 + 1, z0 + 1, salt) * u) * v
  )
}

export interface MassifSpec {
  id: number
  cells: Cell[]
  /** The main peak's height. */
  height: number
  hub: Spot
  seed: number
  /** The ground a hex outside the massif stands at: its terrace top, or the sea cliff's. */
  topOf(cell: Cell): number
  /** The art direction (style.ts); absent is the default. */
  style?: ReliefStyle
}

/** The ridge's points as lattice sources, one about every lattice step, each carrying its crest height. */
function crestSources(ridges: readonly Ridge[]): Source[] {
  const pitch = CIRCUM / RES
  const sources: Source[] = []
  for (const ridge of ridges)
    for (let k = 0; k + 1 < ridge.points.length; k++) {
      const [ax, az] = ridge.points[k] as Spot
      const [bx, bz] = ridge.points[k + 1] as Spot
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / pitch))
      for (let s = 0; s <= steps; s++) {
        const t = s / steps
        const x = ax + (bx - ax) * t
        const z = az + (bz - az) * t
        const j = Math.round((z * RES) / ROW)
        const i = Math.round((x * RES) / CIRCUM - j / 2)
        const [vx, vz] = pointOf(i, j)
        const crest = (ridge.crest[k] as number) * (1 - t) + (ridge.crest[k + 1] as number) * t
        sources.push({ i, j, d: Math.hypot(x - vx, z - vz), value: crest })
      }
    }
  return sources.sort((a, b) => b.value - a.value)
}

/** Builds the massif: skeleton, then the grid of heights. Pure and deterministic. */
export function massifOf(spec: MassifSpec): Massif {
  const { cells, height, seed } = spec
  const keys = new Set(cells.map(key))
  const { peaks, ridges, saddles } = skeletonOf(cells, keys, spec.hub, height, seed)

  // The vertices the massif owns, in a box over its cells.
  let i0 = Number.POSITIVE_INFINITY
  let i1 = Number.NEGATIVE_INFINITY
  let j0 = Number.POSITIVE_INFINITY
  let j1 = Number.NEGATIVE_INFINITY
  for (const cell of cells) {
    const [ci, cj] = centreOf(cell)
    i0 = Math.min(i0, ci - RES)
    i1 = Math.max(i1, ci + RES)
    j0 = Math.min(j0, cj - RES)
    j1 = Math.max(j1, cj + RES)
  }
  const grid = new HeightGrid(i0, j0, i1 - i0 + 1, j1 - j0 + 1)
  const owned = new Uint8Array(grid.data.length)
  for (const cell of cells) {
    const [ci, cj] = centreOf(cell)
    for (let k = 0; k < 6; k++) {
      const [ai, aj] = CORNERS[k] as readonly [number, number]
      const [bi, bj] = CORNERS[(k + 1) % 6] as readonly [number, number]
      for (let a = 0; a <= RES; a++)
        for (let b = 0; a + b <= RES; b++) owned[grid.index(ci + a * ai + b * bi, cj + a * aj + b * bj)] = 1
    }
  }

  // The rim: the lattice points along every edge that faces a hex outside, at that hex's top.
  const rim = new Float32Array(owned.length).fill(Number.POSITIVE_INFINITY)
  for (const cell of cells) {
    const [ci, cj] = centreOf(cell)
    for (let d = 0; d < 6; d++) {
      const next = step(cell, d)
      if (keys.has(key(next))) continue
      const top = spec.topOf(next)
      const [ai, aj] = CORNERS[d] as readonly [number, number]
      const [bi, bj] = CORNERS[(d + 1) % 6] as readonly [number, number]
      for (let a = 0; a <= RES; a++) {
        const at = grid.index(ci + (RES - a) * ai + a * bi, cj + (RES - a) * aj + a * bj)
        rim[at] = Math.min(rim[at] as number, top)
      }
    }
  }
  const isRim = (at: number): boolean => rim[at] !== Number.POSITIVE_INFINITY
  // Distance to the rim, and the base: the nearest rim's height, blurred.
  const rimSources: Source[] = []
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) {
      const at = grid.index(i, j)
      if (isRim(at)) rimSources.push({ i, j, value: rim[at] as number })
    }
  const { dist: toRim, carry: base } = spread(grid, owned, rimSources)
  relax(base, grid, owned, BLUR, isRim)

  // The relief above the base: the nearest crest's flank (its height falling off with the share of
  // the way to the rim), plus ridged noise.
  const { dist: toCrest, carry: crest } = spread(grid, owned, crestSources(ridges))
  const lift = new Float32Array(owned.length)
  let top = 0
  let peakAt = 0
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) {
      const at = grid.index(i, j)
      if (!owned[at] || isRim(at)) continue
      const [x, z] = pointOf(i, j)
      const d = Math.max(0, (toCrest[at] as number) - CROWN)
      const rimDistance = toRim[at] as number
      const flank = (crest[at] as number) * (1 - d / (d + rimDistance)) ** FLANK
      const ridged =
        1 -
        Math.abs(2 * valueNoise(seed, x / 14, z / 14, 1) - 1) +
        0.5 * (1 - Math.abs(2 * valueNoise(seed, x / 6, z / 6, 2) - 1))
      lift[at] = flank + ROUGH * height * ridged * smooth(rimDistance / 12) * (flank / Math.max(1, height))
    }
  relax(lift, grid, owned, SOFTEN, isRim)
  for (let at = 0; at < lift.length; at++)
    if ((lift[at] as number) > top) {
      top = lift[at] as number
      peakAt = at
    }
  // Scale so the tallest vertex is exactly the main peak's height.
  const scale = top > 0 ? Math.max(0.01, height - (base[peakAt] as number)) / top : 1
  // No flank steeper than the grade: a small massif may be steeper (a crag), never past MOST.
  const raw = new Float32Array(owned.length)
  for (let at = 0; at < raw.length; at++)
    raw[at] = isRim(at) ? (rim[at] as number) : (base[at] as number) + (lift[at] as number) * scale
  // Gullies: where a noise's ridge line runs (a narrow valley), the flank is cut, deeper higher up.
  // Cut before the grade limit, so no gully is steeper than a flank may be.
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) {
      const at = grid.index(i, j)
      if (!owned[at] || isRim(at)) continue
      const [x, z] = pointOf(i, j)
      const warp = valueNoise(seed, x / 17, z / 17, 5) * 6
      const line = 1 - Math.abs(2 * valueNoise(seed, x / GULLY_SCALE + warp, z / GULLY_SCALE - warp, 6) - 1)
      const high = smooth((raw[at] as number) / Math.max(1, height) / 0.7)
      raw[at] = (raw[at] as number) - GULLY * line ** 5 * high * smooth(((toRim[at] as number) - 4) / 10)
    }
  if (spec.style === "c")
    for (let at = 0; at < raw.length; at++)
      if (owned[at] && !isRim(at)) raw[at] = sharpen(raw[at] as number, height)
  const needed = (height - (base[peakAt] as number)) / Math.max(1, toRim[peakAt] as number)
  limit(raw, grid, owned, isRim, Math.min(MOST, Math.max(GRADE, needed * 1.1)))
  // The limit leaves flat planes; lumps of two sizes (more where it is steep) make them rock.
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) {
      const at = grid.index(i, j)
      if (!owned[at] || isRim(at)) continue
      const [x, z] = pointOf(i, j)
      const lumps =
        (valueNoise(seed, x / 9, z / 9, 3) - 0.5) * 2 * LUMPS[0] +
        (valueNoise(seed, x / 22, z / 22, 4) - 0.5) * 2 * LUMPS[1]
      raw[at] = (raw[at] as number) + lumps * smooth((toRim[at] as number) / 10)
    }
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) {
      const at = grid.index(i, j)
      if (!owned[at]) continue
      if (isRim(at)) {
        grid.data[at] = rim[at] as number
        continue
      }
      // Ledges settle gentle ground into benches; a slope keeps its own smooth line (no stairs).
      let steep = 0
      for (const [di, dj] of SIX) {
        const near = grid.index(i + di, j + dj)
        if (near >= 0 && owned[near])
          steep = Math.max(steep, Math.abs((raw[near] as number) - (raw[at] as number)))
      }
      const value = raw[at] as number
      const ledge = Math.round(value / TERRACE) * TERRACE
      const weight = LEDGE * smooth((toRim[at] as number) / 8) * (1 - smooth((steep - BENCH) / 1.2))
      let settled = value + (ledge - value) * weight
      // Never more than the rim's own cliff (two ledges) from a rim vertex beside it.
      for (const [di, dj] of SIX) {
        const near = grid.index(i + di, j + dj)
        if (near >= 0 && isRim(near))
          settled = Math.min(
            Math.max(settled, (rim[near] as number) - 2 * TERRACE),
            (rim[near] as number) + 2 * TERRACE,
          )
      }
      grid.data[at] = settled
    }
  // The peaks and saddles as the finished ground stands (the skeleton's heights were asks).
  const shaping = shapingOf(spec.style ?? "current", grid, owned, isRim)
  shaping?.apply()
  const summits = settle(
    grid,
    shaping?.fixed ?? ((i, j) => isRim(grid.index(i, j))),
    peaks,
    saddles,
    shaping?.apply,
  )
  const slope = new Float32Array(owned.length)
  const pitch = CIRCUM / RES
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) {
      const at = grid.index(i, j)
      if (!owned[at]) continue
      let steep = 0
      for (const [di, dj] of SIX) {
        const near = grid.index(i + di, j + dj)
        if (near >= 0 && owned[near])
          steep = Math.max(steep, Math.abs((grid.data[near] as number) - (grid.data[at] as number)) / pitch)
      }
      slope[at] = steep
    }
  relax(slope, grid, owned, 1)
  return {
    id: spec.id,
    cells,
    keys,
    height: summits.peaks[0]?.height ?? 0,
    peaks: summits.peaks,
    ridges,
    saddles: summits.saddles,
    grid,
    slope,
  }
}

/**
 * Blurs `values` over the owned vertices (each becomes the mean of itself and its owned neighbours),
 * `passes` times; the `fixed` ones (the rim) stay put and do not count as neighbours.
 */
function relax(
  values: Float32Array,
  grid: HeightGrid,
  owned: Uint8Array,
  passes: number,
  fixed: (at: number) => boolean = () => false,
): void {
  const next = Float32Array.from(values)
  for (let pass = 0; pass < passes; pass++) {
    for (let j = grid.j0; j < grid.j0 + grid.height; j++)
      for (let i = grid.i0; i < grid.i0 + grid.width; i++) {
        const at = grid.index(i, j)
        if (!owned[at] || fixed(at)) continue
        let sum = values[at] as number
        let n = 1
        for (const [di, dj] of SIX) {
          const near = grid.index(i + di, j + dj)
          if (near >= 0 && owned[near] && !fixed(near)) {
            sum += values[near] as number
            n++
          }
        }
        next[at] = sum / n
      }
    values.set(next)
  }
}

/**
 * Caps every owned vertex at its neighbours' height plus the climb a grade allows (rise over run),
 * sweeping the lattice forwards and back until nothing moves: the lowest any vertex's height plus the
 * way up from it. The rim is fixed: it only ever lowers the heights beside it.
 */
function limit(
  values: Float32Array,
  grid: HeightGrid,
  owned: Uint8Array,
  fixed: (at: number) => boolean,
  grade: number,
): void {
  const step = grade * (CIRCUM / RES)
  const forward = [
    [-1, 0],
    [0, -1],
    [1, -1],
  ] as const
  const back = [
    [1, 0],
    [0, 1],
    [-1, 1],
  ] as const
  const sweep = (order: 1 | -1, neighbours: typeof forward | typeof back): boolean => {
    let moved = false
    const [from, to] = order === 1 ? [0, grid.height] : [grid.height - 1, -1]
    for (let y = from; y !== to; y += order)
      for (let x = order === 1 ? 0 : grid.width - 1; x >= 0 && x < grid.width; x += order) {
        const at = y * grid.width + x
        if (!owned[at] || fixed(at)) continue
        for (const [di, dj] of neighbours) {
          const near = grid.index(grid.i0 + x + di, grid.j0 + y + dj)
          if (near < 0 || !owned[near]) continue
          const cap = (values[near] as number) + step
          if ((values[at] as number) > cap) {
            values[at] = cap
            moved = true
          }
        }
      }
    return moved
  }
  for (let round = 0; round < 6; round++) {
    const a = sweep(1, forward)
    const b = sweep(-1, back)
    if (!a && !b) break
  }
}
