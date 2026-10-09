import type { Cell } from "../../lands.ts"
import { TERRACE, type Waterways, waterwaysOf } from "../../waterways.ts"
import { key } from "../hex.ts"
import type { IslandPlan } from "../plan.ts"
import type { Relief } from "../relief/index.ts"
import { carveRelief } from "./carve.ts"
import { type Course, coursesOf, groundOf } from "./course.ts"

export { dressRivers } from "./dress.ts"

/**
 * An island's rivers (terrain 2c): springs high on the ranges, drained down the valley floors to
 * the sea (course.ts), sorted into reaches and falls by the water layer (`waterwaysOf`, which draws
 * them: scene/nature/Rivers.tsx), the massifs carved to the water's contract (carve.ts) and the
 * lowland hexes tiled (dress.ts). Pure and deterministic; `riversOf` carves the relief in place.
 */

export interface IslandRivers {
  waters: Waterways
  /** Every river hex, by key. */
  hexes: ReadonlySet<string>
  /** The road hexes the rivers cross (a bridge), by the road's axis (0–2). */
  bridges: ReadonlyMap<string, number>
}

export function riversOf(
  plan: IslandPlan,
  relief: Relief,
  level: (cell: Cell) => number,
): IslandRivers | undefined {
  const ground = groundOf(plan, relief, level)
  const { courses, bridges } = coursesOf(plan, relief, ground)
  const wet = new Map<string, number>()
  const accepted: Course[] = []
  let waters: Waterways | undefined
  // A course the water layer refuses (it checks every rule) is left out; the rest stand.
  for (const course of courses) {
    const trial = new Map(wet)
    course.levels.forEach((l, i) => {
      const id = key(course.cells[i] as Cell)
      if (!trial.has(id)) trial.set(id, l)
    })
    const levelOf = (cell: Cell): number | undefined => {
      const id = key(cell)
      if (!plan.land.has(id)) return undefined
      if (trial.has(id)) return trial.get(id)
      return ground.massif.has(id)
        ? Math.max(0, Math.floor((ground.height.get(id) ?? 0) / TERRACE))
        : level(cell)
    }
    try {
      waters = waterwaysOf({ level: levelOf, rivers: [...accepted, course].map((c) => c.cells) })
    } catch {
      continue
    }
    accepted.push(course)
    for (const [id, l] of trial) wet.set(id, l)
  }
  if (!waters || accepted.length === 0) return undefined
  carveRelief(relief, waters)
  const hexes = new Set(waters.rivers.flatMap((reach) => reach.hexes.map((hex) => key(hex.cell))))
  return { waters, hexes, bridges: new Map([...bridges].filter(([id]) => hexes.has(id))) }
}
