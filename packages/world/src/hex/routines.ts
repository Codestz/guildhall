/**
 * Work routines (decisions.md "Game feel plan", task A): what a townsfolk does at a work spot, as a loop
 * of rig clips with visible results. A routine is a pure function of (stay, seed, t): `routineSample`
 * gives the shared life sample `{clip, phase, props, beat}` at `t` seconds into a stay, the same whether
 * the clock was played up to `t` or set there.
 *
 *   part     a clip played `reps` times (a fixed or seeded count), or looped for `hold` seconds; it may
 *            show props (a fish once caught), cue beats (a hit, a cast: particles and sounds) at
 *            fractions of each play, and stand the body a little off its spot (`at`, a farmer moving
 *            down a row: `shift` in the sample) or walk there (`move`).
 *   cycle    the parts in order: one catch, one ore thrown into the cart. A part marked `last` is played
 *            only in the last cycle of a block (the cart rolls away after the sixth throw).
 *   block    `block` cycles whose seeded counts and holds are drawn as a stratified set (a fisher's
 *            waits are 4 to 9 s, in a seeded order), so every block lasts the same: the cycle at any `t`
 *            is found without walking the day.
 *
 * A spot's frame: x to the right of its facing f, z ahead; in the world (x, z) = at + x·(−cos f, sin f)
 * + z·(sin f, cos f) (`spotFrame`); a turn is added to f (positive: to the left).
 *
 * Stocks (`Stock`, `stockAt`): what the work leaves (a fisher's basket, the ore cart and its heap, a log
 * pile, crates, bars, arrows in the butts) as levels over the day's hours, counted off the routines.
 */
import { hash2 } from "../geom/noise.ts"

/** A cue at a moment of a routine: what particles and sounds hang on (task C). */
export type Beat =
  | "cast"
  | "bite"
  | "catch"
  | "drop"
  | "hit"
  | "saw"
  | "dig"
  | "pickup"
  | "throw"
  | "roll"
  | "quench"
  | "serve"
  | "coin"
  | "pour"
  | "draw"
  | "release"
  | "ring"
  | "page"
  | "look"

/**
 * The shared life sample (decisions.md "Game feel plan"): what a person plays now. `phase` is how far
 * into `clip` (0–1, what the crowd draws); `props` the catalog pieces shown on them; `beat` set for
 * BEAT_S after its moment (dedupe by `cycle` + `beat`). Extras for the drawing side: `u` (0–1 into the
 * cycle), `cycle` (cycles done since the stay began), `shift` (metres off the spot in its frame: x to the
 * right of its facing, z ahead) and `turn` (radians added to its facing) while a part stands off it,
 * `carry` (a piece held in both arms walking: a basket, a log).
 */
export interface LifeSample {
  clip: string
  phase: number
  props: readonly string[]
  beat?: Beat
  cycle: number
  u: number
  shift?: readonly [number, number]
  turn?: number
  carry?: string
}

/** Seconds a beat stays set after its moment (a frame at 60 or 30 fps, or two, always sees it). */
export const BEAT_S = 0.2

/**
 * Rig-medium clip lengths, seconds (library catalog, rig-medium): the clips routines play. The beats'
 * moments are read off the clips (the right hand's lowest point after a swing, its highest on a cast or a
 * lift): Chopping lands at 0.3; Hammering and Pickaxing land twice (0.1 and 0.6, 0.08 and 0.58); Digging
 * at 0.42; PickUp reaches the ground at 0.4; Fishing_Cast lets go at 0.7, Fishing_Bite tugs at 0.2,
 * Fishing_Catch lifts the fish out at 0.62; Throw lets go at 0.48; Ranged_Bow_Release at 0.25.
 */
export const ROUTINE_CLIP_SECONDS: Readonly<Record<string, number>> = {
  Chopping: 1.333,
  Digging: 1.4,
  Fishing_Bite: 2.233,
  Fishing_Cast: 1.933,
  Fishing_Catch: 3.233,
  Fishing_Idle: 2.333,
  Fishing_Reeling: 1.6,
  Hammering: 2.667,
  Holding_A: 1,
  Holding_C: 1,
  Idle_A: 1.067,
  Idle_B: 2.133,
  Interact: 1.3,
  PickUp: 1.3,
  Pickaxing: 3.733,
  Ranged_Bow_Aiming_Idle: 1.833,
  Ranged_Bow_Draw: 1.333,
  Ranged_Bow_Idle: 1.567,
  Ranged_Bow_Release: 1.333,
  Saw: 2.4,
  Throw: 1.367,
  Use_Item: 1.6,
  Walking_A: 1.067,
  Waving: 2.133,
  Working_A: 1.5,
  Working_B: 2.533,
}

/** Catalog pieces the routines show (props a hand or the arms hold). */
export const PROPS = {
  rod: "kaykit-weapons/staff-a",
  fish: "kenney-survival/fish",
  basket: "kenney-survival/bucket",
  axe: "kaykit-tools/axe",
  log: "kaykit-resources/wood-log-a",
  saw: "kaykit-tools/saw",
  plank: "kaykit-resources/wood-plank-a",
  pickaxe: "kaykit-tools/pickaxe",
  ore: "kaykit-resources/iron-nugget-medium",
  hammer: "kaykit-tools/hammer",
  bar: "kaykit-resources/iron-bar",
  hoe: "kenney-survival/tool-hoe",
  shovel: "kaykit-tools/shovel",
  crop: "kenney-nature/crop-carrot",
  coin: "kaykit-dungeon/coin",
  mug: "kaykit-adventurers/mug-full",
  bow: "kaykit-adventurers/bow-with-string",
  arrow: "kaykit-weapons/arrow-a",
  book: "kaykit-adventurers/spellbook-open",
  quill: "kaykit-tools/pencil-a-long",
} as const

/** One part of a cycle. */
export interface RoutinePart {
  clip: string
  /** Plays of the clip: a number, or a seeded count in [min, max] (stratified over a block). */
  reps?: number | readonly [number, number]
  /** Instead of plays: the clip looped this long, seconds (a seeded hold in [min, max]). */
  hold?: number | readonly [number, number]
  /** Cues at fractions of each play (of the whole hold for a hold). */
  beats?: readonly (readonly [number, Beat])[]
  /** Pieces shown during the part (beside the routine's own), from `propsFrom` to `propsTo` of it. */
  props?: readonly string[]
  propsFrom?: number
  propsTo?: number
  /** Metres off the spot through the part (spot frame: x right, z ahead); `move`: walked to from the last part's. */
  at?: readonly [number, number]
  move?: boolean
  /** Radians added to the spot's facing through the part. */
  turn?: number
  /** Carried in the arms through the part (a crop to the crate). */
  carry?: string
  /** Only in the last cycle of a block. */
  last?: boolean
  /** Units the part leaves in the routine's stock when it ends (a fish in the basket). */
  yields?: number
}

/** Where a routine's stock stands, in its spot's frame (metres: x right, z ahead), and what it holds. */
export interface StockSpec {
  kind: StockKind
  at: readonly [number, number]
  /** Units that fill it (a full basket, a full cart); a heap or a pile counts on past it. */
  cap: number
  /** The piece one unit is drawn with. */
  piece: string
  /** The cart's rail, from `at` to here (spot frame): rolled out and back in the part marked `roll`. */
  rail?: readonly [number, number]
  /** Emptied at the end of every block (the cart tipped at the rail's end into `heap`). */
  tips?: boolean
}

export type StockKind =
  | "basket"
  | "ore-cart"
  | "ore-heap"
  | "log-pile"
  | "planks"
  | "crates"
  | "bars"
  | "arrows"

export interface Routine {
  /** Pieces shown throughout (the rod, the axe). */
  props: readonly string[]
  parts: readonly RoutinePart[]
  /** Cycles per block (default 8). */
  block?: number
  /** What the routine fills. */
  stock?: StockSpec
  /** Index of the part during which the stock's cart rolls its rail (out and back). */
  roll?: number
}

const P = PROPS

/** The routines, by id. */
export const ROUTINES: Readonly<Record<string, Routine>> = {
  // cast, wait for a bite (4–9 s), strike, reel, land it, into the basket
  fish: {
    props: [P.rod],
    parts: [
      { clip: "Fishing_Cast", beats: [[0.7, "cast"]] },
      { clip: "Fishing_Idle", hold: [4, 9] },
      { clip: "Fishing_Bite", beats: [[0.2, "bite"]] },
      { clip: "Fishing_Reeling", reps: 2 },
      { clip: "Fishing_Catch", beats: [[0.62, "catch"]], props: [P.fish], propsFrom: 0.6 },
      { clip: "PickUp", props: [P.fish], propsTo: 0.55, beats: [[0.55, "drop"]], turn: 0.9, yields: 1 },
    ],
    stock: { kind: "basket", at: [-0.45, 0.05], cap: 40, piece: P.fish },
  },
  // four blows, a breath; the logs go to the pile on trips the day plans (every CHOP_TRIP cycles)
  chop: {
    props: [P.axe],
    parts: [
      { clip: "Chopping", reps: 4, beats: [[0.3, "hit"]] },
      { clip: "Idle_A", hold: [0.9, 2.2] },
    ],
  },
  // saw a plank, lift it off, lay it on the stack
  saw: {
    props: [P.saw],
    parts: [
      {
        clip: "Saw",
        reps: [3, 5],
        beats: [
          [0.28, "saw"],
          [0.78, "saw"],
        ],
      },
      { clip: "PickUp", beats: [[0.4, "pickup"]], props: [P.plank], propsFrom: 0.4 },
      { clip: "Interact", props: [P.plank], propsTo: 0.55, beats: [[0.55, "drop"]], turn: -1.2, yields: 1 },
    ],
    stock: { kind: "planks", at: [0.75, -0.2], cap: 60, piece: P.plank },
  },
  // two to four swings at the rock (two to a play of Pickaxing), pick up the ore, throw it in the cart; after the sixth the cart rolls its
  // rail and back while the miner waits
  mine: {
    props: [P.pickaxe],
    block: 6,
    parts: [
      {
        clip: "Pickaxing",
        reps: [1, 2],
        beats: [
          [0.08, "hit"],
          [0.58, "hit"],
        ],
      },
      { clip: "PickUp", beats: [[0.4, "pickup"]], props: [P.ore], propsFrom: 0.4 },
      { clip: "Throw", props: [P.ore], propsTo: 0.48, beats: [[0.48, "throw"]], turn: -1.3, yields: 1 },
      { clip: "Idle_B", hold: 8, last: true, beats: [[0, "roll"]], turn: -1.3 },
    ],
    roll: 3,
    stock: { kind: "ore-cart", at: [0.95, -0.15], cap: 6, piece: P.ore, rail: [0.95, -2.4], tips: true },
  },
  // blows on the anvil (two to a play of Hammering), a quench every 6–8, a breath
  smith: {
    props: [P.hammer],
    parts: [
      {
        clip: "Hammering",
        reps: [3, 4],
        beats: [
          [0.1, "hit"],
          [0.6, "hit"],
        ],
      },
      { clip: "Use_Item", props: [P.bar], beats: [[0.5, "quench"]], turn: 1.1, yields: 1 },
      { clip: "Idle_A", hold: [0.8, 1.6] },
    ],
    stock: { kind: "bars", at: [-0.7, -0.35], cap: 30, piece: P.bar },
  },
  // dig down a row at three places, pull up the crop, carry it back to the crate
  farm: {
    props: [P.hoe],
    parts: [
      { clip: "Digging", reps: 2, beats: [[0.42, "dig"]] },
      { clip: "Walking_A", move: true, at: [0, 0.45] },
      { clip: "Digging", reps: 2, at: [0, 0.45], beats: [[0.42, "dig"]] },
      { clip: "Walking_A", move: true, at: [0, 0.9] },
      { clip: "Digging", reps: 2, at: [0, 0.9], beats: [[0.42, "dig"]] },
      { clip: "PickUp", at: [0, 0.9], beats: [[0.4, "pickup"]], props: [P.crop], propsFrom: 0.4 },
      { clip: "Walking_A", move: true, at: [0.5, -0.25], carry: P.crop },
      {
        clip: "Interact",
        at: [0.5, -0.25],
        turn: -2.45,
        props: [P.crop],
        propsTo: 0.5,
        beats: [[0.5, "drop"]],
        yields: 1,
      },
      { clip: "Walking_A", move: true, at: [0, 0] },
    ],
    stock: { kind: "crates", at: [0.75, -0.55], cap: 40, piece: P.crop },
  },
  // a monk's garden: the farmer's rows with a spade
  garden: {
    props: [P.shovel],
    parts: [
      { clip: "Digging", reps: [3, 5], beats: [[0.42, "dig"]] },
      { clip: "Idle_A", hold: [1, 2.5] },
      { clip: "PickUp", beats: [[0.4, "pickup"]] },
    ],
  },
  // weeding by hand: bend, pick, look about
  gather: {
    props: [],
    parts: [
      { clip: "PickUp", reps: [2, 4], beats: [[0.4, "pickup"]] },
      { clip: "Idle_B", hold: [1.5, 3.5], beats: [[0.1, "look"]] },
    ],
  },
  // a merchant at the counter: wait for a customer, hand the goods over, take the coin
  serve: {
    props: [],
    parts: [
      { clip: "Idle_A", hold: [3, 8] },
      { clip: "Interact", beats: [[0.5, "serve"]] },
      { clip: "Use_Item", props: [P.coin], propsFrom: 0.3, beats: [[0.45, "coin"]] },
      { clip: "Idle_B", hold: [1.5, 3] },
    ],
  },
  // a tavern keeper: pour, serve, take the coin, wipe the board
  tavern: {
    props: [],
    parts: [
      { clip: "Idle_A", hold: [2.5, 6] },
      { clip: "Interact", props: [P.mug], propsFrom: 0.4, beats: [[0.4, "pour"]] },
      { clip: "Use_Item", props: [P.mug], propsTo: 0.5, beats: [[0.5, "serve"]] },
      { clip: "Use_Item", props: [P.coin], beats: [[0.45, "coin"]] },
      { clip: "Working_A", reps: [1, 3] },
    ],
  },
  // draw, aim, loose, a breath; the arrows stick in the butts until the last of a block is shot
  archery: {
    props: [P.bow],
    block: 10,
    parts: [
      { clip: "Ranged_Bow_Draw", beats: [[0.15, "draw"]] },
      { clip: "Ranged_Bow_Aiming_Idle", hold: [0.8, 2.6] },
      { clip: "Ranged_Bow_Release", beats: [[0.25, "release"]], yields: 1 },
      { clip: "Ranged_Bow_Idle", hold: [0.8, 2] },
    ],
    stock: { kind: "arrows", at: [0, 7], cap: 10, piece: P.arrow, tips: true },
  },
  // a guard at a post: still, a look round now and then
  post: {
    props: [],
    parts: [
      { clip: "Idle_A", hold: [6, 14] },
      { clip: "Idle_B", beats: [[0.2, "look"]] },
    ],
  },
  // a monk copying at a desk: write, turn the page
  copy: {
    props: [P.quill],
    parts: [
      { clip: "Working_B", reps: [2, 4] },
      { clip: "Use_Item", beats: [[0.5, "page"]] },
      { clip: "Idle_A", hold: [1, 3] },
    ],
  },
  // a monk reading at a lectern or a grave
  read: {
    props: [P.book],
    parts: [
      { clip: "Holding_A", hold: [8, 16] },
      { clip: "Use_Item", props: [P.book], beats: [[0.5, "page"]] },
    ],
  },
  // the bell: three pulls, then prayer
  bell: {
    props: [],
    parts: [
      { clip: "Interact", reps: 3, beats: [[0.55, "ring"]] },
      { clip: "Holding_C", hold: [18, 30] },
    ],
  },
  // an extra pair of hands beside someone's work
  help: {
    props: [],
    parts: [
      { clip: "Working_A", reps: [2, 4] },
      { clip: "PickUp", beats: [[0.4, "pickup"]] },
      { clip: "Working_B", reps: [1, 2] },
      { clip: "Idle_A", hold: [1, 3] },
    ],
  },
  // a log laid on the pile at the end of a woodcutter's trip
  stack: {
    props: [],
    parts: [
      { clip: "PickUp", props: [P.log], propsTo: 0.5, beats: [[0.5, "drop"]] },
      { clip: "Idle_A", hold: 60 },
    ],
  },
  // a basket set down at a stall (the fisher's delivery): put it down, take the coin
  deliver: {
    props: [],
    parts: [
      { clip: "PickUp", props: [P.basket], propsTo: 0.5, beats: [[0.5, "drop"]] },
      { clip: "Use_Item", props: [P.coin], beats: [[0.45, "coin"]] },
      { clip: "Waving", hold: 3 },
      { clip: "Idle_A", hold: 60 },
    ],
  },
}

/** Cycles of chopping between a woodcutter's trips with a log to the pile. */
export const CHOP_TRIP = 6

/** A routine at a stay: which one, and the seed its counts and holds are drawn by. */
export interface RoutineAt {
  id: string
  seed: number
}

const clipSeconds = (clip: string) => ROUTINE_CLIP_SECONDS[clip] ?? 1.5
/** The routine's walking pace between its places, metres a second (the townsfolk's own). */
const MOVE_MPS = 0.8

/** Every clip a routine plays (for the crowd to bake). */
export function routineClips(id: string): string[] {
  const r = ROUTINES[id]
  return r ? [...new Set(r.parts.map((p) => p.clip))].sort() : []
}

/**
 * The routine a townsfolk plays at a work spot: by role, the spot's clip and kind, the prefab of its tile
 * and whether it stands by a tower (a monk at the church's door or the bell tower rings the bell). None:
 * the spot's own clip (a seat, a drill, a role's odd job).
 */
export function routineFor(
  role: string,
  spot: { clip?: string; kind?: string; prop?: string },
  prefab?: string,
  byTower = false,
): string | undefined {
  const c = spot.clip ?? ""
  if (c.startsWith("Sit") || c.startsWith("Melee")) return undefined
  if (
    role === "monk" &&
    (byTower || (spot.kind === "stand" && (prefab === "monastery" || prefab === "chapel")))
  )
    return "bell"
  if (c.startsWith("Fishing") || role === "fisher") return "fish"
  if (c === "Chopping") return "chop"
  if (c === "Sawing" || c === "Saw") return "saw"
  if (c === "Pickaxing" || (role === "miner" && !c)) return "mine"
  if (c === "Hammering" || (role === "smith" && !c)) return "smith"
  if (c === "Digging") return role === "farmer" ? "farm" : "garden"
  if (role === "farmer" && !c) return "farm"
  if (c === "PickUp") return "gather"
  if (role === "merchant") return "serve"
  if (role === "tavern-keeper") return "tavern"
  if (role === "archer") return "archery"
  if (role === "monk") {
    if (c === "Interact" || c === "Use_Item") return "copy"
    if (c.startsWith("Holding") || spot.prop?.includes("spellbook")) return "read"
    return "read"
  }
  if ((role === "guard" || role === "night-watch") && spot.kind === "stand") return "post"
  return undefined
}

// ---- the block: every cycle's parts' lengths, drawn once per block and kept ----

interface Block {
  /** The block's index. */
  n: number
  /** Each cycle's start (seconds into the block), and the block's end last. */
  starts: number[]
  /** Each cycle's parts' lengths and plays (a hold: 1). */
  lens: number[][]
  reps: number[][]
}

/** Blocks drawn, by routine at a stay (each stay's object is kept in the plan, so this is per stay). */
const blocks = new WeakMap<RoutineAt, Block>()
/** Each routine's block length, seconds. */
const spans = new Map<string, number>()

const cyclesOf = (r: Routine) => r.block ?? 8

/** The k-th of K stratified values in [a, b], shuffled by a seed: every block draws the same set. */
function stratum(seed: number, block: number, part: number, k: number, K: number): number {
  // k's rank among the block's K seeded keys
  const key = (j: number) => hash2(seed + part * 7919, block, j)
  const mine = key(k)
  let rank = 0
  for (let j = 0; j < K; j++) {
    const o = key(j)
    if (o < mine || (o === mine && j < k)) rank++
  }
  return (rank + 0.5) / K
}

function partPlays(p: RoutinePart, f: number): number {
  if (p.reps === undefined) return 1
  if (typeof p.reps === "number") return p.reps
  const [a, b] = p.reps
  return a + Math.min(b - a, Math.floor(f * (b - a + 1)))
}

function partLength(p: RoutinePart, prev: readonly [number, number], f: number, plays: number): number {
  if (p.move) {
    const to = p.at ?? [0, 0]
    return Math.max(0.3, Math.hypot(to[0] - prev[0], to[1] - prev[1]) / MOVE_MPS)
  }
  if (p.hold !== undefined)
    return typeof p.hold === "number" ? p.hold : p.hold[0] + (p.hold[1] - p.hold[0]) * f
  return clipSeconds(p.clip) * plays
}

/** Where each part stands (the last part's `at` before it, for a move's start). */
function partFrom(r: Routine, i: number): readonly [number, number] {
  for (let j = i - 1; j >= 0; j--) if (r.parts[j]!.at) return r.parts[j]!.at!
  // the cycle starts where its last part ended
  for (let j = r.parts.length - 1; j > i; j--) if (r.parts[j]!.at) return r.parts[j]!.at!
  return [0, 0]
}

function drawBlock(r: Routine, seed: number, n: number): Block {
  const K = cyclesOf(r)
  const starts: number[] = []
  const lens: number[][] = []
  const reps: number[][] = []
  let t = 0
  for (let k = 0; k < K; k++) {
    starts.push(t)
    const l: number[] = []
    const rp: number[] = []
    for (const [i, p] of r.parts.entries()) {
      if (p.last && k !== K - 1) {
        l.push(0)
        rp.push(0)
        continue
      }
      const varies =
        (p.reps !== undefined && typeof p.reps !== "number") ||
        (p.hold !== undefined && typeof p.hold !== "number")
      const f = varies ? stratum(seed, n, i, k, K) : 0.5
      const plays = partPlays(p, f)
      const len = partLength(p, partFrom(r, i), f, plays)
      l.push(len)
      rp.push(plays)
      t += len
    }
    lens.push(l)
    reps.push(rp)
  }
  starts.push(t)
  return { n, starts, lens, reps }
}

/** A routine's block length, seconds: the same for every block (its varying parts are stratified). */
export function routineSpan(id: string): number {
  const have = spans.get(id)
  if (have !== undefined) return have
  const r = ROUTINES[id]
  const span = r ? drawBlock(r, 0, 0).starts.at(-1)! : 1
  spans.set(id, span)
  return span
}

function blockOf(at: RoutineAt, r: Routine, n: number): Block {
  const have = blocks.get(at)
  if (have && have.n === n) return have
  const b = drawBlock(r, at.seed, n)
  blocks.set(at, b)
  return b
}

const NONE: readonly string[] = []
/** The props shown during a part at a fraction of it (kept per part: no allocation per frame). */
const propsCache = new Map<Routine, (readonly string[])[][]>()
function propsAt(r: Routine, i: number, f: number): readonly string[] {
  let per = propsCache.get(r)
  if (!per) {
    per = r.parts.map((p) => [r.props.length ? r.props : NONE, p.props ? [...r.props, ...p.props] : r.props])
    propsCache.set(r, per)
  }
  const p = r.parts[i]!
  if (!p.props) return per[i]![0]!
  const on = f >= (p.propsFrom ?? 0) && f < (p.propsTo ?? 1.01)
  return per[i]![on ? 1 : 0]!
}

/** Where a routine is at `t` seconds: its block, cycle, part and how far into the part. */
interface Where {
  block: Block
  K: number
  cycle: number
  part: number
  into: number
  len: number
}

function where(at: RoutineAt, r: Routine, t: number): Where {
  const span = routineSpan(at.id)
  const tt = Math.max(0, t)
  const n = Math.floor(tt / span)
  const b = blockOf(at, r, n)
  let u = tt - n * span
  const K = cyclesOf(r)
  // the cycle: the last start at or before u
  let k = 0
  while (k + 1 < K && b.starts[k + 1]! <= u) k++
  u -= b.starts[k]!
  const lens = b.lens[k]!
  let i = 0
  while (i + 1 < lens.length && (lens[i]! <= u || lens[i] === 0)) {
    u -= lens[i]!
    i++
  }
  return { block: b, K, cycle: n * K + k, part: i, into: Math.min(u, lens[i]!), len: lens[i]! }
}

/**
 * What someone at a routine plays `t` seconds into their stay (the shared life sample). Unknown
 * routines idle on Idle_A.
 */
export function routineSample(at: RoutineAt, t: number): LifeSample {
  const r = ROUTINES[at.id]
  if (!r) return { clip: "Idle_A", phase: frac(t / clipSeconds("Idle_A")), props: NONE, cycle: 0, u: 0 }
  const w = where(at, r, t)
  const p = r.parts[w.part]!
  const plays = w.block.reps[w.cycle % w.K]![w.part]!
  const f = w.len > 0 ? w.into / w.len : 0
  const clipLen = clipSeconds(p.clip)
  // a played clip runs once per play; a hold (or a walk) loops it
  let phase: number
  let ofPlay: number
  if (p.hold !== undefined || p.move) {
    phase = frac(w.into / clipLen)
    ofPlay = f
  } else {
    const per = w.len / Math.max(1, plays)
    const into = w.into - Math.floor(w.into / per) * per
    ofPlay = per > 0 ? into / per : 0
    phase = Math.min(0.999, ofPlay)
  }
  const out: LifeSample = { clip: p.clip, phase, props: propsAt(r, w.part, f), cycle: w.cycle, u: 0 }
  // how far into the cycle
  const cs = w.block.starts
  const k = w.cycle % w.K
  const start = cs[k]!
  const cycleLen = cs[k + 1]! - start
  let before = 0
  for (let j = 0; j < w.part; j++) before += w.block.lens[k]![j]!
  out.u = cycleLen > 0 ? (before + w.into) / cycleLen : 0
  if (p.beats) {
    const per = p.hold !== undefined || p.move ? w.len : w.len / Math.max(1, plays)
    const into = p.hold !== undefined || p.move ? w.into : w.into - Math.floor(w.into / per) * per
    for (const [b, beat] of p.beats)
      if (into >= b * per && into < b * per + BEAT_S) {
        out.beat = beat
        break
      }
  }
  if (p.move) {
    const a = partFrom(r, w.part)
    const b = p.at ?? [0, 0]
    out.shift = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]
    // walking: facing the way (turned from the spot's facing toward the move)
    const dx = b[0] - a[0]
    const dz = b[1] - a[1]
    if (Math.hypot(dx, dz) > 1e-6) out.turn = Math.atan2(-dx, dz)
  } else if (p.at && (p.at[0] !== 0 || p.at[1] !== 0)) out.shift = p.at
  if (p.turn !== undefined && !p.move) out.turn = p.turn
  if (p.carry) out.carry = p.carry
  return out
}

/** Units a routine has yielded `t` seconds into a stay (a fish counted once it is in the basket). */
export function routineYield(at: RoutineAt, t: number): number {
  const r = ROUTINES[at.id]
  if (!r || t <= 0) return 0
  const per = r.parts.reduce((s, p) => s + (p.last ? 0 : (p.yields ?? 0)), 0)
  const lastOnly = r.parts.reduce((s, p) => s + (p.last ? (p.yields ?? 0) : 0), 0)
  const K = cyclesOf(r)
  const w = where(at, r, t)
  const n = Math.floor(w.cycle / K)
  let count = n * (per * K + lastOnly)
  const k = w.cycle % K
  count += k * per
  // the parts of this cycle done
  for (let j = 0; j < w.part; j++) count += w.block.lens[k]![j]! > 0 ? (r.parts[j]!.yields ?? 0) : 0
  return count
}

/**
 * The cycles a routine has finished `t` seconds into a stay (whole cycles; a chop's trips come every
 * CHOP_TRIP of them).
 */
export function routineCycles(at: RoutineAt, t: number): number {
  const r = ROUTINES[at.id]
  return r && t > 0 ? where(at, r, t).cycle : 0
}

/** Seconds `n` whole cycles of a routine take from a stay's start (the block's cycles, seeded). */
export function cyclesSpan(at: RoutineAt, n: number): number {
  const r = ROUTINES[at.id]
  if (!r || n <= 0) return 0
  const K = cyclesOf(r)
  const span = routineSpan(at.id)
  const blocksDone = Math.floor(n / K)
  const b = drawBlock(r, at.seed, blocksDone)
  return blocksDone * span + b.starts[n % K]!
}

/** Where a cart stands on its rail now: 0 at its place by the worker, 1 at the rail's end. */
function railAt(at: RoutineAt, r: Routine, t: number): { roll: number; tipped: boolean } {
  if (r.roll === undefined) return { roll: 0, tipped: false }
  const w = where(at, r, t)
  if (w.part !== r.roll) return { roll: 0, tipped: false }
  const f = w.len > 0 ? w.into / w.len : 0
  // out over the first 40%, a pause at the end, back over the last 40%
  const roll = f < 0.4 ? smooth(f / 0.4) : f < 0.6 ? 1 : smooth((1 - f) / 0.4)
  return { roll, tipped: f >= 0.4 }
}

/** A point in a spot's frame (x right, z ahead) in the world, the spot at (ax, az) facing `f`. */
export function spotFrame(ax: number, az: number, f: number, x: number, z: number): [number, number] {
  return [ax - Math.cos(f) * x + Math.sin(f) * z, az + Math.sin(f) * x + Math.cos(f) * z]
}

const smooth = (x: number) => x * x * (3 - 2 * x)
const frac = (x: number) => x - Math.floor(x)

// ---- stocks ----

/** A stay that fills a stock: its routine, from and to (day hours). */
export interface StockFeed {
  from: number
  to: number
  routine: RoutineAt
}

/**
 * What work leaves somewhere over the day: a basket by a fisher, a cart and its heap by a miner, a log
 * pile, a stack of planks, crates at a field's end, bars by an anvil, arrows in the butts, and the
 * baskets brought to a stall. Planned with the townsfolk (`planStocks`), sampled by `stockAt`.
 */
export interface Stock {
  /** Who works it (a townsfolk's id; −1 for a stall's, filled by deliveries). */
  folk: number
  kind: StockKind | "stall-fish"
  /** World metres (its feet), and the way it faces. */
  at: readonly [number, number, number]
  facing: number
  /** Units that fill it. */
  cap: number
  /** The piece one unit is drawn with. */
  piece: string
  /** A cart's rail's far end (world metres). */
  rail?: readonly [number, number, number]
  /** The stays that fill it. */
  feeds: StockFeed[]
  /** Hours units arrive by hand (a log carried to the pile, a basket set down at a stall), in order. */
  arrivals?: number[]
  /** Hours it is taken away whole (a basket carried off), in order. */
  takes?: number[]
  /** The day's hour it starts empty (overnight it is cleared). */
  since: number
}

/** A stock as drawn now: units in it, how full (0–1), and a cart's place on its rail (0–1). */
export interface StockSample {
  count: number
  fill: number
  roll?: number
}

/** Hour a day's stocks start from (cleared overnight, before anyone is up). */
export const STOCK_DAY = 4

/**
 * A stock's level at `hour` (day hours) with `secPerHour` screen seconds to a day hour: what its feeds
 * have yielded since the day began (or since it was last taken away), plus what was carried to it.
 */
export function stockAt(s: Stock, hour: number, secPerHour: number): StockSample {
  // hours since the stock's day began, on the day's loop
  const into = (((hour - s.since) % 24) + 24) % 24
  const h = s.since + into
  /** The day hour `t` on the same unrolled clock as `h`. */
  const un = (t: number) => s.since + ((((t - s.since) % 24) + 24) % 24)
  let lastTake = s.since
  for (const t of s.takes ?? []) if (un(t) <= h && un(t) > lastTake) lastTake = un(t)
  let count = 0
  let roll: number | undefined
  for (const f of s.feeds) {
    const from = un(f.from)
    const to = from + (f.to - f.from)
    if (h <= from) continue
    const r = ROUTINES[f.routine.id]
    const end = Math.min(h, to)
    const secs = (end - from) * secPerHour
    const startSecs = Math.max(0, (lastTake - from) * secPerHour)
    let n = routineYield(f.routine, secs) - routineYield(f.routine, startSecs)
    if (s.kind === "ore-cart" && r) {
      // the cart holds this block's throws, tipped at the rail's end once it has rolled out
      const K = cyclesOf(r)
      const per = r.stock?.cap ?? K
      const rail = h < to ? railAt(f.routine, r, secs) : { roll: 0, tipped: false }
      // this block's throws (its last cycle's roll tips them)
      n = routineYield(f.routine, secs) - Math.floor(routineCycles(f.routine, secs) / K) * per
      if (rail.tipped) n = 0
      if (h < to) roll = rail.roll
      count = n
      continue
    }
    if (s.kind === "ore-heap" && r) {
      // a cart's load for every roll that has tipped
      const K = cyclesOf(r)
      const w = routineCycles(f.routine, secs)
      let tips = Math.floor(w / K)
      if (h < to && railAt(f.routine, r, secs).tipped) tips++
      n = tips * (r.stock?.cap ?? K)
    }
    if (s.kind === "arrows" && r) {
      // the butts hold this block's arrows (pulled out after the last)
      n = routineYield(f.routine, secs) % (r.stock?.cap ?? 10)
      count = h < to ? n : 0
      continue
    }
    count += Math.max(0, n)
  }
  for (const t of s.arrivals ?? []) if (un(t) <= h && un(t) > lastTake) count++
  const out: StockSample = { count, fill: Math.min(1, count / Math.max(1, s.cap)) }
  if (roll !== undefined) out.roll = roll
  return out
}

/** Every stock's level at `hour` (the drawing side's one call a frame, or less). */
export function stocksAt(stocks: readonly Stock[], hour: number, secPerHour: number): StockSample[] {
  return stocks.map((s) => stockAt(s, hour, secPerHour))
}

/** What `planStocks` reads of a townsfolk: who, and their day. */
interface StockFolk {
  id: number
  day: readonly StockStep[]
}
type StockStep =
  | {
      kind: "stay"
      from: number
      to: number
      at: readonly [number, number, number]
      facing: number
      routine?: RoutineAt
    }
  | { kind: "walk"; from: number; to: number; carry?: string }

/**
 * The stocks the townsfolk's days fill (planned with them, in the worker): by each worker's spot, the
 * routine's stock in its frame (a basket, the ore cart and the heap at its rail's end, planks, bars,
 * crates, the arrows in the butts); a woodcutter's pile where their carry walks end; a stall's fish
 * where a fisher's basket is set down. One per spot and kind, fed by every stay there.
 */
export function planStocks(folk: readonly StockFolk[]): Stock[] {
  const out: Stock[] = []
  const byKey = new Map<string, Stock>()
  const add = (key: string, make: () => Stock): Stock => {
    let s = byKey.get(key)
    if (!s) {
      s = make()
      byKey.set(key, s)
      out.push(s)
    }
    return s
  }
  const world = (
    st: { at: readonly [number, number, number]; facing: number },
    x: number,
    z: number,
  ): [number, number, number] => {
    const [wx, wz] = spotFrame(st.at[0], st.at[2], st.facing, x, z)
    return [wx, st.at[1], wz]
  }
  for (const f of folk) {
    const n = f.day.length
    for (const [k, s] of f.day.entries()) {
      if (s.kind === "walk") {
        const next = f.day[(k + 1) % n]
        if (!s.carry || next?.kind !== "stay") continue
        if (s.carry === PROPS.log) {
          // the pile half a metre on from where they stand to lay a log on it
          const pile = add(`pile:${f.id}:${next.at.join()}`, () => ({
            folk: f.id,
            kind: "log-pile",
            at: world(next, 0, 0.55),
            facing: next.facing,
            cap: 40,
            piece: PROPS.log,
            feeds: [],
            arrivals: [],
            since: STOCK_DAY,
          }))
          pile.arrivals!.push(s.to)
        } else if (s.carry === PROPS.basket) {
          const stall = add(`stall:${next.at.join()}`, () => ({
            folk: -1,
            kind: "stall-fish",
            at: world(next, 0, 0.6),
            facing: next.facing,
            cap: 4,
            piece: PROPS.basket,
            feeds: [],
            arrivals: [],
            since: STOCK_DAY,
          }))
          stall.arrivals!.push(s.to)
          // the basket goes with them: their own is empty from when they set off
          for (const b of out)
            if (b.folk === f.id && b.kind === "basket") b.takes = [...(b.takes ?? []), s.from]
        }
        continue
      }
      const id = s.routine?.id
      const spec = id ? ROUTINES[id]?.stock : undefined
      if (!spec || !s.routine) continue
      const st = add(`${spec.kind}:${s.at.join()}`, () => {
        const made: Stock = {
          folk: f.id,
          kind: spec.kind,
          at: world(s, spec.at[0], spec.at[1]),
          facing: s.facing,
          cap: spec.cap,
          piece: spec.piece,
          feeds: [],
          since: STOCK_DAY,
        }
        if (spec.rail) made.rail = world(s, spec.rail[0], spec.rail[1])
        return made
      })
      st.feeds.push({ from: s.from, to: s.to, routine: s.routine })
      // a cart tips into a heap at its rail's end
      if (spec.rail) {
        const rail = spec.rail
        const heap = add(`heap:${s.at.join()}`, () => ({
          folk: f.id,
          kind: "ore-heap",
          at: world(s, rail[0], rail[1] - 0.6),
          facing: s.facing,
          cap: 90,
          piece: spec.piece,
          feeds: [],
          since: STOCK_DAY,
        }))
        heap.feeds.push({ from: s.from, to: s.to, routine: s.routine })
      }
    }
  }
  for (const s of out) {
    s.takes?.sort((a, b) => a - b)
    s.arrivals?.sort((a, b) => a - b)
  }
  return out
}
