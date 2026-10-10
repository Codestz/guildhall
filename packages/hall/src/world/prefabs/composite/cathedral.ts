import { roofs, stack } from "../town2.ts"
import { hex, M, quad, S, t2, tiers } from "./rules.ts"
import type { Composite, Group, Node, Variant } from "./types.ts"

/**
 * The houses of learning and prayer. The cathedral (L) is cruciform: a nave of two storeys with a
 * clerestory roof, a transept, a lantern tower with a dome over the crossing, towers at the front, an
 * apse behind, and a cloister with a fountain beside it, all in the town kit's cells drawn at 1.6×.
 * The academy (M) is the hex pack's church with a bell tower and a cloister to its side. A seed draws
 * the nave's length, one front tower or two, the roof the crossing wears, the cloister's side.
 */

const PI = Math.PI
const K = 1.6

const TOP_ROOFS = [
  "c_tower_square_top_roof_rounded",
  "c_tower_square_top_roof_high",
  "c_tower_square_top_roof",
] as const
/** Heights of the tower pieces, in the kit's units (so a stack knows where the next stands). */
const TOP_HEIGHT: Record<(typeof TOP_ROOFS)[number], number> = {
  c_tower_square_top_roof_rounded: 0.95,
  c_tower_square_top_roof_high: 1.35,
  c_tower_square_top_roof: 1,
}

function cathedral(v: Variant): Group {
  const n = v.int("nave", 5, 4, 5)
  const dome = v.pick("dome", TOP_ROOFS)
  const fronts = v.int("towers", 2, 1, 2)
  const along = (j: number): number => (j - (n - 1) / 2) * M
  const crossing = along(1)
  const front = along(n - 1)
  const naveWalls = tiers([
    {
      w: 1,
      d: n,
      floors: 2,
      wall: (side, i, _count, floor) =>
        side === "front"
          ? floor === 0
            ? "wall_door"
            : "wall_window_glass"
          : side === "back"
            ? "wall"
            : i % 2 === 0 || floor === 0
              ? "wall_window_glass"
              : "wall",
    },
  ])
  const arm = (side: number): Node => ({
    name: "Transept arm",
    x: side * 2 * M,
    z: crossing,
    kids: [
      ...tiers([
        {
          w: 2,
          d: 1,
          floors: 2,
          wall: (s, _i, _n, floor) =>
            s === (side < 0 ? "right" : "left") ? undefined : floor === 0 ? "wall_window_glass" : "wall",
        },
      ]).parts,
      ...roofs(2, 1, "roof_high_gable", 2, 0),
    ],
  })
  const frontTower = (side: number): Node => ({
    name: "Front tower",
    x: side * M,
    z: front,
    kids: stack(0, 0, S, [
      ["c_tower_square_base", 1.01],
      ["c_tower_square_mid_windows", 1.01],
      ["c_tower_square_mid_windows", 1.01],
      ["c_tower_square_top_roof_high", 1.35],
    ]),
  })
  const lanternBase = 2 * M
  const lantern: Group = {
    name: "Crossing tower",
    x: 0,
    z: crossing,
    y: lanternBase,
    kids: stack(0, 0, S, [
      ["c_tower_square_mid_windows", 1.01],
      ["c_tower_square_mid_windows", 1.01],
      [dome, TOP_HEIGHT[dome]],
    ]),
    focal: { x: 0, y: (2.02 + TOP_HEIGHT[dome]) * 5 * S, z: 0 },
  }
  const nave = roofs(1, n, "roof_high_gable", 2, PI / 2).filter((roof) => Math.abs(roof.z - crossing) > 0.1)
  return {
    name: "Cathedral",
    scale: K,
    kids: [
      {
        name: "Nave",
        kids: [...naveWalls.parts, ...nave],
        doors: [{ x: 0, z: front + M / 2 + 0.2, rot: 0, depth: 1.2 }],
      },
      arm(-1),
      arm(1),
      lantern,
      { name: "Front towers", kids: [frontTower(-1), ...(fronts === 2 ? [frontTower(1)] : [])] },
      {
        name: "Apse",
        z: along(0) - M * 1.5 - 0.3,
        kids: stack(0, 0, S * 1.15, [
          ["c_tower_hexagon_base", 1.31],
          ["c_tower_hexagon_mid", 0.46],
          ["c_tower_hexagon_roof", 0.83],
        ]),
      },
      {
        name: "Quadrangle",
        x: 3 * M,
        z: front - M * 1.5,
        kids: [quad("Wings", 3, 3), t2("fountain_round", 0, 0, { scale: S * 0.4 })],
      },
      {
        name: "Banners",
        kids: [
          t2("c_flag_banner_long", -0.9, front + M / 2 + 0.2, { y: 1.5 }),
          t2("c_flag_banner_long", 0.9, front + M / 2 + 0.2, { y: 1.5 }),
        ],
      },
    ],
  }
}

function academy(v: Variant): Group {
  const top = v.pick("roof", TOP_ROOFS)
  const books = v.has("books", 0.6)
  return {
    name: "Academy",
    kids: [
      {
        name: "Chapel hall",
        x: -3.4,
        z: -3.4,
        kids: [hex("building_church_blue", 0, 0, { scale: 1.8 })],
        doors: [{ x: 0, z: 6.2, rot: 0, depth: 2 }],
        windows: [{ x: 0, y: 5, z: 5.4 }],
      },
      {
        name: "Bell tower",
        x: -10.6,
        z: -3,
        kids: stack(0, 0, S * 1.1, [
          ["c_tower_square_base", 1.01],
          ["c_tower_square_mid_windows", 1.01],
          ["c_tower_square_mid_windows", 1.01],
          [top, TOP_HEIGHT[top]],
        ]),
        focal: { x: 0, y: (3.03 + TOP_HEIGHT[top]) * 5 * S * 1.1, z: 0 },
      },
      {
        name: "Quadrangle",
        x: 9.4,
        z: 0.8,
        scale: 0.85,
        kids: [quad("Wings", 3, 3), t2("fountain_round", 0, 0, { scale: S * 0.4 })],
      },
      {
        name: "Reading room",
        x: 3.8,
        z: 8.4,
        kids: [
          hex("building_well_blue", 0, 0, { scale: 0.9 }),
          ...(books ? [hex("book_set", 3, 0.4, { scale: 0.4 })] : []),
        ],
      },
      {
        name: "Flags",
        kids: [hex(`flag_${v.flag}`, -8.2, 4.2, { scale: 2 }), hex(`flag_${v.flag}`, 1.4, 4.4, { scale: 2 })],
      },
    ],
  }
}

export const CATHEDRALS: readonly Composite[] = [
  {
    id: "cathedral",
    label: "Cathedral",
    size: "L",
    rings: 2,
    variation: { mirror: true, tint: true },
    build: cathedral,
  },
  {
    id: "academy",
    label: "Academy",
    size: "M",
    rings: 1,
    variation: { mirror: true, tint: true },
    build: academy,
  },
]
