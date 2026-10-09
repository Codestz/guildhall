import { key, noise, unkey } from "../gen/hex.ts"
import { type IslandPlan, quotaOf } from "../gen/plan.ts"
import type { RepoShape } from "../gen/repo.ts"
import { type Cell, cellToWorld } from "../lands.ts"
import type { Chronicle, Day } from "./format.ts"
import { ghostsOf, heatOf } from "./growthGhosts.ts"
import { HEX_R, held, heldAt, hexDistance, STEP_S, sizeOf, spansOf, union } from "./growthSpans.ts"
import { districtsAt } from "./reconstruct.ts"

export { STEP_S } from "./growthSpans.ts"

/**
 * A repo's growth timelapse (`?grow`, ADR 0021) as a pure function of film time: no three, no
 * React. The film runs from the first commit to today in `duration` seconds; every hex of today's
 * island (the plan islandFromTree made) is up or under the sea at each moment, so a seek, a paused
 * probe shot and a replay all show the same island (scene/seas/fleet.ts' pattern).
 *
 *   prologue   the keep stands from the start; the harbour rises round it, ring by ring
 *   districts  each rises from the sea in rings from its square once its folder is born, sized by
 *              the folder's size that day (land ∝ log of its bytes, as the plan sized it), so hexes
 *              pop up as it grows and sink if it shrinks; its road draws in hex by hex from the hub
 *   ghosts     folders gone by today (or renamed away) borrow today's land while they lived, and
 *              sink back when they die
 *   epilogue   the island is exactly today's (districtsAt ends on it), held a moment
 *
 * Sizes are read every STEP_S of film and held for HOLD_S before a hex may sink, so a folder that
 * wobbles round a hex boundary doesn't flicker. Each hex's life is a few [on, off) intervals; what a
 * frame shows (its rise with a small overshoot, its sinking) is computed from them at any `t`.
 */

/** The harbour rises over this much film before the first commit's day starts moving. */
export const PROLOGUE_S = 2.5
/** Today's island held at the end, before the hall hands back. */
export const EPILOGUE_S = 3
/** A hex's pop up out of the sea, and its slower sink. */
export const RISE_S = 0.5
export const SINK_S = 0.8
/** A hex stays up this long after its district last needed it. */
export const HOLD_S = 1
/** A road draws in this fast, hex by hex from the hub. */
export const ROAD_STEP_S = 0.06

/** 45 s for a young repo up to 75 s for twelve years or more. */
export function filmLength(c: Pick<Chronicle, "start" | "end">): number {
  const years = Math.max(0, c.end - c.start) / 365.25
  return Math.round(45 + 30 * Math.min(1, years / 12))
}

export interface GrowthInput {
  chronicle: Chronicle
  /** summarize(tree) of the tree the island was grown from. */
  shape: RepoShape
  /** islandFromTree(tree).plan: the same island the hall draws. */
  plan: IslandPlan
}

export interface GrowthDistrict {
  name: string
  /** Film time its first hex rises (Infinity: never in the film). */
  born: number
  /** Its own land hexes (roads and the keep left out), in the order they rise. */
  hexes: Int32Array
}

export interface GrowthGhost {
  name: string
  born: number
  /** Film time its last hex is let go (Infinity: alive at the end of the readings). */
  died: number
  /** The land it borrows, in the order it rises. */
  hexes: Int32Array
}

export interface GrowthPlan {
  start: Day
  end: Day
  duration: number
  /** Land hexes, by index: their cells, keys, world spots and the plan district holding them. */
  cells: Cell[]
  keys: string[]
  index: ReadonlyMap<string, number>
  spots: Float32Array
  district: Int16Array
  /** Per hex, flat [on, off, on, off…] film times (off Infinity: still up at the end). */
  own: number[][]
  ghostHeld: number[][]
  any: number[][]
  districts: GrowthDistrict[]
  ghosts: GrowthGhost[]
  /** Readings: how many. Per reading the framing [cx, cz, radius]; per district × reading the heat. */
  steps: number
  frame: Float32Array
  heat: Float32Array
}

/** Film time → day (fractional): still on the first day through the prologue, today through the epilogue. */
export function dayAt(g: Pick<GrowthPlan, "start" | "end" | "duration">, t: number): number {
  const span = g.duration - PROLOGUE_S - EPILOGUE_S
  const p = Math.min(1, Math.max(0, (t - PROLOGUE_S) / span))
  return g.start + (g.end - g.start) * p
}

/** Day → the film time it is reached. */
export function timeOfDay(g: Pick<GrowthPlan, "start" | "end" | "duration">, day: number): number {
  const span = g.duration - PROLOGUE_S - EPILOGUE_S
  const p = g.end > g.start ? (day - g.start) / (g.end - g.start) : 1
  return PROLOGUE_S + span * Math.min(1, Math.max(0, p))
}

export function planGrowth({ chronicle: c, shape, plan }: GrowthInput): GrowthPlan {
  const duration = filmLength(c)
  const steps = Math.floor(duration / STEP_S) + 1
  const base = { start: c.start, end: c.end, duration }

  // ---- hexes ----
  const keys = [...plan.land.keys()]
  const index = new Map(keys.map((id, i) => [id, i]))
  const cells = keys.map(unkey)
  const n = keys.length
  const spots = new Float32Array(n * 2)
  const district = new Int16Array(n)
  const kind: string[] = []
  cells.forEach((cell, i) => {
    const [x, z] = cellToWorld(cell)
    spots[i * 2] = x
    spots[i * 2 + 1] = z
    const hex = plan.land.get(keys[i] as string)
    district[i] = hex?.district ?? 0
    kind.push(hex?.char ?? ".")
  })
  const isRoad = (i: number) => kind[i] === "="
  const isKeep = (i: number) => kind[i] === "K" || kind[i] === "V"

  // ---- each district's hexes, in rings from its square ----
  const ranks: number[][] = plan.districts.map(() => [])
  for (let i = 0; i < n; i++) if (!isRoad(i) && !isKeep(i)) ranks[district[i] as number]?.push(i)
  plan.districts.forEach((d, di) => {
    const from = di === 0 ? plan.hub : d.square
    const order = (i: number) =>
      hexDistance(from, cells[i] as Cell) + 0.45 * noise(plan.seed, cells[i] as Cell, "rise")
    ranks[di]?.sort((a, b) => order(a) - order(b))
  })

  // ---- the readings: every district's size, and the ghosts', each STEP_S of film ----
  const names = plan.districts.map((d) => d.folder.name)
  const finals = plan.districts.map((d) => sizeOf(d.folder.files, d.folder.bytes))
  const counts = plan.districts.map(() => new Int32Array(steps))
  const ghostSizes = new Map<string, Float64Array>()
  const finalTotal = finals.reduce((sum, size) => sum + size, 0)
  for (let i = 0; i < steps; i++) {
    const day = dayAt(base, i * STEP_S)
    const at = districtsAt(c, shape, day)
    let total = 0
    for (const d of at.districts.values()) total += sizeOf(d.files, d.bytes)
    for (let di = 1; di < names.length; di++) {
      const now = at.districts.get(names[di] as string)
      const final = finals[di] as number
      // A district none of the chronicle's units maps onto grows with the whole repo.
      const size =
        now?.born === undefined ? (final * total) / Math.max(1, finalTotal) : sizeOf(now.files, now.bytes)
      const share = size > 0 && final > 0 ? Math.min(1, quotaOf(size) / quotaOf(final)) : 0
      const room = ranks[di]?.length ?? 0
      ;(counts[di] as Int32Array)[i] = share > 0 ? Math.min(room, Math.max(1, Math.ceil(share * room))) : 0
    }
    for (const ghost of at.ghosts) {
      let series = ghostSizes.get(ghost.name)
      if (!series) {
        series = new Float64Array(steps)
        ghostSizes.set(ghost.name, series)
      }
      series[i] = sizeOf(ghost.files, ghost.bytes)
    }
  }
  const hold = Math.round(HOLD_S / STEP_S)
  const kept = counts.map((series) => held(series, hold))

  // ---- each hex's own life ----
  const own: number[][] = Array.from({ length: n }, () => [])
  const districts: GrowthDistrict[] = plan.districts.map((d, di) => {
    const list = ranks[di] ?? []
    if (di === 0) {
      // The harbour: up through the prologue, ring by ring from the hub, for good.
      list.forEach((h, k) => {
        own[h] = [PROLOGUE_S * 0.75 * (k / Math.max(1, list.length)), Number.POSITIVE_INFINITY]
      })
      return { name: d.folder.name, born: 0, hexes: Int32Array.from(list) }
    }
    const series = kept[di] as Int32Array
    list.forEach((h, k) => {
      own[h] = spansOf(series, k)
    })
    const first = series.findIndex((count) => count > 0)
    return {
      name: d.folder.name,
      born: first < 0 ? Number.POSITIVE_INFINITY : first * STEP_S,
      hexes: Int32Array.from(list),
    }
  })
  // The keep stands from the first frame (the hall's own rock): up already at t = 0.
  for (let i = 0; i < n; i++) if (isKeep(i)) own[i] = [-RISE_S, Number.POSITIVE_INFINITY]
  // Roads draw in from the hub as each district is born; a hex shared by roads takes the first.
  const squares = new Map(plan.districts.map((d, di) => [key(d.square), di]))
  plan.roads.forEach((road, r) => {
    const last = road[road.length - 1]
    const di = r === 0 ? 0 : (squares.get(key(last ?? plan.hub)) ?? 0)
    const born = districts[di]?.born ?? 0
    road.forEach((cell, j) => {
      const h = index.get(key(cell))
      if (h === undefined) return
      const on = born + j * ROAD_STEP_S
      const was = own[h]?.[0]
      if (was === undefined || on < was) own[h] = [on, Number.POSITIVE_INFINITY]
    })
  })
  for (let i = 0; i < n; i++)
    if ((own[i]?.length ?? 0) === 0 && isRoad(i)) own[i] = [0, Number.POSITIVE_INFINITY]

  // ---- ghosts: today's land, borrowed while they lived ----
  const ghostHeld: number[][] = Array.from({ length: n }, () => [])
  const ghosts = ghostsOf(ghostSizes, ranks, cells, plan, ghostHeld, hold)

  const any = own.map((list, i) => union([list, ghostHeld[i] ?? []]))

  // ---- framing: the middle and reach of the land up at each reading ----
  const frame = new Float32Array(steps * 3)
  let radius = 0
  for (let i = 0; i < steps; i++) {
    const t = i * STEP_S
    let minX = -12
    let maxX = 12
    let minZ = -12
    let maxZ = 12
    for (let h = 0; h < n; h++) {
      if (!heldAt(any[h] as number[], t)) continue
      const x = spots[h * 2] as number
      const z = spots[h * 2 + 1] as number
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minZ = Math.min(minZ, z)
      maxZ = Math.max(maxZ, z)
    }
    const cx = (minX + maxX) / 2
    const cz = (minZ + maxZ) / 2
    // The reach only shrinks slowly (a ghost sinking shouldn't yank the camera in).
    radius = Math.max(Math.hypot(maxX - minX, maxZ - minZ) / 2 + HEX_R, radius * 0.985)
    frame[i * 3] = cx
    frame[i * 3 + 1] = cz
    frame[i * 3 + 2] = radius
  }

  return {
    ...base,
    cells,
    keys,
    index,
    spots,
    district,
    own,
    ghostHeld,
    any,
    districts,
    ghosts,
    steps,
    frame,
    heat: heatOf(
      c,
      shape,
      plan,
      Array.from({ length: steps }, (_, i) => dayAt(base, i * STEP_S)),
    ),
  }
}
