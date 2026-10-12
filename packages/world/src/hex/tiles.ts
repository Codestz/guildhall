/**
 * Tile prefabs (decisions.md "Clean restart on hex", scale B): what stands on one hex tile, composed
 * from the house-style packs. A tile is its ground (a colour, plus a path across it for road tiles)
 * and its pieces, in metres round the tile's centre with the tile's corner at HEX_TILE_SIZE; turning a
 * tile turns everything on it. The authored prefabs are data (`data/tiles/<id>.json`, edited in the tile
 * composer) and are installed with `installTilePrefabs`; `TILE_PREFABS` here is the code fallback the
 * world uses until then (tests, a build with no data).
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
  /** Metres above (or under) the tile's top: a dock's posts stand in the water, a boat floats. */
  y?: number
  /** A re-tint of this piece (palette swatch id → swatch id). */
  swatchMap?: Record<number, number>
  /** Foliage: takes the tile's tone (one of its prefab's `tones`, picked per tile). */
  tone?: boolean
  /** The chance it stands on a given tile (default 1): woods thin out, a stall is sometimes packed away. */
  odds?: number
}

/** A tile piece in the world. */
export interface PlacedPiece {
  piece: string
  x: number
  y: number
  z: number
  rot: number
  scale: number
  swatchMap?: Record<number, number>
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
  /** Foliage tones: one is picked per tile and laid over every `tone` piece, so woods are not one green. */
  tones?: Record<number, number>[]
  /** Other prefabs that stand in for this one on some tiles (picked per tile), so streets do not repeat. */
  variants?: string[]
  /** Where people do things on this tile (tile space, metres round its centre; turned with the tile). */
  spots?: TileSpot[]
  /** What people walk round (props on the tile): discs in tile space. */
  blockers?: TileBlocker[]
  /**
   * The neighbouring tiles this prefab also covers (world.ts claims them, or falls back to one tile), as tile
   * sides (`TILE_SIDES`: 4 is the front, toward the street), for a scene too big for one hex (a tavern
   * with its beer garden, an archery range). Its pieces, spots and blockers may stand over those tiles;
   * `worldSide` says which neighbour a side is once the tile is turned.
   */
  footprint?: number[]
  /**
   * For the Guildhall's castle pieces (decisions.md: the castle is the Guildhall, growing keep → walled
   * keep → castle with wards → citadel): the first tier, 1–4, whose castle uses this tile.
   */
  tier?: number
}

/**
 * A tile's own frame (tile space, what pieces, spots and footprints are written in): every tile is
 * placed turned by `rotOf(d)` = 90° + 60°·d, so in tile space the hexagon has its corners at 0°, 60°…
 * (on ±x) and its sides at 30° + 60°·k, measured like tilePath (counter-clockwise from +x, toward -z).
 * Side 4 (270°) is +z, the front the world turns toward the street.
 */
export const TILE_SIDES = 6
export const FRONT_SIDE = 4
/** The direction (x, z) out through tile side `k` in tile space, a unit vector. */
export function sideDir(k: number): [number, number] {
  const a = (Math.PI / 180) * (30 + 60 * k)
  return [Math.cos(a), -Math.sin(a)]
}
/** The world side (tilePath / grid DIRS order) tile side `k` faces on a tile whose front faces world side `d`. */
export const worldSide = (k: number, d: number): number => (((k + d + 2) % 6) + 6) % 6

/**
 * An activity spot (decisions.md "Activity spots"): where one person stands to do something on a tile,
 * which way they face, the clip they play there and what they hold. Life sends people only to spots, so
 * an archer shoots at the target, a sitter sits on the bench, nobody works in the street.
 */
export interface TileSpot {
  kind: "sit" | "work" | "stand" | "sleep" | "talk"
  x: number
  z: number
  /** Turn about +y, radians (tile space; 0 faces +z). */
  facing: number
  /** Rig clip name (KayKit rig-medium), e.g. "Sit_Chair_Idle", "Interact", "Use_Item". */
  clip?: string
  /** Catalog piece held in the right hand while here (a grips mount). */
  prop?: string
  /** Who may use it: NPC roles (data/npcs ids); any when left out. */
  roles?: string[]
  /** Ground height offset (a bench seat, a dock deck), metres. */
  y?: number
  /** When the spot is used, day hours [from, to) (to < from wraps past midnight); any time when left out. */
  hours?: [number, number]
}

/** A disc nobody walks through (a cart, a stall, a well), tile space. */
export interface TileBlocker {
  x: number
  z: number
  r: number
}

/**
 * Kenney's woods and canvas are baked to the sandstone ramp, which reads pink beside KayKit's timber
 * under our light: every Kenney piece has its wood re-tinted to timber and thatch.
 */
export const KENNEY_WOOD: Record<number, number> = { 28: 21, 29: 22, 51: 23, 52: 25, 53: 26 }

/** Foliage tones (palette swatch → swatch) over KayKit's leaf greens (grass-dark, grass, grass-light, leaf). */
export const LEAF_TONES = {
  /** As baked, a little deeper: the light lime goes. */
  base: { 2: 1 },
  /** Deep wood: leaf and pine. */
  dark: { 0: 33, 1: 34, 2: 34, 34: 33 },
  /** Olive: moss lights. */
  olive: { 0: 34, 1: 35, 2: 35, 34: 34 },
  /** A wood turning: dry-grass golds among the leaf. */
  gold: { 0: 34, 1: 4, 2: 35, 34: 3 },
} satisfies Record<string, Record<number, number>>

const B = SCALE_B.building
const T = SCALE_B.tree
const R = HEX_TILE_SIZE

const p = (piece: string, x: number, z: number, rot = 0, scale = 1, odds?: number): TilePiece =>
  odds === undefined ? { piece, x, z, rot, scale } : { piece, x, z, rot, scale, odds }

/** A piece of foliage: it takes the tile's tone. */
const leaf = (piece: string, x: number, z: number, rot = 0, scale = 1, odds?: number): TilePiece => ({
  ...p(piece, x, z, rot, scale, odds),
  tone: true,
})

/** A KayKit forest piece. */
const F = (name: string) => `kaykit-forest/${name}-color1`

/** The tones a wood tile takes, weighted: mostly as baked or deep, some olive, now and then a gold one. */
const WOOD_TONES = [
  LEAF_TONES.base,
  LEAF_TONES.dark,
  LEAF_TONES.dark,
  LEAF_TONES.olive,
  LEAF_TONES.base,
  LEAF_TONES.olive,
  LEAF_TONES.dark,
  LEAF_TONES.gold,
]

/** Six points round the tile at `k` of its radius, turned by `a`. */
const ringAt = (k: number, a = 0): [number, number][] =>
  [0, 1, 2, 3, 4, 5].map((i) => [
    Math.cos(a + (i * Math.PI) / 3) * R * k,
    Math.sin(a + (i * Math.PI) / 3) * R * k,
  ])

/** A fence round the tile just inside its edge: one piece per side (pointy-top hex, sides 30° off the axes). */
function fenceRing(gap = -1): TilePiece[] {
  const out: TilePiece[] = []
  // on the tile's own sides (TILE_SIDES: 30° + 60°·k in tile space), just inside the edge, spanning it
  const inset = 0.97
  const apothem = R * (Math.sqrt(3) / 2) * inset
  for (let k = 0; k < 6; k++) {
    if (k === gap) continue
    const a = ((30 + 60 * k) * Math.PI) / 180
    out.push(
      p(
        "kenney-nature/fence-simple-low",
        Math.cos(a) * apothem,
        -Math.sin(a) * apothem,
        a - Math.PI / 2,
        (R * inset) / 4.16,
      ),
    )
  }
  return out
}

/** A dock's deck over its tile's y (the shallows' bed): level with the beach. */
const DECK = 0.75
/** A boat's keel over the shallows' bed: it rides at the sea's level. */
const AFLOAT = 0.2

/** A plank pier of `n` platforms from the land side (+z) out to sea. */
const pier = (n = 3): TilePiece[] =>
  Array.from({ length: n }, (_, k) => p("kenney-pirate/structure-platform", 0, 2.05 - k * 2, 0, 0.5))

/** Bushes round a wood tile's rim, about half of them on any one tile: where the wood ends, it ends soft. */
const rimBushes = (a = 0.3): TilePiece[] =>
  ringAt(0.84, a).map(([x, z], k) =>
    leaf(F(k % 2 ? "bush-1-c" : "bush-2-c"), x, z, k, 0.55 + 0.1 * (k % 3), 0.5),
  )

export const TILE_PREFABS: TilePrefab[] = [
  {
    id: "house",
    variants: ["house-porch", "house-pair"],
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
    variants: ["tavern-yard"],
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
    // flat soil in crop rows (no hex slab): neighbouring fields merge into a patchwork
    pieces: [-2, -1, 0, 1, 2].flatMap((row) =>
      [-2.1, -1.4, -0.7, 0, 0.7, 1.4, 2.1]
        .filter((x) => Math.hypot(x, row * 0.8) < R * 0.8)
        .map((x, k) =>
          p(
            row % 2 ? "kenney-nature/crops-corn-stage-c" : "kenney-nature/crops-leafs-stage-b",
            x,
            row * 0.8,
            k,
            row % 2 ? 0.42 : 0.6,
          ),
        ),
    ),
  },
  {
    id: "orchard",
    group: "country",
    name: "Orchard",
    ground: "grass",
    tones: [LEAF_TONES.base, LEAF_TONES.olive, LEAF_TONES.base],
    pieces: [
      ...[
        [-1.3, -1.2],
        [1.3, -1.2],
        [-1.3, 1.2],
        [1.3, 1.2],
        [0, 0],
      ].map(([x, z], k) => leaf(F("tree-3-a"), x!, z!, k, T * 0.62)),
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
    // a mixed wood; one tile in five or so is denser, lighter, or opens into a clearing
    variants: ["woods-dense", "woods-dense", "woods-light", "pines", "woods", "woods-clearing"],
    tones: WOOD_TONES,
    pieces: [
      leaf(F("tree-1-b"), -1, -0.9, 0.3, T),
      leaf(F("tree-2-c"), 1.2, -1, 1.2, T * 0.85),
      leaf(F("tree-1-c"), 0.2, 0.9, 2.1, T * 0.7),
      leaf(F("tree-3-b"), -1.6, 1, 0.7, T * 0.9),
      leaf(F("tree-2-b"), 1.7, 1.1, 1.9, T * 0.9),
      leaf(F("tree-1-a"), 0.1, -2, 0.9, T, 0.6),
      ...rimBushes(0.2),
      p("kaykit-resources/wood-log-a", -0.3, -0.1, 0.5, 0.55, 0.4),
      p("kaykit-forest/rock-3-e-color1", 2.1, -0.1, 0.3, 0.625, 0.4),
    ],
  },
  {
    id: "woods-dense",
    group: "country",
    name: "Deep woods",
    ground: "grass",
    tones: [LEAF_TONES.dark, LEAF_TONES.dark, LEAF_TONES.base, LEAF_TONES.olive],
    pieces: [
      leaf(F("tree-4-c"), -0.9, -1, 0.3, T * 0.7),
      leaf(F("tree-1-b"), 1.2, -0.9, 1.2, T * 1.05),
      leaf(F("tree-4-b"), 0.1, 0.3, 2.1, T * 0.95),
      leaf(F("tree-4-a"), -1.7, 0.6, 0.7, T),
      leaf(F("tree-2-d"), 1.4, 1.3, 1.9, T * 0.75),
      leaf(F("tree-4-b"), -0.5, 1.9, 2.5, T * 0.85),
      leaf(F("tree-3-c"), 0.3, -2.1, 0.4, T * 0.6, 0.7),
      ...rimBushes(0.7),
    ],
  },
  {
    id: "woods-light",
    group: "country",
    name: "Light woods",
    ground: "grass",
    tones: [LEAF_TONES.olive, LEAF_TONES.olive, LEAF_TONES.base, LEAF_TONES.gold],
    pieces: [
      leaf(F("tree-2-a"), -1.2, -0.8, 0.3, T * 1.1),
      leaf(F("tree-2-b"), 0.9, -1.3, 1.2, T),
      leaf(F("tree-3-a"), 0.3, 0.5, 2.1, T * 1.1),
      leaf(F("tree-2-a"), -1.5, 1.3, 0.7, T),
      leaf(F("tree-3-b"), 1.8, 0.9, 1.9, T * 0.8),
      leaf(F("grass-2-c"), -0.4, -0.3, 0, 0.8),
      leaf(F("grass-2-d"), 0.9, 1.9, 1, 0.8),
      p("kenney-nature/flower-yellow-a", -0.3, 1.6, 0, 1, 0.5),
      ...rimBushes(0.5).filter((_, k) => k % 2 === 0),
    ],
  },
  {
    id: "woods-clearing",
    group: "country",
    name: "Clearing",
    ground: "grass",
    tones: WOOD_TONES,
    pieces: [
      // the trees keep to the rim; the middle is open grass with a stump and the day's logs
      ...ringAt(0.7, 0.5).map(([x, z], k) =>
        leaf(
          F(["tree-1-b", "tree-4-b", "tree-3-b", "tree-1-a", "tree-4-a", "tree-2-c"][k]!),
          x,
          z,
          k,
          T * 0.85,
          0.75,
        ),
      ),
      p("kenney-nature/stump-round", 0.2, 0.1, 0.4, 0.6),
      p("kaykit-resources/wood-log-a", -0.7, 0.4, 1.2, 0.55),
      leaf(F("grass-2-c"), 0.7, -0.6, 0, 0.8),
      leaf(F("grass-2-d"), -0.6, -0.7, 1, 0.8),
      p("kenney-nature/flower-red-a", 0.9, 0.7, 0, 1),
      p("kenney-nature/flower-yellow-a", -0.2, 0.9, 0, 1),
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
    variants: ["townhouse-shop", "townhouse-corner"],
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
    variants: ["cottage-garden", "cottage-veg"],
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
    variants: ["market-stalls", "market-carts"],
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
    variants: ["smithy-yard"],
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
    // a plank pier from the shore (+z, toward the land) out over the shallows, its posts on the sea bed
    // (the tile's y), a rowing boat moored along it
    variants: ["dock-ship", "dock-boats"],
    pieces: [
      ...pier(),
      { ...p("kenney-pirate/boat-row-small", 1.45, -0.6, 0.1, 0.42), y: AFLOAT },
      { ...p("kenney-pirate/crate", -0.3, 1.6, 0.3, 0.42), y: DECK },
      { ...p("kenney-pirate/barrel", 0.35, 1.9, 0, 0.38), y: DECK },
      { ...p("kaykit-halloween/post-lantern", -0.7, -1.6, 0, 0.5), y: DECK },
    ],
  },
  {
    id: "dock-ship",
    name: "Dock with a ship",
    group: "town",
    ground: "water",
    pieces: [
      ...pier(),
      { ...p("kenney-pirate/ship-small", -1.75, -0.6, 0.05, 0.27), y: AFLOAT },
      { ...p("kenney-pirate/crate", 0.4, 1.4, 0.3, 0.42), y: DECK },
      { ...p("kenney-pirate/crate", 0.35, 0.9, 1.1, 0.42), y: DECK },
      { ...p("kenney-pirate/barrel", 0.45, -0.2, 0, 0.38), y: DECK },
    ],
  },
  {
    id: "dock-boats",
    name: "Boat moorings",
    group: "town",
    ground: "water",
    pieces: [
      ...pier(2),
      { ...p("kenney-pirate/boat-row-small", 1.4, 0, 0.15, 0.42), y: AFLOAT },
      { ...p("kenney-pirate/boat-row-large", -1.5, -0.3, -0.1, 0.42), y: AFLOAT },
      { ...p("kaykit-dungeon/barrel-small", 0.3, 1.8, 0, 0.45), y: DECK },
    ],
  },
  {
    id: "quay",
    name: "Quay",
    group: "town",
    ground: "dirt",
    variants: ["quay-b"],
    // the harbour's yards: cargo waiting on the quay
    pieces: [
      p("kaykit-resources/pallet-wood-covered-a", -0.9, -0.5, 0.3, 0.7),
      p("kenney-pirate/crate", -1.1, 0.7, 0.2, 0.5),
      p("kenney-pirate/crate", -0.5, 0.9, 1.1, 0.5),
      p("kenney-pirate/crate-bottles", -0.8, 0.8, 0.6, 0.5, 0.6),
      p("kenney-pirate/barrel", 0.9, -0.6, 0, 0.42),
      p("kenney-pirate/barrel", 1.4, -0.1, 0, 0.42),
      p("kenney-pirate/barrel", 0.8, 0.1, 0, 0.42, 0.6),
      p("kaykit-resources/textiles-stack-large-colored", 0.9, 1.3, 0.4, 0.6, 0.6),
      p("kaykit-halloween/post-lantern", 1.9, 1, 0, 0.55),
    ],
  },
  {
    id: "quay-b",
    name: "Quay with a cart",
    group: "town",
    ground: "dirt",
    pieces: [
      p("kenney-town/cart", -0.6, 0.2, 0.8, 0.42),
      p("kaykit-resources/wood-planks-stack-medium", 1.1, -0.8, 0.2, 0.6),
      p("kenney-pirate/crate", 1.2, 0.6, 0.4, 0.5),
      p("kenney-pirate/barrel", 0.4, 1.4, 0, 0.42),
      p("kaykit-resources/fuel-a-barrels", -1.3, -1.1, 0, 0.6, 0.5),
    ],
  },
  {
    id: "warehouse",
    variants: ["storehouse", "storehouse", "boathouse"],
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
  {
    id: "rocky",
    name: "Rocky ground",
    group: "ground",
    ground: "rock",
    pieces: [
      p("kaykit-forest/rock-3-m-color1", -0.6, -0.4, 0.3, 0.55),
      p("kaykit-forest/rock-3-g-color1", 1.3, 0.8, 1.1, 0.6),
      p("kaykit-forest/grass-2-c-color1", -1.5, 1.2, 0, 1),
      p("kaykit-forest/grass-2-d-color1", 1.6, -1.2, 0, 1),
    ],
  },
  {
    id: "hillside",
    name: "Hillside",
    group: "ground",
    ground: "grass",
    pieces: [
      ...rocks(3, 0.6, 2),
      leaf(F("tree-4-b"), 0.6, -0.6, 0, T * 0.8),
      leaf(F("tree-4-a"), -1, 1, 0, T * 0.8),
      leaf(F("tree-4-a"), 1.5, 1.2, 1, T * 0.7, 0.4),
      leaf(F("bush-1-c"), -1.7, -0.4, 0, 0.6, 0.5),
    ],
    tones: [LEAF_TONES.dark, LEAF_TONES.base, LEAF_TONES.olive],
  },
  {
    id: "pines",
    name: "Pine woods",
    group: "ground",
    ground: "grass",
    tones: [LEAF_TONES.dark, LEAF_TONES.dark, LEAF_TONES.base, LEAF_TONES.olive],
    pieces: [
      ...[
        [-1, -1],
        [1.1, -0.8],
        [0, 0.4],
        [-1.5, 1.1],
        [1.5, 1.2],
        [0.1, -1.9],
      ].map(([x, z], k) =>
        leaf(F(`tree-4-${"bac"[k % 3]}`), x!, z!, k, T * (k % 3 === 2 ? 0.6 : 0.8 + 0.1 * (k % 2))),
      ),
      ...rimBushes(0.9).filter((_, k) => k % 2 === 1),
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

  // ---- more places ----
  {
    id: "monastery",
    name: "Monastery",
    group: "town",
    ground: "paved",
    pieces: [
      p(H("church", "yellow"), 0, -0.3, 0, 0.5),
      p("kaykit-forest/tree-3-a-color1", 1.9, 1.2, 0, T * 0.6),
      p("kenney-graveyard/gravestone-cross", -1.8, 1.3, 0, 0.5),
    ],
  },
  {
    id: "archery",
    name: "Archery range",
    group: "town",
    ground: "dirt",
    pieces: [p(H("archeryrange", "red"), 0, 0, 0, 0.4)],
  },
  {
    id: "fort-tower",
    name: "Fort tower",
    group: "town",
    ground: "dirt",
    pieces: [
      p(H("tower-catapult", "red"), 0, 0, 0, 0.5),
      p("kaykit-dungeon/barrel-small", 1.8, 1.2, 0, 0.45),
    ],
  },
  {
    id: "construction",
    name: "Building site",
    group: "town",
    ground: "dirt",
    pieces: [
      p("kaykit-hexagon/building-stage-b", 0, 0, 0, 0.45),
      p("kaykit-resources/wood-planks-stack-large", 1.8, 1.2, 0.3, 0.5),
      p("kaykit-resources/stone-bricks-stack-medium", -1.8, 1.1, 0, 0.5),
    ],
  },
  {
    id: "hunter",
    name: "Hunter's lodge",
    group: "country",
    ground: "grass",
    pieces: [
      p(H("home-a", "green"), -0.3, -0.4, 0, B * 0.85),
      p("kaykit-resources/wood-log-stack", 1.7, 0.9, 0.5, 0.55),
      p("kaykit-forest/tree-1-a-color1", 1.6, -1.4, 0, T * 0.7),
      p("kaykit-forest/bush-2-c-color1", -1.8, 1.2, 0, 0.8),
    ],
  },
  {
    id: "shepherd",
    name: "Shepherd's hut",
    group: "country",
    ground: "grass",
    pieces: [
      p(H("home-a", "yellow"), 0.6, -0.8, 0, B * 0.75),
      ...fenceRing(2).slice(0, 3),
      p("kaykit-forest/grass-2-d-color1", -1, 0.8, 0, 1),
    ],
  },
  {
    id: "homestead",
    name: "Homestead",
    group: "country",
    ground: "grass",
    pieces: [
      p(H("home-b", "yellow"), 0, -0.6, 0, B * 0.9),
      p("kenney-nature/fence-simple", 0, 1.8, 0, 0.7),
      p("kenney-nature/crop-pumpkin", -1.3, 1.2, 0, 0.55),
      p("kenney-nature/crops-leafs-stage-b", 1.3, 1.1, 0, 0.55),
      p("kaykit-dungeon/barrel-small", 1.9, 0, 0, 0.45),
    ],
  },

  // ---- landmarks ----
  {
    id: "castle",
    name: "Castle",
    group: "landmark",
    ground: "rock",
    // the keep: the castle's other tiles are its wards, and walls run round all of them (castleWalls)
    pieces: [p(H("castle", "blue"), 0, -0.2, 0, 0.36), p("kaykit-halloween/post-lantern", 1.9, 1.3, 0, 0.55)],
  },
  {
    id: "castle-ward",
    name: "Castle ward",
    group: "landmark",
    ground: "paved",
    variants: ["castle-yard", "castle-tower"],
    // a ward inside the walls: the stores
    pieces: [
      p("kaykit-dungeon/crates-stacked", -0.6, -0.5, 0.3, 0.5),
      p("kaykit-dungeon/barrel-small", 0.5, -0.9, 0, 0.5),
      p("kaykit-dungeon/barrel-small", 0.9, -0.3, 0, 0.5),
      p("kaykit-resources/wood-log-stack", 0.4, 0.7, 1.2, 0.5),
      p("kaykit-halloween/post-lantern", -0.7, 0.8, 0, 0.55),
    ],
  },
  {
    id: "castle-yard",
    name: "Castle yard",
    group: "landmark",
    ground: "paved",
    // the drill yard: arms on a rack, a cart of hay
    pieces: [
      p("kaykit-dungeon/sword-shield", -0.3, -0.7, 0, 0.5),
      p("kaykit-dungeon/sword-shield", 0.6, -0.7, 0, 0.5),
      p("kenney-town/cart", 0.4, 0.6, 1.1, 0.4),
      p("kaykit-dungeon/barrel-small", -0.9, 0.4, 0, 0.5),
    ],
  },
  {
    id: "castle-tower",
    name: "Castle tower",
    group: "landmark",
    ground: "paved",
    // a second, lower tower in the ward
    pieces: [p(H("tower-a", "blue"), 0, 0, 0, 0.32), p("kaykit-dungeon/barrel-small", 1.1, 0.7, 0, 0.5)],
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

// ---- variants: the same job built another way, so a street does not repeat ----
const pot = (x: number, z: number, flower = "red"): TilePiece[] => [
  p("kenney-nature/pot-small", x, z, 0, 0.32),
  { ...p(`kenney-nature/flower-${flower}-a`, x, z, 0, 0.7), y: 0.3 },
]
const bench = (x: number, z: number, rot = 0): TilePiece => p("kenney-graveyard/bench", x, z, rot, 0.55)
const sign = (x: number, z: number, rot = 0.4): TilePiece => p("kenney-survival/signpost", x, z, rot, 0.9)

TILE_PREFABS.push(
  {
    id: "house-porch",
    name: "House with a bench",
    group: "town",
    ground: "grass",
    pieces: [
      p(H("home-b", "red"), 0.3, -0.5, 0, B * 0.95),
      bench(-1.5, 1.2, 0.2),
      ...pot(-1.9, 0.2),
      ...pot(1.7, 1.3, "yellow"),
      p("kaykit-halloween/post-lantern", 0.9, 1.9, 0, 0.55),
      leaf(F("tree-3-a"), -1.6, -1.4, 0, T * 0.55),
    ],
    tones: [LEAF_TONES.base, LEAF_TONES.olive],
  },
  {
    id: "house-pair",
    name: "Two cottages",
    group: "town",
    ground: "grass",
    pieces: [
      p(H("home-a", "red"), -0.95, -0.6, 0, B * 0.78),
      p(H("home-a", "blue"), 1.1, -0.2, -0.5, B * 0.72),
      p("kenney-nature/fence-simple", -0.9, 1.5, 0, 0.6),
      ...pot(0.2, 1.4, "purple"),
      p("kaykit-dungeon/barrel-small", 2, 1.2, 0, 0.45),
    ],
  },
  {
    id: "townhouse-shop",
    name: "Shop with an awning",
    group: "town",
    ground: "grass",
    pieces: [
      p(H("home-b", "green"), 0, -0.6, 0, B),
      p("kenney-town/stall-red", 1.2, 1.35, Math.PI, 0.42),
      p("kenney-pirate/crate", -0.4, 1.5, 0.3, 0.42),
      p("kenney-pirate/barrel", -1.5, 1.3, 0, 0.38),
      ...pot(-2, 0.1, "yellow"),
    ],
  },
  {
    id: "townhouse-corner",
    name: "Town house on a corner",
    group: "town",
    ground: "grass",
    pieces: [
      p(H("home-b", "blue"), -0.4, -0.4, 0.5, B),
      sign(1.6, 1.6),
      bench(1.5, 0.3, -1.2),
      p("kenney-town/cart", -1.7, 1.4, 1.9, 0.38),
      p("kaykit-halloween/post-lantern", 0.4, 1.9, 0, 0.55),
    ],
  },
  {
    id: "cottage-garden",
    name: "Cottage with a garden",
    group: "town",
    ground: "grass",
    pieces: [
      p(H("home-a", "yellow"), 0.5, -0.6, -0.3, B),
      p("kenney-town/hedge", -1.3, 1.3, 0.5, 0.5),
      p("kenney-town/hedge", -2, 0, 1.6, 0.5),
      bench(-0.6, 0.4, 0.4),
      p("kenney-nature/flower-red-a", 1.3, 1.4, 0, 1),
      p("kenney-nature/flower-purple-a", 0.6, 1.8, 0, 1),
      p("kenney-nature/flower-yellow-a", 1.9, 0.9, 0, 1),
    ],
  },
  {
    id: "cottage-veg",
    name: "Cottage with a vegetable patch",
    group: "town",
    ground: "grass",
    pieces: [
      p(H("home-a", "green"), -0.6, -0.6, 0.2, B * 0.9),
      ...[0.6, 1.2, 1.8].flatMap((x, k) => [
        p(k % 2 ? "kenney-nature/crop-carrot" : "kenney-nature/crop-pumpkin", x, 0.8, k, 0.55),
        p("kenney-nature/crops-leafs-stage-b", x, 1.4, k + 1, 0.55),
      ]),
      p("kaykit-resources/wood-log-stack", -1.9, 0.9, 0.6, 0.5),
      p("kenney-survival/bucket", 0.1, 1.6, 0, 0.8),
    ],
  },
  {
    id: "tavern-yard",
    name: "Tavern with a beer garden",
    group: "town",
    ground: "grass",
    pieces: [
      p(H("tavern", "red"), 0.3, -0.6, 0, B * 0.95),
      bench(-1.4, 1, 0.3),
      bench(-0.3, 1.6, 0.3),
      p("kenney-pirate/barrel", 1.8, 1.2, 0, 0.42),
      p("kenney-pirate/barrel", 1.4, 1.7, 0.5, 0.42),
      sign(-2, -0.2, 1.1),
      p("kaykit-halloween/post-lantern", 0.7, 1.9, 0, 0.55),
    ],
  },
  {
    id: "market-stalls",
    name: "Market stalls",
    group: "town",
    ground: "paved",
    pieces: [
      p("kenney-town/stall-red", -1.2, -0.8, 0.3, 0.45),
      p("kenney-town/stall-green", 1.1, -0.9, -0.3, 0.45),
      p("kenney-town/stall-red", 0, 1.1, Math.PI, 0.45),
      p("kenney-pirate/crate", -1.9, 0.6, 0.2, 0.42),
      p("kenney-pirate/barrel", 1.9, 0.6, 0, 0.38),
      p("kaykit-resources/textiles-stack-large-colored", -0.2, -0.1, 0.4, 0.5),
      p("kaykit-halloween/post-lantern", 1.3, 1.6, 0, 0.55),
    ],
  },
  {
    id: "market-carts",
    name: "Carts and a stall",
    group: "town",
    ground: "paved",
    pieces: [
      p("kenney-town/stall-green", -0.4, -1, 0, 0.45),
      p("kenney-town/cart", 1.2, 0.2, 2.2, 0.42),
      p("kenney-town/cart-high", -1.3, 0.8, 0.9, 0.38),
      p("kenney-town/stall-bench", 0.6, -1.9, 0, 0.45),
      ...pot(1.8, 1.4, "purple"),
      p("kaykit-dungeon/barrel-small", 0.2, 1.4, 0, 0.45),
    ],
  },
  {
    id: "smithy-yard",
    name: "Smithy with a yard",
    group: "town",
    ground: "dirt",
    pieces: [
      p(H("blacksmith", "red"), -0.3, -0.5, 0.3, 0.48),
      p("kenney-survival/workbench-anvil", 1.4, 0.9, 0.4, 0.9),
      p("kaykit-resources/iron-bars-stack-medium", 1.9, -0.2, 0, 0.6),
      p("kaykit-resources/wood-log-stack", -1.6, 1.3, 0.5, 0.55),
      p("kenney-pirate/barrel", 0.5, 1.7, 0, 0.38),
    ],
  },
  {
    id: "storehouse",
    name: "Storehouse",
    group: "town",
    ground: "dirt",
    pieces: [
      p(H("home-b", "blue"), -0.3, -0.6, 0, B),
      p("kaykit-dungeon/crates-stacked", 1.6, -0.4, 0.4, 0.5),
      p("kenney-pirate/crate", 1.2, 1.1, 0.3, 0.5),
      p("kenney-pirate/barrel", 1.8, 1.4, 0, 0.42),
      p("kenney-pirate/barrel", -1.4, 1.4, 0, 0.42),
      p("kaykit-resources/pallet-wood-covered-b", -0.2, 1.5, 0.1, 0.6),
    ],
  },
  {
    id: "boathouse",
    name: "Net shed",
    group: "town",
    ground: "dirt",
    pieces: [
      p(H("home-a", "blue"), 0.4, -0.6, 0, B * 0.85),
      p("kenney-nature/canoe", -1.6, 0.2, 0.3, 0.6),
      p("kenney-survival/fish-large", 0.9, 1.3, 0.8, 0.9),
      p("kenney-survival/bucket", 1.4, 1.5, 0, 0.8),
      p("kenney-pirate/barrel", 2, 0.6, 0, 0.38),
      p("kaykit-halloween/post-lantern", -0.4, 1.9, 0, 0.55),
    ],
  },
)

/** The variant of `prefab` that stands on the tile with this seed (itself when it has none). */
export function tileVariant(prefab: TilePrefab, seed: number): TilePrefab {
  if (!prefab.variants?.length) return prefab
  const k = Math.floor(hash2(Math.imul(seed, 0x9e3779b1), 77, 5) * (prefab.variants.length + 1))
  return (k > 0 && tilePrefab(prefab.variants[k - 1]!)) || prefab
}

/**
 * A tile's pieces in the world: its prefab (or, with `vary`, the variant this tile takes) turned by `rot`
 * (a sixth of a turn per step) and moved to `at`.
 */
export function placeTile(
  prefab: TilePrefab,
  at: [number, number],
  y: number,
  rot: number,
  seed = 0,
  vary = true,
): PlacedPiece[] {
  const t = vary ? tileVariant(prefab, seed) : prefab
  const c = Math.cos(rot)
  const s = Math.sin(rot)
  const tone = t.tones?.length
    ? t.tones[Math.floor(hash2(seed, 91, 3) * t.tones.length) % t.tones.length]
    : undefined
  const out: PlacedPiece[] = []
  t.pieces.forEach((q, k) => {
    if (q.odds !== undefined && hash2(seed, k, 9) >= q.odds) return
    // a hair of jitter so repeated tiles are not identical
    const jx = (hash2(seed, k, 1) - 0.5) * 0.15
    const jz = (hash2(seed, k, 2) - 0.5) * 0.15
    const x = q.x + jx
    const z = q.z + jz
    const map = {
      ...(q.piece.startsWith("kenney-") ? KENNEY_WOOD : {}),
      ...(q.tone && tone ? tone : q.piece.startsWith("kaykit-forest/") ? LEAF_TONES.base : {}),
      ...q.swatchMap,
    }
    const placed: PlacedPiece = {
      piece: q.piece,
      x: at[0] + x * c + z * s,
      y: y + (q.y ?? 0),
      z: at[1] - x * s + z * c,
      rot: q.rot + rot,
      scale: q.scale,
    }
    if (Object.keys(map).length) placed.swatchMap = map
    out.push(placed)
  })
  return out
}

/** Which way, as a piece's `rot`, faces local +z out through the direction at angle `a` (radians, toward -z). */
const facingOut = (a: number) => Math.atan2(Math.cos(a), -Math.sin(a))

/**
 * A castle tile's curtain wall: a KayKit wall along each side in `walls` (sides 0–5 as in tilePath), a
 * gatehouse with banners on each side in `gates`, and a tower with a flag on every outer corner (where
 * two of its walled sides meet), all in the keep's `colour`. The tiles of a castle each pass the sides
 * that face out of it, so the walls run round the whole cluster.
 */
export function castleWalls(
  at: [number, number],
  y: number,
  walls: readonly number[],
  gates: readonly number[],
  colour: string,
): PlacedPiece[] {
  const out: PlacedPiece[] = []
  const A = R * (Math.sqrt(3) / 2) * 0.86
  const put = (piece: string, a: number, r: number, along: number, rot: number, scale: number, dy = 0) => {
    const ux = Math.cos(a)
    const uz = -Math.sin(a)
    // `along` runs on the side, perpendicular to the way out
    const q: PlacedPiece = {
      piece,
      x: at[0] + ux * r - uz * along,
      y: y + dy,
      z: at[1] + uz * r + ux * along,
      rot,
      scale,
    }
    if (piece.startsWith("kenney-")) q.swatchMap = KENNEY_WOOD
    out.push(q)
  }
  const walled = new Set([...walls, ...gates])
  for (const d of walled) {
    const a = (Math.PI / 180) * 60 * d
    const gate = gates.includes(d)
    put(
      gate ? "kaykit-hexagon/wall-straight-gate" : "kaykit-hexagon/wall-straight",
      a,
      A,
      0,
      a + Math.PI / 2,
      0.42,
    )
    if (gate)
      for (const s of [-1, 1])
        put(`kaykit-dungeon/banner-${colour}`, a, A + 0.75, s * 1.05, facingOut(a), 0.42, 0.35)
  }
  // towers on every other outer corner: enough to read as a castle, few enough that the wall shows
  for (let v = 0; v < 6; v += 2) {
    if (!walled.has(v) || !walled.has((v + 1) % 6)) continue
    const b = (Math.PI / 180) * (60 * v + 30)
    put(`kaykit-hexagon/building-tower-base-${colour}`, b, R * 0.86, 0, facingOut(b), 0.26)
    put("kenney-castle/flag", b, R * 0.86, 0, facingOut(b), 0.45, 12 * 0.26 - 0.1)
  }
  return out
}

/**
 * What gathers at a land tile's edges: reeds and pebbles along each side in `banks` (toward a river or
 * lake), fallen rocks along each side in `feet` (under a wall of ground two or more steps high). Placed
 * just inside the side, a few to a side, picked by `seed`.
 */
export function edgeDressing(
  at: [number, number],
  y: number,
  banks: readonly number[],
  feet: readonly number[],
  seed: number,
): PlacedPiece[] {
  const out: PlacedPiece[] = []
  const A = R * (Math.sqrt(3) / 2)
  const put = (
    d: number,
    inset: number,
    along: number,
    piece: string,
    scale: number,
    k: number,
    map?: Record<number, number>,
  ) => {
    const a = (Math.PI / 180) * 60 * d
    const ux = Math.cos(a)
    const uz = -Math.sin(a)
    const q: PlacedPiece = {
      piece,
      x: at[0] + ux * A * inset - uz * along,
      y,
      z: at[1] + uz * A * inset + ux * along,
      rot: hash2(seed, k, 31) * Math.PI * 2,
      scale,
    }
    if (map) q.swatchMap = map
    out.push(q)
  }
  let k = 0
  for (const d of banks)
    for (const along of [-1.1, -0.35, 0.4, 1.1]) {
      k++
      const h = hash2(seed, k, 37)
      if (h < 0.3) continue
      if (h < 0.82)
        put(
          d,
          0.9 + hash2(seed, k, 41) * 0.08,
          along,
          F(h < 0.55 ? "grass-2-a" : "grass-1-a"),
          1.7 + h * 0.6,
          k,
          LEAF_TONES.olive,
        )
      else put(d, 0.86, along, F(`rock-3-${"efgh"[k % 4]}`), 0.35 + h * 0.2, k)
    }
  for (const d of feet)
    for (const along of [-0.9, 0, 0.9]) {
      k++
      const h = hash2(seed, k, 43)
      if (h < 0.5) continue
      put(d, 0.8, along + (h - 0.5) * 0.4, F(`rock-3-${"ijkmno"[k % 6]}`), 0.3 + h * 0.3, k)
    }
  return out
}

/**
 * A road tile's path as triangle positions: a strip from the centre out through each side in `sides`
 * (side d faces 60°·d counter-clockwise from +x, toward -z), and a round patch where they meet.
 */
export function tilePath(at: [number, number], y: number, sides: readonly number[], w = 0.85): number[] {
  const [x, z] = at
  const out: number[] = []
  const reach = R * (Math.sqrt(3) / 2) + 0.05
  const tri = (a: number[], b: number[], c: number[]) =>
    out.push(a[0]!, y, a[1]!, b[0]!, y, b[1]!, c[0]!, y, c[1]!)
  for (const d of sides) {
    const a = (Math.PI / 180) * (60 * d)
    const ex = Math.cos(a) * reach
    const ez = -Math.sin(a) * reach
    const nx = -ez / reach
    const nz = ex / reach
    const q = [
      [x + nx * w, z + nz * w],
      [x - nx * w, z - nz * w],
      [x + ex - nx * w, z + ez - nz * w],
      [x + ex + nx * w, z + ez + nz * w],
    ]
    // both windings: the strip shows from above whichever way it runs
    tri(q[0]!, q[2]!, q[1]!)
    tri(q[0]!, q[3]!, q[2]!)
    tri(q[0]!, q[1]!, q[2]!)
    tri(q[0]!, q[2]!, q[3]!)
  }
  for (let k = 0; k < 8; k++) {
    const a0 = (k / 8) * Math.PI * 2
    const a1 = ((k + 1) / 8) * Math.PI * 2
    const p0 = [x + Math.cos(a0) * w, z + Math.sin(a0) * w]
    const p1 = [x + Math.cos(a1) * w, z + Math.sin(a1) * w]
    tri([x, z], p1, p0)
    tri([x, z], p0, p1)
  }
  return out
}

const FALLBACK = new Map(TILE_PREFABS.map((t) => [t.id, t]))
let installed: Map<string, TilePrefab> | null = null

/**
 * Puts the authored prefabs (data/tiles, validated: see `validateTilePrefab`) in place of the code
 * fallback; an id the data does not have still reads the fallback. `null` goes back to the fallback.
 */
export function installTilePrefabs(list: readonly TilePrefab[] | null): void {
  installed = list ? new Map(list.map((t) => [t.id, t])) : null
}

/** Every prefab the world builds from now: the installed data over the code fallback. */
export function tilePrefabs(): TilePrefab[] {
  if (!installed) return TILE_PREFABS
  return [...installed.values(), ...TILE_PREFABS.filter((t) => !installed!.has(t.id))]
}

/** The prefab with this id. */
export const tilePrefab = (id: string): TilePrefab | undefined => installed?.get(id) ?? FALLBACK.get(id)
