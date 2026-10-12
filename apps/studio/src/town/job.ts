/**
 * One town job, off the main thread: grow the layout (`generateTown`, timed stage by stage) and the
 * planner's map shapes of it for the compare inset. Everything returned is plain data. Pure.
 */
import { generateTown, type TownLayout, type TownSpecInput } from "@guildhall/world"
import { derive, type MapData } from "../planner/derive.ts"
import type { JobLib } from "../planner/job.ts"

export interface TownJob {
  layout: TownLayout
  /** The planner's map of the same plan (`map.plan` is `layout`). */
  map: MapData
  /** Milliseconds per generation stage, then the map's. */
  times: Record<string, number>
}

export type ToWorker = { type: "lib"; lib: JobLib } | { type: "job"; id: number; spec: TownSpecInput }
export type FromWorker =
  | { type: "done"; id: number; job: TownJob }
  | { type: "fail"; id: number; message: string }

type PlanLib = Parameters<typeof generateTown>[1]

export function runTownJob(
  spec: TownSpecInput,
  lib: JobLib,
  now: () => number = () => performance.now(),
): TownJob {
  const times: Record<string, number> = {}
  // With a catalog, the job library's town is the world's `prefabLibrary` (planner/library.ts).
  const layout = generateTown(spec, lib.town as PlanLib, times)
  const t0 = now()
  const map = derive(layout, lib.derive)
  times.map = Math.round((now() - t0) * 1000) / 1000
  return { layout, map, times }
}
