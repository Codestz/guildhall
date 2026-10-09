import type { Prefab } from "./types.ts"

/**
 * The lookout a trail ends at (world/gen/relief/trails.ts): a cairn of three stacked rocks with a
 * flag on top, a couple of boulders about it. It stands on the mountain's own ground, not a hex,
 * so it is placed by the trail (world/world.ts) at its end, turned to face the way the trail comes up.
 */
export const LOOKOUTS: readonly Prefab[] = [
  {
    id: "lookout",
    label: "Lookout cairn",
    kind: "civic",
    rings: 0,
    parts: [
      { piece: "rock_single_E", x: 0, z: 0, scale: 1.7 },
      { piece: "rock_single_C", x: 0.1, z: -0.1, y: 1.5, rot: 0.8, scale: 1.2 },
      { piece: "rock_single_B", x: -0.05, z: 0, y: 2.55, rot: 2.1, scale: 0.95 },
      { piece: "flag_yellow", x: 0, z: 0.1, y: 3.1, rot: 0.3, scale: 2.2 },
      { piece: "rock_single_D", x: 2.5, z: 1.4, rot: 0.6, scale: 1.1 },
      { piece: "rock_single_A", x: -2.4, z: 1.9, rot: 1.9, scale: 1.3 },
    ],
    doors: [],
  },
]
