/**
 * Drills (decisions.md "training arena"): routines of rig clips played on one clock, so people training
 * together move together. A spot names one (`TileSpot.drill`); whoever stands there plays it.
 *
 *   duel    two sides that interlock: one attacks while the other blocks, takes the hit or dodges, then
 *           they swap. Each side's move starts so its contact frame meets the other's (the times below
 *           are read off rig-medium: a chop lands 0.57 s in, a shield's recoil starts 0.07 s into
 *           Melee_Block_Hit). The sides are generic: a soldier, a hero or later a skeleton raider (same
 *           rig) takes either, so a raid can reuse the loop as it stands.
 *   dummy   one side: a round of cuts and a thrust at a training dummy (also what a duellist does alone
 *           while their partner is away: shadow work).
 *   drill   one side, everyone on the tile on the same clock: a line cutting in step.
 *   cheer   spectators at the rail, cheering now and then.
 *
 * A routine is a loop of `period` seconds; each side is a list of moves, a clip played once from `at`;
 * between moves the side holds `rest` (looped). A move runs to its clip's end unless the side's next
 * move starts first; the crowd cross-fades every change.
 */

/** Rig-medium clip lengths (seconds) of the clips drills play (library/catalog/index.json). */
export const CLIP_SECONDS: Readonly<Record<string, number>> = {
  Cheering: 1.667,
  Dodge_Backward: 0.4,
  Hit_A: 0.667,
  Hit_B: 0.867,
  Idle_A: 1.067,
  Melee_1H_Attack_Chop: 1.067,
  Melee_1H_Attack_Slice_Diagonal: 1,
  Melee_1H_Attack_Slice_Horizontal: 1.367,
  Melee_1H_Attack_Stab: 1.6,
  Melee_Block: 1.067,
  Melee_Block_Attack: 1.067,
  Melee_Block_Hit: 1.067,
  Melee_Blocking: 1.067,
}

/** A clip played once, from `at` seconds into its routine's loop. */
export interface DrillMove {
  at: number
  clip: string
}

export interface Drill {
  /** Seconds one loop lasts. */
  period: number
  /** What a side holds between moves (looped): a guard stance, or standing about. */
  rest: string
  /** Each side's moves, in time order (one side: everyone plays the same). */
  sides: readonly (readonly DrillMove[])[]
  /** A two-sided routine's stand-in when one side is alone (its partner away). */
  solo?: string
  /**
   * How the clock is shared: `pair` (a duel's two sides, one offset per pair), `tile` (everyone on the
   * tile in step: a drill line) or `spot` (each on its own, so a row does not move as one).
   */
  sync: "pair" | "tile" | "spot"
}

const CHOP = "Melee_1H_Attack_Chop"
const DIAGONAL = "Melee_1H_Attack_Slice_Diagonal"
const HORIZONTAL = "Melee_1H_Attack_Slice_Horizontal"
const STAB = "Melee_1H_Attack_Stab"
const GUARD = "Melee_Blocking"
const PARRY = "Melee_Block_Hit"

export const DRILLS: Readonly<Record<string, Drill>> = {
  // contact frames: chop 0.57 s, diagonal 0.42, horizontal 0.27, stab 0.45, shield bash 0.47; a parry
  // recoils 0.07 s in, a hit 0.05, a dodge is clear by 0.2
  duel: {
    period: 9.2,
    rest: GUARD,
    sync: "pair",
    solo: "dummy",
    sides: [
      [
        { at: 0, clip: CHOP },
        { at: 1.66, clip: PARRY },
        { at: 2.5, clip: STAB },
        { at: 4.77, clip: "Hit_A" },
        { at: 5.6, clip: "Melee_Block_Attack" },
        { at: 7.21, clip: PARRY },
      ],
      [
        { at: 0.51, clip: PARRY },
        { at: 1.3, clip: DIAGONAL },
        { at: 2.72, clip: "Dodge_Backward" },
        { at: 4.25, clip: CHOP },
        { at: 6.02, clip: "Hit_B" },
        { at: 7, clip: HORIZONTAL },
      ],
    ],
  },
  dummy: {
    period: 6.4,
    rest: GUARD,
    sync: "spot",
    sides: [
      [
        { at: 0, clip: DIAGONAL },
        { at: 1.25, clip: CHOP },
        { at: 2.6, clip: HORIZONTAL },
        { at: 4.2, clip: STAB },
      ],
    ],
  },
  drill: {
    period: 6.3,
    rest: GUARD,
    sync: "tile",
    sides: [
      [
        { at: 0, clip: CHOP },
        { at: 1.4, clip: "Melee_Block" },
        { at: 2.7, clip: STAB },
        { at: 4.5, clip: HORIZONTAL },
      ],
    ],
  },
  cheer: {
    period: 5.5,
    rest: "Idle_A",
    sync: "spot",
    sides: [
      [
        { at: 0, clip: "Cheering" },
        { at: 1.667, clip: "Cheering" },
      ],
    ],
  },
}

/** Whether a routine has two sides that must face each other (a duel). */
export const pairedDrill = (id: string): boolean => (DRILLS[id]?.sides.length ?? 0) === 2

/** Every clip a routine plays (its solo's too), for the crowd to bake. */
export function drillClips(id: string): string[] {
  const d = DRILLS[id]
  if (!d) return []
  const out = new Set([d.rest, ...d.sides.flat().map((m) => m.clip)])
  if (d.solo) for (const c of drillClips(d.solo)) out.add(c)
  return [...out].sort()
}

/**
 * What side `side` of routine `id` plays at `t` seconds on its clock: the clip and how far into it
 * (0–1; a move is held on its last frame rather than wrapped). An unknown routine rests on Idle_A.
 */
export function drillFrame(id: string, side: number, t: number): { clip: string; phase: number } {
  const d = DRILLS[id]
  if (!d) return { clip: "Idle_A", phase: frac(t / CLIP_SECONDS.Idle_A!) }
  const moves = d.sides[side % d.sides.length]!
  const u = ((t % d.period) + d.period) % d.period
  // the move started last (one late in the loop may run on past its wrap)
  let start = Number.NEGATIVE_INFINITY
  let clip = ""
  for (const m of moves) {
    const s = m.at <= u ? m.at : m.at - d.period
    if (s > start) {
      start = s
      clip = m.clip
    }
  }
  const len = CLIP_SECONDS[clip] ?? 1
  if (clip && u - start < len) return { clip, phase: Math.min(0.999, (u - start) / len) }
  return { clip: d.rest, phase: frac(t / (CLIP_SECONDS[d.rest] ?? 1)) }
}

const frac = (x: number) => x - Math.floor(x)
