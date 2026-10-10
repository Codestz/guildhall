import { shell, stack } from "../town2.ts"
import { hex, M, S, t2 } from "./rules.ts"
import type { Composite, Group, Variant } from "./types.ts"

/**
 * The islet landmarks (S, one hex): something to find on a rock of its own. A lighthouse with its
 * keeper's hut, a shrine of four pillars under a hexagonal roof, a small fort of two towers and a gate.
 * Each fits inside a hex's corners (5.8 from its centre) so it can stand on the smallest island.
 */

const PI = Math.PI

function lighthouse(v: Variant): Group {
  const hut = v.has("hut", 0.7)
  const scale = S * v.pick("height", [1.3, 1.5, 1.15])
  const top = (1.31 + 0.46 * 3 + 0.13) * 5 * scale
  return {
    name: "Islet lighthouse",
    kids: [
      {
        name: "Tower",
        x: -0.8,
        z: -0.6,
        kids: [
          ...stack(0, 0, scale, [
            ["c_tower_hexagon_base", 1.31],
            ["c_tower_hexagon_mid", 0.46],
            ["c_tower_hexagon_mid", 0.46],
            ["c_tower_hexagon_mid", 0.46],
            ["c_tower_hexagon_top", 0.13],
            ["c_tower_hexagon_roof", 0.83],
          ]),
          t2("lantern", 0, 0, { y: top - 0.2, scale: scale * 0.7 }),
        ],
        doors: [{ x: 0, z: 2.6, rot: 0, depth: 1.2 }],
        windows: [{ x: 0, y: top + 0.6, z: 0 }],
        focal: { x: 0, y: top + 3, z: 0 },
      },
      ...(hut
        ? [
            {
              name: "Keeper's hut",
              x: 2.8,
              z: 1.8,
              scale: 0.75,
              kids: [
                ...shell(1, 1, (side) => (side === "front" ? "wall_wood_door" : "wall_wood")),
                t2("roof_gable", 0, 0, { y: M }),
                t2("chimney", 0.4, 0, { y: M * 0.9 }),
              ],
              smoke: [{ x: 0.4, y: M * 1.9 + 2, z: 0 }],
            },
          ]
        : []),
      {
        name: "Rocks",
        kids: [
          hex("rock_single_C", -3.4, 1.6, { scale: 1.3 }),
          hex("rock_single_E", 2.6, -2.2, { scale: 1.1 }),
          hex("barrel", -1.4, 3.1, { scale: 1.1 }),
        ],
      },
    ],
  }
}

function shrine(v: Variant): Group {
  const k = S * 1.3
  const lift = 5 * k * 1
  return {
    name: "Islet shrine",
    kids: [
      {
        name: "Dais",
        kids: [-0.5, 0.5].flatMap((i) =>
          [-0.5, 0.5].map((j) => t2("planks", i * M * 0.8, j * M * 0.8, { scale: S * 0.8 })),
        ),
      },
      {
        name: "Pillars",
        kids: [-1, 1].flatMap((i) => [-1, 1].map((j) => t2("pillar_stone", i * 1.6, j * 1.6, { scale: k }))),
      },
      {
        name: "Roof",
        y: lift,
        kids: [t2("c_tower_hexagon_roof", 0, 0, { scale: S * 2.3 })],
        focal: { x: 0, y: 5 * S * 2.3 * 0.83, z: 0 },
      },
      { name: "Steps", kids: [t2("c_stairs_stone", 0, 2.7, { rot: PI / 2, scale: S * 0.9 })] },
      {
        name: "Lights",
        kids: [
          t2("lantern", -2.6, 2.4, { scale: S * 0.8 }),
          t2("lantern", 2.6, 2.4, { scale: S * 0.8 }),
          hex(`flag_${v.flag}`, 0, -2.4, { scale: 2.4 }),
        ],
      },
    ],
    doors: [{ x: 0, z: 3.6, rot: 0, depth: 1 }],
  }
}

function fort(v: Variant): Group {
  return {
    name: "Islet fort",
    kids: [
      {
        name: "Towers",
        kids: [
          hex("building_tower_B_blue", -2.2, -1.8, { scale: 0.6 }),
          hex(v.pick("second", ["building_tower_catapult_blue", "building_tower_B_blue"]), 2.2, -1.8, {
            scale: 0.6,
          }),
        ],
      },
      { name: "Back wall", kids: [hex("wall_straight", 0, -1.9, { scale: 0.42 })] },
      {
        name: "Gate",
        kids: [
          hex("wall_straight_gate", 0, 2.3, { rot: PI, scale: 0.5 }),
          hex("building_tower_A_blue", -3, 2.4, { scale: 0.4 }),
          hex("building_tower_A_blue", 3, 2.4, { scale: 0.4 }),
        ],
        doors: [{ x: 0, z: 4.4, rot: 0, depth: 2 }],
      },
      {
        name: "Side walls",
        kids: [
          hex("wall_straight", -3.6, 0.2, { rot: PI / 2, scale: 0.3 }),
          hex("wall_straight", 3.6, 0.2, { rot: -PI / 2, scale: 0.3 }),
        ],
      },
      {
        name: "Flag",
        kids: [hex(`flag_${v.flag}`, 0, 0, { scale: 2.6 }), hex("barrel", 1.4, 0.8, { scale: 1.1 })],
      },
    ],
  }
}

export const ISLETS: readonly Composite[] = [
  {
    id: "islet-lighthouse",
    label: "Islet lighthouse",
    size: "S",
    rings: 0,
    variation: { mirror: true },
    build: lighthouse,
  },
  {
    id: "islet-shrine",
    label: "Islet shrine",
    size: "S",
    rings: 0,
    variation: { mirror: true, tint: true },
    build: shrine,
  },
  {
    id: "islet-fort",
    label: "Islet fort",
    size: "S",
    rings: 0,
    variation: { mirror: true, tint: true },
    build: fort,
  },
]
