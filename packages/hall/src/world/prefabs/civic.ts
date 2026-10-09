import type { Prefab } from "./types.ts"

/**
 * A civic centre for each size of island (gen/dress/civic.ts picks by tier), and the stubs of the
 * district venues (forge, library, tavern, mine entrance) to be furnished later. All in the land
 * pack's blue, as its landmarks are.
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
  {
    id: "watchtower",
    label: "Watchtower",
    kind: "civic",
    rings: 0,
    parts: [
      { piece: "building_tower_A_blue", x: 0, z: -0.4 },
      { piece: "flag_blue", x: 2.9, z: 2.4 },
      { piece: "barrel", x: -2.8, z: 2.6, rot: 0.7 },
    ],
    doors: [{ x: 0, z: 3.3, rot: 0 }],
  },
  {
    id: "forge",
    label: "Forge (stub)",
    kind: "site",
    rings: 0,
    parts: [
      { piece: "building_blacksmith_blue", x: 0, z: -0.4 },
      { piece: "crate_A_small", x: 3.0, z: 3.4 },
      { piece: "resource_stone", x: -2.4, z: 3.2 },
    ],
    doors: [{ x: 0, z: 3.8, rot: 0 }],
  },
  {
    id: "library",
    label: "Library (stub)",
    kind: "site",
    rings: 0,
    parts: [
      { piece: "building_tower_A_blue", x: -2.1, z: -0.4 },
      { piece: "building_home_A_blue", x: 2.9, z: 1 },
    ],
    doors: [{ x: -2.1, z: 3, rot: 0 }],
  },
  {
    id: "tavern",
    label: "Tavern (stub)",
    kind: "site",
    rings: 0,
    parts: [
      { piece: "building_tavern_blue", x: 0, z: -0.4 },
      { piece: "barrel", x: 3.6, z: 2.6 },
    ],
    doors: [{ x: 0, z: 3.4, rot: 0 }],
  },
  {
    id: "mine-entrance",
    label: "Mine entrance (stub)",
    kind: "site",
    rings: 1,
    parts: [
      { piece: "building_mine_blue", x: 0, z: -0.4 },
      { piece: "rock_single_D", x: -2.7, z: 2.6, scale: 1.2 },
      { piece: "resource_stone", x: 2.5, z: 3 },
    ],
    doors: [{ x: 0, z: 3.4, rot: 0 }],
  },
]
