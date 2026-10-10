import { stack } from "../town2.ts"
import { curtain, hex, M, row, S, t2 } from "./rules.ts"
import type { Composite, Group, Node, Variant } from "./types.ts"

/**
 * The harbour fortress (L, two rings, coastal): its back edge is the coast. A sea wall with a bastion
 * (the pack's catapult tower) at each end and a lighthouse of the castle kit's hexagonal tower between
 * them, a landward curtain with a gate, and inside it the garrison, a warehouse and a market for the
 * quay. A dock of planks on piles runs out from the sea wall into the water, a hex beyond the rings.
 * A seed lengthens or shortens the pier, adds a second pier and bastion, swaps what stands in the yard.
 */

const PI = Math.PI

/** The lighthouse: a hexagonal tower of the castle kit with a lantern room and a pointed cap. */
function lighthouse(x: number, z: number, scale: number): Group {
  const top = (1.31 + 0.46 * 3 + 0.13) * 5 * scale
  return {
    name: "Lighthouse",
    x,
    z,
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
    windows: [{ x: 0, y: top + 0.6, z: 0 }],
    focal: { x: 0, y: top + 4, z: 0 },
  }
}

/** A pier of planks `n` cells long out from `(x, z)` toward the sea (-z), with piles either side. */
function pier(name: string, x: number, z: number, n: number): Group {
  return {
    name,
    kids: [
      ...row(n, x, z, 0, -M, (px, pz) => t2("planks", px, pz)),
      ...row(Math.ceil(n / 2), x - 1.8, z - M * 0.5, 0, -M * 2, (px, pz) =>
        t2("pillar_wood", px, pz, { scale: S * 1.1 }),
      ),
      ...row(Math.ceil(n / 2), x + 1.8, z - M * 0.5, 0, -M * 2, (px, pz) =>
        t2("pillar_wood", px, pz, { scale: S * 1.1 }),
      ),
      hex("rope_bundle_A", x + 1.1, z - M * (n - 1), { scale: 0.35 }),
      hex("barrel", x - 1.1, z - M * (n - 2), { scale: 1.2 }),
    ],
    doors: [{ x, z: z - M * (n - 1) - 1.5, rot: PI, depth: 1 }],
  }
}

function fortress(v: Variant): Group {
  const reach = v.int("pier", 3, 2, 4)
  const bastions = v.int("bastions", 2, 2, 3)
  const second = v.has("second-pier", 0.35)
  const yard = v.pick("yard", ["warehouse", "stable"])
  const walls = curtain({
    name: "Curtain",
    w: 3,
    d: 3,
    gate: "front",
    corner: (x, z) =>
      z < 0
        ? hex("building_tower_catapult_blue", x, z, { scale: 0.95 })
        : hex("building_tower_B_blue", x, z, { scale: 0.8 }),
    flank: (x, z) => hex("building_tower_A_blue", x, z + 0.4, { scale: 0.7 }),
  })
  const mid: Node[] =
    bastions === 3
      ? [
          hex("building_tower_base_blue", 15, 0, { scale: 0.8 }),
          hex("building_tower_base_blue", -15, 0, { scale: 0.8 }),
        ]
      : []
  return {
    name: "Harbour fortress",
    kids: [
      { ...walls, z: -1 },
      { name: "Bastions", z: -1, kids: mid },
      lighthouse(0, -15.2, 1.15),
      {
        name: "Garrison",
        x: -8.6,
        z: -8,
        kids: [hex("building_barracks_blue", 0, 0, { scale: 0.85 })],
        doors: [{ x: 0, z: 4.6, rot: 0, depth: 1.6 }],
      },
      { ref: "market-stalls", x: 8.4, z: -3, scale: 0.8 },
      { ref: yard, x: -8, z: 5.6, scale: 0.9 },
      {
        name: "Quay",
        kids: [
          hex("crate_A_big", 1.8, -12, { rot: 0.2, scale: 1.3 }),
          hex("barrel", 3.4, -12.8, { scale: 1.3 }),
          hex("wheelbarrow", -3.2, -12.4, { rot: 1.5, scale: 1.2 }),
        ],
      },
      pier("Pier", 0, -17.6, reach),
      ...(second ? [pier("East pier", 9, -17.6, 2)] : []),
      {
        name: "Gate banners",
        kids: [
          t2("c_flag_banner_long", -5.4, 14.6, { y: 1.4 }),
          t2("c_flag_banner_long", 5.4, 14.6, { y: 1.4 }),
        ],
      },
      {
        name: "Flags",
        kids: [hex(`flag_${v.flag}`, 3, 8, { scale: 2 }), hex(`flag_${v.flag}`, -3, 8, { scale: 2 })],
      },
    ],
  }
}

export const HARBOURS: readonly Composite[] = [
  {
    id: "harbour-fortress",
    label: "Harbour fortress",
    size: "L",
    rings: 2,
    coastal: true,
    variation: { mirror: true, tint: true },
    build: fortress,
  },
]
