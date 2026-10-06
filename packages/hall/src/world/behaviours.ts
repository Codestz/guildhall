import { PILES, targets } from "../scene/life/places.ts"
import { SITES, type SiteId } from "./lands.ts"
import { type Post, type Spot, STATIONS, type StationId } from "./layout.ts"
import { route } from "./paths.ts"

/**
 * Activities (ADR 0009): what an adventurer does at their place while their session is busy.
 *
 * Agents spend most of a quest thinking between short tool calls, so a work clip that only plays
 * during a call leaves the island standing idle. Instead every site and station has a **behaviour**:
 * a small loop of steps (chop, pick up the log, carry it to the pile, put it down, walk back) that
 * runs the whole time the session is working. Thinking slips natural pauses into it (look at the
 * work, wipe a brow); a tool call steers it (a test run at the forge → quench and inspect).
 *
 * The loop is *working*, not *results*: nothing it does touches the traces. Piles, the yard's
 * building and the arrows in the targets still grow only from completed deeds (scene/life/traces).
 *
 * Pure data and a pure state machine (`Routine`), no three.js: the scene (scene/activity.ts,
 * scene/Adventurer.tsx) walks the body, plays the clip, shows what is held and fires the beats.
 */

/** Things carried in the hands for a moment (drawn by scene/life/shapes.ts). */
export type Held = "log" | "stone" | "fish" | "book" | "plank" | "note"
/** A tool the trade holds the whole time it works (not in kit.glb: drawn like the held things). */
export type Tool = "rod" | "bow"
/** A visible beat of work: an axe bite, a stone chip, a spark, a puff of steam… (scene/life/WorkFx). */
export type Beat =
  | "chop"
  | "chip"
  | "spark"
  | "steam"
  | "splash"
  | "arrow"
  | "page"
  | "pin"
  | "magic"
  | "dust"
  | "sawdust"

/** A duration: fixed, or a seeded pick in [min, max] each time the step runs. */
export type Seconds = number | readonly [min: number, max: number]

export interface BeatSpec {
  kind: Beat
  /** Where it happens: a spot name, or "self" (the worker's hands). Default "work". */
  at?: string
  /** Seconds between beats (a clip's strike rhythm); absent: once. */
  every?: number
  /** Seconds into the step of the first beat. Default: half of `every`, or half the step. */
  first?: number
}

/** Walk to a named spot. Hands full: they carry it (Holding_A arms over walking legs). */
export interface WalkStep {
  walk: string
}

/** Play a clip there. */
export interface PlayStep {
  clip: string
  s: Seconds
  /** Turn towards this spot. None: the post's own facing at the post, else as they stand. */
  face?: string
  /** Pick this up halfway through. */
  take?: Held
  /** Put down what is held halfway through. */
  drop?: true
  beat?: BeatSpec
  /** A wait a tool call may cut short (the float bobbing, a pause). */
  soft?: true
}

export type Step = WalkStep | PlayStep

/** A tool call that changes what happens next. `tools: true` matches every tool. */
export interface Steer {
  tools: ReadonlySet<string> | true
  steps: readonly Step[]
}

/** Named places for one worker: standing spots (walk targets) and things to face or work on. */
export type Spots = Readonly<Record<string, Spot>>

export interface Behaviour {
  /**
   * The places the loop uses for the `berth`-th worker here (0-based, by post): each worker has
   * their own standing spots, so neighbours never queue for one. `post` is always added: the post.
   */
  spots(post: Post, berth: number): Spots
  /** Spots that are only faced or worked on (rocks, trees, the anvil), never stood on. */
  marks: ReadonlySet<string>
  loop: readonly Step[]
  /** Thinking: one of these slips in between loop steps, now and then (seeded). */
  pauses: readonly (readonly Step[])[]
  /** Tool calls: the first rule matching a new call runs its steps next, then the loop resumes. */
  steer?: readonly Steer[]
  /** Held the whole time it works (put away while the hands carry something else). */
  tool?: Tool
}

// ---- Spot geometry --------------------------------------------------------------------------

const r2 = (value: number): number => Math.round(value * 100) / 100

/** A point `distance` ahead of a post along its facing, `side` to its right. */
export function ahead(post: Post, distance: number, side = 0): Spot {
  const [x, z, facing] = post
  const fx = Math.sin(facing)
  const fz = Math.cos(facing)
  return [r2(x + fx * distance - fz * side), r2(z + fz * distance + fx * side)]
}

/** A point `distance` from `to`, on the side of `from`. */
export function near(to: Spot, from: Spot, distance: number): Spot {
  const length = Math.hypot(from[0] - to[0], from[1] - to[1]) || 1
  return [
    r2(to[0] + ((from[0] - to[0]) / length) * distance),
    r2(to[1] + ((from[1] - to[1]) / length) * distance),
  ]
}

/** The heading (radians, 0 = +z) from one spot towards another. */
export function headingTo(from: Spot, to: Spot): number {
  return Math.atan2(to[0] - from[0], to[1] - from[1])
}

const spot = (pile: { x: number; z: number }): Spot => [pile.x, pile.z]

/** A pick-up off the ground (PickUp, the item in hand halfway through). */
const pick = (item: Held, face: string): PlayStep => ({ clip: "PickUp", s: 1.3, face, take: item })
/** A put-down (PickUp played the other way round: the item leaves the hands halfway). */
const put = (face: string, beat?: BeatSpec): PlayStep => ({
  clip: "PickUp",
  s: 1.3,
  face,
  drop: true,
  ...(beat ? { beat } : {}),
})
const set = (...tools: string[]): ReadonlySet<string> => new Set(tools)
const marks = (...names: string[]): ReadonlySet<string> => new Set(names)

/** Island pauses: stop, look at the work, wipe a brow. */
const OUTDOOR_PAUSES: readonly (readonly Step[])[] = [
  [{ clip: "Idle_B", s: [2, 2.6], face: "work", soft: true }],
  [
    { clip: "Idle_A", s: [1.4, 2.4], face: "work", soft: true },
    { clip: "Idle_B", s: 2.1, soft: true },
  ],
]

// ---- The island's job sites -----------------------------------------------------------------

/**
 * The forest's work trees: one character-scale tree per post, felled over and over (it shakes on
 * every bite; scene/life/WorkFx draws them). Just ahead of each post, a little to one side of the
 * stumps the map already has.
 */
export const WORK_TREES: readonly Spot[] = SITES.forest.posts.map((post, n) =>
  ahead(post, 1.55, n === 0 ? 0.9 : n === 1 ? -0.7 : 0.6),
)

/** The proving grounds' targets, nearest-first to each post (from the map, like the trace piles). */
const BOARDS = targets()
const boardOf = (post: Post): Spot => {
  let best: Spot = [post[0], post[1]]
  let distance = Number.POSITIVE_INFINITY
  for (const board of BOARDS) {
    const d = Math.hypot(board.x - post[0], board.z - post[1])
    if (d < distance) {
      distance = d
      best = [board.x, board.z]
    }
  }
  return best
}

/** How far back from its target each archer shoots: staggered, so the lines never meet. */
const LINE: readonly number[] = [7.4, 6, 5]
/** Where the logs are dropped by the mill's pile, one spot per berth on its open (south-east) side. */
const LOG_DROPS: readonly Spot[] = [
  [-46.36, 21.66],
  [-47.21, 19.54],
  [-45.33, 20.63],
]
/**
 * The way to the log pile from the road: berth 0 goes round the east side of the road torch at
 * (-45.1, 18.1); the others walk straight in (their lane is the drop itself).
 */
const LOG_LANES: readonly (Spot | undefined)[] = [[-43.9, 18.6]]
/** Where quarry stone goes: the wheelbarrow for the west face, the heap for the others. */
const STONE_DROPS: readonly { stand: Spot; at: Spot }[] = [
  { stand: [21.2, -43.4], at: [23, -42.5] },
  { stand: [29.9, -43.5], at: spot(PILES.stones) },
  { stand: [28.3, -40.6], at: spot(PILES.stones) },
]
/** The catch goes into the water bucket on the bank, or onto the fish rack. */
const BUCKET: Spot = [-28.5, 48]
const FISH_DROPS: readonly { stand: Spot; at: Spot }[] = [
  { stand: [-24.4, 40.5], at: spot(PILES.fish) },
  { stand: [-28.5, 49.3], at: BUCKET },
  { stand: [-29.6, 48.6], at: BUCKET },
]
/** The yard's timber: the pallet for the west posts, the wheelbarrow for the east ones. */
/** Berth 0 goes round the west end of the ladder at (45, 11); the others' lane is their post. */
const YARD_LANES: readonly (Spot | undefined)[] = [[43.7, 11.3]]
const PALLET: Spot = [45.5, 6]
const BARROW: Spot = [59, 14.5]
const YARD_BENCHES: readonly { stand: Spot; at: Spot }[] = [
  { stand: [44, 8.9], at: PALLET },
  { stand: [57.3, 15.6], at: BARROW },
  { stand: [43.5, 6.2], at: PALLET },
  { stand: [59.3, 16.9], at: BARROW },
]
const TOWER: Spot = [SITES.tower.at[0], SITES.tower.at[1]]
const BOOK_STACKS: readonly Spot[] = [
  [-37.6, -42.4],
  [-37.4, -38.5],
]

export const SITE_WORK: Record<SiteId, Behaviour> = {
  forest: {
    spots: (_post, n) => {
      const pile = LOG_DROPS[n % LOG_DROPS.length] ?? [0, 0]
      return {
        work: WORK_TREES[n % WORK_TREES.length] ?? [0, 0],
        lane: LOG_LANES[n % LOG_DROPS.length] ?? pile,
        pile,
        stack: spot(PILES.logs),
      }
    },
    marks: marks("work", "stack"),
    loop: [
      { clip: "Chopping", s: [6.7, 10.6], face: "work", beat: { kind: "chop", every: 1.33, first: 0.55 } },
      pick("log", "work"),
      { walk: "lane" },
      { walk: "pile" },
      put("stack", { kind: "dust", at: "stack", first: 0.7 }),
      { walk: "lane" },
      { walk: "post" },
      { clip: "Idle_A", s: [0.5, 1.1], face: "work" },
    ],
    pauses: OUTDOOR_PAUSES,
    steer: [
      {
        tools: set("grep", "glob", "list"),
        steps: [
          { walk: "post" },
          { clip: "Chopping", s: 4, face: "work", beat: { kind: "chop", every: 1.33, first: 0.55 } },
        ],
      },
      { tools: set("read"), steps: [{ walk: "post" }, { clip: "Working_A", s: 3, face: "work" }] },
    ],
  },
  quarry: {
    spots: (post, n) => {
      const drop = STONE_DROPS[n % STONE_DROPS.length] ?? STONE_DROPS[0]
      return { work: ahead(post, 1.7), drop: drop?.stand ?? [0, 0], heap: drop?.at ?? [0, 0] }
    },
    marks: marks("work", "heap"),
    loop: [
      { clip: "Pickaxing", s: [7.4, 11.2], face: "work", beat: { kind: "chip", every: 1.865, first: 1.3 } },
      pick("stone", "work"),
      { walk: "drop" },
      put("heap", { kind: "dust", at: "heap", first: 0.7 }),
      { walk: "post" },
    ],
    pauses: OUTDOOR_PAUSES,
    steer: [
      {
        tools: true,
        steps: [
          { walk: "post" },
          { clip: "Pickaxing", s: 3.73, face: "work", beat: { kind: "chip", every: 1.865, first: 1.3 } },
        ],
      },
    ],
  },
  river: {
    spots: (post, n) => {
      const drop = FISH_DROPS[n % FISH_DROPS.length] ?? FISH_DROPS[0]
      return { work: ahead(post, 3.4), basket: drop?.stand ?? [0, 0], bin: drop?.at ?? [0, 0] }
    },
    marks: marks("work", "bin"),
    tool: "rod",
    loop: [
      { clip: "Fishing_Cast", s: 1.93, face: "work", beat: { kind: "splash", first: 1.35 } },
      { clip: "Fishing_Idle", s: [3, 6.5], face: "work", soft: true },
      { clip: "Fishing_Reeling", s: [1.6, 3.2], face: "work", beat: { kind: "splash", every: 0.8 } },
      { clip: "Fishing_Catch", s: 3.23, face: "work", take: "fish", beat: { kind: "splash", first: 0.9 } },
      { walk: "basket" },
      put("bin", { kind: "splash", at: "bin", first: 0.75 }),
      { walk: "post" },
    ],
    pauses: [[{ clip: "Fishing_Idle", s: [2.3, 4.6], face: "work", soft: true }], ...OUTDOOR_PAUSES],
    steer: [
      {
        tools: set("webfetch", "websearch"),
        steps: [
          { walk: "post" },
          { clip: "Fishing_Cast", s: 1.93, face: "work", beat: { kind: "splash", first: 1.35 } },
          { clip: "Fishing_Reeling", s: 3.2, face: "work", beat: { kind: "splash", every: 0.8 } },
        ],
      },
    ],
  },
  proving: {
    spots: (post, n) => {
      const board = boardOf(post)
      return { work: board, line: near(board, [post[0], post[1]], LINE[n % LINE.length] ?? 7) }
    },
    marks: marks("work"),
    tool: "bow",
    loop: [
      { walk: "line" },
      ...volley(),
      ...volley(),
      { clip: "Idle_B", s: [1.2, 2], face: "work" },
      { walk: "post" },
      { clip: "Interact", s: 1.3, face: "work" },
    ],
    pauses: [
      [{ clip: "Ranged_Bow_Aiming_Idle", s: [1.8, 3.6], face: "work", soft: true }],
      ...OUTDOOR_PAUSES,
    ],
    steer: [{ tools: set("bash", "shell"), steps: [{ walk: "line" }, ...volley()] }],
  },
  yard: {
    spots: (post, n) => {
      const bench = YARD_BENCHES[n % YARD_BENCHES.length] ?? YARD_BENCHES[0]
      return {
        work: ahead(post, 2.4),
        lane: YARD_LANES[n % YARD_BENCHES.length] ?? [post[0], post[1]],
        bench: bench?.stand ?? [0, 0],
        timber: bench?.at ?? [0, 0],
      }
    },
    marks: marks("work", "timber"),
    loop: [
      { clip: "Hammering", s: [5.3, 8], face: "work", beat: { kind: "chip", every: 1.335, first: 0.95 } },
      { walk: "lane" },
      { walk: "bench" },
      { clip: "Sawing", s: [2.7, 4], face: "timber", beat: { kind: "sawdust", at: "timber", every: 0.67 } },
      pick("plank", "timber"),
      { walk: "lane" },
      { walk: "post" },
      put("work", { kind: "dust", first: 0.7 }),
    ],
    pauses: OUTDOOR_PAUSES,
    steer: [
      {
        tools: set("write"),
        steps: [
          { walk: "post" },
          { clip: "Sawing", s: 2.7, face: "work", beat: { kind: "sawdust", every: 0.67 } },
        ],
      },
      {
        tools: set("edit", "patch", "multiedit", "bash", "shell"),
        steps: [
          { walk: "post" },
          { clip: "Hammering", s: 2.67, face: "work", beat: { kind: "chip", every: 1.335, first: 0.95 } },
        ],
      },
    ],
  },
  tower: {
    spots: (_post, n) => ({
      work: TOWER,
      stack: BOOK_STACKS[n % BOOK_STACKS.length] ?? [0, 0],
      books: spot(PILES.books),
    }),
    marks: marks("work", "books"),
    loop: [
      { clip: "Ranged_Magic_Spellcasting", s: [2.7, 4], face: "work", beat: { kind: "magic", every: 0.67 } },
      { clip: "Idle_B", s: [1.2, 2.1], face: "work" },
      { walk: "stack" },
      pick("book", "books"),
      { clip: "Working_B", s: [2.5, 3.8], face: "books", beat: { kind: "page", at: "self", every: 1.26 } },
      put("books"),
      { walk: "post" },
      { clip: "Ranged_Magic_Raise", s: 2.1, face: "work", beat: { kind: "magic", first: 1.2 } },
    ],
    pauses: OUTDOOR_PAUSES,
    steer: [
      {
        tools: true,
        steps: [
          { walk: "post" },
          { clip: "Ranged_Magic_Spellcasting", s: 2.7, face: "work", beat: { kind: "magic", every: 0.67 } },
        ],
      },
    ],
  },
}

/** Draw, aim, loose: an arrow flies at `work` (the target) as the string is released. */
function volley(): Step[] {
  return [
    { clip: "Ranged_Bow_Draw", s: 1.33, face: "work" },
    { clip: "Ranged_Bow_Aiming_Idle", s: [1, 2.2], face: "work" },
    { clip: "Ranged_Bow_Release", s: 1.33, face: "work", beat: { kind: "arrow", first: 0.12 } },
  ]
}

// ---- The keep's stations --------------------------------------------------------------------

/** Keep pauses: look over the work, look up at the hall. */
const INDOOR_PAUSES: readonly (readonly Step[])[] = [
  [{ clip: "Idle_B", s: [2, 2.8], face: "work", soft: true }],
  [
    { clip: "Idle_A", s: [1.2, 2], face: "hall", soft: true },
    { clip: "Idle_B", s: 2.1, face: "work", soft: true },
  ],
]
/** The middle of the hall: where a pause looks up to. */
const HALL: Spot = [0, 2]

/** The keep's forge: one anvil per post, a tub to quench in each (the third is scene/life's own). */
const ANVILS: readonly Spot[] = [
  [9.6, -9.6],
  [13, -9.6],
  [16.2, -9.6],
]
/**
 * Quench buckets by the first and third anvils (scene/life/WorkFx draws them): the keep's furniture
 * has one bucket for three smiths.
 */
export const FORGE_BUCKETS: readonly Spot[] = [
  [7.9, -8.6],
  [17.35, -8.05],
]
/** Each smith's tub, where they stand at it, and the spot in the aisle they go round by. */
const QUENCH: readonly { stand: Spot; at: Spot; front: Spot }[] = [
  { stand: [8, -7.45], at: FORGE_BUCKETS[0] ?? [0, 0], front: [9.6, -8.55] },
  { stand: [11.3, -9.85], at: [11.3, -10.9], front: [11.3, -8.55] },
  { stand: [16.45, -8.05], at: FORGE_BUCKETS[1] ?? [0, 0], front: [16.2, -8.55] },
]
const SHELVES: readonly { stand: Spot; at: Spot }[] = [
  { stand: [-14.6, -10.95], at: [-15, -12] },
  { stand: [-11.4, -10.95], at: [-11, -12] },
]

export const STATION_WORK: Record<StationId, Behaviour> = {
  "quest-board": {
    spots: () => ({
      work: [0, -10.4],
      board: [0, -8.65],
      paceL: [-1.9, -7.9],
      paceR: [1.9, -7.9],
      hall: HALL,
    }),
    marks: marks("work", "hall"),
    loop: [
      { walk: "board" },
      { clip: "Interact", s: [2.6, 3.9], face: "work" },
      { clip: "Working_B", s: [2.5, 3.8], face: "work", beat: { kind: "pin", every: 1.26 } },
      { walk: "paceL" },
      { clip: "Idle_B", s: [2, 3], face: "hall" },
      { walk: "paceR" },
      { clip: "Idle_A", s: [1.5, 2.5], face: "hall" },
      { walk: "post" },
      { clip: "Idle_B", s: 2.1, face: "work" },
    ],
    pauses: [[{ clip: "Interact", s: [2.6, 3.9], face: "work", soft: true }], ...INDOOR_PAUSES],
    steer: [
      {
        tools: set("task", "subagent"),
        steps: [
          { walk: "post" },
          { clip: "Ranged_Magic_Summon", s: 4.3, face: "work", beat: { kind: "magic", first: 2.2 } },
        ],
      },
      {
        tools: set("todowrite"),
        steps: [
          { walk: "board" },
          { clip: "Working_B", s: 2.5, face: "work", beat: { kind: "pin", every: 1.26 } },
        ],
      },
    ],
  },
  library: {
    spots: (_post, n) => {
      const shelf = SHELVES[n % SHELVES.length] ?? SHELVES[0]
      return { work: shelf?.at ?? [0, 0], shelf: shelf?.stand ?? [0, 0], hall: HALL }
    },
    marks: marks("work", "hall"),
    loop: [
      { walk: "shelf" },
      { clip: "Interact", s: 1.3, face: "work", take: "book" },
      { walk: "post" },
      { clip: "Working_B", s: [3, 5], beat: { kind: "page", at: "self", every: 1.26 } },
      { clip: "Idle_B", s: [1.5, 2.1] },
      { walk: "shelf" },
      { clip: "Interact", s: 1.3, face: "work", drop: true },
      { walk: "post" },
      { clip: "Working_A", s: [2, 3] },
    ],
    pauses: INDOOR_PAUSES,
    steer: [
      {
        tools: set("read", "grep", "glob", "list"),
        steps: [
          { walk: "post" },
          { clip: "Working_B", s: 3, beat: { kind: "page", at: "self", every: 1.26 } },
        ],
      },
    ],
  },
  forge: {
    spots: (_post, n) => {
      const anvil = ANVILS[n % ANVILS.length] ?? [0, 0]
      const quench = QUENCH[n % QUENCH.length] ?? QUENCH[0]
      return {
        work: anvil,
        anvil: [anvil[0], -8.55],
        front: quench?.front ?? [anvil[0], -8.55],
        quench: quench?.stand ?? [0, 0],
        tub: quench?.at ?? [0, 0],
        hall: HALL,
      }
    },
    marks: marks("work", "tub", "hall"),
    loop: [
      { walk: "anvil" },
      { clip: "Hammering", s: [5.3, 8], face: "work", beat: { kind: "spark", every: 1.335, first: 0.95 } },
      { walk: "front" },
      { walk: "quench" },
      { clip: "Use_Item", s: 1.6, face: "tub", beat: { kind: "steam", at: "tub", first: 0.6 } },
      { walk: "front" },
      { walk: "anvil" },
      { clip: "Lockpicking", s: [2, 2.6], face: "work" },
      { clip: "Hammering", s: [2.7, 5.3], face: "work", beat: { kind: "spark", every: 1.335, first: 0.95 } },
    ],
    pauses: INDOOR_PAUSES,
    steer: [
      {
        tools: set("bash", "shell"),
        steps: [
          { walk: "front" },
          { walk: "quench" },
          { clip: "Use_Item", s: 1.6, face: "tub", beat: { kind: "steam", at: "tub", first: 0.6 } },
          { walk: "front" },
          { walk: "anvil" },
          { clip: "Lockpicking", s: 2.3, face: "work" },
        ],
      },
      {
        tools: set("edit", "write", "patch", "multiedit"),
        steps: [
          { walk: "anvil" },
          { clip: "Hammering", s: 2.67, face: "work", beat: { kind: "spark", every: 1.335, first: 0.95 } },
        ],
      },
    ],
  },
  "drafting-table": {
    spots: () => ({ work: [-13, -1.6], corner: [-11.35, 0.45], side: [-11.35, -1.6], hall: HALL }),
    marks: marks("work", "hall"),
    loop: [
      { clip: "Working_A", s: [4, 6], face: "work", beat: { kind: "page", every: 1.5 } },
      { walk: "corner" },
      { walk: "side" },
      { clip: "Working_B", s: [2.5, 3.8], face: "work" },
      { clip: "Interact", s: 1.3, face: "work", take: "note" },
      { walk: "corner" },
      { walk: "post" },
      { clip: "Idle_B", s: [1.5, 2.1] },
      { clip: "Interact", s: 1.3, face: "work", drop: true },
    ],
    pauses: INDOOR_PAUSES,
    steer: [
      {
        tools: set("write", "edit"),
        steps: [
          { walk: "post" },
          { clip: "Working_A", s: 3, face: "work", beat: { kind: "page", every: 1.5 } },
        ],
      },
    ],
  },
  easel: {
    spots: () => ({ work: [14.4, -2.2], table: [13, -1.8], back: [13.3, 2.3], hall: HALL }),
    marks: marks("work", "table", "hall"),
    loop: [
      { clip: "Working_B", s: [3.5, 5], face: "work", beat: { kind: "page", every: 1.26 } },
      { walk: "back" },
      { clip: "Idle_B", s: [2, 2.6], face: "work" },
      { walk: "post" },
      { clip: "Interact", s: 1.3, face: "work" },
      { clip: "Working_A", s: [2, 3], face: "table" },
    ],
    pauses: INDOOR_PAUSES,
  },
  "map-table": {
    spots: (_post, n) => ({ work: [-13, 6.4], end: n % 2 === 0 ? [-15.8, 6.4] : [-10.2, 6.4], hall: HALL }),
    marks: marks("work", "hall"),
    loop: [
      { clip: "Working_B", s: [3, 5], face: "work" },
      { walk: "end" },
      { clip: "Interact", s: 1.3, face: "work" },
      { clip: "Idle_B", s: [1.5, 2.1], face: "work" },
      { walk: "post" },
      { clip: "Working_A", s: [2, 3], face: "work", beat: { kind: "page", every: 1.5 } },
    ],
    pauses: INDOOR_PAUSES,
    steer: [
      {
        tools: set("webfetch", "websearch"),
        steps: [
          { walk: "post" },
          { clip: "Working_B", s: 3, face: "work", beat: { kind: "magic", every: 1.26 } },
        ],
      },
    ],
  },
  "scroll-desk": {
    spots: () => ({ work: [-5.5, 7], corner: [-3.85, 5.15], side: [-3.85, 7], hall: HALL }),
    marks: marks("work", "hall"),
    loop: [
      { clip: "Working_A", s: [4, 6], face: "work", beat: { kind: "page", every: 1.5 } },
      { clip: "Interact", s: 1.3, face: "work", take: "note" },
      { clip: "Idle_B", s: [1.6, 2.4] },
      { walk: "corner" },
      { walk: "side" },
      { clip: "Interact", s: 1.3, face: "work", drop: true },
      { walk: "corner" },
      { walk: "post" },
    ],
    pauses: INDOOR_PAUSES,
  },
  "inspection-bench": {
    spots: () => ({ work: [13, 7], corner: [14.95, 5.2], crates: [15, 8.75], box: [16.6, 10.2], hall: HALL }),
    marks: marks("work", "box", "hall"),
    loop: [
      { clip: "Lockpicking", s: [4, 6], face: "work" },
      { clip: "Interact", s: 1.3, face: "work" },
      { walk: "corner" },
      { walk: "crates" },
      { clip: "Interact", s: 1.3, face: "box", take: "book" },
      { walk: "corner" },
      { walk: "post" },
      { clip: "Interact", s: 1.3, face: "work", drop: true },
    ],
    pauses: INDOOR_PAUSES,
    steer: [
      {
        tools: set("bash", "shell"),
        steps: [{ walk: "post" }, { clip: "Lockpicking", s: 2.3, face: "work" }],
      },
    ],
  },
  overflow: {
    spots: () => ({ work: [6, -2], hall: HALL }),
    marks: marks("work", "hall"),
    loop: [
      { clip: "Working_A", s: [3.5, 5], face: "work", beat: { kind: "page", every: 1.5 } },
      { clip: "Idle_B", s: [1.5, 2.1], face: "work" },
      { clip: "Interact", s: 1.3, face: "work" },
      { clip: "Working_B", s: [2.5, 3.8], face: "work" },
    ],
    pauses: INDOOR_PAUSES,
  },
}

// ---- Where a worker is ----------------------------------------------------------------------

/** A worker's place: which behaviour, which berth, and that berth's spots (with `post`). */
export interface Place {
  /** `site:forest`, `station:forge`: one key per place, for the scene's reservations. */
  key: string
  behaviour: Behaviour
  berth: number
  post: Post
  spots: Spots
}

const samePost = (a: Post, x: number, z: number): boolean =>
  Math.abs(a[0] - x) < 1e-6 && Math.abs(a[1] - z) < 1e-6

/**
 * The place a working adventurer is at, from where the store sent them: their site, or their
 * station when they stand at one of its posts (the overflow bench when the station was full).
 * Undefined anywhere else.
 */
export function placeOf(
  site: SiteId | undefined,
  station: StationId | undefined,
  target: Post,
): Place | undefined {
  if (site) return at(`site:${site}`, SITE_WORK[site], SITES[site].posts, target)
  if (!station) return undefined
  return (
    at(`station:${station}`, STATION_WORK[station], STATIONS[station].posts, target) ??
    at("station:overflow", STATION_WORK.overflow, STATIONS.overflow.posts, target)
  )
}

function at(key: string, behaviour: Behaviour, posts: readonly Post[], target: Post): Place | undefined {
  const berth = posts.findIndex((post) => samePost(post, target[0], target[1]))
  if (berth < 0) return undefined
  return { key, behaviour, berth, post: target, spots: spotsOf(behaviour, target, berth) }
}

/** A behaviour's spots for one berth, with `post` added. */
export function spotsOf(behaviour: Behaviour, post: Post, berth: number): Spots {
  return { ...behaviour.spots(post, berth), post: [post[0], post[1]] }
}

/**
 * The same place, shifted sideways for the `lap`-th worker sent to a berth already taken (more
 * workers than posts): their own standing spots beside the first one's.
 */
export function shifted(place: Place, lap: number): Place {
  if (lap === 0) return place
  const [x, z, facing] = place.post
  const dx = Math.cos(facing) * 1.5 * lap
  const dz = -Math.sin(facing) * 1.5 * lap
  const spots: Record<string, Spot> = {}
  for (const [name, value] of Object.entries(place.spots))
    spots[name] = place.behaviour.marks.has(name) ? value : [r2(value[0] + dx), r2(value[1] + dz)]
  return { ...place, post: [r2(x + dx), r2(z + dz), facing], spots }
}

/** Every behaviour by key, for tests and the docs. */
export const BEHAVIOURS: Readonly<Record<string, Behaviour>> = {
  ...Object.fromEntries(Object.entries(SITE_WORK).map(([id, b]) => [`site:${id}`, b])),
  ...Object.fromEntries(Object.entries(STATION_WORK).map(([id, b]) => [`station:${id}`, b])),
}

/** Every step a behaviour can run: its loop, pauses and steers. */
export function stepsOf(behaviour: Behaviour): Step[] {
  return [...behaviour.loop, ...behaviour.pauses.flat(), ...(behaviour.steer ?? []).flatMap((s) => s.steps)]
}

/** Every clip name the behaviours play (each must be in anims.glb: test/anims.test.ts). */
export function clipsOf(behaviour: Behaviour): string[] {
  return stepsOf(behaviour).flatMap((step) => ("clip" in step ? [step.clip] : []))
}

/** Loop walks shorter than this go straight (the spots are chosen, and tested, clear of props). */
export const LOCAL_WALK = 8

/**
 * The spots a loop walk passes through from `from` to `to`, ending at `to`: straight across a
 * site or a station, along the walk router's roads and aisles (world/paths.ts) when further.
 */
export function legOf(from: Spot, to: Spot): Spot[] {
  return Math.hypot(to[0] - from[0], to[1] - from[1]) < LOCAL_WALK ? [to] : route(from, to)
}

// ---- The routine: one worker's loop, as a state machine --------------------------------------

/** A seeded [0, 1) generator (mulberry32). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A string → 32-bit seed (FNV-1a): each adventurer's own variety, the same every run. */
export function seedOf(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193)
  return hash >>> 0
}

/** What the routine hears each frame. */
export interface RoutineInput {
  thinking: boolean
  /** The tool call running now, if any. */
  tool: string | undefined
  /** Standing at the routine's aim (or at the post, before it has started). */
  arrived: boolean
}

/** Seconds of loop between thinking pauses, at least. */
const PAUSE_GAP: readonly [number, number] = [8, 16]

/**
 * One worker's routine. Starts once they first reach their post, then runs the loop for as long
 * as the scene keeps calling `update`. Allocates nothing per update: its outputs are fields the
 * scene reads (`clip`, `aim`, `faceAt`, `held`, `beats`).
 */
export class Routine {
  /** Started: the worker reached their post once and the loop runs. */
  started = false
  /** The clip to play now; null while walking (the scene picks walking or carrying). */
  clip: string | null = null
  /** Where to be: a walk step's spot, else the last spot walked to. */
  aim: Spot
  /** Turn towards this, when set. */
  faceAt: Spot | null = null
  /** At the post with nothing to face: the post's own facing. */
  atPost = true
  held: Held | null = null
  /** Counts up on every beat; `beat` and `beatAt` say the last one's kind and place. */
  beats = 0
  beat: Beat | null = null
  /** A spot, or null for the worker's own hands. */
  beatAt: Spot | null = null
  /** Which list the current step comes from. */
  source: "loop" | "pause" | "steer" = "loop"

  private readonly rand: () => number
  private queue: readonly Step[]
  private index = 0
  /** The loop step to resume at after a pause or a steer. */
  private resume = 0
  private t = 0
  private duration = 0
  private nextBeat = Number.POSITIVE_INFINITY
  private handled = false
  private sincePause = 0
  private pauseGap: number
  private lastTool: string | undefined
  private pending: readonly Step[] | null = null

  constructor(
    readonly place: Place,
    seed: number,
  ) {
    this.rand = seeded(seed)
    this.queue = place.behaviour.loop
    this.aim = place.spots.post ?? [place.post[0], place.post[1]]
    this.pauseGap = this.between(PAUSE_GAP)
  }

  get step(): Step | undefined {
    return this.queue[this.index]
  }

  /** Back to before the start (the phase left working): hands emptied, the loop from the top. */
  reset(): void {
    this.started = false
    this.held = null
    this.clip = null
    this.faceAt = null
    this.atPost = true
    this.queue = this.place.behaviour.loop
    this.index = 0
    this.resume = 0
    this.source = "loop"
    this.pending = null
    this.lastTool = undefined
    this.aim = this.place.spots.post ?? this.aim
  }

  update(dt: number, input: RoutineInput): void {
    this.steerFor(input.tool)
    if (!this.started) {
      if (!input.arrived) return
      this.started = true
      // Neighbours never move in step: each starts somewhere into the loop's first step.
      this.enter(this.rand() * 0.8)
      return
    }
    const step = this.step
    if (!step) {
      this.next(input.thinking)
      return
    }
    this.t += dt
    if ("walk" in step) {
      // The frame a walk starts, `arrived` still speaks of the last aim: wait one update.
      if (input.arrived && this.t > dt) this.next(input.thinking)
      return
    }
    // A soft wait gives way to a tool call at once (when the hands are free).
    if (this.pending && this.held === null && (step.soft || this.source === "pause")) {
      this.next(input.thinking)
      return
    }
    while (this.t >= this.nextBeat) {
      this.beats++
      this.nextBeat = step.beat?.every ? this.nextBeat + step.beat.every : Number.POSITIVE_INFINITY
    }
    if (!this.handled && this.t >= this.duration * 0.5) {
      this.handled = true
      if (step.take) this.held = step.take
      if (step.drop) this.held = null
    }
    if (this.t >= this.duration) this.next(input.thinking)
  }

  /** A new tool call: remember the rule it matches, to run at the next free moment. */
  private steerFor(tool: string | undefined): void {
    if (tool === this.lastTool) return
    this.lastTool = tool
    if (!tool) return
    const rule = this.place.behaviour.steer?.find((s) => s.tools === true || s.tools.has(tool))
    if (rule) this.pending = rule.steps
  }

  /** On to the next step: a pending steer or a thinking pause first, when the hands are free. */
  private next(thinking: boolean): void {
    if (this.source === "loop") this.resume = this.index + 1
    this.sincePause += this.t
    const free = this.held === null
    if (this.pending && free) {
      this.run("steer", this.pending)
      this.pending = null
    } else if (this.source !== "loop" && this.index + 1 < this.queue.length) {
      this.index++
    } else {
      // Back on the loop where it left off; thinking may slip a pause in first, never mid-carry.
      this.source = "loop"
      this.queue = this.place.behaviour.loop
      this.index = this.resume % this.queue.length
      if (thinking && free && this.sincePause >= this.pauseGap) this.pausing()
    }
    this.enter(0)
  }

  private pausing(): void {
    const pauses = this.place.behaviour.pauses
    const pause = pauses[Math.floor(this.rand() * pauses.length)]
    if (!pause || pause.length === 0) return
    this.run("pause", pause)
    this.sincePause = 0
    this.pauseGap = this.between(PAUSE_GAP)
  }

  private run(source: "pause" | "steer", steps: readonly Step[]): void {
    this.source = source
    this.queue = steps
    this.index = 0
  }

  /** Start the current step, `progress` (0–1) of the way in. */
  private enter(progress: number): void {
    const step = this.step
    this.handled = false
    this.nextBeat = Number.POSITIVE_INFINITY
    if (!step) return
    if ("walk" in step) {
      this.t = 0
      this.duration = 0
      this.clip = null
      this.faceAt = null
      this.aim = this.place.spots[step.walk] ?? this.aim
      this.atPost = step.walk === "post"
      return
    }
    this.duration = this.between(step.s)
    this.t = this.duration * progress
    this.clip = step.clip
    this.faceAt = step.face ? (this.place.spots[step.face] ?? null) : null
    if (step.beat) {
      const first = step.beat.first ?? (step.beat.every ? step.beat.every / 2 : this.duration / 2)
      this.nextBeat = first
      // Started part way in: skip the beats already past, without firing them.
      while (this.nextBeat < this.t && step.beat.every) this.nextBeat += step.beat.every
      this.beat = step.beat.kind
      const at = step.beat.at ?? "work"
      this.beatAt = at === "self" ? null : (this.place.spots[at] ?? null)
    }
  }

  private between(seconds: Seconds): number {
    if (typeof seconds === "number") return seconds
    return seconds[0] + (seconds[1] - seconds[0]) * this.rand()
  }
}
