import type { Prefab } from "./types.ts"

/**
 * The lookout a trail ends at (world/gen/relief/trails.ts): a flag on the flat top of the summit's
 * ledge, nothing else (the mountain is boxes of stone, and a heap of rounded kit rocks would be a
 * shape of its own). It stands on the mountain's own ground, not a hex, so it is placed by the trail
 * (world/world.ts) at its end, turned to face the way the trail comes up.
 */
export const LOOKOUTS: readonly Prefab[] = [
  {
    id: "lookout",
    label: "Lookout flag",
    kind: "civic",
    rings: 0,
    parts: [{ piece: "flag_yellow", x: 0, z: 0, rot: 0.3, scale: 3.2 }],
    doors: [],
  },
]
