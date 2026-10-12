/**
 * One town job, off the main thread: grow the layout (`generateTown`, timed stage by stage), the
 * planner's map shapes of it for the compare inset, and the meshes of its ground and of its water
 * (with open sea round the site) as typed arrays render only uploads. Everything returned is plain
 * data. Pure.
 */
import {
  type GroundGeometry,
  generateTown,
  groundGeometry,
  type TownDraw,
  type TownLayout,
  type TownSpecInput,
  townGround,
  townWater,
  type Vec2,
  type WaterGeometry,
  waterGeometry,
} from "@guildhall/world"
import { derive, type MapData } from "../planner/derive.ts"
import type { JobLib } from "../planner/job.ts"

export interface TownJob {
  layout: TownLayout
  /** The planner's map of the same plan (`map.plan` is `layout`). */
  map: MapData
  /** The ground's and the water's meshes, ready to upload. */
  ground: GroundGeometry
  water: WaterGeometry
  /** Milliseconds per generation stage, then the map's, the ground's and the water's. */
  times: Record<string, number>
}

export type ToWorker = { type: "lib"; lib: JobLib } | { type: "job"; id: number; spec: TownSpecInput }
export type FromWorker =
  | { type: "done"; id: number; job: TownJob }
  | { type: "fail"; id: number; message: string }

type PlanLib = Parameters<typeof generateTown>[1]

/** How far the sea runs past the site's bounds, as a share of their half side (the haze hides its edge). */
const SEA_REACH = 3

/**
 * The water with open sea round the site: four bands (not overlapping) from the bounds' box out to
 * SEA_REACH × its half side. On an island site the sea is inside the bounds already; the bands only
 * carry it out to the haze. The shore lines stay the land's outline.
 */
export function withSea(water: TownDraw["water"], bounds: readonly Vec2[]): TownDraw["water"] {
  if (bounds.length < 3) return water
  let x0 = Number.POSITIVE_INFINITY
  let z0 = Number.POSITIVE_INFINITY
  let x1 = Number.NEGATIVE_INFINITY
  let z1 = Number.NEGATIVE_INFINITY
  for (const [x, z] of bounds) {
    x0 = Math.min(x0, x)
    z0 = Math.min(z0, z)
    x1 = Math.max(x1, x)
    z1 = Math.max(z1, z)
  }
  const r = SEA_REACH * Math.max(x1 - x0, z1 - z0) * 0.5
  const box = (a: number, b: number, c: number, d: number): Vec2[] => [
    [a, b],
    [c, b],
    [c, d],
    [a, d],
  ]
  const bands = [
    box(x0 - r, z0 - r, x1 + r, z0),
    box(x0 - r, z1, x1 + r, z1 + r),
    box(x0 - r, z0, x0, z1),
    box(x1, z0, x1 + r, z1),
  ]
  return { ...water, polys: [...water.polys, ...bands] }
}

export function runTownJob(
  spec: TownSpecInput,
  lib: JobLib,
  now: () => number = () => performance.now(),
): TownJob {
  const times: Record<string, number> = {}
  const lap = (name: string, t0: number) => {
    times[name] = Math.round((now() - t0) * 1000) / 1000
  }
  // With a catalog, the job library's town is the world's `prefabLibrary` (planner/library.ts).
  const layout = generateTown(spec, lib.town as PlanLib, times)
  let t0 = now()
  const map = derive(layout, lib.derive)
  lap("map", t0)
  // The prefabs the library compiled are the ones the screen draws as houses (their footprints shade).
  const prefabs = new Set(lib.town.prefabs.map((p) => p.id))
  t0 = now()
  const draw = townGround(layout, (p) => prefabs.has(p.prefab))
  const ground = groundGeometry(draw, layout.spec.seed)
  lap("ground", t0)
  t0 = now()
  const water = waterGeometry(withSea(townWater(layout, draw), layout.bounds))
  lap("water", t0)
  return { layout, map, ground, water, times }
}

/** The job's typed arrays, handed over (not copied) when the worker posts it. */
export const transferables = (job: TownJob): ArrayBuffer[] =>
  [job.ground, job.water].flatMap((g) =>
    Object.values(g).map((a: Float32Array | Uint32Array) => a.buffer as ArrayBuffer),
  )
