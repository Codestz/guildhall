import type { Cell } from "../../lands.ts"
import { key, step } from "../hex.ts"
import type { IslandPlan } from "../plan.ts"
import { contiguous } from "../tiles.ts"

const LEVEL: Record<string, number> = { H: 1, m: 1, M: 2 }

/** The plan's terraces: each raised hex's level, and how a foothill slopes down to its lower sides. */
export interface Terrace {
  /** Level of every raised hex by key (absent is level ground). */
  levels: Map<string, number>
  level(cell: Cell): number
  /** The sides of a hex that drop below `height`. */
  lowerOf(cell: Cell, height: number): number[]
  /** The side a ramp tile slopes down to, when one can (1–3 lower sides in one run, none onto the sea). */
  rampOf(cell: Cell, lower: readonly number[]): number | undefined
}

/** The plan's levels, foothills that can't slope sinking to knolls (lands.ts' rule). */
export function terraceOf(plan: IslandPlan, isSea: (cell: Cell) => boolean): Terrace {
  const levels = new Map<string, number>()
  for (const [id, hex] of plan.land) {
    const raised = hex.level ?? LEVEL[hex.char]
    if (raised) levels.set(id, raised)
  }
  // Hill country steps down a terrace at a time: a plateau two up from level ground sinks to one.
  for (let changed = true; changed; ) {
    changed = false
    for (const [id, height] of levels) {
      if (height < 2 || !plan.land.get(id)?.level) continue
      const cell = id.split(",").map(Number) as unknown as Cell
      if ([0, 1, 2, 3, 4, 5].some((dir) => (levels.get(key(step(cell, dir))) ?? 0) < height - 1)) {
        levels.set(id, height - 1)
        changed = true
      }
    }
  }
  const level = (cell: Cell): number => levels.get(key(cell)) ?? 0
  const rampOf = (cell: Cell, lower: readonly number[]): number | undefined => {
    if (lower.length === 0 || lower.length > 3) return undefined
    if (lower.some((dir) => isSea(step(cell, dir)))) return undefined
    const run = contiguous(lower)
    return run ? run.start + Math.floor((run.length - 1) / 2) : undefined
  }
  const lowerOf = (cell: Cell, height: number): number[] =>
    [0, 1, 2, 3, 4, 5].filter((dir) => level(step(cell, dir)) < height)
  for (let changed = true; changed; ) {
    changed = false
    for (const [id, height] of levels) {
      if (plan.land.get(id)?.char !== "H") continue
      const cell = id.split(",").map(Number) as unknown as Cell
      const lower = lowerOf(cell, height)
      if (lower.length > 0 && rampOf(cell, lower) === undefined) {
        levels.delete(id)
        changed = true
      }
    }
  }
  return { levels, level, lowerOf, rampOf }
}
