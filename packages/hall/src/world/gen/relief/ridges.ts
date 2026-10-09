import { type Cell, cellToWorld } from "../../lands.ts"
import type { Spot } from "../../layout.ts"
import { Heap } from "../heap.ts"
import { key, neighbours, noise, unkey } from "../hex.ts"

/**
 * A massif's skeleton (terrain v2 §2.2): peaks on its footprint, ridges joining them (a minimum
 * spanning tree routed through the footprint's middle) with a saddle, a pass, at the middle of each,
 * and spurs running out to the rim. The ridge is a polyline in world xz with a crest height at every
 * point; field.ts hangs the mountain's flanks off it.
 */

export interface Peak {
  cell: Cell
  at: Spot
  /** Crest height above the massif's base, before the field's own scaling. */
  height: number
}

export interface Ridge {
  points: Spot[]
  /** The crest's height at each point. */
  crest: number[]
}

export interface Saddle {
  at: Spot
  height: number
  /** The two peaks (indexes into `peaks`) its ridge joins. */
  between: readonly [number, number]
}

export interface Skeleton {
  peaks: Peak[]
  ridges: Ridge[]
  saddles: Saddle[]
}

/** Peaks are at least this far apart, world units (about four rings). */
const PEAK_GAP = 38
/** A saddle dips to this share of the lower of its two peaks. */
const SADDLE = [0.55, 0.7] as const

/** Rings from each footprint hex to the nearest hex outside it (1 on the rim). */
export function depthsOf(keys: ReadonlySet<string>): Map<string, number> {
  const depth = new Map<string, number>()
  let wave: string[] = []
  for (const id of keys)
    if (neighbours(unkey(id)).some((n) => !keys.has(key(n)))) {
      depth.set(id, 1)
      wave.push(id)
    }
  for (let d = 2; wave.length > 0; d++) {
    const next: string[] = []
    for (const id of wave)
      for (const n of neighbours(unkey(id))) {
        const nid = key(n)
        if (keys.has(nid) && !depth.has(nid)) {
          depth.set(nid, d)
          next.push(nid)
        }
      }
    wave = next
  }
  return depth
}

const dist = (a: Spot, b: Spot): number => Math.hypot(a[0] - b[0], a[1] - b[1])

/** The cheapest hex path between two footprint hexes, hugging the middle (deep hexes cost less). */
function route(from: Cell, to: Cell, keys: ReadonlySet<string>, depth: ReadonlyMap<string, number>): Cell[] {
  const goal = key(to)
  const best = new Map<string, number>([[key(from), 0]])
  const back = new Map<string, string>()
  const heap = new Heap<{ id: string; cost: number }>((a, b) => a.cost < b.cost)
  heap.push({ id: key(from), cost: 0 })
  for (let at = heap.pop(); at; at = heap.pop()) {
    if (at.id === goal) break
    if (at.cost > (best.get(at.id) ?? Number.POSITIVE_INFINITY)) continue
    for (const n of neighbours(unkey(at.id))) {
      const nid = key(n)
      if (!keys.has(nid)) continue
      const cost = at.cost + 1 + 2.5 / (depth.get(nid) ?? 1)
      if (cost >= (best.get(nid) ?? Number.POSITIVE_INFINITY)) continue
      best.set(nid, cost)
      back.set(nid, at.id)
      heap.push({ id: nid, cost })
    }
  }
  const path: Cell[] = [to]
  for (let id = goal; id !== key(from); ) {
    id = back.get(id) ?? key(from)
    path.unshift(unkey(id))
  }
  return path
}

/** Two rounds of corner cutting, ends fixed: a hex path becomes a crest with bends. */
function chaikin(points: readonly Spot[]): Spot[] {
  let line = [...points]
  for (let round = 0; round < 2 && line.length > 2; round++) {
    const next: Spot[] = [line[0] as Spot]
    for (let i = 0; i + 1 < line.length; i++) {
      const [ax, az] = line[i] as Spot
      const [bx, bz] = line[i + 1] as Spot
      next.push(
        [ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25],
        [ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75],
      )
    }
    next.push(line[line.length - 1] as Spot)
    line = next
  }
  return line
}

/** Arc length 0–1 of each point along a polyline. */
function along(points: readonly Spot[]): number[] {
  const out = [0]
  for (let i = 1; i < points.length; i++)
    out.push((out[i - 1] as number) + dist(points[i - 1] as Spot, points[i] as Spot))
  const length = out[out.length - 1] || 1
  return out.map((d) => d / length)
}

/** The skeleton of a footprint whose main peak stands `height` tall. */
export function skeletonOf(
  cells: readonly Cell[],
  keys: ReadonlySet<string>,
  hub: Spot,
  height: number,
  seed: number,
): Skeleton {
  const depth = depthsOf(keys)
  const deepest = Math.max(...depth.values())
  const jitter = (cell: Cell, salt: string): number => noise(seed, cell, salt)
  const worldOf = (cell: Cell): Spot => cellToWorld(cell)

  // The main peak: deep inside, and farthest from the hub.
  const main = [...cells]
    .filter((c) => (depth.get(key(c)) ?? 0) >= Math.max(1, deepest - 1))
    .sort(
      (a, b) =>
        dist(worldOf(b), hub) + jitter(b, "peak") * 12 - (dist(worldOf(a), hub) + jitter(a, "peak") * 12),
    )[0] as Cell
  const peaks: Peak[] = [{ cell: main, at: worldOf(main), height }]
  const wanted = Math.min(4, 1 + Math.floor(cells.length / 45))
  const inner = cells.filter((c) => (depth.get(key(c)) ?? 0) >= Math.max(1, Math.floor(deepest / 2)))
  while (peaks.length < wanted) {
    let pick: Cell | undefined
    let far = PEAK_GAP
    for (const cell of inner) {
      const gap = Math.min(...peaks.map((p) => dist(p.at, worldOf(cell)))) + jitter(cell, "next") * 6
      if (gap > far) {
        far = gap
        pick = cell
      }
    }
    if (!pick) break
    peaks.push({ cell: pick, at: worldOf(pick), height: height * (0.6 + 0.25 * jitter(pick, "tall")) })
  }

  // Ridges: Prim's tree over the peaks, each edge routed through the middle of the footprint.
  const ridges: Ridge[] = []
  const saddles: Saddle[] = []
  const joined = [0]
  while (joined.length < peaks.length) {
    let edge: [number, number] | undefined
    let shortest = Number.POSITIVE_INFINITY
    for (const a of joined)
      for (let b = 0; b < peaks.length; b++) {
        if (joined.includes(b)) continue
        const d = dist((peaks[a] as Peak).at, (peaks[b] as Peak).at)
        if (d < shortest) {
          shortest = d
          edge = [a, b]
        }
      }
    if (!edge) break
    const [a, b] = edge
    const from = peaks[a] as Peak
    const to = peaks[b] as Peak
    const points = chaikin(route(from.cell, to.cell, keys, depth).map(worldOf))
    const s = along(points)
    const low = Math.min(from.height, to.height)
    const dip = low * (SADDLE[0] + (SADDLE[1] - SADDLE[0]) * jitter(to.cell, "saddle"))
    const crest = s.map((t) => {
      const end = t < 0.5 ? from.height : to.height
      return dip + (end - dip) * Math.abs(2 * t - 1) ** 1.25
    })
    const mid = s.findIndex((t) => t >= 0.5)
    saddles.push({ at: points[mid] as Spot, height: dip, between: [a, b] })
    ridges.push({ points, crest })
    joined.push(b)
  }

  // Spurs: arms from each peak out to the rim, as far from everything else as they can be.
  const marks: Spot[] = ridges.flatMap((r) => r.points).concat(peaks.map((p) => p.at))
  const rim = cells.filter((c) => depth.get(key(c)) === 1)
  peaks.forEach((peak, p) => {
    const arms = 1 + (jitter(peak.cell, "arms") > 0.45 ? 1 : 0)
    for (let arm = 0; arm < arms; arm++) {
      let pick: Cell | undefined
      let far = 25
      for (const cell of rim) {
        const gap = Math.min(...marks.map((m) => dist(m, worldOf(cell)))) + jitter(cell, `arm${p}`) * 8
        if (gap > far) {
          far = gap
          pick = cell
        }
      }
      if (!pick) continue
      const points = chaikin(route(peak.cell, pick, keys, depth).map(worldOf))
      const s = along(points)
      ridges.push({ points, crest: s.map((t) => peak.height * (0.85 - 0.7 * t ** 0.8)) })
      marks.push(...points)
    }
  })
  return { peaks, ridges, saddles }
}
