import type { PieceState } from "./growthPieces.ts"

/**
 * Growth film v2's construction stages (ADR 0021, world-gen v2 §4 (d)), pure: what a building looks
 * like `age` film seconds after it was begun. The same instance rises through the stages (a vertical
 * scale reveal, a scar on the ground, a scaffold and a stack of planks beside it): no extra pieces,
 * no extra draw calls.
 *
 *   house, hall   plot (a dark flat scar) → frame (scaffold up, a third) → walls → roof (it settles)
 *   keep          the same in thirds, slower; its scaffold stays up longest
 *   wall          rubble → wall rises
 *   mine          a hall that is also cut into the flank (it grows out of the rock)
 *   flag, prop    pop once the thing they stand by is done
 *   tree          spreads: grows slowly, a lag after its land (growthBuild.ts)
 */

export type Kind = "house" | "hall" | "mine" | "keep" | "tower" | "wall" | "gate" | "flag" | "prop" | "tree"

export interface Stage extends PieceState {
  /** 0–1: how much of the ground-scar tint the piece wears (a plot, rubble). */
  scar: number
  /** 0–1: the stack of planks beside a building going up. */
  planks: number
}

export const emptyStage = (): Stage => ({
  visible: false,
  rise: 0,
  scale: 1,
  scaleY: 1,
  scaffold: 0,
  scar: 0,
  planks: 0,
})

/** Film seconds each kind takes from its first sign to done. */
export const SPAN: Readonly<Record<Kind, number>> = {
  house: 2.8,
  hall: 3.6,
  mine: 3.4,
  keep: 4.2,
  tower: 2.6,
  wall: 1.3,
  gate: 2.2,
  flag: 0.3,
  prop: 0.25,
  tree: 1.6,
}

/** Kinds that go up behind a scaffold. */
export const SCAFFOLDED: ReadonlySet<Kind> = new Set(["house", "hall", "mine", "keep", "tower", "gate"])

const smooth = (a: number, b: number, v: number): number => {
  const p = Math.min(1, Math.max(0, (v - a) / (b - a)))
  return p * p * (3 - 2 * p)
}
/** 0 → 1 over `span` with a small overshoot. */
const pop = (v: number, span: number): number => {
  const p = Math.min(1, Math.max(0, v / span))
  return p >= 1 ? 1 : 1 + 2.7 * (p - 1) ** 3 + 1.7 * (p - 1) ** 2
}

/** Heights a building has by the end of plot, frame, walls and roof (a keep rises in thirds). */
const HEIGHTS: Partial<Record<Kind, readonly number[]>> = { keep: [0.04, 0.33, 0.66, 1] }
const STORIES = [0.04, 0.4, 0.8, 1]
/** Where, as a share of the span, each stage ends. */
const ENDS = [0.16, 0.42, 0.68, 0.9] as const

/** The stage a `kind` is in `age` seconds after it began, written into `out` (rise left as it was). */
export function stageAt(kind: Kind, age: number, out: Stage): Stage {
  out.scale = 1
  out.scaleY = 1
  out.scaffold = 0
  out.scar = 0
  out.planks = 0
  out.visible = age > 0
  if (!out.visible) return out
  const span = SPAN[kind]
  const u = age / span
  switch (kind) {
    case "tree":
      out.scale = smooth(0, 1, u)
      out.visible = out.scale > 0.01
      return out
    case "flag":
    case "prop":
      out.scale = pop(age, span)
      out.visible = out.scale > 0.01
      return out
    case "wall":
      // Rubble first, then the wall rises out of it.
      out.scar = 1 - smooth(0.3, 0.7, u)
      out.scaleY = 0.1 + 0.9 * smooth(0.3, 1, u)
      return out
    default:
  }
  const heights = HEIGHTS[kind] ?? STORIES
  let height = heights[0] as number
  for (let i = 1; i < heights.length; i++)
    height +=
      ((heights[i] as number) - (heights[i - 1] as number)) *
      smooth(ENDS[i - 1] as number, ENDS[i] as number, u)
  // The roof's settle: a small overshoot as it tops out.
  out.scaleY = height * (u > ENDS[3] ? 1 + 0.05 * Math.sin(Math.min(1, (u - ENDS[3]) / 0.1) * Math.PI) : 1)
  out.scar = 1 - smooth(ENDS[0] as number, ENDS[1] as number, u)
  out.planks = Math.min(pop(age - 0.05, 0.25), 1 - smooth(0.7, 0.9, u))
  out.scaffold = Math.min(pop(u * span - ENDS[0] * span * 0.7, 0.3), 1 - smooth(0.88, 1, u))
  // A mine is cut into the flank: it also swells out of the rock.
  if (kind === "mine") out.scale = 0.55 + 0.45 * smooth(0.25, 0.75, u)
  return out
}
