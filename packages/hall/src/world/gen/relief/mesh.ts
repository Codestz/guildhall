import type { Cell } from "../../lands.ts"
import { hash, key, step } from "../hex.ts"
import type { Relief } from "./index.ts"
import { CORNERS, centreOf, pointOf, RES } from "./lattice.ts"
import { SWATCH, swatchV } from "./swatches.ts"

/**
 * A relief as geometry (terrain v2 §6.1): the per-hex-set builder the island and the planned region
 * chunks (world/chunks.ts) call, once per hex set and detail tier. Pure typed arrays, no three.js.
 * The faces are flat-shaded (a non-indexed mesh with face normals: the kit's own faceted look), each
 * UV'd onto one palette swatch (swatches.ts) by its slope and height, so it joins the lands batch.
 *
 * Tiers nest: tier 0 is the lattice's finest (96 triangles a hex), tier 1 every other vertex (24),
 * tier 2 only the hex corners and centre (6).
 *
 * Where the set ends a skirt hangs below the edge: 5 units over a hex outside every massif (the same
 * drop as a tile's column, so no gap shows under a bevelled rim), 3 over a hex of the same massif that
 * another set draws (a crack where two tiers meet).
 */

export type DetailTier = 0 | 1 | 2

export interface MeshArrays {
  position: Float32Array
  normal: Float32Array
  uv: Float32Array
}

/** Skirts: over the rim, and over a seam between two sets of one massif. */
const RIM_DROP = 5
const SEAM_DROP = 3
/** Face slopes (degrees from flat): grass up to here, below the tree line. */
const GRASS_SLOPE = 36
/** Beyond this a face is a wall, in dark stone. */
const WALL_SLOPE = 66
/** Grass stops at this share of the main peak's height. */
const TREE_LINE = 0.55

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x))

export function reliefMesh(relief: Relief, cells: readonly Cell[], tier: DetailTier = 0): MeshArrays {
  const n = RES >> tier
  const stride = RES / n
  const inSet = new Set(cells.map(key))
  const position: number[] = []
  const normal: number[] = []
  const uv: number[] = []

  const emit = (
    a: readonly number[],
    b: readonly number[],
    c: readonly number[],
    texel: readonly [number, number],
    up: boolean,
    outward?: readonly [number, number],
  ): void => {
    let [p, q, r] = [a, b, c]
    let nx =
      ((q[1] as number) - (p[1] as number)) * ((r[2] as number) - (p[2] as number)) -
      ((q[2] as number) - (p[2] as number)) * ((r[1] as number) - (p[1] as number))
    let ny =
      ((q[2] as number) - (p[2] as number)) * ((r[0] as number) - (p[0] as number)) -
      ((q[0] as number) - (p[0] as number)) * ((r[2] as number) - (p[2] as number))
    let nz =
      ((q[0] as number) - (p[0] as number)) * ((r[1] as number) - (p[1] as number)) -
      ((q[1] as number) - (p[1] as number)) * ((r[0] as number) - (p[0] as number))
    const flip = up ? ny < 0 : outward ? nx * outward[0] + nz * outward[1] < 0 : false
    if (flip) {
      ;[q, r] = [r, q]
      nx = -nx
      ny = -ny
      nz = -nz
    }
    const length = Math.hypot(nx, ny, nz) || 1
    for (const v of [p, q, r]) {
      position.push(v[0] as number, v[1] as number, v[2] as number)
      normal.push(nx / length, ny / length, nz / length)
      uv.push(texel[0], texel[1])
    }
  }

  for (const cell of cells) {
    const massif = relief.massifAt(cell)
    if (!massif) continue
    const { grid } = massif
    const [ci, cj] = centreOf(cell)
    // x, y, z, and the lattice vertex's own smoothed steepness (what paints a face).
    const vertex = (i: number, j: number, drop = 0): number[] => {
      const [x, z] = pointOf(i, j)
      return [x, grid.get(i, j) - drop, z, massif.slope[grid.index(i, j)] as number]
    }

    for (let k = 0; k < 6; k++) {
      const [ai, aj] = CORNERS[k] as readonly [number, number]
      const [bi, bj] = CORNERS[(k + 1) % 6] as readonly [number, number]
      const at = (a: number, b: number): number[] =>
        vertex(ci + stride * (a * ai + b * bi), cj + stride * (a * aj + b * bj))
      for (let a = 0; a < n; a++)
        for (let b = 0; a + b < n; b++) {
          const faces: [number[], number[], number[]][] = [[at(a, b), at(a + 1, b), at(a, b + 1)]]
          if (a + b < n - 1) faces.push([at(a + 1, b), at(a + 1, b + 1), at(a, b + 1)])
          for (const [p, q, r] of faces) emit(p, q, r, paint(p, q, r, massif.height), true)
        }
    }

    for (let d = 0; d < 6; d++) {
      const next = step(cell, d)
      if (inSet.has(key(next))) continue
      const seam = relief.massifAt(next) === massif
      const drop = seam ? SEAM_DROP : RIM_DROP
      const [ai, aj] = CORNERS[d] as readonly [number, number]
      const [bi, bj] = CORNERS[(d + 1) % 6] as readonly [number, number]
      const edge = (a: number, lower = false): number[] =>
        vertex(ci + stride * ((n - a) * ai + a * bi), cj + stride * ((n - a) * aj + a * bj), lower ? drop : 0)
      const angle = (Math.PI / 6) * (1 + 2 * d)
      const outward = [Math.cos(angle), Math.sin(angle)] as const
      const texel: readonly [number, number] = seam
        ? [SWATCH.dark.u, swatchV(SWATCH.dark, 0.7)]
        : [SWATCH.grass.u, SWATCH.grass.dark]
      for (let a = 0; a < n; a++) {
        emit(edge(a), edge(a + 1), edge(a, true), texel, false, outward)
        emit(edge(a + 1), edge(a + 1, true), edge(a, true), texel, false, outward)
      }
    }
  }
  return {
    position: Float32Array.from(position),
    normal: Float32Array.from(normal),
    uv: Float32Array.from(uv),
  }
}

/** A face's swatch: grass on gentle ground below the tree line, light rock above and on slopes, dark stone on walls. */
function paint(
  p: readonly number[],
  q: readonly number[],
  r: readonly number[],
  peak: number,
): [number, number] {
  const grade = ((p[3] as number) + (q[3] as number) + (r[3] as number)) / 3
  const slope = (Math.atan(grade) * 180) / Math.PI
  const height = ((p[1] as number) + (q[1] as number) + (r[1] as number)) / 3
  const rel = clamp01(height / Math.max(1, peak))
  // A little per-face variation, stable: the kit's facets are never all one shade.
  const jitter =
    (hash(`${(p[0] as number).toFixed(1)},${(p[2] as number).toFixed(1)}`) / 4294967296 - 0.5) * 0.03
  if (slope >= WALL_SLOPE) return [SWATCH.dark.u, swatchV(SWATCH.dark, 1 - rel + jitter)]
  if (slope < GRASS_SLOPE && rel < TREE_LINE) {
    // A tile's own top is v 0.643: flat low ground matches the tiles beside it, steeper and higher turns olive and light.
    const t = 0.38 + 0.5 * (slope / GRASS_SLOPE) - 0.4 * (rel / TREE_LINE)
    return [SWATCH.grass.u, swatchV(SWATCH.grass, t + jitter)]
  }
  return [SWATCH.rock.u, swatchV(SWATCH.rock, 1 - rel + jitter)]
}
