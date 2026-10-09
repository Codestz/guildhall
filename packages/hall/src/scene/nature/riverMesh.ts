import { BufferGeometry, Float32BufferAttribute, Vector3 } from "three"
import { key, step } from "../../world/gen/hex.ts"
import { type Cell, cellToWorld } from "../../world/lands.ts"
import type { Spot } from "../../world/layout.ts"
import {
  BANK,
  courseLine,
  type Fall,
  gradeHalfWidth,
  gradeSlopes,
  type Lake,
  type Point3,
  type Reach,
  surfaceY,
  type Waterways,
} from "../../world/waterways.ts"
import { HEX_RADIUS } from "./scatter.ts"

/**
 * The inland water's two meshes (world-gen v2 §2.3, Rivers.tsx draws them): every river reach and
 * lake as one surface, and every waterfall as one more. Each hex of water is its own flat patch at
 * its body's height, so terraces need nothing but more patches: the land's tiles clip each one at
 * its banks, as they clip the sea. What the sea's shader reads from its baked shore texture, these
 * carry per vertex instead, worked out here from the hex geometry:
 *
 * - `aFlow`: which way and how fast the water runs (xz; length 0 still, 1 a river, more near a lip);
 *   along the river's course line, from a lake's falls to its outlet.
 * - `aShore`: how far it is to the bank, world units (≤ 0 under the land).
 * - `aFoot`: the nearest waterfall's foot in this body of water (xz) and 1, or 0 when none falls in.
 *
 * The falls' mesh is fallMesh.ts.
 */

/** How far a lakeshore tile's sand runs on under the water past its edge, to about its waterline. */
const COAST_REACH = 3
/** How much further in, per bank beyond the first, a corner tile's waterline lies. */
const CORNER_REACH = 2.5
/** A hex's inradius (centre to edge midpoint). */
const INRADIUS = HEX_RADIUS * Math.cos(Math.PI / 6)
/** Rings per hex patch: 12 points round each (corners and edge midpoints), 1 + 12·RINGS vertices. */
const RINGS = 3
/** How much faster a river runs as it nears a lip, and from how far. */
const LIP_BOOST = 0.7
const LIP_REACH = 4.5
/** A fall's jet: how far out past its lip it leaves (fallMesh.ts), and how far out it lands. */
export const THROW_AT_LIP = 0.12
export const THROW = 0.55

const UP = new Vector3(0, 1, 0)

/** One mesh's arrays, written a triangle at a time and wound to face `facing`. */
export class Builder {
  readonly position: number[] = []
  readonly normal: number[] = []
  readonly index: number[] = []
  readonly extra: Record<string, number[]> = {}

  constructor(readonly sizes: Record<string, number>) {
    for (const name of Object.keys(sizes)) this.extra[name] = []
  }

  vertex(at: Vector3, normal: Vector3, values: Record<string, readonly number[]>): number {
    this.position.push(at.x, at.y, at.z)
    this.normal.push(normal.x, normal.y, normal.z)
    for (const name of Object.keys(this.sizes)) this.extra[name]?.push(...(values[name] ?? []))
    return this.position.length / 3 - 1
  }

  /** A triangle, its corners ordered so its front faces `facing`. */
  triangle(a: number, b: number, c: number, facing: Vector3): void {
    const p = (i: number) => new Vector3().fromArray(this.position, i * 3)
    const pa = p(a)
    const cross = p(b).sub(pa).cross(p(c).sub(pa))
    if (cross.dot(facing) >= 0) this.index.push(a, b, c)
    else this.index.push(a, c, b)
  }

  geometry(): BufferGeometry {
    const geometry = new BufferGeometry()
    geometry.setAttribute("position", new Float32BufferAttribute(this.position, 3))
    geometry.setAttribute("normal", new Float32BufferAttribute(this.normal, 3))
    for (const [name, size] of Object.entries(this.sizes))
      geometry.setAttribute(name, new Float32BufferAttribute(this.extra[name] ?? [], size))
    geometry.setIndex(this.index)
    geometry.computeBoundingSphere()
    return geometry
  }
}

/** What a patch's vertex carries: flow (xz), distance to the bank, and the foot it foams round. */
type Water = (x: number, z: number) => { flow: Spot; shore: number; foot: readonly [number, number, number] }

/** A flat hex patch at height y round `centre`: rings of 12 points out to the hex's corners. */
function patch(out: Builder, [cx, cz]: Spot, y: number, water: Water): void {
  const rim: Spot[] = []
  for (let j = 0; j < 12; j++) {
    const corner = j % 2 === 0
    const angle = (j / 12) * Math.PI * 2
    const r = corner ? HEX_RADIUS : INRADIUS
    rim.push([Math.cos(angle) * r, Math.sin(angle) * r])
  }
  const at = new Vector3()
  const add = (x: number, z: number) => {
    const { flow, shore, foot } = water(x, z)
    return out.vertex(at.set(x, y, z), UP, { aFlow: flow, aShore: [shore], aFoot: foot })
  }
  const centre = add(cx, cz)
  let inner: number[] = []
  for (let k = 1; k <= RINGS; k++) {
    const ring = rim.map(([x, z]) => add(cx + (x * k) / RINGS, cz + (z * k) / RINGS))
    for (let j = 0; j < 12; j++) {
      const a = ring[j] as number
      const b = ring[(j + 1) % 12] as number
      if (k === 1) out.triangle(centre, a, b, UP)
      else {
        const c = inner[j] as number
        const d = inner[(j + 1) % 12] as number
        out.triangle(c, a, b, UP)
        out.triangle(c, b, d, UP)
      }
    }
    inner = ring
  }
}

export const W = (cell: Cell): Spot => cellToWorld(cell)
const same = (a: Cell, b: Cell) => a[0] === b[0] && a[1] === b[1]
export const mid = (a: Spot, b: Spot): Spot => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/** Distance from p to the polyline, and the unit direction of its nearest segment. */
function nearest([px, pz]: Spot, line: readonly Spot[]): { d: number; along: Spot } {
  let best = { d: Number.POSITIVE_INFINITY, along: [0, 0] as Spot }
  for (let i = 1; i < line.length; i++) {
    const [ax, az] = line[i - 1] as Spot
    const [bx, bz] = line[i] as Spot
    const dx = bx - ax
    const dz = bz - az
    const length = Math.hypot(dx, dz)
    const t = Math.min(1, Math.max(0, ((px - ax) * dx + (pz - az) * dz) / (length * length)))
    const d = Math.hypot(px - ax - dx * t, pz - az - dz * t)
    if (d < best.d) best = { d, along: [dx / length, dz / length] }
  }
  return best
}

/** Distance from p to the segment ab. */
function toSegment([px, pz]: Spot, [ax, az]: Spot, [bx, bz]: Spot): number {
  const dx = bx - ax
  const dz = bz - az
  const t = Math.min(1, Math.max(0, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)))
  return Math.hypot(px - ax - dx * t, pz - az - dz * t)
}

/** Distance from p to the infinite line through a and b. */
function toLine([px, pz]: Spot, [ax, az]: Spot, [bx, bz]: Spot): number {
  const dx = bx - ax
  const dz = bz - az
  return Math.abs((px - ax) * dz - (pz - az) * dx) / Math.hypot(dx, dz)
}

/** Edge `dir` of a hex as its two corners (edge k faces 30° + 60°·k; its corners are at 60°·k and 60°·(k+1)). */
function edgeOf([cx, cz]: Spot, dir: number): [Spot, Spot] {
  const corner = (k: number): Spot => [
    cx + Math.cos((k * Math.PI) / 3) * HEX_RADIUS,
    cz + Math.sin((k * Math.PI) / 3) * HEX_RADIUS,
  ]
  return [corner(dir), corner(dir + 1)]
}

/** Where a fall lands: past the lip by its throw, on the lower water. */
function footOf(fall: Fall): Spot {
  const [fx, fz] = W(fall.from)
  const [tx, tz] = W(fall.to)
  const [mx, mz] = mid([fx, fz], [tx, tz])
  const length = Math.hypot(tx - fx, tz - fz)
  const reach = THROW_AT_LIP + THROW + 0.4
  return [mx + ((tx - fx) / length) * reach, mz + ((tz - fz) / length) * reach]
}

/** The nearest of a body's feet to (x, z), as `aFoot`. */
function nearestFoot(feet: readonly Spot[], x: number, z: number): readonly [number, number, number] {
  let best: Spot | undefined
  for (const foot of feet)
    if (!best || Math.hypot(foot[0] - x, foot[1] - z) < Math.hypot(best[0] - x, best[1] - z)) best = foot
  return best ? [best[0], best[1], 1] : [0, 0, 0]
}

/** Every reach and lake as one surface geometry (empty when there is no inland water). */
export function surfaceGeometry(waters: Waterways): BufferGeometry {
  const out = new Builder({ aFlow: 2, aShore: 1, aFoot: 3 })
  for (const reach of waters.rivers) (reach.grade ? slope : river)(out, reach, waters.falls)
  for (const lake of waters.lakes) still(out, lake, waters.falls)
  return out.geometry()
}

/**
 * A reach: flow along its course line (faster towards a lip), banks a channel's width from it.
 * A spring's hex is a straight run (the pack has no dead-end river tile) whose upstream end opens
 * against the hex behind it, a mountain's foot: the water wells up there, foaming.
 */
function river(out: Builder, reach: Reach, falls: readonly Fall[]): void {
  const cells = reach.hexes.map((hex) => hex.cell)
  const feet = falls.filter((fall) => cells.some((cell) => same(cell, fall.to))).map(footOf)
  const line = courseLine(reach)
  if (!reach.prev) feet.push(line[0] as Spot)
  const last = cells.at(-1) as Cell
  const lip = falls.find((fall) => same(fall.from, last) && same(fall.to, reach.next))
  const lipAt = lip ? mid(W(lip.from), W(lip.to)) : undefined
  const y = surfaceY("river", reach.level)
  for (const cell of cells)
    patch(out, W(cell), y, (x, z) => {
      const { d, along } = nearest([x, z], line)
      const toLip = lipAt ? Math.hypot(x - lipAt[0], z - lipAt[1]) : Number.POSITIVE_INFINITY
      const speed = 1 + LIP_BOOST * (1 - smoothstep(0, LIP_REACH, toLip))
      return { flow: [along[0] * speed, along[1] * speed], shore: BANK - d, foot: nearestFoot(feet, x, z) }
    })
}

/** Columns across a graded reach's ribbon, and how far past its banks it tucks under them (they hide its edge). */
const COLUMNS = 8
const TUCK = 1
/** How much faster a graded reach runs for each unit of slope, and its fastest (the shaders' white water begins near 1.9). */
const SLOPE_SPEED = 1.1
const SPEED_MAX = 3.4

/**
 * A graded reach (it runs down a mountain's flank): a ribbon along its surface, its width the
 * channel's at each point (a torrent narrower than a stream). Where it is steep it runs faster and
 * tilts its normal downhill, so the shaders churn it white; it is tilted only along its course.
 */
function slope(out: Builder, reach: Reach, falls: readonly Fall[]): void {
  const grade = reach.grade as Point3[]
  const slopes = gradeSlopes(grade)
  const cells = reach.hexes.map((hex) => hex.cell)
  const feet = falls.filter((fall) => cells.some((cell) => same(cell, fall.to))).map(footOf)
  const [x0, , z0] = grade[0] as Point3
  if (!reach.prev) feet.push([x0, z0])
  const at = new Vector3()
  let along: Spot = [0, 1]
  const rows = grade.map(([x, y, z], i) => {
    const a = grade[Math.max(0, i - 1)] as Point3
    const b = grade[Math.min(grade.length - 1, i + 1)] as Point3
    const length = Math.hypot(b[0] - a[0], b[2] - a[2])
    if (length > 1e-6) along = [(b[0] - a[0]) / length, (b[2] - a[2]) / length]
    const [tx, tz] = along
    const steep = slopes[i] as number
    const half = gradeHalfWidth(steep)
    const speed = Math.min(SPEED_MAX, 1 + SLOPE_SPEED * steep)
    const normal = new Vector3(steep * tx, 1, steep * tz).normalize()
    return Array.from({ length: COLUMNS + 1 }, (_, c) => {
      const side = (c / COLUMNS - 0.5) * 2 * (half + TUCK)
      const px = x - tz * side
      const pz = z + tx * side
      return out.vertex(at.set(px, y, pz), normal, {
        aFlow: [tx * speed, tz * speed],
        aShore: [half - Math.abs(side)],
        aFoot: nearestFoot(feet, px, pz),
      })
    })
  })
  for (let i = 1; i < rows.length; i++) {
    const [a, b] = [rows[i - 1] as number[], rows[i] as number[]]
    for (let c = 0; c < COLUMNS; c++) {
      out.triangle(a[c] as number, a[c + 1] as number, b[c] as number, UP)
      out.triangle(a[c + 1] as number, b[c + 1] as number, b[c] as number, UP)
    }
  }
}

/**
 * A lake: its hexes and the shore round them, at its height. Its banks are its edges with land
 * (not its outlet, nor where a fall pours in); a lakeshore tile's sand runs on under the water
 * past them, to about COAST_REACH in. It drifts slowly to its outlet, and away from any fall into it.
 */
function still(out: Builder, lake: Lake, falls: readonly Fall[]): void {
  const inside = new Set(lake.cells.map(key))
  const banks: [Spot, Spot][] = []
  for (const cell of lake.cells)
    for (let dir = 0; dir < 6; dir++) {
      const outlet = same(cell, lake.outlet.cell) && dir === lake.outlet.dir
      const into = falls.some((fall) => same(fall.to, cell) && fall.dir === (dir + 3) % 6)
      if (!outlet && !into && !inside.has(key(step(cell, dir)))) banks.push(edgeOf(W(cell), dir))
    }
  const drain = edgeOf(W(lake.outlet.cell), lake.outlet.dir)
  const exit = mid(drain[0], drain[1])
  const feet = falls.filter((fall) => lake.cells.some((cell) => same(cell, fall.to))).map(footOf)
  const y = surfaceY("lake", lake.level)
  for (const cell of [...lake.cells, ...lake.shore]) {
    const wet = inside.has(key(cell))
    const centre = W(cell)
    // A lakeshore tile's sand is its hex inset from the banks it borders, corners square: the
    // distance to each bank's whole line, not its segment (which rounds the corner off, and so
    // misplaces the waterline where two banks meet).
    const own = wet
      ? []
      : banks.filter(([a, b]) => {
          const [mx, mz] = mid(a, b)
          return Math.hypot(mx - centre[0], mz - centre[1]) < INRADIUS + 0.01
        })
    // ...and a tile with two banks (a corner of the land) cups the water further in (eased in from its banks, so the water doesn't step at them).
    const extra = CORNER_REACH * Math.max(0, own.length - 1)
    patch(out, centre, y, (x, z) => {
      let edge = 2 * HEX_RADIUS
      for (const [a, b] of own) edge = Math.min(edge, toLine([x, z], a, b))
      if (own.length === 0) for (const [a, b] of banks) edge = Math.min(edge, toSegment([x, z], a, b))
      const toExit = Math.hypot(exit[0] - x, exit[1] - z)
      const drift = 0.3 * (1 - smoothstep(2, 10, toExit))
      const foot = nearestFoot(feet, x, z)
      const fromFoot = Math.hypot(x - foot[0], z - foot[1])
      const push = foot[2] * 0.5 * (1 - smoothstep(0, 6, fromFoot))
      const flow: Spot = [
        ((exit[0] - x) / Math.max(toExit, 1e-3)) * drift + ((x - foot[0]) / Math.max(fromFoot, 1e-3)) * push,
        ((exit[1] - z) / Math.max(toExit, 1e-3)) * drift + ((z - foot[1]) / Math.max(fromFoot, 1e-3)) * push,
      ]
      return {
        flow,
        shore: wet ? edge + COAST_REACH : COAST_REACH + extra * Math.min(1, edge / COAST_REACH) - edge,
        foot,
      }
    })
  }
}
