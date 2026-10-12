/**
 * Tile prefabs (decisions.md "Clean restart on hex", scale B): what stands on one hex tile, composed
 * from the house-style packs. A tile is its ground (a colour, plus a path across it for road tiles)
 * and its pieces, in metres round the tile's centre with the tile's corner at HEX_TILE_SIZE; turning a
 * tile turns everything on it. These are code for the first look; once the look is approved they move
 * into the Composer as editable recipes.
 */
import { hash2 } from "../geom/noise.ts"

/** Centre to corner of one hex tile, metres (scale B: a KayKit hex house at half its import fills it). */
export const HEX_TILE_SIZE = 3.1

/** Scale B: KayKit hex buildings and trees as the library imports them, scaled to the hex world. */
export const SCALE_B = { building: 0.5, tree: 0.6 } as const

/**
 * Characters in the hex world (user: "the door = the same height as the character"): the KayKit heroes
 * scaled so their head reaches a door's top beside a scale-B building.
 */
export const CHARACTER_SCALE = 0.55

export type TileGround = "grass" | "soil" | "dirt" | "paved" | "sand"

export interface TilePiece {
  piece: string
  x: number
  z: number
  rot: number
  scale: number
}

export interface TilePrefab {
  id: string
  name: string
  ground: TileGround
  /** A dirt path across the tile, from edge to edge through the centre (road tiles). */
  path?: boolean
  pieces: TilePiece[]
}

const B = SCALE_B.building
const T = SCALE_B.tree
const R = HEX_TILE_SIZE

const p = (piece: string, x: number, z: number, rot = 0, scale = 1): TilePiece => ({
  piece,
  x,
  z,
  rot,
  scale,
})

/** Six points round the tile at `k` of its radius, turned by `a`. */
const ringAt = (k: number, a = 0): [number, number][] =>
  [0, 1, 2, 3, 4, 5].map((i) => [
    Math.cos(a + (i * Math.PI) / 3) * R * k,
    Math.sin(a + (i * Math.PI) / 3) * R * k,
  ])

/** A fence round the tile just inside its edge: one piece per side (pointy-top hex, sides 30° off the axes). */
function fenceRing(gap = -1): TilePiece[] {
  const out: TilePiece[] = []
  const inR = R * 0.82 * (Math.sqrt(3) / 2)
  const side = R * 0.82
  for (let k = 0; k < 6; k++) {
    if (k === gap) continue
    const a = (k * Math.PI) / 3
    // the side's middle, and its run (perpendicular to the direction out)
    out.push(
      p("kenney-nature/fence-simple", Math.cos(a) * inR, Math.sin(a) * inR, -a + Math.PI / 2, side / 4),
    )
  }
  return out
}

export const TILE_PREFABS: TilePrefab[] = [
  {
    id: "house",
    name: "House",
    ground: "grass",
    pieces: [
      p("kaykit-hexagon/building-home-b-red", 0, -0.3, 0, B),
      p("kenney-pirate/barrel", 1.7, 1.2, 0.4, 0.45),
      p("kenney-nature/plant-bush", -1.8, 1.1, 0, 0.7),
      p("kenney-nature/flower-red-a", -1.1, 1.7, 0, 1),
      p("kenney-nature/flower-yellow-a", -0.6, 1.9, 0, 1),
      p("kaykit-halloween/post-lantern", 1.2, 1.9, 0, 0.55),
    ],
  },
  {
    id: "tavern",
    name: "Tavern",
    ground: "grass",
    pieces: [
      p("kaykit-hexagon/building-tavern-blue", 0, -0.2, 0, B),
      p("kenney-pirate/barrel", 1.9, 1.3, 0, 0.45),
      p("kenney-pirate/barrel", 2.1, 0.7, 1, 0.45),
      p("kenney-pirate/crate", -1.9, 1.3, 0.3, 0.6),
      p("kaykit-halloween/post-lantern", -1, 1.9, 0, 0.55),
    ],
  },
  {
    id: "well-square",
    name: "Well square",
    ground: "paved",
    pieces: [
      p("kaykit-hexagon/building-well-yellow", 0, 0, 0, B),
      p("kenney-nature/plant-bush-large", -1.9, -0.9, 0, 0.6),
      p("kenney-nature/plant-bush-large", 1.9, -0.9, 1, 0.6),
      p("kaykit-halloween/post-lantern", 1.6, 1.3, 0, 0.55),
      p("kaykit-halloween/post-lantern", -1.6, 1.3, 0, 0.55),
    ],
  },
  {
    id: "farmstead",
    name: "Farmstead",
    ground: "grass",
    pieces: [
      p("kaykit-hexagon/building-home-a-yellow", -0.4, -1.1, 0, B * 0.9),
      p("kenney-town/cart", 1.7, -0.9, 0.6, 0.45),
      p("kaykit-dungeon/barrel-small", 2.1, 0.2, 0, 0.5),
      ...[-1.4, -0.6, 0.2, 1].flatMap((x, k) => [
        p(k % 2 ? "kenney-nature/crops-leafs-stage-b" : "kenney-nature/crop-pumpkin", x, 1.1, k, 0.55),
        p(k % 2 ? "kenney-nature/crop-pumpkin" : "kenney-nature/crops-leafs-stage-b", x, 1.8, k + 1, 0.55),
      ]),
      p("kenney-nature/fence-simple", -0.2, 2.45, 0, 0.75),
    ],
  },
  {
    id: "field",
    name: "Field",
    ground: "soil",
    // KayKit's own hex field (V1's), scaled from its native hex to ours
    pieces: [p("kaykit-hexagon/building-grain", 0, 0, 0, 0.37)],
  },
  {
    id: "orchard",
    name: "Orchard",
    ground: "grass",
    pieces: [
      ...[
        [-1.3, -1.2],
        [1.3, -1.2],
        [-1.3, 1.2],
        [1.3, 1.2],
        [0, 0],
      ].map(([x, z], k) => p("kaykit-forest/tree-3-a-color1", x!, z!, k, T * 0.62)),
      p("kenney-nature/grass", -2, 0, 0, 0.8),
      p("kenney-nature/grass", 2, 0.2, 1, 0.8),
    ],
  },
  {
    id: "pasture",
    name: "Pasture",
    ground: "grass",
    pieces: [
      ...fenceRing(1),
      p("kenney-nature/log-stack", -0.6, -0.4, 0.4, 0.45),
      p("kaykit-dungeon/barrel-small", 0.7, 0.5, 0, 0.5),
      ...ringAt(0.45, 0.4).map(([x, z], k) =>
        p(k % 2 ? "kenney-nature/grass-large" : "kenney-nature/grass", x, z, k, 0.8),
      ),
      p("kenney-nature/flower-yellow-a", 1.2, -1, 0, 1),
    ],
  },
  {
    id: "woods",
    name: "Woods",
    ground: "grass",
    pieces: [
      p("kaykit-forest/tree-1-b-color1", -1, -0.9, 0.3, T),
      p("kaykit-forest/tree-2-b-color1", 1.2, -1, 1.2, T),
      p("kaykit-forest/tree-1-a-color1", 0.2, 0.9, 2.1, T * 1.1),
      p("kaykit-forest/tree-4-b-color1", -1.6, 1, 0.7, T * 0.85),
      p("kaykit-forest/tree-3-b-color1", 1.7, 1.1, 1.9, T * 0.8),
      p("kenney-nature/plant-bush-large", -0.1, -2, 0, 0.6),
      p("kenney-nature/mushroom-red", 0.8, 0.2, 0, 1),
      p("kenney-nature/stump-round", -0.3, -0.1, 0.5, 0.5),
      p("kenney-nature/rock-small-c", 2.1, -0.1, 0.3, 0.5),
    ],
  },
  {
    id: "meadow",
    name: "Meadow",
    ground: "grass",
    pieces: [
      p("kaykit-forest/tree-2-b-color1", 1.1, -0.8, 0.5, T * 0.9),
      ...ringAt(0.55, 0.3).map(([x, z], k) =>
        p(
          ["kenney-nature/flower-red-a", "kenney-nature/flower-yellow-a", "kenney-nature/grass"][k % 3]!,
          x,
          z,
          k,
          1,
        ),
      ),
      p("kenney-nature/rock-small-c", -1.2, 0.6, 0, 0.45),
      p("kenney-nature/plant-bush", -0.6, -1.4, 0, 0.6),
    ],
  },
  {
    id: "road",
    name: "Road",
    ground: "grass",
    path: true,
    pieces: [
      p("kaykit-halloween/post-lantern", 1.3, -0.9, 0, 0.55),
      p("kenney-nature/grass", -1.4, 1.3, 0, 0.8),
      p("kenney-nature/grass", 1.6, 1.4, 1, 0.8),
      p("kenney-nature/rock-small-c", -1.8, -1.2, 0.3, 0.4),
      p("kenney-nature/flower-yellow-a", -2, 0.2, 0, 1),
    ],
  },
]

/** A tile's pieces in the world: its prefab turned by `rot` (a sixth of a turn per step) and moved to `at`. */
export function placeTile(
  prefab: TilePrefab,
  at: [number, number],
  y: number,
  rot: number,
  seed = 0,
): { piece: string; x: number; y: number; z: number; rot: number; scale: number }[] {
  const c = Math.cos(rot)
  const s = Math.sin(rot)
  return prefab.pieces.map((q, k) => {
    // a hair of jitter so repeated tiles are not identical
    const jx = (hash2(seed, k, 1) - 0.5) * 0.15
    const jz = (hash2(seed, k, 2) - 0.5) * 0.15
    const x = q.x + jx
    const z = q.z + jz
    return {
      piece: q.piece,
      x: at[0] + x * c + z * s,
      y,
      z: at[1] - x * s + z * c,
      rot: q.rot + rot,
      scale: q.scale,
    }
  })
}
