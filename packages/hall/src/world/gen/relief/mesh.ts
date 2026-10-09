import type { Cell } from "../../lands.ts"
import { hash, key, step } from "../hex.ts"
import { isFaceted } from "./facets.ts"
import type { Relief } from "./index.ts"
import { CORNERS, centreOf, pointOf, RES } from "./lattice.ts"
import { onLedge, stairsOf } from "./strata.ts"
import { strideOf } from "./style.ts"
import { SWATCH, swatchV } from "./swatches.ts"
import { paintRiser, paintStrata, paintZones, TILE_TOP } from "./zones.ts"

/**
 * A relief as geometry (terrain v2 §6.1): the per-hex-set builder the island and the planned region
 * chunks (world/chunks.ts) call, once per hex set and detail tier. Pure typed arrays, no three.js.
 * The faces are flat-shaded (a non-indexed mesh with face normals: the kit's own faceted look), each
 * UV'd onto one palette swatch (swatches.ts) by its slope and height, so it joins the lands batch.
 *
 * Tiers nest: tier 0 is the lattice's finest (96 triangles a hex), tier 1 every other vertex (24),
 * tier 2 only the hex corners and centre (6): the far tier, which keeps the hybrid's stairs (cut at
 * its corners) and loses the sculpted summit's facets. The chunky styles keep a river hex's lattice at
 * every tier.
 * A river hex's edge facing a coarse hex is set on that hex's edge whether or not the coarse hex is in
 * the set, so a chunk's mesh joins its neighbour's, at any tier of either, without a crack of its own.
 *
 * The chunky styles (style.ts) mesh a hex at every `strideOf`-th vertex (24 triangles for the facets), except a hex a
 * river carved (it keeps its lattice) whose edge vertices facing a coarse hex are set on that hex's
 * edge, so no crack opens between the two. Their rim faces and skirts take the tile top's grass.
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
/** Grass climbs slopes this steep (degrees from flat) at the foot of a massif... */
const GRASS_FOOT = 70
/** ...and only this steep up at the tree line, so the meadow thins into rock rather than ending at a line. */
const GRASS_HIGH = 48
/** Beyond this a face is a wall, in dark stone. */
const WALL_SLOPE = 74
/** The tree line, a share of the massif's peak: grass thins up to it and is gone a little past. */
const TREE_LINE = 0.7

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x))

export function reliefMesh(relief: Relief, cells: readonly Cell[], tier: DetailTier = 0): MeshArrays {
  const tierN = RES >> tier
  const chunky = relief.style !== "current"
  const paintOf = relief.style === "b" || relief.style === "d" ? paintStrata : paintZones
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
    // A hex's lattice: the style's coarse one (or the tier's, if coarser), but a river's bed cut into a
    // hex keeps the finest at every tier, or the far ground would bury the stream.
    const coarse = RES / strideOf(relief.style)
    const nOf = (c: Cell): number =>
      !chunky ? tierN : isFaceted(grid, c, strideOf(relief.style)) ? Math.min(tierN, coarse) : RES
    const n = nOf(cell)
    const stride = RES / n
    const [ci, cj] = centreOf(cell)
    // Where a fine hex meets a coarse one the edge's in-between vertices lie on the coarse edge.
    const snapped = new Map<string, number>()
    if (chunky && n === RES)
      for (let d = 0; d < 6; d++) {
        const next = step(cell, d)
        if (!relief.massifAt(next) || nOf(next) >= n) continue
        const [ai, aj] = CORNERS[d] as readonly [number, number]
        const [bi, bj] = CORNERS[(d + 1) % 6] as readonly [number, number]
        const at = (a: number): readonly [number, number] => [
          ci + (n - a) * ai + a * bi,
          cj + (n - a) * aj + a * bj,
        ]
        for (let a = 1; a < n; a += 2) {
          const [i, j] = at(a)
          const [i0, j0] = at(a - 1)
          const [i1, j1] = at(a + 1)
          snapped.set(`${i},${j}`, (grid.get(i0, j0) + grid.get(i1, j1)) / 2)
        }
      }
    // x, y, z, and the lattice vertex's own smoothed steepness (what paints a face).
    const vertex = (i: number, j: number, drop = 0): number[] => {
      const [x, z] = pointOf(i, j)
      return [
        x,
        (snapped.get(`${i},${j}`) ?? grid.get(i, j)) - drop,
        z,
        massif.slope[grid.index(i, j)] as number,
      ]
    }

    for (let k = 0; k < 6; k++) {
      const [ai, aj] = CORNERS[k] as readonly [number, number]
      const [bi, bj] = CORNERS[(k + 1) % 6] as readonly [number, number]
      const at = (a: number, b: number): number[] =>
        vertex(ci + stride * (a * ai + b * bi), cj + stride * (a * aj + b * bj))
      const toTile = chunky && !relief.massifAt(step(cell, k))
      for (let a = 0; a < n; a++)
        for (let b = 0; a + b < n; b++) {
          const faces: [number[], number[], number[]][] = [[at(a, b), at(a + 1, b), at(a, b + 1)]]
          if (a + b < n - 1) faces.push([at(a + 1, b), at(a + 1, b + 1), at(a, b + 1)])
          for (const [p, q, r] of faces) {
            // A chunky massif's rim faces over land wear the tile top's grass: no seam to the hex ground.
            const rim =
              toTile && a + b === n - 1 && Math.min(p[1] as number, q[1] as number, r[1] as number) >= 0
            // The hybrid's ledges are stairs: tops and risers rather than a ramp between two ledges.
            if (
              relief.style === "d" &&
              [p, q, r].every((v) => onLedge(v[1] as number) && (v[1] as number) <= massif.ledgeTop + 1e-3)
            ) {
              const stairs = stairsOf(p, q, r)
              for (const t of stairs.tops)
                emit(t[0], t[1], t[2], rim ? TILE_TOP : paintOf(t[0], t[1], t[2], massif.height), true)
              for (const w of stairs.walls)
                emit(w.tri[0], w.tri[1], w.tri[2], paintRiser(w.low), false, w.outward)
              continue
            }
            const texel = !chunky
              ? paint(p, q, r, massif.height)
              : rim
                ? TILE_TOP
                : paintOf(p, q, r, massif.height)
            emit(p, q, r, texel, true)
          }
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
      const sea = (edge(0)[1] as number) < 0
      const texel: readonly [number, number] = seam
        ? [SWATCH.dark.u, swatchV(SWATCH.dark, 0.7)]
        : chunky && !sea
          ? TILE_TOP
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

/**
 * A face's swatch, as ground ages up a mountain: meadow and grass on the foothills (greens varying
 * face by face), a mottled belt where gentle faces keep grass and steep ones show rock (chosen by
 * the face's own slope, its height and a little noise, so never a ruled line), then rock in a few
 * greys and warm browns, and dark stone only on walls. Slope is read off the face itself.
 */
function paint(
  p: readonly number[],
  q: readonly number[],
  r: readonly number[],
  peak: number,
): [number, number] {
  const ux = (q[0] as number) - (p[0] as number)
  const uy = (q[1] as number) - (p[1] as number)
  const uz = (q[2] as number) - (p[2] as number)
  const vx = (r[0] as number) - (p[0] as number)
  const vy = (r[1] as number) - (p[1] as number)
  const vz = (r[2] as number) - (p[2] as number)
  const nx = uy * vz - uz * vy
  const ny = uz * vx - ux * vz
  const nz = ux * vy - uy * vx
  const slope = (Math.atan2(Math.hypot(nx, nz), Math.abs(ny)) * 180) / Math.PI
  const height = ((p[1] as number) + (q[1] as number) + (r[1] as number)) / 3
  const rel = clamp01(height / Math.max(1, peak))
  // Stable per-face chance: the kit's facets are never all one shade, and a belt is never ruled.
  const cx = ((p[0] as number) + (q[0] as number) + (r[0] as number)) / 3
  const cz = ((p[2] as number) + (q[2] as number) + (r[2] as number)) / 3
  const chance = hash(`${cx.toFixed(1)},${cz.toFixed(1)}`) / 4294967296
  const other = hash(`${cz.toFixed(1)}:${cx.toFixed(1)}`) / 4294967296
  const jitter = (chance - 0.5) * 0.2
  if (slope >= WALL_SLOPE) return [SWATCH.warm.u, swatchV(SWATCH.warm, 0.55 + 0.4 * (1 - rel) + jitter)]
  // Grass holds on slopes up to a limit that falls with height, ragged by chance.
  const limit = GRASS_FOOT + (GRASS_HIGH - GRASS_FOOT) * clamp01(rel / TREE_LINE) ** 1.6 + (chance - 0.5) * 16
  if (slope < limit && rel < TREE_LINE + 0.15 + (other - 0.5) * 0.2) {
    const high = clamp01(rel / TREE_LINE)
    // Foot: bright yellow-green like the tiles; then meadow, then deeper green and wooded teal.
    if (high < 0.2 && slope < 24) return [SWATCH.grass.u, swatchV(SWATCH.grass, 0.38 + 0.3 * high + jitter)]
    if (other < 0.3 + 0.4 * high)
      return [SWATCH.conifer.u, swatchV(SWATCH.conifer, 0.15 + 0.5 * high + jitter)]
    return [SWATCH.meadow.u, swatchV(SWATCH.meadow, 0.1 + 0.6 * high + slope / 150 + jitter)]
  }
  // Rock: light slate on the sunlit upper faces, warm grey-brown on the lower and the rubbly.
  const shade = clamp01(0.15 + 0.5 * (1 - rel) + jitter)
  if (other < 0.5 - 0.25 * rel) return [SWATCH.warm.u, swatchV(SWATCH.warm, shade)]
  if (slope > 58 && chance < 0.2) return [SWATCH.rock.u, swatchV(SWATCH.rock, 0.3 + 0.5 * (1 - rel))]
  return [SWATCH.slate.u, swatchV(SWATCH.slate, shade)]
}
