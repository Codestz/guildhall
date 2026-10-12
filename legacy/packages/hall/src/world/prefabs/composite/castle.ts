import { curtain, hex, S, t2 } from "./rules.ts"
import type { Composite, Group, Node, Variant } from "./types.ts"

/**
 * The castles. The grand one (L, two rings) is a concentric plan: an outer curtain with a gatehouse
 * and a drawbridge, a cross wall with its own gate that makes two wards, and in the back ward the keep
 * with its halls and towers stepping up to it: wall (5.5), halls (6), gate towers (11), ward towers
 * (12), keep (20). The keep-and-gate (M, one ring) is the same shape cut down to a gatehouse, a keep
 * and its halls. A seed adds towers and wings, swaps a hall, flies another colour and may flip the plan.
 */

const PI = Math.PI

/** Banners hung either side of a gate on the wall's face (y up the wall). */
const banners = (x: number, z: number, spread: number, rot = 0): Node[] => [
  t2("c_flag_banner_long", x - spread, z, { rot, y: 1.4 }),
  t2("c_flag_banner_long", x + spread, z, { rot, y: 1.4 }),
]

/** A tower with its flag, `scale` times the pack's own. */
const tower = (v: Variant, piece: string, x: number, z: number, scale = 1): Node => ({
  name: piece.replace("building_", ""),
  x,
  z,
  kids: [hex(piece, 0, 0, { scale }), hex(`flag_${v.flag}`, 0, 3.1 * scale, { scale: 1.6 })],
})

function grand(v: Variant): Group {
  const hall = v.pick("hall", ["building_barracks_blue", "building_church_blue"])
  const wings = v.int("wings", 2, 1, 2)
  const towers = v.int("towers", 0, 0, 3)
  const extra: [number, number][] = [
    [-15, 11],
    [15, 11],
    [-15, -9],
  ]
  const outer = curtain({
    name: "Outer curtain",
    w: 3,
    d: 3,
    gate: "front",
    corner: (x, z) => tower(v, "building_tower_B_blue", x, z, 0.75),
    flank: (x, z) => tower(v, "building_tower_A_blue", x, z + 0.5, 0.7),
  })
  const cross: Group = {
    name: "Cross wall",
    z: 3,
    kids: [
      hex("wall_straight", -10, 0, { rot: PI }),
      hex("wall_straight_gate", 0, 0, { rot: PI }),
      hex("wall_straight", 10, 0, { rot: PI }),
      tower(v, "building_tower_base_blue", -14, 0, 0.9),
      tower(v, "building_tower_base_blue", 14, 0, 0.9),
      tower(v, "building_tower_A_blue", -5.8, 0.4, 0.65),
      tower(v, "building_tower_A_blue", 5.8, 0.4, 0.65),
    ],
    doors: [{ x: 0, z: 3.4, rot: 0, depth: 4.4 }],
  }
  const keep: Group = {
    name: "Keep",
    z: -7.6,
    kids: [
      hex("building_castle_blue", 0, 0, { scale: 1.3 }),
      hex(`flag_${v.flag}`, -4.4, 8.4, { scale: 2 }),
      hex(`flag_${v.flag}`, 4.4, 8.4, { scale: 2 }),
    ],
    focal: { x: 0, y: 26, z: 0 },
  }
  const wing = (side: number): Node => ({
    name: "Hall wing",
    x: side * 11,
    z: -8,
    kids: [hex(hall, 0, 0, { scale: 0.55 }), tower(v, "building_tower_A_blue", -side * 3.6, 6.4, 0.6)],
  })
  const scaffold = v.has("scaffold", 0.35) ? [hex("building_scaffolding", 0, 0, { scale: 0.55 })] : []
  const front: Group = {
    name: "Outer ward",
    kids: [
      { ref: "plaza-well", x: 0, z: 9.5, scale: 0.8 },
      { ref: "stable", x: -9.5, z: 9.5, scale: 0.7 },
      v.has("market", 0.5)
        ? { ref: "market-stalls", x: 9.5, z: 9.5, scale: 0.6 }
        : hex("building_barracks_blue", 9.5, 9.5, { scale: 0.45 }),
    ],
  }
  const more = extra.slice(0, towers).map(([x, z]): Node => tower(v, "building_tower_base_blue", x, z, 0.8))
  return {
    name: "Grand castle",
    kids: [
      outer,
      cross,
      keep,
      { name: "Halls", kids: [wing(-1), ...(wings >= 2 ? [wing(1)] : [])] },
      { name: "Scaffold", x: sign(v) * 11, z: -8, kids: scaffold },
      front,
      { name: "Gate banners", kids: banners(0, 17.6, 5.4) },
      { name: "Drawbridge", kids: [t2("c_bridge_draw", 0, 16.4, { rot: PI / 2, scale: S * 1.5 })] },
      { name: "Extra towers", kids: more },
    ],
  }
}

function keepAndGate(v: Variant): Group {
  const flank = v.pick("flank", ["building_tower_B_blue", "building_tower_A_blue"])
  const walls = v.has("walls", 0.8)
  const side = (sign: number): Node => ({
    name: "Side",
    kids: [
      ...(walls ? [hex("wall_straight", sign * 9.6, 5.3, { rot: sign * (PI / 2) })] : []),
      tower(v, flank, sign * 9.6, -0.2, 0.75),
      tower(v, "building_tower_base_blue", sign * 8.4, -6.8, 0.8),
    ],
  })
  const gate = curtain({
    name: "Gatehouse",
    w: 1,
    d: 1,
    gate: "front",
    open: ["back", "left", "right"],
    corner: (x, z) => tower(v, "building_tower_A_blue", x * 1.1, z, 0.7),
  })
  return {
    name: "Keep and gate",
    kids: [
      { ...gate, z: 5.5 },
      side(-1),
      side(1),
      {
        name: "Keep",
        z: -6,
        kids: [
          hex("building_castle_blue", 0, 0, { scale: 1.15 }),
          hex(`flag_${v.flag}`, -3.6, 7.4, { scale: 2 }),
          hex(`flag_${v.flag}`, 3.6, 7.4, { scale: 2 }),
        ],
        focal: { x: 0, y: 23, z: 0 },
      },
      { name: "Drawbridge", kids: [t2("c_bridge_draw", 0, 11.4, { rot: PI / 2, scale: S })] },
      { name: "Banners", kids: banners(0, 12.1, 4.2) },
      ...(v.has("yard", 0.6)
        ? [
            {
              name: "Yard",
              kids: [
                hex("barrel", 3, 5.5),
                hex("crate_open", -3.2, 5, { rot: 0.5 }),
                hex("wheelbarrow", 0, 3, { rot: 1.3 }),
              ],
            },
          ]
        : []),
    ],
  }
}

const sign = (v: Variant): number => (v.has("scaffold-side", 0.5) ? 1 : -1)

export const CASTLES: readonly Composite[] = [
  {
    id: "castle-grand",
    label: "Grand castle",
    size: "L",
    rings: 2,
    variation: { mirror: true, tint: true },
    build: grand,
  },
  {
    id: "castle-keep",
    label: "Keep and gate",
    size: "M",
    rings: 1,
    variation: { mirror: true, tint: true },
    build: keepAndGate,
  },
]
