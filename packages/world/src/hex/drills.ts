/**
 * Drills (decisions.md "training arena"): routines of rig clips played on one clock, so people training
 * together move together. A spot names one (`TileSpot.drill`); whoever stands there plays it.
 *
 *   duel    a bout between two sides that reads as a fight: they step in, trade blows that interlock
 *           (one attacks while the other parries, takes the hit or dodges; each move starts so its
 *           contact frame meets the other's: the times are read off rig-medium, a chop lands 0.57 s in,
 *           a shield's recoil starts 0.07 s into Melee_Block_Hit), a decisive blow, the winner cheers
 *           while the loser shakes it off, they step back and start again. Who wins is drawn per bout.
 *           The sides are generic: a soldier, a hero or later a skeleton raider (same rig) takes either.
 *   wait    a duellist whose partner is away: guard up now and then, a look round, a wave to call them
 *           over. Never a swing at nothing.
 *   dummy   one side: a round of cuts and a thrust at a training dummy (a shield on a bale).
 *   drill   one side, everyone on the tile on the same clock: a line cutting in step.
 *   lead    the drill line's leader facing it: calls each cut a beat before it comes.
 *   cheer   spectators at the rail, on the duels' clock: cheering each hit that lands, in either bout.
 *
 * A routine is a loop of `period` seconds; each side is a list of moves, a clip played once from `at`;
 * between moves the side holds `rest` (looped). A move runs to its clip's end unless the side's next
 * move starts first; the crowd cross-fades every change. `steps` stand both sides a little forward of
 * their spots (stepping in to fight, out after), eased over STEP_S.
 */

/** Rig-medium clip lengths (seconds) of the clips drills play (library/catalog/index.json). */
export const CLIP_SECONDS: Readonly<Record<string, number>> = {
  Cheering: 1.667,
  Dodge_Backward: 0.4,
  Hit_A: 0.667,
  Hit_B: 0.867,
  Idle_A: 1.067,
  Idle_B: 2.133,
  Melee_1H_Attack_Chop: 1.067,
  Melee_1H_Attack_Slice_Diagonal: 1,
  Melee_1H_Attack_Slice_Horizontal: 1.367,
  Melee_1H_Attack_Stab: 1.6,
  Melee_Block: 1.067,
  Melee_Block_Attack: 1.067,
  Melee_Block_Hit: 1.067,
  Melee_Blocking: 1.067,
  Waving: 2.133,
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
  /**
   * A bout's end, drawn per loop: the winner's moves and the loser's (added to their side's), the
   * winner side 0 or 1 by the loop's index (`boutWinner`).
   */
  finale?: { win: readonly DrillMove[]; lose: readonly DrillMove[] }
  /** Metres forward of the spot both sides stand from each time on (eased): stepping in and out. */
  steps?: readonly (readonly [number, number])[]
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
const BASH = "Melee_Block_Attack"
const GUARD = "Melee_Blocking"
const PARRY = "Melee_Block_Hit"

/** Seconds a duel's bout lasts (both bouts on a tile share it, half a bout apart: `pairShare`). */
export const BOUT_S = 19
/**
 * Metres between a face-to-face pair's centres at rest (a duel's two spots, a hero's sparring spot and
 * anyone near it): two bodies, a shield and a sword's reach between them, so a blow lands on the shield
 * and the helmets never touch. Shared by every source that squares two fighters up (data/tiles pairs,
 * heroes.ts).
 */
export const DUEL_APART = 1.6
/** Metres between them at the nearest, stepped in for the bout's blows (each steps half the difference). */
export const DUEL_CLOSEST = 1.5
/** Metres each side steps in for the bout. */
const DUEL_STEP = (DUEL_APART - DUEL_CLOSEST) / 2
/** Seconds a step in or out takes. */
export const STEP_S = 0.5
/**
 * When a blow lands in a duel's bout (seconds into it): the hits the spectators cheer (the decisive one
 * last). A tile's second bout runs half a bout later.
 */
export const DUEL_HITS: readonly number[] = [6.17, 10.97, 12.85]

export const DRILLS: Readonly<Record<string, Drill>> = {
  // contact frames: chop 0.57 s, diagonal 0.42, horizontal 0.27, stab 0.45, shield bash 0.47; a parry
  // recoils 0.07 s in, a hit 0.05, a dodge is clear by 0.2
  duel: {
    period: BOUT_S,
    rest: GUARD,
    sync: "pair",
    solo: "wait",
    steps: [
      [0.1, DUEL_STEP],
      [16.6, 0],
    ],
    sides: [
      [
        { at: 0.6, clip: CHOP },
        { at: 2.75, clip: PARRY },
        { at: 4, clip: STAB },
        { at: 6.12, clip: "Hit_A" },
        { at: 7.4, clip: BASH },
        { at: 9.1, clip: PARRY },
        { at: 10.4, clip: CHOP },
      ],
      [
        { at: 1.1, clip: PARRY },
        { at: 2.4, clip: DIAGONAL },
        { at: 4.25, clip: "Dodge_Backward" },
        { at: 5.6, clip: CHOP },
        { at: 7.8, clip: PARRY },
        { at: 8.9, clip: HORIZONTAL },
        { at: 10.92, clip: "Hit_B" },
      ],
    ],
    finale: {
      // the decisive thrust lands at 12.85; the winner cheers, the loser takes it and shakes it off
      win: [
        { at: 12.4, clip: STAB },
        { at: 14, clip: "Cheering" },
        { at: 15.67, clip: "Cheering" },
      ],
      lose: [
        { at: 12.8, clip: "Hit_B" },
        { at: 14.1, clip: "Idle_B" },
      ],
    },
  },
  // a duellist alone: guard up, a look round, a wave to call the partner over
  wait: {
    period: 14,
    rest: "Idle_A",
    sync: "spot",
    sides: [
      [
        { at: 2, clip: "Melee_Block" },
        { at: 5.5, clip: "Idle_B" },
        { at: 10, clip: "Waving" },
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
  // the line's leader, on the line's clock: a call (a raised hand) a beat before each cut
  lead: {
    period: 6.3,
    rest: "Idle_A",
    sync: "tile",
    sides: [
      [
        { at: 5.7, clip: "Waving" },
        { at: 2.2, clip: "Melee_Block" },
      ],
    ],
  },
  // on the duels' clock (sync tile, the same period): a cheer as each hit lands, in both bouts
  cheer: {
    period: BOUT_S,
    rest: "Idle_A",
    sync: "tile",
    sides: [
      [...DUEL_HITS, ...DUEL_HITS.map((t) => t + BOUT_S / 2)]
        .map((t) => (t + 0.15) % BOUT_S)
        .sort((a, b) => a - b)
        .map((at) => ({ at, clip: "Cheering" })),
    ],
  },
}

/** Whether a routine has two sides that must face each other (a duel). */
export const pairedDrill = (id: string): boolean => (DRILLS[id]?.sides.length ?? 0) === 2

/** Every clip a routine plays (its finale's and its solo's too), for the crowd to bake. */
export function drillClips(id: string): string[] {
  const d = DRILLS[id]
  if (!d) return []
  const moves = [...d.sides.flat(), ...(d.finale?.win ?? []), ...(d.finale?.lose ?? [])]
  const out = new Set([d.rest, ...moves.map((m) => m.clip)])
  if (d.solo) for (const c of drillClips(d.solo)) out.add(c)
  return [...out].sort()
}

/** Which side wins bout `n` of a duel (its loop's index on its clock): drawn, so it varies. */
export function boutWinner(n: number): number {
  let h = Math.imul(n | 0, 0x27d4eb2d) ^ 0x165667b1
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) % 2
}

/** A drill frame: the clip, how far into it (0–1), and how far forward of its spot the side stands (m). */
export interface DrillFrame {
  clip: string
  phase: number
  step: number
}

/**
 * What side `side` of routine `id` plays at `t` seconds on its clock: the clip and how far into it
 * (0–1; a move is held on its last frame rather than wrapped), and its step forward. An unknown routine
 * rests on Idle_A.
 */
export function drillFrame(id: string, side: number, t: number): DrillFrame {
  const d = DRILLS[id]
  if (!d) return { clip: "Idle_A", phase: frac(t / CLIP_SECONDS.Idle_A!), step: 0 }
  const s = side % d.sides.length
  const n = Math.floor(t / d.period)
  const u = t - n * d.period
  // this loop's moves (a duel's finale by who wins it), and the last loop's (one late in it may run on)
  const movesOf = (bout: number): readonly DrillMove[] =>
    d.finale ? [...d.sides[s]!, ...(boutWinner(bout) === s ? d.finale.win : d.finale.lose)] : d.sides[s]!
  let start = Number.NEGATIVE_INFINITY
  let clip = ""
  for (const m of movesOf(n))
    if (m.at <= u && m.at > start) {
      start = m.at
      clip = m.clip
    }
  if (!clip)
    for (const m of movesOf(n - 1))
      if (m.at - d.period > start) {
        start = m.at - d.period
        clip = m.clip
      }
  const step = stepAt(d, u)
  const len = CLIP_SECONDS[clip] ?? 1
  if (clip && u - start < len) return { clip, phase: Math.min(0.999, (u - start) / len), step }
  return { clip: d.rest, phase: frac(t / (CLIP_SECONDS[d.rest] ?? 1)), step }
}

/** How far forward a drill's sides stand at `u` seconds into its loop (eased between its steps). */
function stepAt(d: Drill, u: number): number {
  const steps = d.steps
  if (!steps?.length) return 0
  let from = steps[steps.length - 1]![1]
  for (const [at, to] of steps) {
    if (u < at) break
    const f = Math.min(1, (u - at) / STEP_S)
    const e = f * f * (3 - 2 * f)
    from = from + (to - from) * e
  }
  return from
}

const frac = (x: number) => x - Math.floor(x)
