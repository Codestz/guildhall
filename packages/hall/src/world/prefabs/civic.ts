import type { Prefab } from "./types.ts"

/**
 * A civic centre for each size of island (gen/dress/civic.ts picks by tier), in the land pack's blue,
 * as its landmarks are. The district venues are venues.ts'.
 */

export const CIVIC: readonly Prefab[] = [
  {
    id: "inn",
    label: "Inn",
    kind: "civic",
    rings: 0,
    parts: [
      { piece: "building_tavern_blue", x: 0, z: -0.4 },
      { piece: "barrel", x: 3.5, z: 2.8, rot: 0.5 },
      { piece: "barrel", x: 4.1, z: 2, rot: 1.3 },
      { piece: "crate_open", x: -3.4, z: 3, rot: -0.4 },
      { piece: "flag_blue", x: -3.8, z: -0.5 },
    ],
    doors: [{ x: 0, z: 3.4, rot: 0 }],
    variation: {
      mirror: true,
      swaps: { flag_blue: ["flag_red", "flag_yellow"] },
      props: [
        { piece: "wheelbarrow", x: 3.9, z: 0.2, rot: 1.9, chance: 0.4 },
        { piece: "crate_A_big", x: -4.2, z: 1.4, rot: 0.3, chance: 0.45 },
        { piece: "sack", x: 3.4, z: 3.9, rot: 0.8, chance: 0.4 },
        { piece: "resource_lumber", x: 3.7, z: -1.6, rot: 1.6, scale: 0.8, chance: 0.4 },
      ],
    },
  },
  {
    id: "guildhouse",
    label: "Guildhouse",
    kind: "civic",
    rings: 0,
    parts: [
      { piece: "building_church_blue", x: 0, z: -0.3 },
      { piece: "flag_blue", x: -3.4, z: 2.6 },
      { piece: "flag_blue", x: 3.4, z: 2.6 },
      { piece: "bucket_water", x: 2.4, z: 3.6 },
    ],
    doors: [{ x: 0, z: 3.4, rot: 0 }],
  },
  {
    id: "town-hall",
    label: "Town hall",
    kind: "civic",
    rings: 1,
    parts: [
      { piece: "building_barracks_blue", x: 0, z: -1 },
      { piece: "building_tower_base_blue", x: -6.4, z: -1.2 },
      { piece: "building_tower_base_blue", x: 6.4, z: -1.2 },
      { piece: "flag_blue", x: -2.6, z: 4 },
      { piece: "flag_blue", x: 2.6, z: 4 },
    ],
    doors: [{ x: 0, z: 4.2, rot: 0 }],
  },
  {
    id: "castle",
    label: "Castle",
    kind: "civic",
    rings: 1,
    parts: [
      { piece: "building_castle_blue", x: 0, z: -0.5 },
      { piece: "building_tower_B_blue", x: -9, z: 1.5 },
      { piece: "building_tower_B_blue", x: 9, z: 1.5 },
      { piece: "flag_blue", x: -3.2, z: 6.6 },
      { piece: "flag_blue", x: 3.2, z: 6.6 },
    ],
    doors: [{ x: 0, z: 7, rot: 0 }],
  },
]
