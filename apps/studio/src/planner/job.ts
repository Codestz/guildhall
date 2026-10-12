/**
 * One planner job, start to finish: generate the town, turn it into map shapes, count it. The worker
 * runs it off the main thread; the screen runs it inline when workers are unavailable. Pure.
 */
import type { TownLibrary, TownSpecInput } from "@guildhall/world"
import { type DeriveLib, derive, type MapData } from "./derive.ts"
import { type Generated, generate, type Timing } from "./generate.ts"
import type { Layer } from "./query.ts"
import { layerCounts, type PlanStats, planStats } from "./stats.ts"

export interface JobLib {
  town: TownLibrary
  derive: DeriveLib
}

export interface JobResult {
  map: MapData
  stats: PlanStats
  counts: Record<Layer, number>
  stages: string[]
  problems: Generated["problems"]
}

/** The protocol between the screen and its worker. */
export type ToWorker = { type: "lib"; lib: JobLib } | { type: "job"; id: number; spec: TownSpecInput }
export type FromWorker =
  | { type: "done"; id: number; result: JobResult }
  | { type: "fail"; id: number; message: string }

export function runJob(
  spec: TownSpecInput,
  lib: JobLib,
  now: () => number = () => performance.now(),
): JobResult {
  const gen = generate(spec, lib.town, undefined, now)
  const t0 = now()
  const map = derive(gen.plan, lib.derive, gen.overlays, gen.edgeRoles)
  const timings: Timing[] = [...gen.timings, { stage: "map shapes", ms: now() - t0 }]
  return {
    map,
    stats: planStats(map, timings),
    counts: layerCounts(map),
    stages: gen.stages,
    problems: gen.problems,
  }
}
