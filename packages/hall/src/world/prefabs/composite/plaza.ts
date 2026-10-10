import { hex, M, row, S, t2 } from "./rules.ts"
import type { Composite, Group, Node, Variant } from "./types.ts"

/**
 * The guildhouse plaza (L, two rings): a square a town is proud of. The great hall (the pack's
 * barracks, drawn large) closes the back with a wing of timber at each side and a colonnade either side of its
 * front, pillars under a plank roof; in front of it a fountain, and rows of stalls, lamps and benches
 * down both sides, houses at the corners, a cart or two. A seed draws the stalls' count and colours,
 * the hall's wings, whether trees line the square, and flips the plan.
 */

const PI = Math.PI

/** A colonnade of `n` bays, `bay` apart, pillars under a gabled roof, centred on `(x, z)`. */
function colonnade(x: number, z: number, n: number, bay: number): Group {
  return {
    name: "Colonnade",
    kids: [
      ...row(n + 1, x - (n * bay) / 2, z, bay, 0, (px, pz) =>
        t2("pillar_stone", px, pz, { scale: S * 1.15 }),
      ),
      // A shed roof over the bays, a ridge down each: pillars under gables, an arcade.
      ...row(n, x - ((n - 1) * bay) / 2, z - 1.6, bay, 0, (px, pz) =>
        t2("roof_gable", px, pz, { y: M * 1.15, scale: S * 1.55 }),
      ),
    ],
  }
}

function plaza(v: Variant): Group {
  const stalls = v.int("stalls", 3, 2, 4)
  const trees = v.has("trees", 0.5)
  const wings = v.has("wings", 0.7)
  const colours = [
    ["stall_red", "stall_green"],
    ["stall_green", "stall_red"],
  ] as const
  const stallsAt = (side: number): Node[] =>
    row(stalls, side * 12.5, -2, 0, 5.2, (x, z, i) =>
      t2(i % 2 === 0 ? colours[side > 0 ? 0 : 1][0] : colours[side > 0 ? 0 : 1][1], x, z, {
        rot: side * (PI / 2) * -1,
        scale: S * 0.75,
      }),
    )
  return {
    name: "Guildhouse plaza",
    kids: [
      {
        name: "Great hall",
        z: -16.5,
        kids: [
          hex("building_barracks_blue", 0, 0, { scale: 1.85 }),
          hex(`flag_${v.flag}`, -6.8, 8.6, { scale: 2.4 }),
          hex(`flag_${v.flag}`, 6.8, 8.6, { scale: 2.4 }),
        ],
        doors: [{ x: 0, z: 9.4, rot: 0, depth: 2.4 }],
        windows: [{ x: 0, y: 5.2, z: 8.4 }],
        focal: { x: 0, y: 15, z: 0 },
      },
      ...(wings
        ? [
            { ref: "warehouse", x: -14, z: -13, rot: 0.2, scale: 1 },
            { ref: "stable", x: 14, z: -13, rot: -0.2, scale: 1 },
          ]
        : []),
      colonnade(-8.6, -7, 2, 4.6),
      colonnade(8.6, -7, 2, 4.6),
      {
        name: "Fountain",
        kids: [
          t2("fountain_square", 0, 3.2, { scale: S * 0.9 }),
          t2("fountain_round", 0, 3.2, { y: 0.4, scale: S * 0.45 }),
          t2("lantern", -5.6, 3.2, { scale: S }),
          t2("lantern", 5.6, 3.2, { scale: S }),
        ],
      },
      { name: "West stalls", kids: stallsAt(-1) },
      { name: "East stalls", kids: stallsAt(1) },
      {
        name: "Benches",
        kids: row(2, -3, 10.8, 6, 0, (x, z) => t2("stall_bench", x, z, { rot: PI / 2, scale: S * 0.9 })),
      },
      { ref: "house-townhouse", x: -14.5, z: 12, rot: 0.3 },
      { ref: "house-cottage", x: 14.5, z: 12, rot: -0.3 },
      {
        name: "Props",
        kids: [
          t2("cart", 8.6, 8.8, { rot: 0.7 }),
          hex("barrel", -9, 9.4, { scale: 1.2 }),
          hex("crate_open", -10.4, 10.4, { rot: 0.4 }),
        ],
      },
      ...(trees
        ? [
            {
              name: "Trees",
              kids: [
                t2("tree_high", -20.5, 2, { scale: S * 0.6 }),
                t2("tree_high", 20.5, 2, { scale: S * 0.6 }),
              ],
            },
          ]
        : []),
    ],
  }
}

export const PLAZAS: readonly Composite[] = [
  {
    id: "guildhouse-plaza",
    label: "Guildhouse plaza",
    size: "L",
    rings: 2,
    variation: { mirror: true, tint: true },
    build: plaza,
  },
]
