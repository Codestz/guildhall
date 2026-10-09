import type { Prefab } from "./types.ts"

/**
 * The curtain wall's modules: a straight run 10 long, the same with a gate, a tower to stand at the
 * corners and the gate's sides, and a corner piece. A run lies along x (front, +z, is the inside).
 */

export const WALLS: readonly Prefab[] = [
  {
    id: "wall-straight",
    label: "Wall segment",
    kind: "wall",
    rings: 0,
    parts: [{ piece: "wall_straight", x: 0, z: 0 }],
    doors: [],
  },
  {
    id: "wall-gate",
    label: "Wall gate",
    kind: "wall",
    rings: 0,
    parts: [{ piece: "wall_straight_gate", x: 0, z: 0 }],
    doors: [{ x: 0, z: 0, rot: 0 }],
  },
  {
    id: "wall-tower",
    label: "Wall tower",
    kind: "wall",
    rings: 0,
    parts: [
      { piece: "building_tower_B_blue", x: 0, z: 0 },
      { piece: "flag_blue", x: 0, z: 3.4 },
    ],
    doors: [],
  },
  {
    id: "wall-corner",
    label: "Wall corner",
    kind: "wall",
    rings: 1,
    parts: [{ piece: "wall_corner_A_outside", x: 0, z: 0 }],
    doors: [],
  },
]
