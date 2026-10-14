import type { Craft } from "@guildhall/core"
import type { HeroPose } from "@guildhall/world"

/**
 * How a hero works, by its call's craft and where it stands (the game-feel plan, task D): the rig clips
 * it plays, one after another, the props in its hands and the beats (a hammer's strike, a spell's cast)
 * a particle or a sound keys on. Never by its body: a knight reading holds a book like a mage does.
 *
 *   read           the open book, `Working_B`
 *   edit, write    `Hammering` with a hammer at an anvil, crates or a scaffold; elsewhere `Working_A`
 *                  with a pencil (a hero never hammers away from something to hammer at)
 *   search, fetch  the map and the magnifier, `Working_B`
 *   test, lint     a bow volley (draw, aim, release); at the camp's targets, now and then sparring
 *   run            `Use_Item` at the forge (an anvil), `Lockpicking` elsewhere, a file in hand
 *   plan           thinking: `Idle_B`, a few steps away and back
 *   consult        `Ranged_Magic_Spellcasting_Long` with the staff
 *   delegate       `Ranged_Magic_Summon` with the staff
 *
 * and the moments the planner choreographs (itineraries.ts): the Guildmaster pinning a quest at the
 * notice board and beckoning the recruit, the recruit's briefing, the loot carried home and set down,
 * a failure's blow and slump, a plea's wave, a cheer, standing up again, and rest (sitting two by two
 * at the gathering).
 *
 * A routine is sampled by `routineAt`, a pure function of the ms since it began: the same at every t
 * however it is reached (a scrub and a play agree).
 */

/** A cue on a routine's clock for particles and sound: the instant a hammer lands, a spell goes off… */
export type Beat = "hit" | "cast" | "shoot" | "pickup" | "pin" | "cheer" | "fall" | "page" | "scratch"

/**
 * What a hero is drawn doing at a time (the game-feel plan's shared life sample): the clip, how far
 * through it (0..1, wrapping), the props in its hands (catalog ids; `HERO_PROP_STANDIN` names the
 * mounted piece shown for one the library cannot mount yet), and a beat while one is due (set for
 * `BEAT_SPAN` of the clip after its cue: a reader fires on its rising edge).
 */
export interface LifeSample {
  clip: string
  phase: number
  props: string[]
  beat?: Beat
}

/** The rig clips heroes play, and their lengths in seconds (the shared KayKit rig, `rig-medium`). */
export const CLIP_SECONDS = {
  Cheering: 1.667,
  Hammering: 2.667,
  Hit_A: 0.667,
  Idle_A: 1.067,
  Idle_B: 2.133,
  Interact: 1.3,
  Lockpicking: 2.333,
  Melee_1H_Attack_Slice_Diagonal: 1,
  Melee_1H_Attack_Stab: 1.6,
  Melee_Block: 1.067,
  PickUp: 1.3,
  Ranged_Bow_Aiming_Idle: 1.833,
  Ranged_Bow_Draw: 1.333,
  Ranged_Bow_Release: 1.333,
  Ranged_Magic_Spellcasting_Long: 2.533,
  Ranged_Magic_Summon: 4.3,
  Sit_Floor_Down: 1,
  Sit_Floor_Idle: 4,
  Sit_Floor_StandUp: 1.133,
  Use_Item: 1.6,
  Walking_A: 1.067,
  Waving: 2.133,
  Working_A: 1.5,
  Working_B: 2.533,
} as const

export type HeroClip = keyof typeof CLIP_SECONDS

/** Every clip a hero's routines play (for a renderer to bake). */
export const HERO_CLIPS: readonly HeroClip[] = Object.keys(CLIP_SECONDS) as HeroClip[]

/** The props heroes hold, as catalog ids. */
export const HERO_PROPS = {
  book: "kaykit-adventurers/spellbook-open",
  pencil: "kaykit-tools/pencil-a-short",
  hammer: "kaykit-tools/hammer",
  map: "kaykit-tools/map",
  magnifier: "kaykit-tools/magnifying-glass",
  bow: "kaykit-adventurers/bow-with-string",
  file: "kaykit-tools/file",
  staff: "kaykit-adventurers/staff",
  scroll: "quaternius-props/scroll-1",
  chest: "kaykit-dungeon/chest",
  sword: "kaykit-adventurers/sword-1handed",
  shield: "kaykit-adventurers/shield-round",
} as const

/**
 * A prop the library has no hand mount for yet (the game-feel plan's task B mounts them), and the
 * nearest piece that has one, shown in its place meanwhile; "" for none (empty-handed).
 */
export const HERO_PROP_STANDIN: Readonly<Record<string, string>> = {
  [HERO_PROPS.pencil]: "kaykit-tools/chisel",
  [HERO_PROPS.map]: "kaykit-adventurers/spellbook-closed",
  [HERO_PROPS.magnifier]: "kaykit-tools/lantern",
  [HERO_PROPS.scroll]: "kaykit-adventurers/spellbook-closed",
  [HERO_PROPS.chest]: "kaykit-tools/bucket-metal",
}

/** One move of a routine: a clip for `ms` (one cycle when left out), and what goes with it. */
export interface Move {
  clip: HeroClip
  ms?: number
  /** A beat on each cycle of the clip, at this fraction of it. */
  beat?: [Beat, number]
  /** The props held during this move (the routine's when left out). */
  props?: readonly string[]
  /** Radians added to the spot's facing during this move. */
  turn?: number
  /** Metres walked along the move's facing over the move (a few steps while thinking). */
  step?: number
}

/** A routine: its moves in turn; then they repeat (`all`) or the last goes on (`last`). */
export interface Routine {
  moves: readonly Move[]
  loop: "all" | "last"
  props: readonly string[]
}

/** How long after its cue a beat stays set, as a fraction of its clip. */
export const BEAT_SPAN = 0.15

const P = HERO_PROPS
const one = (move: Move, props: readonly string[] = []): Routine => ({ moves: [move], loop: "all", props })

/** Where one hammers: an anvil, crates and barrels (a wright's), a scaffold. */
export const HAMMER_POSES: ReadonlySet<HeroPose> = new Set<HeroPose>(["anvil", "crates", "scaffold"])

const VOLLEY: Routine = {
  moves: [
    { clip: "Ranged_Bow_Draw" },
    { clip: "Ranged_Bow_Aiming_Idle" },
    { clip: "Ranged_Bow_Release", beat: ["shoot", 0.12] },
  ],
  loop: "all",
  props: [P.bow],
}
const SPARRING: Routine = {
  moves: [
    { clip: "Melee_1H_Attack_Slice_Diagonal", beat: ["hit", 0.45] },
    { clip: "Melee_Block" },
    { clip: "Melee_1H_Attack_Stab", beat: ["hit", 0.5] },
    { clip: "Melee_Block" },
  ],
  loop: "all",
  props: [P.sword, P.shield],
}
/** Thinking: stands a while, turns about and takes a few steps away, stands, comes back. */
const THINK: Routine = {
  moves: [
    { clip: "Idle_B" },
    { clip: "Walking_A", turn: Math.PI, step: 0.6 },
    { clip: "Idle_B", turn: Math.PI },
    { clip: "Walking_A", step: 0.6 },
  ],
  loop: "all",
  props: [],
}

/**
 * The routine for a call of `craft` at a spot of `pose` (none: a ring place, a briefing spot). `seed`
 * picks between a place's alternatives (at the camp's targets: a volley or sparring).
 */
export function craftRoutine(craft: Craft, pose: HeroPose | undefined, seed = 0): Routine {
  switch (craft) {
    case "read":
      return one({ clip: "Working_B", beat: ["page", 0.55] }, [P.book])
    case "edit":
    case "write":
      return pose && HAMMER_POSES.has(pose)
        ? one({ clip: "Hammering", beat: ["hit", 0.42] }, [P.hammer])
        : one({ clip: "Working_A", beat: ["scratch", 0.5] }, [P.pencil])
    case "search":
    case "fetch":
      return one({ clip: "Working_B" }, [P.map, P.magnifier])
    case "test":
    case "lint":
      return pose === "drill" && seed % 2 === 1 ? SPARRING : VOLLEY
    case "run":
      return pose === "anvil"
        ? one({ clip: "Use_Item", beat: ["hit", 0.5] }, [P.file])
        : one({ clip: "Lockpicking" }, [P.file])
    case "plan":
      return THINK
    case "consult":
      return one({ clip: "Ranged_Magic_Spellcasting_Long", beat: ["cast", 0.6] }, [P.staff])
    case "delegate":
      return one({ clip: "Ranged_Magic_Summon", beat: ["cast", 0.55] }, [P.staff])
    default:
      return one({ clip: "Idle_A" })
  }
}

/** ms a pin at the board takes (one `Interact`). */
export const PIN_MS = 1300
/** ms a recruit's briefing takes (a `PickUp` of the scroll, a little slower). */
export const BRIEF_MS = 1500
/** ms the loot is set down (`PickUp`), then cheered (`Cheering`). */
export const SETDOWN_MS = 1300
export const CHEER_MS = 2000
/** ms a failure's blow takes before the slump (`Hit_A`), and sitting down (`Sit_Floor_Down`). */
export const HIT_MS = 667
export const SIT_MS = 1000
/** ms standing up again (`Sit_Floor_StandUp`). */
export const STANDUP_MS = 1133

/** A moment the planner choreographs, or a call's craft, or thinking between calls. */
export type Play =
  | "craft"
  | "think"
  | "pin"
  | "beckon"
  | "brief"
  | "carry"
  | "deliver"
  | "plea"
  | "fail"
  | "slump"
  | "standup"
  | "cheer"
  | "rest"

const SIT: readonly Move[] = [{ clip: "Sit_Floor_Down", ms: SIT_MS }, { clip: "Sit_Floor_Idle" }]

const PLAYS: Readonly<Record<Exclude<Play, "craft" | "think">, Routine>> = {
  pin: {
    moves: [{ clip: "Interact", ms: PIN_MS, beat: ["pin", 0.55] }, { clip: "Idle_A" }],
    loop: "last",
    props: [P.scroll],
  },
  beckon: one({ clip: "Waving" }),
  brief: {
    moves: [
      { clip: "PickUp", ms: BRIEF_MS, beat: ["pickup", 0.5] },
      { clip: "Idle_A", props: [P.scroll] },
    ],
    loop: "last",
    props: [],
  },
  // walking home with the loot (the walk's own clip; only the props count)
  carry: one({ clip: "Walking_A" }, [P.chest]),
  deliver: {
    moves: [
      { clip: "PickUp", ms: SETDOWN_MS, beat: ["pickup", 0.55], props: [P.chest] },
      { clip: "Cheering", ms: CHEER_MS, beat: ["cheer", 0.25] },
      { clip: "Idle_A" },
    ],
    loop: "last",
    props: [],
  },
  plea: one({ clip: "Waving" }),
  fail: { moves: [{ clip: "Hit_A", ms: HIT_MS, beat: ["fall", 0.1] }, ...SIT], loop: "last", props: [] },
  slump: { moves: SIT, loop: "last", props: [] },
  standup: {
    moves: [{ clip: "Sit_Floor_StandUp", ms: STANDUP_MS }, { clip: "Idle_A" }],
    loop: "last",
    props: [],
  },
  cheer: {
    moves: [{ clip: "Cheering", ms: CHEER_MS, beat: ["cheer", 0.25] }, { clip: "Idle_A" }],
    loop: "last",
    props: [],
  },
  rest: { moves: SIT, loop: "last", props: [] },
}

/** The routine a play runs at a spot of `pose` (a craft's by `craftRoutine`). */
export function playRoutine(
  play: Play,
  craft: Craft | undefined,
  pose: HeroPose | undefined,
  seed = 0,
): Routine {
  if (play === "craft") return craftRoutine(craft ?? "other", pose, seed)
  if (play === "think") return THINK
  return PLAYS[play]
}

const moveMs = (m: Move) => m.ms ?? CLIP_SECONDS[m.clip] * 1000

/** A routine's length, ms (one round of its moves). */
export function routineMs(r: Routine): number {
  let ms = 0
  for (const m of r.moves) ms += moveMs(m)
  return ms
}

/** A routine at `ms` since it began: the sample, and how far it has turned and stepped from its spot. */
export interface RoutineAt extends LifeSample {
  /** Radians added to the spot's facing. */
  turn: number
  /** Metres along the spot's facing (turned by the step's move) it has stepped off its spot. */
  dx: number
  dz: number
}

/** A routine sampled at `ms` since it began (clamped at 0): pure. */
export function routineAt(r: Routine, ms: number, facing = 0): RoutineAt {
  const total = routineMs(r)
  let e = Math.max(0, ms)
  if (r.loop === "all" && total > 0) e %= total
  let dx = 0
  let dz = 0
  for (const [k, m] of r.moves.entries()) {
    const len = moveMs(m)
    const last = k === r.moves.length - 1
    if (e >= len && !last) {
      if (m.step) {
        dx += Math.sin(facing + (m.turn ?? 0)) * m.step
        dz += Math.cos(facing + (m.turn ?? 0)) * m.step
      }
      e -= len
      continue
    }
    // in this move (the last runs on when the routine holds it)
    const cycle = CLIP_SECONDS[m.clip] * 1000
    const into = Math.min(e, len)
    const phase = cycle > 0 ? (e / cycle) % 1 : 0
    if (m.step) {
      const f = len > 0 ? into / len : 1
      dx += Math.sin(facing + (m.turn ?? 0)) * m.step * f
      dz += Math.cos(facing + (m.turn ?? 0)) * m.step * f
    }
    const out: RoutineAt = {
      clip: m.clip,
      phase,
      props: [...(m.props ?? r.props)],
      turn: m.turn ?? 0,
      dx,
      dz,
    }
    if (m.beat && phase >= m.beat[1] && phase < m.beat[1] + BEAT_SPAN) out.beat = m.beat[0]
    return out
  }
  return { clip: "Idle_A", phase: 0, props: [], turn: 0, dx: 0, dz: 0 }
}
