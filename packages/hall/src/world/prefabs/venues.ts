import type { Prefab } from "./types.ts"

/**
 * The district venues (world/venues.ts): a building worth walking to, with its yard, standing on a
 * district's landmark hex facing its square. Each is the land pack's own building drawn bigger than
 * its 5× (the `scale`s below) with what the trade keeps round it, all in the pack's blue.
 *
 * Every one is laid out to stand on its one hex, its body reaching a little into the hexes behind
 * and beside it and never past the front edge (z ≈ 5), where the square's paving begins; its first
 * door's spot is just there, so the step is on the road graph's side of the hex. `windows` and
 * `chimneys` are what lights and smokes while someone is inside (scene/life/Venues.tsx).
 */

export const VENUES: readonly Prefab[] = [
  {
    id: "forge",
    label: "Forge",
    kind: "venue",
    rings: 1,
    parts: [
      { piece: "building_blacksmith_blue", x: 0, z: -0.8, scale: 1.35 },
      { piece: "weaponrack", x: 4.4, z: 2.2, rot: -0.6, scale: 1.3 },
      { piece: "resource_stone", x: -5, z: 1.4, rot: 0.3, scale: 1.2 },
      { piece: "barrel", x: 5.3, z: -0.4, scale: 1.3 },
      { piece: "barrel", x: 5.5, z: 1, rot: 1.2, scale: 1.3 },
      { piece: "bucket_water", x: 3.4, z: 4.2, scale: 1.3 },
      { piece: "crate_A_big", x: -4.4, z: 4.2, rot: 0.4, scale: 1.3 },
      { piece: "wheelbarrow", x: 5, z: 4, rot: 2.6, scale: 1.2 },
      { piece: "resource_lumber", x: 4.6, z: -4.4, rot: 1.6, scale: 1.1 },
    ],
    doors: [{ x: -2.6, z: 4.4, rot: 0, depth: 4.4 }],
    windows: [
      { x: 1.7, y: 2.7, z: 2.9 },
      { x: -2.6, y: 2.4, z: 0.6 },
    ],
    chimneys: [{ x: 1.4, y: 6.6, z: -1.75 }],
  },
  {
    id: "library",
    label: "Library",
    kind: "venue",
    rings: 1,
    parts: [
      { piece: "building_church_blue", x: 2.8, z: -0.6, scale: 1.25 },
      { piece: "building_tower_A_blue", x: -3.4, z: -1.2, scale: 1.3 },
      { piece: "crate_A_big", x: -1.2, z: 3.9, rot: 0.2, scale: 1.2 },
      { piece: "book_set", x: -1.2, y: 1.3, z: 3.9, rot: 0.3, scale: 0.35 },
      { piece: "crate_open", x: 5.6, z: 3.8, rot: -0.4 },
      { piece: "book_set", x: 5.9, y: 0.5, z: 3.9, rot: 0.5, scale: 0.35 },
      { piece: "flag_blue", x: 0.4, z: 4.6 },
      { piece: "bucket_water", x: -5.6, z: 3.2 },
    ],
    doors: [{ x: 2.8, z: 4.6, rot: 0, depth: 1.6 }],
    windows: [
      { x: -3.4, y: 3, z: 3 },
      { x: 2.8, y: 3, z: 3.4 },
    ],
  },
  {
    id: "tavern",
    label: "Tavern",
    kind: "venue",
    rings: 1,
    parts: [
      { piece: "building_tavern_blue", x: 0, z: -0.4, scale: 1.3 },
      { piece: "table_long", x: -5.3, z: 2, rot: 0, scale: 0.24 },
      { piece: "stool", x: -6.7, z: 1, scale: 0.3 },
      { piece: "stool", x: -6.7, z: 3, scale: 0.3 },
      { piece: "stool", x: -3.9, z: 1.2, scale: 0.3 },
      { piece: "table_long", x: 5.3, z: 2, rot: 0, scale: 0.24 },
      { piece: "stool", x: 6.7, z: 1, scale: 0.3 },
      { piece: "stool", x: 6.7, z: 3, scale: 0.3 },
      { piece: "barrel", x: 4.8, z: -3, scale: 1.4 },
      { piece: "barrel", x: 5.9, z: -2.4, rot: 1, scale: 1.4 },
      { piece: "crate_open", x: -4.6, z: -3.4, rot: 0.5, scale: 1.2 },
      { piece: "flag_red", x: 2.6, z: 4.6, scale: 1.4 },
    ],
    doors: [{ x: -0.9, z: 5, rot: 0, depth: 3.3, y: 1 }],
    windows: [
      { x: -0.9, y: 2, z: 3 },
      { x: 2.4, y: 2, z: 3 },
    ],
    chimneys: [{ x: -0.9, y: 9, z: -0.5 }],
  },
  {
    id: "mine-entrance",
    label: "Mine entrance",
    kind: "venue",
    rings: 1,
    parts: [
      { piece: "building_mine_blue", x: 0, z: -0.6, scale: 1.25 },
      { piece: "crate_long_A", x: -3.4, z: 4, rot: 1.3, scale: 1.1 },
      { piece: "wheelbarrow", x: 3.6, z: 4, rot: 0.4, scale: 1.2 },
      { piece: "resource_stone", x: 5, z: 1.4, rot: 0.6, scale: 1.2 },
      { piece: "rock_single_D", x: -5, z: 2, scale: 1.4 },
      { piece: "crate_A_big", x: -5.2, z: 4, rot: 0.8, scale: 1.2 },
    ],
    doors: [{ x: 0, z: 5.6, rot: 0, depth: 2.6 }],
    windows: [{ x: 0, y: 1.4, z: 4 }],
  },
  {
    id: "watchtower",
    label: "Watchtower",
    kind: "venue",
    rings: 1,
    parts: [
      { piece: "building_tower_A_blue", x: 0, z: -0.8, scale: 1.5 },
      { piece: "weaponrack", x: 4.2, z: 2.4, rot: -0.5, scale: 1.3 },
      { piece: "target", x: -4.6, z: 2.6, rot: 0.4, scale: 1.4 },
      { piece: "bucket_arrows", x: -3.4, z: 4.2, scale: 1.3 },
      { piece: "barrel", x: 3.8, z: 4.2, scale: 1.3 },
      { piece: "flag_blue", x: 2.8, z: 4.8, scale: 1.4 },
    ],
    doors: [{ x: 0, z: 5.2, rot: 0, depth: 1.8 }],
    windows: [
      { x: 1.5, y: 3.9, z: 3.8 },
      { x: -1.5, y: 3.9, z: 3.8 },
      { x: 1.5, y: 8, z: 3.8 },
      { x: -1.5, y: 8, z: 3.8 },
    ],
  },
  {
    id: "market-hall",
    label: "Market hall",
    kind: "venue",
    rings: 1,
    parts: [
      { piece: "building_home_B_blue", x: 0, z: -2.2, scale: 1.4 },
      { piece: "building_market_blue", x: -4.2, z: 2.6, rot: 0.3, scale: 0.62 },
      { piece: "building_market_red", x: 5.2, z: 2.6, rot: -0.3, scale: 0.62 },
      { piece: "crate_A_big", x: -5.6, z: -1, rot: 0.2, scale: 1.2 },
      { piece: "crate_B_big", x: -5.7, z: -2.4, rot: -0.3, scale: 1.2 },
      { piece: "barrel", x: 5.7, z: -0.8, scale: 1.3 },
      { piece: "sack", x: 5.2, z: -2.2, rot: 1.4, scale: 1.3 },
      { piece: "wheelbarrow", x: 0.6, z: 4.8, rot: 1.6, scale: 1.2 },
    ],
    doors: [{ x: 1.3, z: 2.6, rot: 0, depth: 1.9, y: 1 }],
    windows: [
      { x: -1.1, y: 3.2, z: 1.9 },
      { x: 1.4, y: 6.2, z: 1.9 },
    ],
    chimneys: [{ x: 1.7, y: 9, z: -2.9 }],
  },
]
