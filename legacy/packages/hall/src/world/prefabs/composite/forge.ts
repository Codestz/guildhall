import { roofs, shell, stack } from "../town2.ts"
import { hex, M, row, S, t2 } from "./rules.ts"
import type { Composite, Group, Node, Variant } from "./types.ts"

/**
 * The forge works (L, two rings): a works, not a house. The smithy (the hex pack's blacksmith, drawn
 * big) with its own chimney, a long timber hall beside it with two stacks, a smelter (a tall hexagonal
 * stack of the castle kit, open at the top), and a cart track of planks from the mine mouth through
 * the yard, with carts, ore and timber on it. Smoke points are named for the world to put smoke on.
 * A seed adds a second hall, drops or keeps the smelter, loads the carts and may flip the plan.
 */

const PI = Math.PI

const planks = (name: string, x: number, z: number, n: number, dx: number, dz: number): Group => ({
  name,
  kids: row(n, x, z, dx, dz, (px, pz) => t2("planks", px, pz)),
})

/** A timber hall `w` cells long: shuttered walls, a door at the front, gabled roof and `stacks` chimneys. */
function hall(name: string, x: number, z: number, w: number, stacks: number, scale = 1.3): Group {
  const smoke = Array.from({ length: stacks }, (_, n) => ({
    x: (n - (stacks - 1) / 2) * M * 1.2,
    y: M * 1.9 + 3,
    z: 0,
  }))
  return {
    name,
    x,
    z,
    scale,
    kids: [
      ...shell(w, 2, (side, i) =>
        side === "front" && i === 0
          ? "wall_wood_door"
          : i % 2 === 1
            ? "wall_wood_window_shutters"
            : "wall_wood",
      ),
      // Ridges across the hall, side by side: a sawtooth roof, as a works has.
      ...roofs(w, 2, "roof_gable", 1, PI / 2),
      ...smoke.map((s) => t2("chimney", s.x, 0, { y: M * 1.9 })),
    ],
    smoke,
    doors: [{ x: -((w - 1) / 2) * M, z: M + 1.2, rot: 0, depth: 1.2 }],
  }
}

function works(v: Variant): Group {
  const second = v.has("second", 0.5)
  const smelter = v.has("smelter", 0.8)
  const loads = v.int("loads", 2, 1, 3)
  const smithy: Group = {
    name: "Smithy",
    x: -5,
    z: -4,
    kids: [hex("building_blacksmith_blue", 0, 0, { scale: 2 })],
    doors: [{ x: -3.9, z: 7.4, rot: 0, depth: 2.2 }],
    windows: [
      { x: 3, y: 4.2, z: 7 },
      { x: -4.2, y: 4.2, z: 2.5 },
    ],
    chimneys: [{ x: 2.1, y: 9.8, z: -1.4 }],
    smoke: [{ x: 2.1, y: 10.4, z: -1.4 }],
  }
  const stack1: Group = {
    name: "Smelter",
    x: -18,
    z: 2,
    kids: stack(0, 0, S * 2, [
      ["c_tower_hexagon_base", 1.31],
      ["c_tower_hexagon_mid", 0.46],
      ["c_tower_hexagon_mid", 0.46],
      ["c_tower_hexagon_top", 0.13],
    ]),
    smoke: [{ x: 0, y: 14.6, z: 0 }],
    windows: [{ x: 0, y: 2, z: 4.4 }],
  }
  const cart = (x: number, z: number, rot: number, loaded: boolean): Node => ({
    name: "Cart",
    x,
    z,
    rot,
    kids: [t2("cart", 0, 0), ...(loaded ? [hex("resource_stone", 0, 0.1, { y: 1.2, scale: 0.8 })] : [])],
  })
  const track = planks("Cart track", -12, 9.4, 9, 3, 0)
  const mine: Group = {
    name: "Mine mouth",
    x: 3,
    z: -17,
    kids: [
      hex("building_mine_blue", 0, 0, { scale: 1.2 }),
      hex("rock_single_D", -5.4, 1.4, { scale: 1.6 }),
      hex("rock_single_B", 5.4, 2, { scale: 1.8 }),
    ],
    doors: [{ x: 0, z: 6.4, rot: 0, depth: 2.8 }],
  }
  return {
    name: "Forge works",
    kids: [
      smithy,
      hall("Timber hall", 11.5, -3, 3, 2),
      ...(second ? [hall("Second hall", -14, -14, 2, 1)] : []),
      ...(smelter ? [stack1] : []),
      track,
      {
        name: "Carts",
        kids: [
          cart(-5, 9.4, 0, true),
          ...(loads >= 2 ? [cart(4, 9.4, 0.1, true)] : []),
          ...(loads >= 3 ? [cart(12, 9.4, -0.1, false)] : []),
        ],
      },
      { name: "Mine track", kids: row(3, 3, -9.4, 0, 3.2, (x, z) => t2("planks", x, z, { rot: PI / 2 })) },
      mine,
      {
        name: "Yard",
        kids: [
          hex("weaponrack", 5, 6.6, { rot: -0.5, scale: 1.2 }),
          hex("barrel", -14, 7, { scale: 1.3 }),
          hex("barrel", -12.6, 7.8, { rot: 1.2, scale: 1.3 }),
          hex("resource_lumber", 18.4, 6.4, { rot: 1.6, scale: 1.2 }),
          hex("crate_A_big", 9.4, 6.4, { rot: 0.4, scale: 1.3 }),
          hex("bucket_water", -7.6, 6.2, { scale: 1.3 }),
          hex(`flag_${v.flag}`, 0.4, 5.4, { scale: 2 }),
        ],
      },
    ],
    focal: { x: -18, y: 14, z: 2 },
  }
}

export const FORGES: readonly Composite[] = [
  {
    id: "forge-works",
    label: "Forge works",
    size: "L",
    rings: 2,
    variation: { mirror: true, tint: true },
    build: works,
  },
]
