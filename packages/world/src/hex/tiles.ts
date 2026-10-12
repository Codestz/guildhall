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
export const CHARACTER_SCALE = 0.47

export type TileGround = "grass" | "soil" | "dirt" | "paved" | "sand" | "rock" | "water"

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
  /** Paths from the centre out through these sides (0–5, counter-clockwise from east): road tiles. */
  path?: number[]
  /** What the tile is for, for the gallery's grouping. */
  group?: "town" | "country" | "ground" | "landmark" | "road"
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
    group: "town",
    name: "House",
    ground: "grass",
    pieces: [
      p("kaykit-hexagon/building-home-b-red", 0, -0.3, 0, B),
      p("kenney-pirate/barrel", 1.7, 1.2, 0.4, 0.45),
      p("kaykit-forest/bush-1-c-color1", -1.8, 1.1, 0, 0.84),
      p("kenney-nature/flower-red-a", -1.1, 1.7, 0, 1),
      p("kenney-nature/flower-yellow-a", -0.6, 1.9, 0, 1),
      p("kaykit-halloween/post-lantern", 1.2, 1.9, 0, 0.55),
    ],
  },
  {
    id: "tavern",
    group: "town",
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
    group: "town",
    name: "Well square",
    ground: "paved",
    pieces: [
      p("kaykit-hexagon/building-well-yellow", 0, 0, 0, B),
      p("kaykit-forest/bush-2-c-color1", -1.9, -0.9, 0, 0.69),
      p("kaykit-forest/bush-2-c-color1", 1.9, -0.9, 1, 0.69),
      p("kaykit-halloween/post-lantern", 1.6, 1.3, 0, 0.55),
      p("kaykit-halloween/post-lantern", -1.6, 1.3, 0, 0.55),
    ],
  },
  {
    id: "farmstead",
    group: "country",
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
    group: "country",
    name: "Field",
    ground: "soil",
    // KayKit's own hex field (V1's), scaled from its native hex to ours
    pieces: [p("kaykit-hexagon/building-grain", 0, 0, 0, 0.37)],
  },
  {
    id: "orchard",
    group: "country",
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
      p("kaykit-forest/grass-2-c-color1", -2, 0, 0, 0.8),
      p("kaykit-forest/grass-2-c-color1", 2, 0.2, 1, 0.8),
    ],
  },
  {
    id: "pasture",
    group: "country",
    name: "Pasture",
    ground: "grass",
    pieces: [
      ...fenceRing(1),
      p("kaykit-resources/wood-log-stack", -0.6, -0.4, 0.4, 0.54),
      p("kaykit-dungeon/barrel-small", 0.7, 0.5, 0, 0.5),
      ...ringAt(0.45, 0.4).map(([x, z], k) =>
        p(k % 2 ? "kaykit-forest/grass-2-d-color1" : "kaykit-forest/grass-2-c-color1", x, z, k, 0.8),
      ),
      p("kenney-nature/flower-yellow-a", 1.2, -1, 0, 1),
    ],
  },
  {
    id: "woods",
    group: "country",
    name: "Woods",
    ground: "grass",
    pieces: [
      p("kaykit-forest/tree-1-b-color1", -1, -0.9, 0.3, T),
      p("kaykit-forest/tree-2-b-color1", 1.2, -1, 1.2, T),
      p("kaykit-forest/tree-1-a-color1", 0.2, 0.9, 2.1, T * 1.1),
      p("kaykit-forest/tree-4-b-color1", -1.6, 1, 0.7, T * 0.85),
      p("kaykit-forest/tree-3-b-color1", 1.7, 1.1, 1.9, T * 0.8),
      p("kaykit-forest/bush-2-c-color1", -0.1, -2, 0, 0.69),
      p("kaykit-forest/bush-1-c-color1", 0.8, 0.2, 0, 0.6),
      p("kaykit-resources/wood-log-a", -0.3, -0.1, 0.5, 0.55),
      p("kaykit-forest/rock-3-e-color1", 2.1, -0.1, 0.3, 0.625),
    ],
  },
  {
    id: "meadow",
    group: "country",
    name: "Meadow",
    ground: "grass",
    pieces: [
      p("kaykit-forest/tree-2-b-color1", 1.1, -0.8, 0.5, T * 0.9),
      ...ringAt(0.55, 0.3).map(([x, z], k) =>
        p(
          ["kenney-nature/flower-red-a", "kenney-nature/flower-yellow-a", "kaykit-forest/grass-2-c-color1"][
            k % 3
          ]!,
          x,
          z,
          k,
          1,
        ),
      ),
      p("kaykit-forest/rock-3-e-color1", -1.2, 0.6, 0, 0.562),
      p("kaykit-forest/bush-1-c-color1", -0.6, -1.4, 0, 0.72),
    ],
  },
  {
    id: "road",
    group: "road",
    name: "Road",
    ground: "grass",
    path: [0, 3],
    pieces: [
      p("kaykit-halloween/post-lantern", 1.3, -0.9, 0, 0.55),
      p("kaykit-forest/grass-2-c-color1", -1.4, 1.3, 0, 0.8),
      p("kaykit-forest/grass-2-c-color1", 1.6, 1.4, 1, 0.8),
      p("kaykit-forest/rock-3-e-color1", -1.8, -1.2, 0.3, 0.5),
      p("kenney-nature/flower-yellow-a", -2, 0.2, 0, 1),
    ],
  },
]

const H = (id: string, colour = "blue") => `kaykit-hexagon/building-${id}-${colour}`
const rocks = (n: number, k = 0.6, seed = 0): TilePiece[] =>
  Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 + seed
    const r = R * (0.25 + (0.4 * ((i * 37 + seed * 11) % 7)) / 7)
    return p(`kaykit-forest/rock-3-${"efghijk"[i % 7]}-color1`, Math.cos(a) * r, Math.sin(a) * r, i, k)
  })

TILE_PREFABS.push(
  // ---- road pieces: a straight, a bend, a fork, a crossing, an end ----
  {
    id: "road-bend",
    name: "Road bend",
    group: "road",
    ground: "grass",
    path: [0, 2],
    pieces: [
      p("kaykit-forest/bush-1-c-color1", -1.6, 1, 0, 1),
      p("kaykit-forest/grass-2-c-color1", 1.2, 1.5, 0, 1),
    ],
  },
  {
    id: "road-fork",
    name: "Road fork",
    group: "road",
    ground: "grass",
    path: [0, 2, 4],
    pieces: [p("kaykit-halloween/post-lantern", 0.9, 0.9, 0, 0.55)],
  },
  {
    id: "road-cross",
    name: "Crossroads",
    group: "road",
    ground: "grass",
    path: [0, 1, 3, 4],
    pieces: [p("kaykit-halloween/post-lantern", -0.6, 1.4, 0, 0.55)],
  },
  {
    id: "road-end",
    name: "Road end",
    group: "road",
    ground: "grass",
    path: [3],
    pieces: [p("kenney-town/cart", 0.9, 0, 0.4, 0.4), p("kaykit-dungeon/barrel-small", 1.6, -1, 0, 0.5)],
  },

  // ---- town ----
  {
    id: "townhouse",
    name: "Town house",
    group: "town",
    ground: "grass",
    pieces: [
      p(H("home-b", "green"), 0, -0.3, 0, B),
      p("kaykit-dungeon/barrel-small", 1.8, 1.2, 0, 0.45),
      p("kaykit-forest/bush-1-c-color1", -1.8, 1.1, 0, 0.8),
    ],
  },
  {
    id: "cottage",
    name: "Cottage",
    group: "town",
    ground: "grass",
    pieces: [
      p(H("home-a", "red"), 0, -0.4, 0, B),
      p("kenney-nature/fence-simple", 0, 1.9, 0, 0.7),
      p("kenney-nature/flower-red-a", -1.4, 1.2, 0, 1),
      p("kenney-nature/flower-yellow-a", 1.3, 1.1, 0, 1),
    ],
  },
  {
    id: "market",
    name: "Market",
    group: "town",
    ground: "paved",
    pieces: [
      p(H("market", "red"), 0, 0, 0, 0.4),
      p("kaykit-dungeon/barrel-small", 2, 1.3, 0, 0.45),
      p("kaykit-halloween/post-lantern", -2, 1.3, 0, 0.55),
    ],
  },
  {
    id: "smithy",
    name: "Smithy",
    group: "town",
    ground: "dirt",
    pieces: [
      p(H("blacksmith", "yellow"), 0, -0.2, 0, 0.5),
      p("kaykit-resources/wood-log-stack", 1.9, 1.3, 0.4, 0.6),
    ],
  },
  {
    id: "chapel",
    name: "Chapel",
    group: "town",
    ground: "grass",
    pieces: [
      p(H("church", "blue"), 0, -0.6, 0, 0.5),
      p("kenney-graveyard/gravestone-round", 1.6, 1.3, 0, 0.5),
      p("kenney-graveyard/gravestone-cross", 2.2, 0.4, 0.2, 0.5),
      p("kenney-graveyard/gravestone-bevel", 1, 1.9, -0.2, 0.5),
    ],
  },
  {
    id: "barracks",
    name: "Barracks",
    group: "town",
    ground: "dirt",
    pieces: [p(H("barracks", "red"), 0, 0, 0, 0.44)],
  },
  {
    id: "graveyard",
    name: "Graveyard",
    group: "town",
    ground: "grass",
    pieces: [
      ...[-1.4, 0, 1.4].flatMap((x, k) => [
        p(k % 2 ? "kenney-graveyard/gravestone-cross" : "kenney-graveyard/gravestone-round", x, -0.6, 0, 0.5),
        p("kenney-graveyard/gravestone-bevel", x, 0.8, 0, 0.5),
      ]),
      p("kaykit-forest/tree-bare-1-c-color1", -1.8, 1.5, 0, 0.4),
      ...fenceRing(1),
    ],
  },

  // ---- harbour ----
  {
    id: "dock",
    name: "Dock",
    group: "town",
    ground: "water",
    pieces: [
      p("kenney-pirate/structure-platform-dock", 0, 0, 0, 0.75),
      p("kenney-pirate/boat-row-small", 1.9, 1.4, 0.6, 0.45),
      p("kaykit-dungeon/barrel-small", -0.8, -0.6, 0, 0.45),
    ],
  },
  {
    id: "warehouse",
    name: "Warehouse",
    group: "town",
    ground: "dirt",
    pieces: [
      p(H("lumbermill", "blue"), 0, -0.3, 0, 0.45),
      p("kenney-pirate/crate", 1.8, 1.4, 0.3, 0.5),
      p("kenney-pirate/crate", 2.1, 0.6, 1, 0.5),
    ],
  },

  // ---- ground ----
  {
    id: "beach",
    name: "Beach",
    group: "ground",
    ground: "sand",
    pieces: [
      p("kaykit-forest/rock-3-e-color1", 1.2, -0.8, 0, 0.6),
      p("kaykit-forest/grass-2-c-color1", -1.6, -1.2, 0, 1),
    ],
  },
  { id: "rocky", name: "Rocky ground", group: "ground", ground: "rock", pieces: rocks(6, 0.7, 1) },
  {
    id: "hillside",
    name: "Hillside",
    group: "ground",
    ground: "grass",
    pieces: [
      ...rocks(3, 0.6, 2),
      p("kaykit-forest/tree-4-b-color1", 0.6, -0.6, 0, T * 0.8),
      p("kaykit-forest/tree-4-a-color1", -1, 1, 0, T * 0.8),
    ],
  },
  {
    id: "pines",
    name: "Pine woods",
    group: "ground",
    ground: "grass",
    pieces: [
      ...[
        [-1, -1],
        [1.1, -0.8],
        [0, 0.4],
        [-1.5, 1.1],
        [1.5, 1.2],
        [0.1, -1.9],
      ].map(([x, z], k) =>
        p(`kaykit-forest/tree-4-${"abc"[k % 3]}-color1`, x!, z!, k, T * (0.7 + 0.1 * (k % 3))),
      ),
    ],
  },
  {
    id: "lake",
    name: "Lake",
    group: "ground",
    ground: "water",
    pieces: [p("kaykit-forest/rock-3-e-color1", 1.9, -1, 0, 0.5)],
  },
  {
    id: "reeds",
    name: "Reeds",
    group: "ground",
    ground: "grass",
    pieces: Array.from({ length: 9 }, (_, i) =>
      p(
        "kaykit-forest/grass-2-a-color1",
        Math.cos(i * 0.7) * (0.6 + (i % 3) * 0.6),
        Math.sin(i * 0.7) * (0.6 + (i % 3) * 0.6),
        i,
        1.3,
      ),
    ),
  },

  // ---- landmarks ----
  {
    id: "castle",
    name: "Castle",
    group: "landmark",
    ground: "rock",
    pieces: [p(H("castle", "blue"), 0, 0, 0, 0.36), p("kenney-castle/flag-pennant", 2.3, 1.4, 0, 0.5)],
  },
  {
    id: "windmill",
    name: "Windmill",
    group: "landmark",
    ground: "grass",
    pieces: [
      p(H("windmill", "yellow"), 0, 0, 0, 0.5),
      p("kenney-nature/crops-leafs-stage-b", 1.8, 1.4, 0, 0.55),
      p("kenney-nature/crop-pumpkin", 1.2, 1.9, 0, 0.55),
    ],
  },
  {
    id: "watermill",
    name: "Watermill",
    group: "landmark",
    ground: "grass",
    pieces: [p(H("watermill", "red"), 0, 0, 0, 0.5)],
  },
  {
    id: "mine",
    name: "Mine",
    group: "landmark",
    ground: "rock",
    pieces: [p(H("mine", "blue"), 0, 0, 0, 0.42), p("kaykit-resources/stone-chunks-large", 2, 1.2, 0, 0.6)],
  },
  {
    id: "lumber",
    name: "Lumber camp",
    group: "landmark",
    ground: "dirt",
    pieces: [
      p(H("lumbermill", "yellow"), 0, -0.4, 0, 0.45),
      p("kaykit-resources/wood-log-stack", -1.9, 1.2, 0.5, 0.6),
      p("kaykit-resources/wood-planks-stack-large", 1.9, 1.3, 0, 0.5),
    ],
  },
  {
    id: "watchtower",
    name: "Watchtower",
    group: "landmark",
    ground: "grass",
    pieces: [p(H("tower-a", "green"), 0, 0, 0, 0.5), ...rocks(2, 0.5, 4)],
  },
  {
    id: "lighthouse",
    name: "Lighthouse",
    group: "landmark",
    ground: "rock",
    pieces: [p(H("tower-b", "red"), 0, 0, 0, 0.45), ...rocks(3, 0.55, 5)],
  },
  {
    id: "campsite",
    name: "Campsite",
    group: "landmark",
    ground: "grass",
    pieces: [
      p("kenney-survival/tent-canvas", -0.8, -0.6, 0.5, 0.7),
      p("kenney-survival/campfire-pit", 0.8, 0.6, 0, 1),
      p("kaykit-resources/wood-log-a", 1.6, 0, 1, 0.8),
      p("kaykit-forest/tree-1-a-color1", 1.6, -1.6, 0, T * 0.7),
    ],
  },
  {
    id: "ruins",
    name: "Ruins",
    group: "landmark",
    ground: "grass",
    pieces: [
      p("kaykit-hexagon/building-destroyed", 0, 0, 0, 0.42),
      p("kaykit-forest/bush-2-c-color1", 1.8, 1.2, 0, 0.8),
    ],
  },
)

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
