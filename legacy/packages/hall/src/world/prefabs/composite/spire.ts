import { hex, M, quad, S, t2, tiers } from "./rules.ts"
import type { Composite, Group, Variant } from "./types.ts"

/**
 * The observatory spire (M, one ring): a tall tower on a stepped base. A ring of low gabled wings
 * (the library) round a garth; in the garth a taller box of two storeys stands, its flat top a fenced
 * terrace; from the terrace the tower rises in three stages to a dome (the observatory) or a slender
 * spire. Heights step 3 (wings), 9 (the box), 22 (the tower), so the eye is led to the top.
 * A seed picks the crown, the tower's windows' count, the books at the door and flips the plan.
 */

const PI = Math.PI

/** The crowns the tower may wear, with the kit's height of each and the width it is drawn at (× the tower's). */
const CROWNS = {
  dome: { piece: "c_tower_square_top_roof_rounded", height: 0.95, wide: 1.35 },
  spire: { piece: "c_tower_slant_roof", height: 2.14, wide: 1 },
} as const

function spire(v: Variant): Group {
  const crown = CROWNS[v.pick("crown", ["dome", "spire"] as const)]
  const stages = v.int("stages", 2, 2, 3)
  const k = S * 1.4
  const box = tiers([
    {
      w: 2,
      d: 2,
      floors: 2,
      wall: (side, i, _n, floor) =>
        side === "front" && floor === 0
          ? i === 0
            ? "wall_window_glass"
            : "wall"
          : i % 2 === 0
            ? "wall_window_glass"
            : "wall",
    },
  ])
  const terrace = 2 * M
  // Each stage a step narrower than the last, the crown narrower still: a tower that tapers to its top.
  const body = ["c_tower_square_base", ...Array.from({ length: stages }, () => "c_tower_square_mid_windows")]
  let rise = 0
  const stagesUp = body.map((piece, n) => {
    const scale = k * 0.88 ** n
    const part = t2(piece, 0, 0, { y: rise, scale })
    rise += 1.01 * 5 * scale
    return part
  })
  const crownScale = k * 0.88 ** stages * crown.wide * 0.85
  const top = terrace + rise + crown.height * 5 * crownScale
  return {
    name: "Observatory spire",
    kids: [
      {
        name: "Library wings",
        kids: [quad("Wings", 4, 4)],
        doors: [{ x: -M / 2, z: 2 * M + 1.2, rot: 0, depth: 1.4 }],
      },
      { name: "Tower box", kids: box.parts },
      {
        name: "Terrace",
        y: terrace,
        kids: [
          ...[-0.5, 0.5].flatMap((i) => [-0.5, 0.5].map((j) => t2("planks", i * M, j * M))),
          ...[-1, 1].flatMap((side) => [
            t2("fence", side * M, -M / 2, { rot: PI / 2 }),
            t2("fence", side * M, M / 2, { rot: PI / 2 }),
          ]),
          ...[-1, 1].flatMap((side) => [
            t2("fence", -M / 2, side * M, { rot: 0 }),
            t2("fence", M / 2, side * M, { rot: 0 }),
          ]),
        ],
      },
      {
        name: "Tower",
        y: terrace,
        kids: [...stagesUp, t2(crown.piece, 0, 0, { y: rise, scale: crownScale })],
        windows: [{ x: 0, y: terrace + 5 * k * 1.6, z: 2.2 * k * 1.2 }],
        focal: { x: 0, y: top - terrace, z: 0 },
      },
      {
        name: "Court",
        kids: [
          t2("fountain_round", 0, 2 * M + 3.4, { scale: S * 0.4 }),
          t2("lantern", -3.8, 2 * M + 2.6, { scale: S }),
          t2("lantern", 3.8, 2 * M + 2.6, { scale: S }),
          hex(`flag_${v.flag}`, 5.2, 2 * M + 3, { scale: 2 }),
          ...(v.has("books", 0.6) ? [hex("book_set", -5.2, 2 * M + 3, { scale: 0.4 })] : []),
        ],
      },
    ],
  }
}

export const SPIRES: readonly Composite[] = [
  {
    id: "observatory",
    label: "Observatory spire",
    size: "M",
    rings: 1,
    variation: { mirror: true, tint: true },
    build: spire,
  },
]
