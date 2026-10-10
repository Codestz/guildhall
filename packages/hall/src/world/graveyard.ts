import { DMath } from "./dmath.ts"
import type BOUNDS from "./graveyard.json"
import { GRAVEYARD_PLOT } from "./lands.ts"

/**
 * The graveyard, as data (roadmap G2): KayKit Halloween Bits (graveyard.glb) laid out on the plot
 * `lands.ts` reserves for it. A fence round it with the arch gate onto the avenue, the crypt at the
 * back, a path from the gate to the crypt's door, rows of graves on dirt, dead trees, lanterns,
 * candles and a few bones. Everything is static: scene/Graveyard merges it into two meshes.
 *
 * `graves` are where the undead rise (guild/undead.ts): on each grave's dirt, facing the gate.
 * `glows` join the island's night lights (world/lights.ts GLOWS): halos and ground pools.
 */

export type GravePiece = keyof typeof BOUNDS

export interface GravePlacement {
  piece: GravePiece
  x: number
  z: number
  /** Height of its origin above the turf (the dirt sits just on it). */
  y?: number
  rot?: number
  scale?: number
  /** Stretch along the piece's own x: fence runs fit their side exactly. */
  stretch?: number
}

/** A grave the undead can rise from: the middle of its dirt, and which way they face. */
export interface Grave {
  x: number
  z: number
  rot: number
}

/** A flame that glows at night (world/lights.ts `Glow`). */
export interface Flame {
  flame: readonly [x: number, y: number, z: number]
  halo: number
  pool: number
}

const { x0, x1, z0, z1, gate } = GRAVEYARD_PLOT
/** Facing east (+x): towards the gate, the avenue and the default camera's side. */
const EAST = Math.PI / 2
/** Half the arch's opening in the east fence. */
const GATE_HALF = 2.2
const CRYPT_SCALE = 0.75
/** A grave's dirt lies this far in front of (east of) its headstone. */
const DIRT_OFFSET = 1.4
const DIRT_SCALE = 0.55
/** The hex turf sits a touch above y = 0: the dirt's top would hide under it. */
const DIRT_LIFT = 0.06

const pieces: GravePlacement[] = []
const put = (piece: GravePiece, x: number, z: number, rot = 0, scale?: number): void => {
  pieces.push({ piece, x, z, rot, ...(scale ? { scale } : {}) })
}

/** A fence from a to b (along x or z): whole pieces stretched to fit, a pillar at every joint. */
function fence(a: readonly [number, number], b: readonly [number, number], broken: readonly number[] = []) {
  const length = DMath.hypot(b[0] - a[0], b[1] - a[1])
  const n = Math.max(1, Math.round(length / 4))
  const rot = Math.abs(b[0] - a[0]) > Math.abs(b[1] - a[1]) ? 0 : EAST
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n
    pieces.push({
      piece: broken.includes(i) ? "fence_broken" : "fence",
      x: a[0] + (b[0] - a[0]) * t,
      z: a[1] + (b[1] - a[1]) * t,
      rot,
      stretch: length / n / 4,
    })
  }
  for (let i = 0; i <= n; i++)
    put("fence_pillar", a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n)
}

fence([x0, z0], [x1, z0])
fence([x0, z1], [x1, z1], [2])
fence([x0, z0], [x0, z1], [1])
fence([x1, z0], [x1, gate - GATE_HALF])
fence([x1, gate + GATE_HALF], [x1, z1])
put("arch_gate", x1, gate, EAST)

// The crypt at the back, its door on the path.
put("crypt", x0 + 3.6, gate, EAST, CRYPT_SCALE)
// The path: in from the avenue's verge, through the arch, up to the crypt's door.
for (let i = 0, x = -3.9; x > x0 + 3.6 + 3; i++, x -= 1.9) put(i % 2 ? "path_B" : "path_A", x, gate, i * EAST)

/**
 * Graves, headstone west and dirt east, in rows either side of the path; the order is the order
 * they fill: the south rows first, nearest the default camera (south-east), so the first risers
 * aren't behind the arch.
 */
const HEADS: readonly (readonly [x: number, z: number])[] = [
  [-10.2, 54.2],
  [-14.2, 54.2],
  [-10.2, 57.4],
  [-14.2, 57.4],
  [-14.2, 47.8],
  [-10.2, 47.8],
  [-14.2, 44.6],
  [-10.2, 44.6],
  [-20.4, 57.4],
  [-20.4, 44.6],
]
const STONES: readonly GravePiece[] = [
  "grave_A",
  "gravestone",
  "grave_B",
  "gravemarker_A",
  "grave_A_destroyed",
  "grave_B",
  "gravemarker_B",
  "grave_A",
  "gravestone",
  "grave_A_destroyed",
]
const graves: Grave[] = HEADS.map(([x, z], i) => {
  put(STONES[i] ?? "grave_A", x, z, EAST)
  pieces.push({ piece: "floor_dirt_grave", x: x + DIRT_OFFSET, z, y: DIRT_LIFT, scale: DIRT_SCALE })
  return { x: x + DIRT_OFFSET, z, rot: EAST }
})

// Mood: dead trees, coffins by the crypt, a shrine, bones, pumpkins at the gate.
put("tree_dead_large", -20.3, 47.3, 0.4)
put("tree_dead_medium", -16.5, 59, 2.6)
put("tree_dead_small", -7, 59.2, -0.5)
put("coffin_decorated", -17.4, 47.2, EAST)
put("coffin", -18.6, 55.1, EAST)
put("shrine_candles", -16.4, 54.4, EAST)
put("bone_A", -11.5, 46.2, 0.7)
put("bone_B", -15.9, 57.6, 2.1)
put("skull", -7, 46.1, -0.6)
put("skull", -7, 56, 0.9)
put("ribcage", -21, 59.1, 1.2)
put("pumpkin_orange_jackolantern", -4.5, 46.2, EAST)
put("pumpkin_orange_small", -4.9, 55.6, 0.3)

// Lights: lanterns on posts either side of the gate (arms over the path), lanterns at the crypt's
// door, candles on the graves and the shrine.
const lights: Flame[] = []
const light = (flame: Flame["flame"], halo: number, pool: number) => lights.push({ flame, halo, pool })
put("post_lantern", -4.6, gate - 2.8, 0)
put("post_lantern", -4.6, gate + 2.8, Math.PI)
light([-4.6, 2.05, gate - 2.8 + 1], 3, 4.6)
light([-4.6, 2.05, gate + 2.8 - 1], 3, 4.6)
const LANTERN = 1.2
put("lantern_standing", -14.9, gate - 1.6, EAST, LANTERN)
put("lantern_standing", -14.9, gate + 1.6, EAST, LANTERN)
light([-14.9, 0.55 * LANTERN, gate - 1.6], 2.2, 3.2)
light([-14.9, 0.55 * LANTERN, gate + 1.6], 2.2, 3.2)
put("candle_triple", -9.6, 49.4, 0.3)
put("candle_triple", -12.4, 52.8, 1.9)
light([-9.6, 0.7, 49.4], 1.4, 1.8)
light([-12.4, 0.7, 52.8], 1.4, 1.8)
light([-16.4, 1.45, 54.4], 1.8, 2.5)
light([-4.5, 0.6, 46.2], 1.3, 1.8)

export const GRAVEYARD: {
  readonly pieces: readonly GravePlacement[]
  readonly graves: readonly Grave[]
  readonly glows: readonly Flame[]
  /** Above the crypt's door: where a count of the fallen without a grave is shown. */
  readonly plaque: readonly [x: number, y: number, z: number]
} = {
  pieces,
  graves,
  glows: lights,
  plaque: [x0 + 3.6 + 3 * CRYPT_SCALE * 1.1, 6.6, gate],
}

/** Ground pieces nobody would miss in the shadow map: dirt, path, bones. */
export function castsShadow(piece: GravePiece): boolean {
  return !/^(floor_|path_|bone_|skull|ribcage|candle|pumpkin_orange_small)/.test(piece)
}

/** The ground the graveyard covers, plot and gate apron (for tests and other layers' clearances). */
export const GRAVEYARD_REACH = { x0: x0 - 0.5, x1: -2.9, z0: z0 - 0.5, z1: z1 + 0.5 } as const
