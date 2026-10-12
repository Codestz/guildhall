import { noise } from "../gen/hex.ts"
import { type IslandPlan, quotaOf } from "../gen/plan.ts"
import type { RepoShape } from "../gen/repo.ts"
import { type Cell, cellToWorld } from "../lands.ts"
import { activityAt, type Chronicle, weekOf, weeksOf } from "./format.ts"
import type { GrowthGhost } from "./growth.ts"
import { angleGap, held, hexDistance, STEP_S, sizeOf, spansOf, union } from "./growthSpans.ts"
import { districtOf } from "./reconstruct.ts"

/** The growth timelapse's ghosts (folders gone by today) and its activity heat (growth.ts). */

/** Ghosts kept, biggest first. */
export const MAX_GHOSTS = 6

/**
 * The ghosts kept (biggest first, at most MAX_GHOSTS), each given a patch of today's land round a
 * seed spread round the harbour (away from the bay), sized like a district of its size would be.
 */
export function ghostsOf(
  sizes: ReadonlyMap<string, Float64Array>,
  ranks: readonly number[][],
  cells: readonly Cell[],
  plan: IslandPlan,
  ghostHeld: number[][],
  hold: number,
): GrowthGhost[] {
  // Land per quota, as the plan shrank the districts to fit: a ghost gets the same.
  let land = 0
  let quota = 0
  plan.districts.forEach((d, di) => {
    if (di === 0) return
    land += ranks[di]?.length ?? 0
    quota += quotaOf(sizeOf(d.folder.files, d.folder.bytes))
  })
  const scale = quota > 0 ? land / quota : 1
  const candidates = ranks.slice(1).flat()
  if (candidates.length === 0) return []
  const peakOf = (series: Float64Array) => series.reduce((top, v) => Math.max(top, v), 0)
  const chosen = [...sizes]
    .map(([name, series]) => ({ name, series, peak: peakOf(series), first: series.findIndex((v) => v > 0) }))
    .sort((a, b) => b.peak - a.peak || (a.name < b.name ? -1 : 1))
    .slice(0, MAX_GHOSTS)
    .sort((a, b) => a.first - b.first || b.peak - a.peak)
  const [hx, hz] = cellToWorld(plan.hub)
  const used = new Set<number>()
  return chosen.map(({ name, series }, j) => {
    const counts = new Int32Array(series.length)
    series.forEach((size, i) => {
      counts[i] = size > 0 ? Math.min(candidates.length, Math.max(1, Math.round(quotaOf(size) * scale))) : 0
    })
    const kept = held(counts, hold)
    const peak = kept.reduce((top, v) => Math.max(top, v), 0)
    // North first, then round by the golden angle; the bay (south, +z) is left open.
    let angle = -Math.PI / 2 + j * 2.399963
    if (angleGap(angle, Math.PI / 2) < 0.7) angle += Math.PI / 2
    const score = (h: number) => {
      const [x, z] = cellToWorld(cells[h] as Cell)
      return (
        9 * angleGap(angle, Math.atan2(z - hz, x - hx)) +
        hexDistance(plan.hub, cells[h] as Cell) +
        (used.has(h) ? 4 : 0)
      )
    }
    const seed = candidates.reduce((best, h) => (score(h) < score(best) ? h : best))
    const order = (h: number) =>
      hexDistance(cells[seed] as Cell, cells[h] as Cell) + 0.45 * noise(plan.seed, cells[h] as Cell, name)
    const hexes = [...candidates].sort((a, b) => order(a) - order(b)).slice(0, peak)
    hexes.forEach((h, k) => {
      used.add(h)
      ghostHeld[h] = union([ghostHeld[h] ?? [], spansOf(kept, k)])
    })
    const first = kept.findIndex((v) => v > 0)
    let last = -1
    for (let i = kept.length - 1; i >= 0; i--)
      if ((kept[i] as number) > 0) {
        last = i
        break
      }
    return {
      name,
      born: first < 0 ? Number.POSITIVE_INFINITY : first * STEP_S,
      died: last < 0 || last === kept.length - 1 ? Number.POSITIVE_INFINITY : (last + 1) * STEP_S,
      hexes: Int32Array.from(hexes),
    }
  })
}

/**
 * How busy each district is at each reading, 0–1: its contributors' weekly commits (a contributor
 * counts towards the district of their home unit), over five weeks, against the busiest district
 * week. A chronicle without homes (quick) has no heat.
 */
export function heatOf(
  c: Chronicle,
  shape: RepoShape,
  plan: IslandPlan,
  /** The day at each reading. */
  days: readonly number[],
): Float32Array {
  const steps = days.length
  const out = new Float32Array(plan.districts.length * steps)
  const weeks = weeksOf(c)
  const map = districtOf(c, shape)
  const byName = new Map(plan.districts.map((d, di) => [d.folder.name, di]))
  const weekly = plan.districts.map(() => new Float32Array(weeks))
  let any = false
  for (const person of c.contributors) {
    const di = byName.get(map.get(person.home ?? "") ?? "")
    if (di === undefined || person.bot) continue
    any = true
    const series = weekly[di] as Float32Array
    for (let w = person.from; w < person.from + person.weeks.length && w < weeks; w++)
      series[w] = (series[w] as number) + activityAt(person, w)
  }
  if (!any) return out
  const smooth = weekly.map((series) =>
    series.map((_, w) => {
      let sum = 0
      for (let k = w - 2; k <= w + 2; k++) sum += series[Math.min(weeks - 1, Math.max(0, k))] as number
      return sum / 5
    }),
  )
  const top = Math.max(1, ...smooth.map((series) => series.reduce((m, v) => Math.max(m, v), 0))) * 0.7
  for (let i = 0; i < steps; i++) {
    const week = weekOf(c, Math.floor(days[i] as number))
    smooth.forEach((series, di) => {
      out[di * steps + i] = Math.min(1, (series[week] as number) / top)
    })
  }
  return out
}
