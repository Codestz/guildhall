import { DMath } from "../../dmath.ts"
import type { Cell } from "../../lands.ts"
import { cellAt, key, step } from "../hex.ts"
import { carvedHex } from "./carved.ts"
import { curvatureAt } from "./curvature.ts"
import { flightsIn } from "./flights.ts"
import type { Relief } from "./index.ts"
import { CIRCUM, CORNERS, centreOf, pointOf, RES, ROW, sectorTriangles } from "./lattice.ts"
import { valueNoise } from "./noise.ts"
import { grassy, PATCH, riserZone, TILE_TOP, type Tone, vOf, type Zone, zoneOf } from "./paint.ts"
import { coarseSeamStairs, fineSeamStairs, type Lat, snapsOf, steppedSeam } from "./seams.ts"
import { TRAIL_STRIDE } from "./shape.ts"
import { smoothNormals, WALL } from "./smooth.ts"
import { curtainOf, cutEdge, levelOf, onLedge, onLine, profile, rampOf, stairsOf, upOf } from "./strata.ts"
import { SWATCH, swatchV } from "./swatches.ts"
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
 * corners): the same stepped summit, its ledges cut a hex wide. A hex a river carved keeps its
 * lattice at every tier (its bed is finer than a coarse face), its edge facing a coarser hex set on
 * that hex's edge (or, where both sides stand on ledges, cut as stairs on both sides: seams.ts), so a
 * chunk's mesh joins its neighbour's, at any tier of either, without a crack.
 * The faces of the massif's hexes just outside the set are built too (and dropped), so the vertices
 * on the set's edge are smoothed with the ground beyond it and no seam shows between two sets.
 *
 * The mesh is watertight inside a massif (test/reliefWatertight.test.ts): the stairs take their cuts
 * on the lattice's edges (strata.ts), so two triangles on an edge share its vertices; a ramp beside
 * stairs, a rim's long edges and a coarser hex's edge carry the same extra vertices their neighbour
 * has, and a curtain closes the gap between a ramp's line and the stairs' profile. Two sets of one
 * lattice therefore meet exactly, with nothing hung between them.
 *
 * Where the set ends over something that does not meet it exactly a skirt hangs below the edge: 5
 * units over a hex outside every massif (the same drop as a tile's column, so no gap shows under a
 * bevelled rim) or another massif's, 3 over a hex of the same massif whose lattice is another size (a
 * far tier's seam, which only an island seen whole draws beside a near one).
 */

export type DetailTier = 0 | 1 | 2

export interface MeshArrays {
  position: Float32Array
  normal: Float32Array
  uv: Float32Array
}

/** Skirts: over the rim, and over a seam between two lattices of one massif. */
const RIM_DROP = 5
const SEAM_DROP = 3
/** A ramp's edge is cut where it is longer than this (units), so no face is a sliver. */
const LONG = 4.5
/** A rim face wears the tile's grass only if it is about level: a steep one is the mountain's own (rock) and the seam is its foot. */
const FLAT_RIM = 1.2

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
    isReal: boolean,
    facing: "up" | "kept" | readonly [number, number],
    skirt = false,
    shade?: readonly number[],
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
    const flip = facing === "kept" ? false : facing === "up" ? ny < 0 : nx * facing[0] + nz * facing[1] < 0
    if (flip) {
      ;[q, r] = [r, q]
      nx = -nx
      ny = -ny
      nz = -nz
    }
    const length = DMath.hypot(nx, ny, nz)
    if (length < 1e-9) return
    for (const v of [p, q, r]) {
      position.push(v[0] as number, v[1] as number, v[2] as number)
      face.push(...(shade ?? [nx / length, ny / length, nz / length]))
      uv.push(...paint(v))
    }
    flat.push(skirt || shade ? 1 : Array.isArray(facing) ? WALL : 0)
    real.push(isReal ? 1 : 0)
  }

  const build = (cell: Cell, isReal: boolean): void => {
    const massif = relief.massifAt(cell)
    if (!massif) return
    const { grid } = massif
    const trailFlags = massif.trail
    // A hex's lattice: the tier's, but a river's bed or a trail's shelf keeps the finest at every
    // tier, or the far ground would bury it.
    const n = nOf(cell)
    const stride = RES / n
    const [ci, cj] = centreOf(cell)
    // Where a fine hex meets a coarser one the edge's in-between vertices lie on the coarse edge (seams.ts).
    const snapped = snapsOf(grid, [ci, cj], n, (d) => {
      const next = step(cell, d)
      return relief.massifAt(next) ? nOf(next) : n
    })
    // x, y, z, and the lattice vertex's own smoothed steepness and trail flag.
    const vertex = (i: number, j: number, drop = 0): number[] => {
      const [x, z] = pointOf(i, j)
      return [
        x,
        (snapped.get(`${i},${j}`) ?? grid.get(i, j)) - drop,
        z,
        massif.slope[grid.index(i, j)] as number,
        trailFlags[grid.index(i, j)] as number,
      ]
    }
    /** A vertex that stands on a ledge of the stairs (not a rim at a half terrace, nor a trail's or river's ramp). */
    const onStairs = (v: readonly number[]): boolean => onLedge(v[1] as number)
    const toneOf = (v: readonly number[]): Tone => ({
      rel: (v[1] as number) / Math.max(1, massif.height),
      curve: curvatureAt(grid, v[0] as number, v[2] as number),
      weather: 2 * valueNoise(13, (v[0] as number) / PATCH, (v[2] as number) / PATCH, 51) - 1,
    })
    const wear =
      (zone: Zone) =>
      (v: readonly number[]): readonly [number, number] => [zone.swatch.u, vOf(zone, toneOf(v))]
    const texel = (t: readonly [number, number]) => (): readonly [number, number] => t

    /** The lattice vertex nearest a world point (the corner a ramp's neighbour has across an edge). */
    const latticeOf = (x: number, z: number): [number, number] => {
      const j = Math.round((z * RES) / ROW)
      return [Math.round((x * RES) / CIRCUM - j / 2), j]
    }
    /** Whether the triangle across the edge u–v from `w` is ground that may grow grass too (gentle, or stairs): a face of grass has a neighbour, never stands alone. */
    const grassAcross = (u: number[], v: number[], w: number[]): boolean => {
      const across = vertex(
        ...latticeOf(
          (u[0] as number) + (v[0] as number) - (w[0] as number),
          (u[2] as number) + (v[2] as number) - (w[2] as number),
        ),
      )
      return onStairs(across) || grassy(u, v, across)
    }
    /** The lattice of the hex that holds a lattice point (4 for a river's bed, else the tier's). */
    const sizeAt = ([i, j]: Lat): number => nOf(cellAt(pointOf(i, j)))
    /** An edge on a hex edge where the lattice changes (a finer hex on one side): kept straight, never stepped, unless the seam is stairs (seams.ts). */
    const straightEdge = (u: readonly number[], v: readonly number[]): boolean => {
      const [dx, dz] = [(v[0] as number) - (u[0] as number), (v[2] as number) - (u[2] as number)]
      const length = DMath.hypot(dx, dz) || 1
      const [mx, mz] = [((u[0] as number) + (v[0] as number)) / 2, ((u[2] as number) + (v[2] as number)) / 2]
      const [c1, c2] = [
        cellAt([mx - (dz / length) * 0.02, mz + (dx / length) * 0.02]),
        cellAt([mx + (dz / length) * 0.02, mz - (dx / length) * 0.02]),
      ]
      return (
        key(c1) !== key(c2) &&
        !!relief.massifAt(c1) &&
        !!relief.massifAt(c2) &&
        nOf(c1) !== nOf(c2) &&
        !steppedSeam(
          grid,
          latticeOf(u[0] as number, u[2] as number),
          latticeOf(v[0] as number, v[2] as number),
          sizeAt,
        )
      )
    }
    /** Whether the triangle across the edge u–v from `w` is stairs (its third corner stands on a ledge, and it is no lattice change). */
    const stairsAcross = (u: number[], v: number[], w: number[]): boolean => {
      const across = vertex(
        ...latticeOf(
          (u[0] as number) + (v[0] as number) - (w[0] as number),
          (u[2] as number) + (v[2] as number) - (w[2] as number),
        ),
      )
      return onStairs(across) && !straightEdge(u, across) && !straightEdge(v, across)
    }

    for (let k = 0; k < 6; k++) {
      const [ai, aj] = CORNERS[k] as readonly [number, number]
      const [bi, bj] = CORNERS[(k + 1) % 6] as readonly [number, number]
      const latOf = ([a, b]: readonly [number, number]): Lat => [
        ci + stride * (a * ai + b * bi),
        cj + stride * (a * aj + b * bj),
      ]
      const at = (a: number, b: number): number[] => vertex(...latOf([a, b]))
      const next = step(cell, k)
      const toTile = !relief.massifAt(next)
      // Across this hex edge a hex of another lattice: the edge stays straight, and the coarser side takes the finer's vertices.
      const across = toTile ? n : nOf(next)
      const gap = across > n ? across / n : 1
      // A skirt hangs where the set ends over a hex that does not meet it exactly: a tile's, another massif's, or a lattice of another size (a tier's seam).
      const skirted = isReal && !inSet.has(key(next)) && (relief.massifAt(next) !== massif || across !== n)
      for (let a = 0; a < n; a++)
        for (let b = 0; a + b < n; b++) {
          for (const [index, ab] of sectorTriangles(n, a, b).entries()) {
            const [p, q, r] = ab.map(([x, y]) => at(x, y)) as [number[], number[], number[]]
            const vs = [p, q, r]
            // Its edge on the hex edge (from corner 1 to corner 2); where the lattice changes it is kept straight,
            // unless the seam is stairs: then both sides cut the same risers, the coarse triangle split at the fine vertex between.
            const onEdge = index === 0 && a + b === n - 1
            const [lp, lq, lr] = ab.map(latOf) as unknown as [Lat, Lat, Lat]
            const stairsSeam =
              onEdge &&
              ((n === 2 && across === RES && coarseSeamStairs(grid, lq, lr, lp)) ||
                (n === RES && across === 2 && fineSeamStairs(grid, lq, lr, lp)))
            const straight = onEdge && across !== n && !stairsSeam ? 1 : -1
            // The rim faces over land wear the tile top's grass: no seam to the hex ground.
            const low = Math.min(p[1] as number, q[1] as number, r[1] as number)
            const rim =
              toTile &&
              onEdge &&
              low >= 0 &&
              Math.max(p[1] as number, q[1] as number, r[1] as number) - low < FLAT_RIM
            // A trail's shelf: the path's sand on the flat tops (trailPaint.ts).
            const trail = trailTexel(p, q, r)
            const paintOf = (t: readonly number[][]) =>
              trail
                ? texel(trail)
                : rim
                  ? texel(TILE_TOP)
                  : wear(zoneOf(t[0] as number[], t[1] as number[], t[2] as number[], massif.height))
            // The ramp's own up-facing normal, which the curtains over its edges are shaded with.
            const up = upOf(p, q, r)
            // A ramp's one zone, from its corners, whatever it is cut into.
            const rampPaint = rim
              ? texel(TILE_TOP)
              : wear(
                  zoneOf(
                    p,
                    q,
                    r,
                    massif.height,
                    grassy(p, q, r) &&
                      vs.filter((u, e) =>
                        grassAcross(u, vs[(e + 1) % 3] as number[], vs[(e + 2) % 3] as number[]),
                      ).length >= 2,
                  ),
                )
            /** A riser's face; a curtain over a ramp's edge wears the ramp's own colour and shading (`shade`), so it reads as the ramp, not a dark crack in it. */
            const wall = (
              w: { tri: [number[], number[], number[]]; low: number; outward: readonly [number, number] },
              shade?: readonly number[],
            ) => {
              const zone = riserZone(w.low)
              const paint = shade ? rampPaint : texel([zone.swatch.u, vOf(zone, { rel: 0.5, curve: 0 })])
              emit(w.tri[0], w.tri[1], w.tri[2], paint, isReal, w.outward, false, shade)
            }
            // What the surface does along each edge, in order from corner 1: a stairs triangle's profile, a ramp's extra vertices.
            let chain: number[][] = []
            if (straight < 0 && vs.every(onStairs)) {
              // The ledges are stairs: tops and risers rather than a ramp between two ledges.
              const mid = stairsSeam && n === 2 ? vertex((lq[0] + lr[0]) / 2, (lq[1] + lr[1]) / 2) : undefined
              for (const part of mid
                ? [
                    [p, q, mid],
                    [p, mid, r],
                  ]
                : [vs]) {
                const stairs = stairsOf(part[0] as number[], part[1] as number[], part[2] as number[])
                for (const t of stairs.tops) emit(t[0], t[1], t[2], paintOf(t), isReal, "up")
                for (const w of stairs.walls) wall(w)
              }
              if (skirted && onEdge)
                chain = mid
                  ? [...profile(q, mid).map((s) => s.at), mid, ...profile(mid, r).map((s) => s.at)]
                  : profile(q, r).map((s) => s.at)
            } else {
              // A ramp: its edge keeps the finer lattice's vertices when straight, and where a stairs triangle
              // lies across, the riser's mid-points, closed by a curtain to the stairs' profile.
              const between = vs.map((u, e) => {
                const v = vs[(e + 1) % 3] as number[]
                if (e === straight) {
                  const points: number[][] = []
                  for (let m = 1; m < gap; m++) {
                    const t = m / gap
                    points.push([
                      (u[0] as number) + ((v[0] as number) - (u[0] as number)) * t,
                      (u[1] as number) + ((v[1] as number) - (u[1] as number)) * t,
                      (u[2] as number) + ((v[2] as number) - (u[2] as number)) * t,
                      0,
                      0,
                    ])
                  }
                  return points
                }
                const opposite = vs[(e + 2) % 3] as number[]
                if (onStairs(u) && onStairs(v) && levelOf(u) !== levelOf(v) && stairsAcross(u, v, opposite)) {
                  const nodes = profile(u, v)
                  for (const w of curtainOf(u, v, nodes, opposite)) wall(w, up)
                  return onLine(nodes)
                }
                // Between two ledge corners a stairs triangle may lie across, uncut: only edges with a peak or rim corner are.
                return onStairs(u) && onStairs(v)
                  ? []
                  : cutEdge(u, v, n === 1 ? Number.POSITIVE_INFINITY : LONG)
              })
              for (const t of rampOf(p, q, r, between)) emit(t[0], t[1], t[2], rampPaint, isReal, "kept")
              if (skirted && onEdge) chain = between[1] as number[][]
            }
            if (!skirted || !onEdge) continue
            // The skirt hangs below this edge of the set, over the rim or over a seam with another set.
            const seam = relief.massifAt(next) === massif
            const drop = seam ? SEAM_DROP : RIM_DROP
            const angle = (Math.PI / 6) * (1 + 2 * k)
            const outward = [DMath.cos(angle), DMath.sin(angle)] as const
            const stone: readonly [number, number] = seam
              ? [SWATCH.slate.u, swatchV(SWATCH.slate, 0.6)]
              : [SWATCH.rock.u, swatchV(SWATCH.rock, 0.5)]
            // Over a hex outside, the wall stands from the rim down to that hex's top: stone; under it, the tile's own grass.
            const tile = seam
              ? Number.NEGATIVE_INFINITY
              : Math.max(massif.foot[grid.index(...lq)] as number, massif.foot[grid.index(...lr)] as number)
            const edge = [q, ...chain, r]
            const at3 = (v: number[], y: number): number[] => [v[0] as number, y, v[2] as number]
            const bottom = (v: number[]): number => (v[1] as number) - drop
            const meet = (v: number[]): number =>
              Number.isNaN(tile) ? (v[1] as number) : Math.max(bottom(v), Math.min(v[1] as number, tile))
            const grass = texel(seam ? stone : TILE_TOP)
            const above = texel(stone)
            for (let m = 0; m + 1 < edge.length; m++) {
              const [s, t] = [edge[m] as number[], edge[m + 1] as number[]]
              const [sm, tm] = [at3(s, meet(s)), at3(t, meet(t))]
              emit(s, t, sm, above, isReal, outward, true)
              emit(t, tm, sm, above, isReal, outward, true)
              emit(sm, tm, at3(s, bottom(s)), grass, isReal, outward, true)
              emit(tm, at3(t, bottom(t)), at3(s, bottom(s)), grass, isReal, outward, true)
            }
          }
        }
    }
  }

  for (const cell of cells) {
    build(cell, true)
    // The trails' steps stand where their top meets the wall; the far tier leaves them out.
    if (tier < 2)
      for (const { tri, texel } of flightsIn(
        relief.massifAt(cell)?.flights ?? [],
        (x, z) => key(cellAt([x, z])) === key(cell),
      ))
        emit(tri[0], tri[1], tri[2], () => texel, true, "kept", true)
  }
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
