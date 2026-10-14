/**
 * The work FX's kinds (pure, worker-safe): what each burst is (how many particles, how long the longest
 * lives), and which burst a life beat makes (`beatKinds`). The vertex shader (shader.ts) draws each kind
 * from these same ids; the motion itself lives only there.
 */

export const WORK_KINDS = [
  "sparks",
  "chips",
  "stone",
  "splash",
  "ring",
  "dust",
  "pages",
  "motes",
  "glint",
  "steam",
  "shoot",
  "pin",
  "cheer",
] as const
export type WorkKind = (typeof WORK_KINDS)[number]

export interface KindSpec {
  /** The shader's id. */
  id: number
  /** Particles in a burst (`scale` multiplies it a little, never past `MAX_BURST`). */
  count: number
  /** Seconds the longest of them lives (the slot is free after this). */
  life: number
}

export const KIND: Record<WorkKind, KindSpec> = {
  // an anvil's hammer: short bright streaks, up and out, falling
  sparks: { id: 0, count: 12, life: 0.6 },
  // an axe in a log: pale flakes tumbling out and down
  chips: { id: 1, count: 9, life: 0.9 },
  // a pick in rock: grey chips, quicker, fewer
  stone: { id: 2, count: 8, life: 0.8 },
  // a catch or a cast: droplets up and back into the water (a ring goes with it)
  splash: { id: 3, count: 12, life: 0.9 },
  // a ring spreading on the water
  ring: { id: 4, count: 1, life: 1.2 },
  // a puff of dust at the foot (a load set down, a scaffold done)
  dust: { id: 5, count: 7, life: 1.3 },
  // a page or two lifted and fluttering down (a scholar's desk)
  pages: { id: 6, count: 3, life: 1.8 },
  // motes of light rising and turning (a spell, a shrine)
  motes: { id: 7, count: 10, life: 1.6 },
  // a coin's glint: a star that flares and goes
  glint: { id: 8, count: 1, life: 0.45 },
  // steam off a quenched blade: soft puffs rising and growing
  steam: { id: 9, count: 8, life: 1.8 },
  // a flight of arrows into the target: streaks that land and stand a moment (hero beat `shoot`)
  shoot: { id: 10, count: 3, life: 1.2 },
  // sheets of paper fluttering onto the notice board and staying put a moment (hero beat `pin`)
  pin: { id: 11, count: 3, life: 2.2 },
  // a small burst of confetti and glints, thrown up and fluttering down (hero beat `cheer`)
  cheer: { id: 12, count: 14, life: 1.6 },
}

/** The most particles one emit takes. */
export const MAX_BURST = 16

/** A life beat's sample (the shared shape: `{ clip, phase, props, beat }`), what `beatKinds` reads. */
export interface BeatSample {
  clip?: string
  props?: readonly string[]
}

const has = (sample: BeatSample | undefined, re: RegExp) =>
  re.test(sample?.clip ?? "") || (sample?.props ?? []).some((p) => re.test(p))

const SMITH = /anvil|hammer|smith|forge|tongs/i
const WOOD = /axe|chop|wood|log|saw|lumber/i
const STONE = /pick|mine|dig|stone|rock|chisel|mason/i
const WATER = /rod|fish|net|harpoon|bucket|water/i
const MAGIC = /staff|wand|spell|magic|orb|crystal/i
const BOOK = /book|scroll|page|quill|read|write|desk/i

/**
 * The bursts a beat makes, from its name and what the worker holds (`sample`): a hit at an anvil
 * sparks, with an axe chips, with a pick stone; a cast with a rod rings the water (with a staff, motes);
 * a catch splashes; a quench steams; a pickup or a set-down puffs dust; a page turns; a coin glints. A
 * kind's own name is a beat too. Unknown beats make nothing.
 */
export function beatKinds(beat: string, sample?: BeatSample): WorkKind[] {
  if ((WORK_KINDS as readonly string[]).includes(beat))
    return beat === "splash" ? ["splash", "ring"] : [beat as WorkKind]
  switch (beat) {
    case "hit":
    case "strike":
    case "hammer":
      if (has(sample, SMITH)) return ["sparks"]
      // a pickaxe is a pick, not an axe
      if (has(sample, STONE)) return ["stone"]
      if (has(sample, WOOD)) return ["chips"]
      return ["dust"]
    case "chop":
      return ["chips"]
    case "dig":
      return ["stone"]
    case "cast":
      if (has(sample, MAGIC) || !has(sample, WATER)) return ["motes"]
      return ["ring"]
    case "catch":
    case "reel":
      return ["splash", "ring"]
    case "throw":
      return has(sample, WATER) ? ["splash", "ring"] : ["dust"]
    case "quench":
      return ["steam"]
    case "pickup":
    case "drop":
    case "set":
    case "land":
      return ["dust"]
    case "page":
    case "read":
    case "write":
      return ["pages"]
    case "coin":
    case "pay":
    case "sell":
    case "loot":
      return ["glint"]
    case "spell":
    case "pray":
      return ["motes"]
    case "turn":
      return has(sample, BOOK) ? ["pages"] : []
    default:
      return []
  }
}
