/**
 * What the world's loading screen says (V1's boot card, packages/ui `Loader`): the steps in the order the
 * island is built (the worker's stages map, ground, pieces, shore, then townsfolk, then the light the
 * stage compiles and draws before the reveal), a line of flavour for each, and how long each is
 * expected to take, so the bar eases toward the step's end by itself (CSS) while the main thread is
 * busy and the real arrival snaps it forward.
 */

export const STEPS = ["Map", "Ground", "Pieces", "Water", "Townsfolk", "Light"] as const
export type Step = (typeof STEPS)[number]

/** V1's line under its name on the boot card. */
export const PITCH = "Events in. A living world out."

/** The line of flavour while a step runs. */
export const LINES: Record<Step, string> = {
  Map: "Charting the coast and the hills.",
  Ground: "Laying the land, one hex at a time.",
  Pieces: "Raising the halls, the mills and the walls.",
  Water: "Letting the rivers find the sea.",
  Townsfolk: "Waking the townsfolk.",
  Light: "Lighting the lanterns.",
}

/**
 * Expected ms of each step for an island of `files` files (a measured guess: the bar eases toward the
 * step's end over this long, and is only ever early, never wrong: an early arrival snaps it forward, a
 * late one leaves it waiting just short of the end).
 */
export function loadPlan(files: number): Record<Step, number> {
  const f = Math.max(0, files)
  return {
    Map: 500 + f * 0.05,
    Ground: 900 + f * 0.1,
    Pieces: 1500 + f * 0.5,
    Water: 300,
    Townsfolk: 900 + f * 0.15,
    Light: 800,
  }
}
