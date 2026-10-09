import type { Part, Prefab } from "./types.ts"

/**
 * Buildings the KayKit hex pack has none of, built from the second town kit (town2.glb, lazy, gen 2
 * only): Kenney's Fantasy Town wall and roof modules, its windmill, stalls and fences, and the Castle
 * kit's towers and bridge, all baked onto the hex pack's palette (scripts/palette.ts). The kit's
 * modules are 1 unit a cell, drawn at S × 5, so a cell is M = 3 world units and a home-sized building
 * two or three cells wide; its wall panels sit on a cell's edge, so `shell` rings a box with them.
 */

/** The drawing size, relative to the pack's 5×, and the cell it makes in world units. */
const S = 0.6
const M = 5 * S

const round = (value: number): number => Math.round(value * 100) / 100

/** A piece of the kit (`t2_` is its name in the bundle) at a spot, `y` world units up, drawn at `scale` × 5. */
function at(piece: string, x: number, z: number, rot = 0, y = 0, scale = S): Part {
  return {
    piece: `t2_${piece}`,
    x: round(x),
    z: round(z),
    ...(rot ? { rot: round(rot) } : {}),
    ...(y ? { y: round(y) } : {}),
    scale,
  }
}

type Side = "front" | "back" | "left" | "right"
/** The turn that faces a +x panel (as the kit draws one) toward each side of the box. */
const TURN: Record<Side, number> = { right: 0, front: -Math.PI / 2, left: Math.PI, back: Math.PI / 2 }

/** The wall panel (by name) for the `i`th of `n` cells along a side, or nothing: a gap. */
type Pick = (side: Side, i: number, n: number) => string | undefined

/** A box `w` × `d` cells (x by z) centred on the anchor, ringed by wall panels, `floor` cells up. */
function shell(w: number, d: number, pick: Pick, floor = 0): Part[] {
  const out: Part[] = []
  const x = (i: number): number => (i - (w - 1) / 2) * M
  const z = (j: number): number => (j - (d - 1) / 2) * M
  const put = (side: Side, i: number, n: number, px: number, pz: number): void => {
    const piece = pick(side, i, n)
    if (piece) out.push(at(piece, px, pz, TURN[side], floor * M))
  }
  for (let i = 0; i < w; i++) {
    put("front", i, w, x(i), z(d - 1))
    put("back", i, w, x(i), z(0))
  }
  for (let j = 0; j < d; j++) {
    put("left", j, d, x(0), z(j))
    put("right", j, d, x(w - 1), z(j))
  }
  return out
}

/** One roof piece over every cell of a `w` × `d` box, `floor` cells up. */
function roofs(w: number, d: number, piece: string, floor = 1, turned = 0): Part[] {
  const out: Part[] = []
  for (let i = 0; i < w; i++)
    for (let j = 0; j < d; j++)
      out.push(at(piece, (i - (w - 1) / 2) * M, (j - (d - 1) / 2) * M, turned, floor * M))
  return out
}

/** A door in the middle of the front, windows elsewhere on the sides, plain walls behind. */
const lodging =
  (wall: string, door: string, window: string): Pick =>
  (side, i, n) => {
    if (side === "front") return i === Math.floor((n - 1) / 2) ? door : window
    if (side === "back") return wall
    return i === Math.floor(n / 2) ? window : wall
  }

/** A tower of kit pieces, each (name, height in the kit's units) on the last, drawn at `scale` × 5. */
function stack(x: number, z: number, scale: number, pieces: readonly (readonly [string, number])[]): Part[] {
  let y = 0
  return pieces.map(([piece, height]) => {
    const part = at(piece, x, z, 0, y, scale)
    y += height * 5 * scale
    return part
  })
}

/** The parts moved over by (dx, dz): a building off the hex's centre, toward the back or a side. */
const shift = (parts: readonly Part[], dx: number, dz: number): Part[] =>
  parts.map((part) => ({ ...part, x: round(part.x + dx), z: round(part.z + dz) }))

const FRONT = (d: number): number => ((d - 1) / 2) * M + M / 2

export const TOWN2: readonly Prefab[] = [
  {
    id: "chapel",
    label: "Chapel",
    kind: "civic",
    rings: 0,
    parts: shift(
      [
        ...shell(1, 2, (side) =>
          side === "front" ? "wall_door" : side === "back" ? "wall" : "wall_window_glass",
        ),
        ...roofs(1, 2, "roof_high_gable", 1, Math.PI / 2),
        // The bell tower stands at the nave's front corner.
        ...stack(M * 0.5 + 1.4, M * 0.5 - 0.2, S * 0.5, [
          ["c_tower_square_base", 1.01],
          ["c_tower_square_mid", 1.01],
          ["c_tower_square_top_roof_high", 1.35],
        ]),
      ],
      -1.2,
      0,
    ),
    doors: [{ x: -1.2, z: M + 0.6, rot: 0 }],
  },
  {
    id: "bakery",
    label: "Bakery",
    kind: "house",
    rings: 0,
    houses: 1,
    parts: [
      ...shell(2, 1, lodging("wall_wood", "wall_wood_door", "wall_wood_window_shutters")),
      ...roofs(2, 1, "roof_gable", 1),
      at("chimney", M * 0.5, 0, 0, M * 0.9),
      at("stall", 3.3, 2.6, -0.6),
      { piece: "barrel", x: -3.4, z: 2.4, rot: 0.4 },
      { piece: "sack", x: -2.8, z: 3.4, rot: 1.6 },
    ],
    doors: [{ x: -M / 2, z: FRONT(1) + 0.2, rot: 0 }],
  },
  {
    id: "stable",
    label: "Stable",
    kind: "house",
    rings: 0,
    houses: 1,
    parts: [
      ...shift(
        [
          ...shell(2, 1, (side) => (side === "front" ? undefined : "wall_wood")),
          ...roofs(2, 1, "roof_gable", 1),
        ],
        0,
        -1.6,
      ),
      at("fence", -1.5, 3.3, -Math.PI / 2),
      at("fence_gate", 1.5, 3.3, -Math.PI / 2),
      at("cart", 3, 0.6, 0.5),
      { piece: "crate_A_small", x: -3.6, z: 1.8, rot: 0.3 },
      { piece: "sack", x: -2.4, z: 0.6, rot: 1.1 },
    ],
    doors: [{ x: 0, z: 3.6, rot: 0 }],
  },
  {
    id: "warehouse",
    label: "Warehouse",
    kind: "house",
    rings: 0,
    houses: 1,
    parts: [
      ...shift(
        [
          ...shell(2, 1, (side) => (side === "front" ? "wall_door" : "wall")),
          ...roofs(2, 1, "roof_gable", 1),
        ],
        0,
        -1.4,
      ),
      { piece: "crate_A_big", x: -3.4, z: 2.6, rot: 0.2 },
      { piece: "crate_B_big", x: -2.2, z: 3.1, rot: -0.2 },
      { piece: "barrel", x: 3.4, z: 2.7, rot: 0.8 },
      { piece: "crate_open", x: 1.6, z: 3.6, rot: 0.4 },
    ],
    doors: [{ x: -M / 2, z: 0.1 + M / 2 + 0.2, rot: 0 }],
  },
  {
    id: "windmill-hex",
    label: "Windmill",
    kind: "house",
    rings: 0,
    parts: [
      ...stack(0, 0, S * 1.3, [
        ["c_tower_hexagon_base", 1.31],
        ["c_tower_hexagon_mid", 0.46],
        ["c_tower_hexagon_roof", 0.83],
      ]),
      at("windmill", 0, 2.1, -Math.PI / 2, 7.4, S * 0.85),
    ],
    doors: [{ x: 0, z: 3.4, rot: 0 }],
  },
  {
    id: "harbour-light",
    label: "Harbour light",
    kind: "civic",
    rings: 0,
    parts: [
      ...stack(0, 0, S * 1.5, [
        ["c_tower_hexagon_base", 1.31],
        ["c_tower_hexagon_mid", 0.46],
        ["c_tower_hexagon_mid", 0.46],
        ["c_tower_hexagon_top", 0.13],
        ["c_tower_hexagon_roof", 0.83],
      ]),
      at("lantern", 3.2, 3.2, 0, 0, S * 1.2),
      { piece: "rock_single_C", x: -3.1, z: 2.1, scale: 1.4 },
    ],
    doors: [{ x: 0, z: 3.4, rot: 0 }],
  },
  {
    id: "bridge-plank",
    label: "Plank bridge",
    kind: "wall",
    rings: 0,
    parts: [
      ...[-1, 0, 1].map((n) => at("planks", 0, n * M, 0, 0)),
      ...[-1, 0, 1].flatMap((n) => [at("fence", 0, n * M, 0), at("fence", 0, n * M, Math.PI)]),
      at("pillar_wood", -1.4, -1.5 * M, 0, 0),
      at("pillar_wood", 1.4, -1.5 * M, 0, 0),
      at("pillar_wood", -1.4, 1.5 * M, 0, 0),
      at("pillar_wood", 1.4, 1.5 * M, 0, 0),
    ],
    doors: [],
  },
  {
    id: "bridge-draw",
    label: "Gate bridge",
    kind: "wall",
    rings: 0,
    parts: [
      at("c_bridge_draw", 0, 1.6, Math.PI / 2, 0, S * 1.2),
      at("c_wall_narrow_gate", 0, -1.2, Math.PI / 2, 0, S * 1.2),
      ...stack(-3.6, -1.2, S * 0.7, [
        ["c_tower_square_base", 1.01],
        ["c_tower_square_mid", 1.01],
        ["c_tower_square_top_roof", 1],
      ]),
      ...stack(3.6, -1.2, S * 0.7, [
        ["c_tower_square_base", 1.01],
        ["c_tower_square_mid", 1.01],
        ["c_tower_square_top_roof", 1],
      ]),
    ],
    doors: [],
  },
  {
    id: "plaza-fountain",
    label: "Fountain square",
    kind: "plaza",
    rings: 0,
    parts: [
      // A basin about a cottage wide (3 units across), its lamps and stall close round it.
      at("fountain_round", 0, 0, 0, 0, S * 0.5),
      at("lantern", -2.6, 1, 0, 0, S),
      at("lantern", 2.6, 1, 0, 0, S),
      at("stall_red", 0, 3, Math.PI, 0, S * 0.5),
    ],
    doors: [],
    variation: {
      mirror: true,
      swaps: { t2_stall_red: ["t2_stall_green"] },
      props: [
        { piece: "barrel", x: 2.6, z: -2.2, rot: 0.5, chance: 0.5 },
        { piece: "crate_A_small", x: -2.6, z: -2.4, rot: 0.2, chance: 0.5 },
      ],
    },
  },
  {
    id: "garden",
    label: "Walled garden",
    kind: "plaza",
    rings: 0,
    parts: [
      ...shell(2, 2, (side, i) => (side === "front" && i === 0 ? "hedge_gate" : "hedge")),
      at("tree_high", 0.9, -0.6, 0, 0, S * 0.5),
      at("lantern", -1.6, 0.4, 0, 0, S * 0.8),
      { piece: "bucket_water", x: 1.6, z: 1.2 },
    ],
    doors: [],
  },
]
