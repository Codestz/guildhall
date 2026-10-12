/**
 * The water's mesh as plain typed arrays, pure so the town worker can build it (render wraps them and
 * shades the water). A PITCH grid round the shore lines and a FAR_PITCH grid past them, cell by cell
 * wherever there is water; no polygon booleans. Each vertex carries its signed distance to the shore
 * (negative under the land, which hides it), so interpolated across a cell it is zero on the coast.
 */
import { bbox, insideIndex } from "../geom/poly.ts"
import type { Vec2 } from "../geom/vec.ts"
import { type Grid, growable, stampSegment } from "./ground.ts"
import type { TownDraw } from "./types.ts"

export type WaterDraw = TownDraw["water"]

/** x,y,z positions and normals, each vertex's distance to the shore (metres), triangle indices. */
export interface WaterGeometry {
  position: Float32Array
  normal: Float32Array
  shore: Float32Array
  index: Uint32Array
}

/** The water's grid pitch near the shore, metres: the shore distance is interpolated across it. */
const PITCH = 4
/** The shore distance is measured this far out (the shader is at its deepest by 10 m). */
const MEASURED = 18
/** Water further than this past the shore lines' box is all deep: one coarse grid, metres. */
const NEAR = 30
const FAR_PITCH = 40
/** The shore distance of water nobody measured. */
const DEEP = 1e3

export function waterGeometry(w: WaterDraw): WaterGeometry {
  const pos = growable((n) => new Float32Array(n))
  const nor = growable((n) => new Float32Array(n))
  const shore = growable((n) => new Float32Array(n))
  const idx = growable((n) => new Uint32Array(n))
  const done = () => ({ position: pos.done(), normal: nor.done(), shore: shore.done(), index: idx.done() })
  const polys = w.polys.filter((r) => r.length >= 3)
  if (polys.length === 0) return done()
  const tests = polys.map((r) => insideIndex([r], 16))
  const wet = (x: number, z: number) => tests.some((t) => t([x, z]))

  let count = 0
  const vertex = (x: number, z: number, d: number) => {
    pos.push(x)
    pos.push(w.level)
    pos.push(z)
    nor.push(0)
    nor.push(1)
    nor.push(0)
    shore.push(d)
    return count++
  }
  /** A grid's cells where `keep` says so, as two up-facing triangles (clockwise in x,z) each. */
  const cells = (g: Grid, value: (k: number) => number, keep: (i: number, j: number) => boolean) => {
    const W = g.nx + 1
    const ids = new Int32Array(W * (g.nz + 1)).fill(-1)
    const at = (k: number) => {
      if ((ids[k] as number) < 0)
        ids[k] = vertex(g.x0 + (k % W) * g.step, g.z0 + Math.floor(k / W) * g.step, value(k))
      return ids[k] as number
    }
    for (let j = 0; j < g.nz; j++)
      for (let i = 0; i < g.nx; i++) {
        if (!keep(i, j)) continue
        const a = at(j * W + i)
        const b = at(j * W + i + 1)
        const c = at((j + 1) * W + i + 1)
        const d = at((j + 1) * W + i)
        for (const v of [a, c, b, a, d, c]) idx.push(v)
      }
  }

  // The far grid on FAR_PITCH multiples, so the near box (snapped to it) leaves whole cells out.
  const [elo, ehi] = bbox(polys.flat())
  const snapDown = (v: number) => Math.floor(v / FAR_PITCH) * FAR_PITCH
  const snapUp = (v: number) => Math.ceil(v / FAR_PITCH) * FAR_PITCH
  const far: Grid = {
    x0: snapDown(elo[0]),
    z0: snapDown(elo[1]),
    nx: (snapUp(ehi[0]) - snapDown(elo[0])) / FAR_PITCH,
    nz: (snapUp(ehi[1]) - snapDown(elo[1])) / FAR_PITCH,
    step: FAR_PITCH,
  }
  const lines = w.shore.filter((l) => l.length > 1)
  let box: [Vec2, Vec2] | null = null
  if (lines.length > 0) {
    const [slo, shi] = bbox(lines.flat())
    box = [
      [Math.max(far.x0, snapDown(slo[0] - NEAR)), Math.max(far.z0, snapDown(slo[1] - NEAR))],
      [Math.min(snapUp(ehi[0]), snapUp(shi[0] + NEAR)), Math.min(snapUp(ehi[1]), snapUp(shi[1] + NEAR))],
    ]
  }
  const inBox = (x: number, z: number) =>
    box !== null && x >= box[0][0] && x < box[1][0] && z >= box[0][1] && z < box[1][1]
  cells(
    far,
    () => DEEP,
    (i, j) => {
      const x = far.x0 + i * FAR_PITCH
      const z = far.z0 + j * FAR_PITCH
      if (inBox(x + FAR_PITCH / 2, z + FAR_PITCH / 2)) return false
      const h = FAR_PITCH / 2
      return (
        wet(x + h, z + h) || wet(x, z) || wet(x + 2 * h, z) || wet(x, z + 2 * h) || wet(x + 2 * h, z + 2 * h)
      )
    },
  )
  if (!box) return done()

  // The near grid: the signed shore distance at every vertex, the cells with water at a corner (or
  // land within a cell of it: under the land, hidden, so no gap opens along a coast).
  const near: Grid = {
    x0: box[0][0],
    z0: box[0][1],
    nx: Math.round((box[1][0] - box[0][0]) / PITCH),
    nz: Math.round((box[1][1] - box[0][1]) / PITCH),
    step: PITCH,
  }
  const W = near.nx + 1
  const dist = new Float32Array(W * (near.nz + 1)).fill(DEEP)
  for (const line of lines)
    for (let i = 0; i + 1 < line.length; i++)
      stampSegment(near, dist, line[i] as Vec2, line[i + 1] as Vec2, MEASURED)
  for (let k = 0; k < dist.length; k++)
    if (!wet(near.x0 + (k % W) * PITCH, near.z0 + Math.floor(k / W) * PITCH)) dist[k] = -(dist[k] as number)
  const value = (k: number) => dist[k] as number
  cells(near, value, (i, j) => {
    const k = j * W + i
    return Math.max(value(k), value(k + 1), value(k + W), value(k + W + 1)) > -1.5 * PITCH
  })
  return done()
}
