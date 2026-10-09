import type { Cell } from "../../lands.ts"
import { key, step } from "../hex.ts"
import { curvatureAt } from "./curvature.ts"
import { planeAt } from "./facets.ts"
import type { Massif } from "./field.ts"
import type { Relief } from "./index.ts"
import { CORNERS, centreOf, pointOf, RES } from "./lattice.ts"
import { valueNoise } from "./noise.ts"
import { PATCH, riserZone, TILE_TOP, type Tone, vOf, type Zone, zoneOf } from "./paint.ts"
import { LEDGE_STEP, TRAIL_STRIDE } from "./shape.ts"
import { smoothNormals } from "./smooth.ts"
import { chisel, onLedge, seamOf, stairsOf } from "./strata.ts"
import { SWATCH, swatchV } from "./swatches.ts"
import { flagsOf } from "./trailCarve.ts"
import { trailTexel } from "./trailPaint.ts"

/**
 * A relief as geometry (terrain v2 §6.1): the per-hex-set builder the island and the planned region
 * chunks (world/chunks.ts) call, once per hex set and detail tier. Pure typed arrays, no three.js.
 * The faces are smooth-shaded with creases (smooth.ts: slopes soft, ledge risers and ridges hard)
 * and UV'd onto the land's palette swatches (swatches.ts), a vertex at its own place on the swatch's
 * gradient strip (paint.ts), so it joins the lands batch.
 *
 * Tiers nest: a hex is meshed at every second vertex (24 triangles) at the finest tier and tier 1, and
 * at tier 2 only the hex corners and centre (6): the far tier, which keeps the stairs (cut at its
 * corners) and loses the sculpted summit's shape. A hex a river or a trail carved keeps its lattice
 * at every tier (its bed is finer than a coarse face), its edge facing a coarser hex set on that
 * hex's edge, so a chunk's mesh joins its neighbour's, at any tier of either, without a crack.
 * The faces of the massif's hexes just outside the set are built too (and dropped), so the vertices
 * on the set's edge are smoothed with the ground beyond it and no seam shows between two sets.
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
/** A vertex is carved when it differs from the field's own height and from its plane by more than this (units). */
const CARVED = 0.05
/** A rim face wears the tile's grass only if it is about level: a steep one is the mountain's own (rock) and the seam is its foot. */
const FLAT_RIM = 1.2
/** The concavity (units) a riser's foot and lip are shaded as: a full gully at the foot, a full lip at the top. */
const WALL_CURVE = 3

/**
 * Whether a river carved into the hex: a vertex between the coarse ones that is neither the field's
 * own height nor the coarse plane (a trail brings those back to the plane, which a coarse tier
 * draws as it is; a river's bed is finer than a coarse face).
 */
function carvedHex(massif: Massif, cell: Cell): boolean {
  const { grid, pristine } = massif
  const [ci, cj] = centreOf(cell)
  for (let k = 0; k < 6; k++) {
    const [ai, aj] = CORNERS[k] as readonly [number, number]
    const [bi, bj] = CORNERS[(k + 1) % 6] as readonly [number, number]
    for (let a = 0; a <= RES; a++)
      for (let b = 0; a + b <= RES; b++) {
        const [i, j] = [ci + a * ai + b * bi, cj + a * aj + b * bj]
        const at = grid.index(i, j)
        if (at < 0 || (i % TRAIL_STRIDE === 0 && j % TRAIL_STRIDE === 0)) continue
        const h = grid.data[at] as number
        if (
          Math.abs(h - (pristine[at] as number)) > CARVED &&
          Math.abs(h - planeAt(grid, i, j, TRAIL_STRIDE)) > CARVED
        )
          return true
      }
  }
  return false
}

export function reliefMesh(relief: Relief, cells: readonly Cell[], tier: DetailTier = 0): MeshArrays {
  const tierN = RES >> tier
  const inSet = new Set(cells.map(key))
  // The hexes of the same massifs just outside the set: built for the smoothing, never drawn.
  const ghosts = new Map<string, Cell>()
  for (const cell of cells)
    for (let d = 0; d < 6; d++) {
      const next = step(cell, d)
      if (!inSet.has(key(next)) && relief.massifAt(next)) ghosts.set(key(next), next)
    }
  const position: number[] = []
  const face: number[] = []
  const uv: number[] = []
  /** Per triangle: it keeps its face normal (a skirt), and it is part of the set (not a ghost's). */
  const flat: number[] = []
  const real: number[] = []
  const carved = new Map<string, boolean>()
  const nOf = (c: Cell): number => {
    const massif = relief.massifAt(c)
    if (!massif) return Math.min(tierN, RES / TRAIL_STRIDE)
    const id = key(c)
    let yes = carved.get(id)
    if (yes === undefined) {
      yes = carvedHex(massif, c)
      carved.set(id, yes)
    }
    return yes ? RES : Math.min(tierN, RES / TRAIL_STRIDE)
  }

  /** One triangle; `paint` gives each vertex its [u, v] (a face's colour, or a texel for all three). */
  const emit = (
    a: readonly number[],
    b: readonly number[],
    c: readonly number[],
    paint: (v: readonly number[]) => readonly [number, number],
    up: boolean,
    isReal: boolean,
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
    const length = Math.hypot(nx, ny, nz)
    if (length < 1e-9) return
    for (const v of [p, q, r]) {
      position.push(v[0] as number, v[1] as number, v[2] as number)
      face.push(nx / length, ny / length, nz / length)
      uv.push(...paint(v))
    }
    flat.push(up ? 0 : 1)
    real.push(isReal ? 1 : 0)
  }

  const build = (cell: Cell, isReal: boolean): void => {
    const massif = relief.massifAt(cell)
    if (!massif) return
    const { grid } = massif
    const trailFlags = flagsOf(grid)
    // A hex's lattice: the tier's, but a river's bed or a trail's shelf keeps the finest at every
    // tier, or the far ground would bury it.
    const n = nOf(cell)
    const stride = RES / n
    const [ci, cj] = centreOf(cell)
    // Where a fine hex meets a coarser one the edge's in-between vertices lie on the coarse edge.
    const snapped = new Map<string, number>()
    if (n > 1)
      for (let d = 0; d < 6; d++) {
        const next = step(cell, d)
        const coarse = relief.massifAt(next) ? nOf(next) : n
        if (coarse >= n) continue
        const [ai, aj] = CORNERS[d] as readonly [number, number]
        const [bi, bj] = CORNERS[(d + 1) % 6] as readonly [number, number]
        const at = (a: number): readonly [number, number] => [
          ci + (n - a) * ai + a * bi,
          cj + (n - a) * aj + a * bj,
        ]
        const gap = n / coarse
        for (let a = 1; a < n; a++) {
          if (a % gap === 0) continue
          const lo = Math.floor(a / gap) * gap
          const [i0, j0] = at(lo)
          const [i1, j1] = at(lo + gap)
          const [i, j] = at(a)
          const t = (a - lo) / gap
          snapped.set(`${i},${j}`, grid.get(i0, j0) * (1 - t) + grid.get(i1, j1) * t)
        }
      }
    // x, y, z, and the lattice vertex's own smoothed steepness and trail flag.
    const vertex = (i: number, j: number, drop = 0): number[] => {
      const [x, z] = pointOf(i, j)
      return [
        x,
        (snapped.get(`${i},${j}`) ?? grid.get(i, j)) - drop,
        z,
        massif.slope[grid.index(i, j)] as number,
        trailFlags?.[grid.index(i, j)] ?? 0,
      ]
    }
    /** A vertex that stands on a ledge of the stairs (not the peak above them, nor a rim at a half terrace). */
    const onStairs = (v: readonly number[]): boolean =>
      onLedge(v[1] as number) && (v[1] as number) <= massif.ledgeTop + 1e-3
    const toneOf = (v: readonly number[]): Tone => ({
      rel: (v[1] as number) / Math.max(1, massif.height),
      curve: curvatureAt(grid, v[0] as number, v[2] as number),
      weather: 2 * valueNoise(13, (v[0] as number) / PATCH, (v[2] as number) / PATCH, 51) - 1,
    })
    const wear =
      (zone: Zone) =>
      (v: readonly number[]): readonly [number, number] => [zone.swatch.u, vOf(zone, toneOf(v))]
    const texel = (t: readonly [number, number]) => (): readonly [number, number] => t

    for (let k = 0; k < 6; k++) {
      const [ai, aj] = CORNERS[k] as readonly [number, number]
      const [bi, bj] = CORNERS[(k + 1) % 6] as readonly [number, number]
      const at = (a: number, b: number): number[] =>
        vertex(ci + stride * (a * ai + b * bi), cj + stride * (a * aj + b * bj))
      const toTile = !relief.massifAt(step(cell, k))
      for (let a = 0; a < n; a++)
        for (let b = 0; a + b < n; b++) {
          const corners: [number, number][][] = [
            [
              [a, b],
              [a + 1, b],
              [a, b + 1],
            ],
          ]
          if (a + b < n - 1)
            corners.push([
              [a + 1, b],
              [a + 1, b + 1],
              [a, b + 1],
            ])
          for (const ab of corners) {
            const [p, q, r] = ab.map(([x, y]) => at(x, y)) as [number[], number[], number[]]
            // The rim faces over land wear the tile top's grass: no seam to the hex ground.
            const low = Math.min(p[1] as number, q[1] as number, r[1] as number)
            const rim =
              toTile &&
              a + b === n - 1 &&
              low >= 0 &&
              Math.max(p[1] as number, q[1] as number, r[1] as number) - low < FLAT_RIM
            // A trail's shelf: the path's sand, or stone where its legs are steps (trailCarve.ts).
            const trail = trailTexel(p, q, r)
            if (trail) {
              emit(p, q, r, texel(trail), true, isReal)
              continue
            }
            // The ledges are stairs: tops and risers rather than a ramp between two ledges.
            if ([p, q, r].every(onStairs)) {
              const stairs = stairsOf(p, q, r)
              for (const t of stairs.tops)
                emit(
                  t[0],
                  t[1],
                  t[2],
                  rim ? texel(TILE_TOP) : wear(zoneOf(t[0], t[1], t[2], massif.height)),
                  true,
                  isReal,
                )
              for (const w of chisel(stairs.walls)) {
                const zone = riserZone(w.low)
                const foot = w.low * LEDGE_STEP
                // A wall is dark at its foot (a crease) and catches the light along its lip.
                const along = (v: readonly number[]): readonly [number, number] => [
                  zone.swatch.u,
                  vOf(zone, {
                    rel: 0.5,
                    curve: WALL_CURVE * (1 - (2 * ((v[1] as number) - foot)) / LEDGE_STEP),
                    weather: 2 * valueNoise(13, (v[0] as number) / PATCH, (v[2] as number) / PATCH, 51) - 1,
                  }),
                ]
                emit(w.tri[0], w.tri[1], w.tri[2], along, false, isReal, w.outward)
              }
              continue
            }
            emit(p, q, r, rim ? texel(TILE_TOP) : wear(zoneOf(p, q, r, massif.height)), true, isReal)
            // Where this ramp meets a stairs triangle across an edge between two ledges, the gap is closed.
            const vs = [p, q, r]
            for (let e = 0; e < 3; e++) {
              const [i, j, w] = [e, (e + 1) % 3, (e + 2) % 3]
              const [u, v] = [vs[i] as number[], vs[j] as number[]]
              if (!onStairs(u) || !onStairs(v) || Math.abs((u[1] as number) - (v[1] as number)) < 1e-3)
                continue
              const [ui, uj, wi] = [
                ab[i] as [number, number],
                ab[j] as [number, number],
                ab[w] as [number, number],
              ]
              const across = at(ui[0] + uj[0] - wi[0], ui[1] + uj[1] - wi[1])
              if (!onStairs(across) || trailTexel(u, v, across)) continue
              for (const seam of seamOf(u, v)) {
                const zone = riserZone(seam.low)
                const foot = seam.low * LEDGE_STEP
                const along = (x: readonly number[]): readonly [number, number] => [
                  zone.swatch.u,
                  vOf(zone, {
                    rel: 0.5,
                    curve: WALL_CURVE * (1 - (2 * ((x[1] as number) - foot)) / LEDGE_STEP),
                  }),
                ]
                // Seen from either side: the sliver is the gap's only face.
                emit(seam.tri[0], seam.tri[1], seam.tri[2], along, false, isReal)
                emit(seam.tri[0], seam.tri[2], seam.tri[1], along, false, isReal)
              }
            }
          }
        }
    }
    // The skirts: they hang below the edge of the set, over the rim or over a seam with another set.
    if (!isReal) return
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
      const colour: readonly [number, number] = seam
        ? [SWATCH.slate.u, swatchV(SWATCH.slate, 0.6)]
        : !sea
          ? TILE_TOP
          : [SWATCH.grass.u, SWATCH.grass.dark]
      for (let a = 0; a < n; a++) {
        emit(edge(a), edge(a + 1), edge(a, true), texel(colour), false, true, outward)
        emit(edge(a + 1), edge(a + 1, true), edge(a, true), texel(colour), false, true, outward)
      }
    }
  }

  for (const cell of cells) build(cell, true)
  for (const cell of ghosts.values()) build(cell, false)

  const smooth = smoothNormals(position, face, Uint8Array.from(flat))
  const keep = real.flatMap((r, t) => (r ? [t] : []))
  const out: MeshArrays = {
    position: new Float32Array(keep.length * 9),
    normal: new Float32Array(keep.length * 9),
    uv: new Float32Array(keep.length * 6),
  }
  keep.forEach((t, k) => {
    for (let m = 0; m < 9; m++) {
      out.position[k * 9 + m] = position[t * 9 + m] as number
      out.normal[k * 9 + m] = smooth[t * 9 + m] as number
    }
    for (let m = 0; m < 6; m++) out.uv[k * 6 + m] = uv[t * 6 + m] as number
  })
  return out
}
