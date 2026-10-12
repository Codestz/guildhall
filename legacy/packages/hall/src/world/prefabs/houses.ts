import type { Prefab } from "./types.ts"

/**
 * Homes and what stands in the square. The homes are the pack's two (`building_home_A` a cottage,
 * `_B` two storeys), 4 × 4.3 and 4.4 × 5.5 world units, so one to three fit a 10-unit hex; they come
 * in the district's four colours (`{kit}`).
 *
 * Each varies by seed (types.ts `Variation`): the roof's team colour, which side things stand, and
 * the props that happen to be about (a barrow, a bucket, a tree). Seed 0 is the plain one below.
 */

const FRONT_DOOR = { x: 0, z: 3, rot: 0 } as const

/** What every home varies by itself: the roof's colour and the side things stand; its props are its own. */
const LOOK = { tint: true, mirror: true } as const

export const HOUSES: readonly Prefab[] = [
  {
    id: "house-cottage",
    label: "Cottage",
    kind: "house",
    rings: 0,
    houses: 1,
    parts: [
      { piece: "building_home_A_{kit}", x: 0, z: -0.3 },
      { piece: "barrel", x: 2.9, z: 2.6, rot: 0.6 },
      { piece: "crate_A_small", x: -2.8, z: 2.7, rot: -0.3 },
    ],
    doors: [FRONT_DOOR],
    variation: {
      ...LOOK,
      props: [
        { piece: "wheelbarrow", x: -3.4, z: 0.4, rot: 1.2, chance: 0.4 },
        { piece: "bucket_water", x: 3.2, z: 0.9, chance: 0.5 },
        { piece: "tree_single_B", x: -2, z: -2.4, chance: 0.4 },
        { piece: "resource_lumber", x: 3.2, z: -2.4, rot: 1.6, scale: 0.8, chance: 0.35 },
      ],
    },
  },
  {
    id: "house-townhouse",
    label: "Two-storey house",
    kind: "house",
    rings: 0,
    houses: 1,
    parts: [
      { piece: "building_home_B_{kit}", x: 0, z: -0.4 },
      { piece: "bucket_water", x: 2.8, z: 3.3 },
    ],
    doors: [{ x: 0, z: 3.4, rot: 0 }],
    variation: {
      ...LOOK,
      props: [
        { piece: "barrel", x: -3, z: 2.9, rot: 0.3, chance: 0.5 },
        { piece: "crate_A_small", x: 3.2, z: 2.2, rot: -0.4, chance: 0.5 },
        { piece: "sack", x: -2.9, z: 3.9, rot: 1.1, chance: 0.4 },
        { piece: "tree_single_A", x: -2.2, z: -2.3, chance: 0.35 },
      ],
    },
  },
  {
    id: "house-row",
    label: "Row house",
    kind: "house",
    rings: 0,
    houses: 2,
    parts: [
      { piece: "building_home_A_{kit}", x: -2.3, z: -0.4 },
      { piece: "building_home_B_{kit}", x: 2.5, z: -0.4 },
    ],
    doors: [
      { x: -2.3, z: 2.6, rot: 0 },
      { x: 2.5, z: 3.2, rot: 0 },
    ],
    variation: {
      ...LOOK,
      props: [
        { piece: "barrel", x: 0.1, z: 3.6, rot: 0.5, chance: 0.5 },
        { piece: "bucket_water", x: -3.6, z: 3.2, chance: 0.4 },
        { piece: "crate_A_small", x: 3.9, z: 3.4, rot: 0.2, chance: 0.4 },
      ],
    },
  },
  {
    id: "house-trio",
    label: "Three homes",
    kind: "house",
    rings: 0,
    houses: 3,
    parts: [
      { piece: "building_home_A_{kit}", x: -2.3, z: -1.5 },
      { piece: "building_home_A_{kit}", x: 2.3, z: -1.5 },
      { piece: "building_home_A_{kit}", x: 0, z: 2.9 },
    ],
    doors: [
      { x: -2.3, z: 1.5, rot: 0 },
      { x: 2.3, z: 1.5, rot: 0 },
      { x: 0, z: 5, rot: 0 },
    ],
    variation: {
      ...LOOK,
      props: [
        { piece: "wheelbarrow", x: 3.7, z: 2.6, rot: 2.2, chance: 0.4 },
        { piece: "barrel", x: -3.8, z: 3, chance: 0.4 },
        { piece: "bucket_water", x: -1.1, z: 5.1, chance: 0.35 },
      ],
    },
  },
  {
    id: "house-farmhouse",
    label: "Farmhouse",
    kind: "house",
    rings: 0,
    houses: 1,
    parts: [
      { piece: "building_home_B_{kit}", x: -1.4, z: -1.2, rot: 0.15 },
      { piece: "wheelbarrow", x: 2.8, z: 1.8, rot: 1.2 },
      { piece: "sack", x: 1.3, z: 3.2 },
      { piece: "sack", x: 1.9, z: 3.5, rot: 0.8 },
      { piece: "crate_A_big", x: 3.4, z: -0.8 },
      { piece: "tree_single_A", x: 2.4, z: -2.6 },
    ],
    doors: [{ x: -1.4, z: 2.4, rot: 0.15 }],
    variation: {
      ...LOOK,
      props: [
        { piece: "barrel", x: 3.7, z: 0.4, rot: 0.7, chance: 0.5 },
        { piece: "bucket_water", x: -3.4, z: 2.6, chance: 0.45 },
        { piece: "pallet", x: 0.9, z: 4.4, rot: 0.2, chance: 0.4 },
      ],
    },
  },
]

export const SQUARES: readonly Prefab[] = [
  {
    id: "plaza-well",
    label: "Well plaza",
    kind: "plaza",
    rings: 0,
    parts: [
      { piece: "building_well_blue", x: 0, z: 0 },
      { piece: "bucket_water", x: 1.9, z: 1.2 },
      { piece: "barrel", x: -3.6, z: -2.4, rot: 0.4 },
      { piece: "crate_A_big", x: 3.7, z: -2.2, rot: -0.5 },
      { piece: "sack", x: -3.5, z: 2.6, rot: 2 },
      { piece: "flag_blue", x: 4.2, z: 2.4 },
      { piece: "flag_blue", x: -4.2, z: -0.4 },
    ],
    doors: [],
  },
  {
    id: "market-stalls",
    label: "Market stalls",
    kind: "market",
    rings: 0,
    parts: [
      { piece: "building_market_red", x: 0, z: 0.2 },
      { piece: "crate_A_big", x: -3.2, z: 3.9, rot: 0.3 },
      { piece: "crate_B_big", x: -2.1, z: 4.3, rot: -0.2 },
      { piece: "barrel", x: 2.6, z: 4.1, rot: 0.9 },
      { piece: "sack", x: 3.4, z: 3.9, rot: 2.2 },
      { piece: "wheelbarrow", x: 0.3, z: 4.3, rot: 1.6 },
    ],
    doors: [],
    variation: {
      mirror: true,
      swaps: { building_market_red: ["building_market_blue"] },
      props: [
        { piece: "crate_open", x: 3.9, z: 1.2, rot: 0.6, chance: 0.5 },
        { piece: "barrel", x: -3.8, z: 1.6, rot: 0.2, chance: 0.5 },
        { piece: "crate_long_A", x: 0, z: -3.6, chance: 0.4 },
      ],
    },
  },
]
