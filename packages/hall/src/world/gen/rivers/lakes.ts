import type { Cell } from "../../lands.ts"
import { type Waterways, waterwaysOf } from "../../waterways.ts"
import { key, neighbours, unkey } from "../hex.ts"
import { keepOf } from "../plan/lakes.ts"
import type { IslandPlan } from "../plan.ts"
import type { Relief } from "../relief/index.ts"
import { COAST_TILES, fit } from "../tiles.ts"
import { type Course, dryOf, type Ground } from "./course.ts"
import { coursesFor } from "./pool.ts"

/**
 * The valley lakes (terrain 2c, third attempt): each basin the plan reserved (plan/lakes.ts) gets
 * its stream, from the range's foot through the lake and out by one outlet to the sea (pool.ts),
 * one candidate course after another until the water layer (`waterwaysOf`, which checks the levels,
 * the rim and the outlet) takes it and the basin's shore can be laid as lakeshore tiles
 * (rivers/dressLakes.ts). A basin no course suits stays meadow. Nothing is carved.
 */

/** What the lakes are laid against: the island's ground and its rivers so far. */
export interface LakeInput {
  plan: IslandPlan
  relief: Relief
  ground: Ground
  accepted: readonly Course[]
  /** The terrace level of every land hex, the rivers' own included. */
  level(cell: Cell): number | undefined
  bridges: ReadonlyMap<string, number>
}

/** `base` with the island's lakes in it (or `base` itself when none can be). Deterministic. */
export function addLakes(base: Waterways, input: LakeInput): Waterways {
  const { plan } = input
  const dry = dryOf(plan, input.bridges)
  const kept = keepOf(plan.lakes)
  let accepted = [...input.accepted]
  const pools: string[][] = []
  let waters = base
  for (const lake of plan.lakes) {
    const terrain = { ...input, accepted, dry, kept }
    for (const course of coursesFor(lake, terrain)) {
      const trial = tryPools(input, [...accepted, course], [...pools, lake.cells], dry)
      if (!trial) continue
      waters = trial
      accepted = [...accepted, course]
      pools.push(lake.cells)
      break
    }
  }
  return waters
}

/** The water layer's verdict on `courses` through `pools` (undefined when refused, or a shore can't be laid). */
function tryPools(
  input: LakeInput,
  courses: readonly Course[],
  pools: readonly string[][],
  dry: ReadonlySet<string>,
): Waterways | undefined {
  // A river hex's level is its course's own, never rising downstream (course.ts), whatever the ground's.
  const laid = new Map<string, number>()
  for (const course of courses)
    course.levels.forEach((level, i) => {
      const id = key(course.cells[i] as Cell)
      if (!laid.has(id)) laid.set(id, level)
    })
  let waters: Waterways
  try {
    waters = waterwaysOf({
      level: (cell) => laid.get(key(cell)) ?? input.level(cell),
      rivers: courses.map((c) => c.cells),
      lakes: pools.flat().map(unkey),
    })
  } catch {
    return undefined
  }
  for (const lake of waters.lakes) {
    const wet = new Set(lake.cells.map(key))
    for (const cell of lake.shore) {
      const edges = neighbours(cell).flatMap((n, dir) => (wet.has(key(n)) ? [dir] : []))
      if (dry.has(key(cell)) || input.relief.massifAt(cell) || !fit(COAST_TILES, edges)) return undefined
    }
    if (lake.cells.some((cell) => input.relief.massifAt(cell))) return undefined
  }
  return waters
}
