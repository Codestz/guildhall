/**
 * Nature vignettes: small authored scenes, kept as data, that nature stamps where they belong (forest
 * edges, glades, meadows, shores, road bends) at a seeded turn and size. A vignette names slots, not
 * catalog ids, so it reads against whatever the library holds; a slot the library lacks is left out.
 * The shape follows the composer's dressing (`x`, `z` in metres, `rot`, `scale` per piece, +z front);
 * they live in code until the prefab schema has a nature kind.
 */

/** What a vignette piece (or a scattered plant) is, before the library turns it into an id. */
export const SLOTS = [
  "tree",
  "pine",
  "birch",
  "willow",
  "bush",
  "grass",
  "reed",
  "flower",
  "mushroom",
  "rock",
  "boulder",
  "stone",
  "log",
  "stump",
] as const
export type Slot = (typeof SLOTS)[number]

/** Where a vignette may stand. */
export type Setting = "core" | "edge" | "fringe" | "meadow" | "shore" | "glade" | "bend" | "rough"

export interface VignettePiece {
  slot: Slot
  x: number
  z: number
  /** Radians, added to the vignette's own turn; omitted: any turn. */
  rot?: number
  scale?: number
}

export interface Vignette {
  id: string
  /** Settings it suits, with the chance per site of it being chosen there (summed per setting ≤ 1). */
  where: Partial<Record<Setting, number>>
  pieces: VignettePiece[]
}

/** Flowers round a centre at radius r: a ring, the start turned so rings differ. */
const ring = (slot: Slot, count: number, r: number, start = 0): VignettePiece[] =>
  Array.from({ length: count }, (_, k) => {
    const a = start + (2 * Math.PI * k) / count
    return { slot, x: round2(r * Math.cos(a)), z: round2(r * Math.sin(a)), scale: 0.9 + 0.05 * (k % 3) }
  })
const round2 = (x: number) => Math.round(x * 100) / 100

export const VIGNETTES: readonly Vignette[] = [
  {
    id: "boulders",
    where: { edge: 0.07, fringe: 0.05, bend: 0.6, rough: 0.2 },
    pieces: [
      { slot: "boulder", x: 0, z: 0, scale: 1 },
      { slot: "rock", x: 1.9, z: 0.7, scale: 0.75 },
      { slot: "rock", x: -1.3, z: 1.5, scale: 0.6 },
      { slot: "bush", x: 0.5, z: -2, scale: 0.9 },
      { slot: "grass", x: 1.2, z: 1.9 },
      { slot: "flower", x: -1.7, z: -1.1 },
      { slot: "flower", x: 2.3, z: -1.2 },
    ],
  },
  {
    id: "deadfall",
    where: { core: 0.1, edge: 0.04 },
    pieces: [
      { slot: "log", x: 0, z: 0, rot: 0 },
      { slot: "mushroom", x: 0.8, z: 1, scale: 1 },
      { slot: "mushroom", x: 1.3, z: 0.5, scale: 0.8 },
      { slot: "stump", x: -2.3, z: 0.9 },
      { slot: "mushroom", x: -2.7, z: 1.8, scale: 0.9 },
      { slot: "grass", x: -1, z: -1.2 },
      { slot: "bush", x: 2.2, z: -1.4, scale: 0.8 },
    ],
  },
  {
    id: "old-tree",
    where: { meadow: 0.01, fringe: 0.03 },
    pieces: [
      { slot: "tree", x: 0, z: 0, scale: 1.4 },
      ...ring("flower", 7, 3.4, 0.3),
      { slot: "grass", x: 2.2, z: 2.6 },
      { slot: "grass", x: -2.8, z: -1.6 },
    ],
  },
  {
    id: "outcrop",
    where: { rough: 0.25, edge: 0.03 },
    pieces: [
      { slot: "boulder", x: 0, z: 0, scale: 1.3 },
      { slot: "boulder", x: 2.4, z: 1.1, scale: 0.85 },
      { slot: "rock", x: -2, z: -0.7, scale: 0.9 },
      { slot: "rock", x: 0.8, z: -1.9, scale: 0.6 },
      { slot: "pine", x: -3.4, z: 2.4, scale: 1 },
      { slot: "pine", x: 3.8, z: -2.6, scale: 0.85 },
      { slot: "pine", x: 0.6, z: 4, scale: 1.1 },
      { slot: "bush", x: 1.8, z: -3.2, scale: 0.8 },
    ],
  },
  {
    id: "shore-stones",
    where: { shore: 0.35 },
    pieces: [
      { slot: "stone", x: 0, z: 0 },
      { slot: "stone", x: 1.7, z: 0.8, scale: 0.8 },
      { slot: "rock", x: -1.5, z: 0.4, scale: 0.7 },
      { slot: "rock", x: 0.4, z: 1.9, scale: 0.55 },
      { slot: "grass", x: 0.6, z: -1.3 },
      { slot: "reed", x: -0.6, z: -1.5 },
    ],
  },
  {
    id: "reed-bed",
    where: { shore: 0.15 },
    pieces: [
      { slot: "reed", x: 0, z: 0 },
      { slot: "reed", x: 0.9, z: 0.5 },
      { slot: "reed", x: -0.8, z: 0.7 },
      { slot: "reed", x: 0.3, z: -0.9 },
      { slot: "reed", x: 1.6, z: -0.4 },
      { slot: "stone", x: -1.6, z: -0.6, scale: 0.7 },
      { slot: "grass", x: -0.5, z: 1.7 },
    ],
  },
  {
    id: "thicket",
    where: { edge: 0.16, fringe: 0.04 },
    pieces: [
      { slot: "bush", x: 0, z: 0, scale: 1.1 },
      { slot: "bush", x: 1.5, z: 0.9, scale: 0.9 },
      { slot: "bush", x: -1.3, z: 1.1, scale: 0.8 },
      { slot: "tree", x: 0.3, z: -2.7, scale: 0.65 },
      { slot: "grass", x: -1.9, z: -1 },
      { slot: "flower", x: 2.2, z: -0.9 },
    ],
  },
  {
    id: "glade-ring",
    where: { glade: 1 },
    pieces: [
      { slot: "stump", x: 0, z: 0 },
      ...ring("flower", 6, 2.4),
      { slot: "grass", x: 3.2, z: 0.8 },
      { slot: "grass", x: -2.9, z: -1.4 },
      { slot: "mushroom", x: 0.7, z: 0.6, scale: 0.8 },
    ],
  },
  {
    id: "mushroom-ring",
    where: { core: 0.06 },
    pieces: [...ring("mushroom", 7, 1.3), { slot: "grass", x: 0, z: 0 }],
  },
  {
    id: "berry-bank",
    where: { fringe: 0.05, edge: 0.05 },
    pieces: [
      { slot: "bush", x: -1.6, z: 0, scale: 0.9 },
      { slot: "bush", x: 0, z: 0.3, scale: 1 },
      { slot: "bush", x: 1.6, z: -0.1, scale: 0.85 },
      { slot: "flower", x: -0.8, z: -1.3 },
      { slot: "flower", x: 0.9, z: -1.4 },
      { slot: "flower", x: 2.6, z: 1 },
      { slot: "rock", x: -2.9, z: 0.9, scale: 0.6 },
    ],
  },
  {
    id: "copse",
    where: { fringe: 0.04, meadow: 0.006 },
    pieces: [
      { slot: "birch", x: 0, z: 0, scale: 1.05 },
      { slot: "birch", x: 2.3, z: 1.2, scale: 0.85 },
      { slot: "birch", x: -1.4, z: 2.2, scale: 0.75 },
      { slot: "grass", x: 1, z: -1.6 },
      { slot: "flower", x: -1.8, z: -0.8 },
    ],
  },
  {
    id: "standing-stone",
    where: { meadow: 0.004, rough: 0.05 },
    pieces: [
      { slot: "boulder", x: 0, z: 0, scale: 1.7 },
      { slot: "grass", x: 1.6, z: 0.9 },
      { slot: "grass", x: -1.3, z: -1.2 },
      { slot: "flower", x: 0.4, z: -1.9 },
    ],
  },
]

/** The vignette a site in `setting` gets for draw `u` in [0, 1), or none (most sites stay plain). */
export function vignetteFor(setting: Setting, u: number): Vignette | null {
  let sum = 0
  for (const v of VIGNETTES) {
    sum += v.where[setting] ?? 0
    if (u < sum) return v
  }
  return null
}
