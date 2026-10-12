/**
 * Routing over a raster (ADR 012): one A* over a cost grid, a string-pull that straightens its cell
 * staircase wherever a straight line costs little more, and rounded corners that keep clear of what
 * the cost forbids. It knows nothing of islands: the island's cost tables live in island/cost.ts.
 *
 * Grid space: cell `i = z * w + x` covers [x, x + 1) × [z, z + 1), its centre at (x + 0.5, z + 0.5);
 * world = origin + grid · cell. A move costs its length (1 or √2) times the mean cost of the two cells
 * (a line crossing cells costs each cell's cost times the length inside it, so the two agree), plus
 * `step` when given. Diagonal moves never squeeze between two impassable cells, and neither do lines.
 */
import { chaikin, dedupe, resample } from "./line.ts"
import { dist, round3, snap, type Vec2 } from "./vec.ts"

export interface CostGrid {
  w: number
  h: number
  /** Per cell, the cost of one unit of length; not finite (Infinity) is impassable. */
  cost: Float32Array
  /** Metres per cell (default 1). */
  cell?: number
  /** Where the grid's corner stands (default [0, 0]). */
  origin?: Vec2
  /**
   * An extra cost for moving from cell a into its neighbour b, added to the move (not finite forbids
   * it). The M4 hook: a grade term here makes a straight climb dear, so routes zig-zag up a slope.
   */
  step?: (a: number, b: number) => number
}

/** Orthogonal moves first, then diagonals: the order neighbours are tried in (part of the tie-break). */
const DX = [1, 0, -1, 0, 1, -1, -1, 1] as const
const DZ = [0, 1, 0, -1, 1, 1, -1, -1] as const
const MOVE = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2] as const

/**
 * How much more than the cells' own path a shortcut may cost. 3%, not plan-w8 §4.2's 10%: at 10% a
 * pulled road runs straight through the woods it should skirt.
 */
const PULL = 1.03

/** Less than Infinity: NaN and Infinity are both impassable. */
const passable = (cost: Float32Array, i: number): boolean => (cost[i] as number) < Number.POSITIVE_INFINITY

/**
 * A min-heap of (f, g, cell), ordered by f, then the larger g (the node nearer the goal), then the
 * lower cell index: a total order, so the pops and so the path never depend on insertion order.
 */
class Heap {
  f = new Float64Array(256)
  g = new Float64Array(256)
  id = new Int32Array(256)
  size = 0

  private less(a: number, b: number): boolean {
    const fa = this.f[a] as number
    const fb = this.f[b] as number
    if (fa !== fb) return fa < fb
    const ga = this.g[a] as number
    const gb = this.g[b] as number
    if (ga !== gb) return ga > gb
    return (this.id[a] as number) < (this.id[b] as number)
  }

  private swap(a: number, b: number): void {
    const f = this.f[a] as number
    const g = this.g[a] as number
    const id = this.id[a] as number
    this.f[a] = this.f[b] as number
    this.g[a] = this.g[b] as number
    this.id[a] = this.id[b] as number
    this.f[b] = f
    this.g[b] = g
    this.id[b] = id
  }

  push(f: number, g: number, id: number): void {
    if (this.size === this.id.length) {
      const grow = <T extends Float64Array | Int32Array>(a: T, make: (n: number) => T): T => {
        const b = make(a.length * 2)
        b.set(a)
        return b
      }
      this.f = grow(this.f, (n) => new Float64Array(n))
      this.g = grow(this.g, (n) => new Float64Array(n))
      this.id = grow(this.id, (n) => new Int32Array(n))
    }
    let i = this.size++
    this.f[i] = f
    this.g[i] = g
    this.id[i] = id
    while (i > 0) {
      const up = (i - 1) >> 1
      if (!this.less(i, up)) break
      this.swap(i, up)
      i = up
    }
  }

  /** Removes the top; read `f[0]`, `g[0]`, `id[0]` before calling. */
  pop(): void {
    const last = --this.size
    if (last > 0) this.swap(0, last)
    let i = 0
    for (;;) {
      const l = 2 * i + 1
      const r = l + 1
      let m = i
      if (l < last && this.less(l, m)) m = l
      if (r < last && this.less(r, m)) m = r
      if (m === i) break
      this.swap(i, m)
      i = m
    }
  }
}

/**
 * The cheapest 8-neighbour path of cells from `from` to `to` (a cell, or the first cell a predicate
 * accepts, found by Dijkstra), both ends included; null when the ends are impassable or nothing joins
 * them. Ties are broken by the heap's total order, so the same grid always gives the same path.
 */
export function gridAStar(g: CostGrid, from: number, to: number | ((i: number) => boolean)): number[] | null {
  const { w, h, cost, step } = g
  const n = w * h
  if (from < 0 || from >= n || !passable(cost, from)) return null
  const goal = typeof to === "number" ? to : -1
  if (typeof to === "number" && (to < 0 || to >= n || !passable(cost, to))) return null
  const accept = typeof to === "number" ? null : to

  // The heuristic is the octile distance at the grid's cheapest cost, so it never overestimates.
  let low = 0
  if (goal >= 0) {
    low = Number.POSITIVE_INFINITY
    for (let i = 0; i < n; i++) {
      const c = cost[i] as number
      if (c < low) low = c
    }
    if (!(low > 0) || !Number.isFinite(low)) low = 0
  }
  const gx = goal % w
  const gz = (goal - gx) / w
  const heuristic = (x: number, z: number): number => {
    if (goal < 0) return 0
    const dx = Math.abs(x - gx)
    const dz = Math.abs(z - gz)
    return low * (Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz))
  }

  const best = new Float64Array(n).fill(Number.POSITIVE_INFINITY)
  const parent = new Int32Array(n).fill(-1)
  const done = new Uint8Array(n)
  const open = new Heap()
  best[from] = 0
  open.push(heuristic(from % w, Math.floor(from / w)), 0, from)

  while (open.size > 0) {
    const i = open.id[0] as number
    const gi = open.g[0] as number
    open.pop()
    if (done[i] === 1) continue
    done[i] = 1
    if (accept ? accept(i) : i === goal) {
      const path: number[] = []
      for (let k = i; k >= 0; k = parent[k] as number) path.push(k)
      return path.reverse()
    }
    const x = i % w
    const z = (i - x) / w
    const ci = cost[i] as number
    for (let d = 0; d < 8; d++) {
      const nx = x + (DX[d] as number)
      const nz = z + (DZ[d] as number)
      if (nx < 0 || nz < 0 || nx >= w || nz >= h) continue
      const j = nz * w + nx
      if (done[j] === 1 || !passable(cost, j)) continue
      // A diagonal needs both cells it brushes past open: nothing slips between two water cells.
      if (d >= 4 && (!passable(cost, z * w + nx) || !passable(cost, nz * w + x))) continue
      let move = ((MOVE[d] as number) * (ci + (cost[j] as number))) / 2
      if (step) move += step(i, j)
      if (!Number.isFinite(move)) continue
      const gj = gi + move
      if (gj < (best[j] as number)) {
        best[j] = gj
        parent[j] = i
        open.push(gj + heuristic(nx, nz), gj, j)
      }
    }
  }
  return null
}

/**
 * The cost of the straight line a → b in grid space (`step` included at each cell crossing), or
 * Infinity when it touches an impassable cell, squeezes through a corner between two, or leaves the
 * grid. Cells are walked exactly (Amanatides–Woo), so a sliver through a cell's corner still counts.
 */
export function lineCost(g: CostGrid, a: Vec2, b: Vec2): number {
  const { w, h, cost, step } = g
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const length = Math.sqrt(dx * dx + dz * dz)
  let x = Math.floor(a[0])
  let z = Math.floor(a[1])
  const sx = dx > 0 ? 1 : -1
  const sz = dz > 0 ? 1 : -1
  const tdx = dx !== 0 ? 1 / Math.abs(dx) : Number.POSITIVE_INFINITY
  const tdz = dz !== 0 ? 1 / Math.abs(dz) : Number.POSITIVE_INFINITY
  let tx = dx > 0 ? (x + 1 - a[0]) * tdx : dx < 0 ? (a[0] - x) * tdx : Number.POSITIVE_INFINITY
  let tz = dz > 0 ? (z + 1 - a[1]) * tdz : dz < 0 ? (a[1] - z) * tdz : Number.POSITIVE_INFINITY
  const inside = (cx: number, cz: number) => cx >= 0 && cz >= 0 && cx < w && cz < h
  let t = 0
  let sum = 0
  let prev = -1
  for (;;) {
    if (!inside(x, z)) return Number.POSITIVE_INFINITY
    const i = z * w + x
    const c = cost[i] as number
    if (!Number.isFinite(c)) return Number.POSITIVE_INFINITY
    if (step && prev >= 0) sum += step(prev, i)
    const next = Math.min(tx, tz, 1)
    sum += c * (next - t) * length
    if (next >= 1) break
    t = next
    prev = i
    if (tx < tz) {
      x += sx
      tx += tdx
    } else if (tz < tx) {
      z += sz
      tz += tdz
    } else {
      // Exactly through a corner: the same rule as a diagonal move.
      if (!inside(x + sx, z) || !inside(x, z + sz)) return Number.POSITIVE_INFINITY
      if (!passable(cost, z * w + x + sx) || !passable(cost, (z + sz) * w + x))
        return Number.POSITIVE_INFINITY
      x += sx
      z += sz
      tx += tdx
      tz += tdz
    }
  }
  return Number.isFinite(sum) ? sum : Number.POSITIVE_INFINITY
}

/** The cell under a world point, or -1 off the grid. */
export function cellAt(g: CostGrid, p: Vec2): number {
  const [x, z] = toGrid(g, p)
  const cx = Math.floor(x)
  const cz = Math.floor(z)
  return cx < 0 || cz < 0 || cx >= g.w || cz >= g.h ? -1 : cz * g.w + cx
}

/** The world centre of cell i. */
export function cellCentre(g: CostGrid, i: number): Vec2 {
  const x = i % g.w
  return toWorld(g, [x + 0.5, (i - x) / g.w + 0.5])
}

function toGrid(g: CostGrid, p: Vec2): Vec2 {
  const c = g.cell ?? 1
  const o = g.origin ?? [0, 0]
  return [(p[0] - o[0]) / c, (p[1] - o[1]) / c]
}

function toWorld(g: CostGrid, p: Vec2): Vec2 {
  const c = g.cell ?? 1
  const o = g.origin ?? [0, 0]
  return [o[0] + p[0] * c, o[1] + p[1] * c]
}

const centreOf = (g: CostGrid, i: number): Vec2 => {
  const x = i % g.w
  return [x + 0.5, (i - x) / g.w + 0.5]
}

/**
 * The cell path as a polyline of world points (cell centres): from each kept cell it reaches ahead to
 * the furthest cell whose straight line costs at most `maxCost` times the cells' own path between
 * them (and touches nothing impassable), so a bend survives only where cutting it would cost more.
 * The whole rest of the path is tried, not just up to the first miss, so no one-cell jogs survive.
 */
export function stringPull(cells: readonly number[], g: CostGrid, maxCost = PULL): Vec2[] {
  if (cells.length === 0) return []
  const { cost, step } = g
  // The path's running cost, move by move, by the same rule gridAStar used.
  const run = new Float64Array(cells.length)
  for (let k = 1; k < cells.length; k++) {
    const a = cells[k - 1] as number
    const b = cells[k] as number
    const diagonal = a % g.w !== b % g.w && Math.floor(a / g.w) !== Math.floor(b / g.w)
    const move = ((diagonal ? Math.SQRT2 : 1) * ((cost[a] as number) + (cost[b] as number))) / 2
    run[k] = (run[k - 1] as number) + move + (step ? step(a, b) : 0)
  }
  const kept = [0]
  for (let k = 0; k < cells.length - 1; ) {
    let reach = k + 1
    const from = centreOf(g, cells[k] as number)
    for (let m = k + 2; m < cells.length; m++) {
      const line = lineCost(g, from, centreOf(g, cells[m] as number))
      if (line <= maxCost * ((run[m] as number) - (run[k] as number)) + 1e-9) reach = m
    }
    kept.push(reach)
    k = reach
  }
  return kept.map((k) => toWorld(g, centreOf(g, cells[k] as number)))
}

export interface SmoothOptions {
  /** Metres: the most a corner's curve reaches back along each leg (default 60). */
  radius?: number
  /** Metres between output points (default 6). */
  step?: number
  /** The grid output points snap to, metres (default 1). */
  snap?: number
  /** A corner's curve may cost this much more than the corner it rounds (default 1.03). */
  maxCost?: number
}

/** How many times a corner's reach is halved before the corner is left sharp. */
const SHRINK = 5

/**
 * The polyline (a string-pulled route, in world metres) with every corner rounded: each corner
 * becomes a curve (Chaikin's limit, a parabola) reaching back up to `radius` along both legs (never
 * past half a leg, so neighbouring curves never overlap), shrunk wherever the wide curve would touch
 * the impassable or cost more than `maxCost` times the corner, so roads swing wide over open ground
 * and tuck in round a lake or a wood. Then it is resampled every `step` and snapped to `snap`; the
 * ends stay where they were. Every segment of the result is passable.
 */
export function smoothRoute(line: readonly Vec2[], g: CostGrid, opts: SmoothOptions = {}): Vec2[] {
  const cell = g.cell ?? 1
  const radius = (opts.radius ?? 60) / cell
  const maxCost = opts.maxCost ?? PULL
  const grid = opts.snap ?? 1
  const pts = line.map((p) => toGrid(g, p))
  if (pts.length < 2) return line.map((p) => [round3(p[0]), round3(p[1])])

  const curve: Vec2[] = [pts[0] as Vec2]
  for (let k = 1; k < pts.length - 1; k++) {
    const prev = pts[k - 1] as Vec2
    const p = pts[k] as Vec2
    const next = pts[k + 1] as Vec2
    const back = dist(prev, p) * (k === 1 ? 1 : 0.5)
    const ahead = dist(p, next) * (k === pts.length - 2 ? 1 : 0.5)
    let reach = Math.min(radius, back, ahead)
    let round: Vec2[] | null = null
    for (let tries = 0; tries < SHRINK && reach > 0.25 && !round; tries++, reach /= 2) {
      const a = towards(p, prev, reach)
      const b = towards(p, next, reach)
      const corner = lineCost(g, a, p) + lineCost(g, p, b)
      // Cutting the corner first; where that bites into what the corner skirts (a wood, the water), a
      // curve through the corner itself, swinging out on the open side.
      const through: Vec2 = [2 * p[0] - (a[0] + b[0]) / 2, 2 * p[1] - (a[1] + b[1]) / 2]
      for (const control of [p, through]) {
        const arc = chaikin([a, control, b], 4)
        let c = 0
        for (let i = 1; i < arc.length && Number.isFinite(c); i++)
          c += lineCost(g, arc[i - 1] as Vec2, arc[i] as Vec2)
        if (Number.isFinite(c) && c <= maxCost * corner + 1e-9) {
          round = arc
          break
        }
      }
    }
    curve.push(...(round ?? [p]))
  }
  curve.push(pts[pts.length - 1] as Vec2)

  // Resampled and snapped. Wherever a chord, or its snap, would touch the impassable, the curve's own
  // points between the chord's ends are kept instead, so the result is exactly as clear as the curve.
  const world = dedupe(curve.map((p) => toWorld(g, p)))
  const arcs = [0]
  for (let i = 1; i < world.length; i++)
    arcs.push((arcs[i - 1] as number) + dist(world[i - 1] as Vec2, world[i] as Vec2))
  const total = arcs[arcs.length - 1] as number
  const fine = resample(world, opts.step ?? 6)
  const count = fine.length - 1
  const clear = (a: Vec2, b: Vec2) => Number.isFinite(lineCost(g, toGrid(g, a), toGrid(g, b)))
  const out: Vec2[] = [fine[0] as Vec2]
  let j = 1
  for (let k = 1; k <= count; k++) {
    const p = fine[k] as Vec2
    const q: Vec2 = k === count ? p : [snapTo(p[0], grid), snapTo(p[1], grid)]
    const s0 = (total * (k - 1)) / count
    const s1 = (total * k) / count
    if (clear(out[out.length - 1] as Vec2, q)) out.push(q)
    else {
      out[out.length - 1] = fine[k - 1] as Vec2
      for (; j < world.length && (arcs[j] as number) < s1 - 1e-6; j++)
        if ((arcs[j] as number) > s0 + 1e-6) out.push(snap(world[j] as Vec2))
      out.push(p)
    }
    while (j < world.length && (arcs[j] as number) < s1 - 1e-6) j++
  }
  return out
}

function towards(from: Vec2, to: Vec2, d: number): Vec2 {
  const l = dist(from, to)
  const t = l === 0 ? 0 : d / l
  return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]
}

const snapTo = (x: number, grid: number): number => round3(Math.round(x / grid) * grid)
