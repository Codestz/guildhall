import KIT from "./kit.json"
import { ROOM, TILE } from "./layout.ts"

/**
 * Every piece of furniture and decor in the great hall, as data (piece names are kit.glb nodes,
 * listed in kit.json). `y` is the surface it stands on; the piece's own bottom is lifted onto it
 * unless `mounted` (wall pieces carry their own height).
 */
export type Piece = keyof typeof KIT

export interface Placement {
  piece: Piece
  x: number
  z: number
  /** Surface height it rests on (0 = floor). */
  y?: number
  /** Rotation about Y, radians. */
  rot?: number
  scale?: number
  mounted?: boolean
}

/** How far a piece must be lifted so its bottom rests on y = 0. */
export function liftOf(piece: Piece): number {
  return -(KIT[piece].min[1] ?? 0)
}

/** The height of a piece — a table's top, for things placed on it. */
export function topOf(piece: Piece): number {
  return KIT[piece].size[1] ?? 0
}

const T = topOf
const HALF_W = ROOM.width / 2
const HALF_D = ROOM.depth / 2
const QUARTER = Math.PI / 2

export const FURNITURE: readonly Placement[] = [
  // Quest board + dais (back centre): the guildmaster's place.
  { piece: "rug_rectangle_stripes_A", x: 0, z: -8.6, scale: 1.6 },
  { piece: "table_medium_long", x: 0, z: -10.4 },
  { piece: "map", x: -0.5, z: -10.4, y: T("table_medium_long") },
  { piece: "coin_stack_medium", x: 1, z: -10.2, y: T("table_medium_long") },
  { piece: "chest_gold", x: 3.2, z: -10.8, rot: -0.3 },
  { piece: "candle_triple", x: -2.2, z: -10.9 },

  // Library (back left).
  { piece: "shelf_B_large_decorated", x: -15, z: -12 },
  { piece: "shelf_B_large_decorated", x: -11, z: -12 },
  { piece: "cabinet_medium_decorated", x: -17.2, z: -9.2, rot: QUARTER },
  { piece: "lantern", x: -13, z: -11.4 },
  { piece: "book_set", x: -15, z: -11.6, y: T("shelf_B_large_decorated") },

  // Infirmary (back, between library and dais).
  { piece: "bed_frame", x: -6.5, z: -10.3 },
  { piece: "bed_frame", x: -3.5, z: -10.3 },
  { piece: "candle_lit", x: -5, z: -11.4 },

  // Forge (back right).
  { piece: "anvil", x: 9.6, z: -9.6 },
  { piece: "anvil", x: 13, z: -9.6 },
  { piece: "anvil", x: 16.2, z: -9.6 },
  { piece: "grindstone", x: 17, z: -5.6, rot: -QUARTER },
  { piece: "barrel_large", x: 7.4, z: -10.8 },
  { piece: "bucket_metal", x: 11.3, z: -10.9 },
  { piece: "tongs", x: 13, z: -9.6, y: T("anvil"), rot: QUARTER },
  { piece: "hammer", x: 16.2, z: -9.6, y: T("anvil"), rot: 0.6 },

  // Drafting table (left middle): architect.
  { piece: "table_medium", x: -13, z: -1.6 },
  { piece: "blueprint_stacked", x: -13.2, z: -1.6, y: T("table_medium") },
  { piece: "drafting_compass", x: -12.3, z: -1.2, y: T("table_medium") },
  { piece: "lamp_standing", x: -16.5, z: -2.6 },

  // Designer's corner (right middle).
  { piece: "rug_oval_A", x: 13, z: -0.4, scale: 1.3 },
  { piece: "table_small_decorated_A", x: 13, z: -1.8 },
  { piece: "pictureframe_large_A", x: 14.4, z: -2.2, y: 1, mounted: true, rot: -0.3, scale: 1.4 },
  { piece: "armchair", x: 16.4, z: 1.4, rot: -QUARTER },

  // Map table (left front): explorer, researcher.
  { piece: "table_long", x: -13, z: 6.4, rot: QUARTER },
  { piece: "map", x: -13.4, z: 6.4, y: T("table_long") },
  { piece: "compass_base", x: -11.6, z: 6.8, y: T("table_long") },
  { piece: "map_rolled", x: -15, z: 6.2, y: T("table_long"), rot: 0.4 },

  // Scroll desk (front, left of centre): product owner.
  { piece: "table_medium", x: -5.5, z: 7 },
  { piece: "journal_open", x: -5.6, z: 7, y: T("table_medium") },
  { piece: "candle_lit", x: -4.8, z: 7.4, y: T("table_medium") },

  // Inspection bench (right front): verifier.
  { piece: "table_medium_long", x: 13, z: 7 },
  { piece: "magnifying_glass", x: 12.4, z: 7, y: T("table_medium_long"), rot: 0.3 },
  { piece: "lantern", x: 14.2, z: 7.2, y: T("table_medium_long") },
  { piece: "crates_stacked", x: 16.6, z: 10.2, rot: 0.2 },

  // Tavern (front, right of centre): finished adventurers rest here.
  { piece: "table_long", x: 5, z: 6.4 },
  { piece: "plate_food_A", x: 5, z: 5.4, y: T("table_long") },
  { piece: "mug_full", x: 5.2, z: 7.4, y: T("table_long") },
  { piece: "stool", x: 3.2, z: 4.4 },
  { piece: "stool", x: 3.2, z: 6.4 },
  { piece: "stool", x: 3.2, z: 8.4 },
  { piece: "stool", x: 6.8, z: 4.4 },
  { piece: "stool", x: 6.8, z: 6.4 },
  { piece: "stool", x: 6.8, z: 8.4 },
  { piece: "keg_decorated", x: 8.6, z: 10.6, rot: Math.PI },
  { piece: "barrel_small_stack", x: 1.6, z: 10.9 },

  // Overflow bench (right of the hearth).
  { piece: "table_long", x: 6, z: -2, rot: QUARTER },

  // Gate approach and corners; a stone step outside the gate for arrivals and departures.
  { piece: "floor_tile_large", x: 0, z: HALF_D + 2.6, mounted: true },
  { piece: "pillar_decorated", x: -3.4, z: HALF_D - 1 },
  { piece: "pillar_decorated", x: 3.4, z: HALF_D - 1 },
  { piece: "pillar", x: -HALF_W + 0.75, z: -HALF_D + 0.75 },
  { piece: "pillar", x: HALF_W - 0.75, z: -HALF_D + 0.75 },
  { piece: "pillar", x: -HALF_W + 0.75, z: HALF_D - 0.75 },
  { piece: "pillar", x: HALF_W - 0.75, z: HALF_D - 0.75 },
  { piece: "barrel_small_stack", x: -16.4, z: 10.9 },
]

/** Things hung on the walls; they fade with their wall (see Room). */
export interface WallPiece extends Placement {
  side: Side
}
export type Side = "back" | "front" | "left" | "right"

export const WALL_DECOR: readonly WallPiece[] = [
  { side: "back", piece: "banner_shield_blue", x: 0, z: -HALF_D - 0.5, mounted: true },
  { side: "back", piece: "banner_patternA_blue", x: -8, z: -HALF_D - 0.5, mounted: true },
  { side: "back", piece: "banner_patternA_blue", x: 8, z: -HALF_D - 0.5, mounted: true },
  { side: "back", piece: "torch_mounted", x: -4, z: -HALF_D, y: 2.4, mounted: true },
  { side: "back", piece: "torch_mounted", x: 4, z: -HALF_D, y: 2.4, mounted: true },
  { side: "back", piece: "torch_mounted", x: -12, z: -HALF_D, y: 2.4, mounted: true },
  { side: "back", piece: "torch_mounted", x: 12, z: -HALF_D, y: 2.4, mounted: true },
  { side: "left", piece: "banner_thin_yellow", x: -HALF_W - 0.5, z: -2, rot: QUARTER, mounted: true },
  { side: "left", piece: "torch_mounted", x: -HALF_W, z: 4, y: 2.4, rot: QUARTER, mounted: true },
  { side: "right", piece: "banner_thin_yellow", x: HALF_W + 0.5, z: -2, rot: -QUARTER, mounted: true },
  { side: "right", piece: "torch_mounted", x: HALF_W, z: 4, y: 2.4, rot: -QUARTER, mounted: true },
]

/** Wall segments: one per tile edge; windows on the back wall, the gate in the front. */
export interface WallSegment {
  side: Side
  piece: Piece
  x: number
  z: number
  rot: number
}

export const WALLS: readonly WallSegment[] = [
  ...Array.from({ length: ROOM.cols }, (_, i) => {
    const x = -HALF_W + TILE / 2 + i * TILE
    const windowed = i === 2 || i === 6
    return {
      side: "back" as const,
      piece: (windowed ? "wall_window_open" : "wall") as Piece,
      x,
      z: -HALF_D - 0.5,
      rot: 0,
    }
  }),
  ...Array.from({ length: ROOM.cols }, (_, i) => {
    const x = -HALF_W + TILE / 2 + i * TILE
    return {
      side: "front" as const,
      piece: (i === 4 ? "wall_doorway" : "wall") as Piece,
      x,
      z: HALF_D + 0.5,
      rot: Math.PI,
    }
  }),
  ...Array.from({ length: ROOM.rows }, (_, j) => {
    const z = -HALF_D + TILE / 2 + j * TILE
    return {
      side: "left" as const,
      piece: (j === 2 ? "wall_window_open" : "wall") as Piece,
      x: -HALF_W - 0.5,
      z,
      rot: QUARTER,
    }
  }),
  ...Array.from({ length: ROOM.rows }, (_, j) => {
    const z = -HALF_D + TILE / 2 + j * TILE
    return {
      side: "right" as const,
      piece: (j === 2 ? "wall_window_open" : "wall") as Piece,
      x: HALF_W + 0.5,
      z,
      rot: -QUARTER,
    }
  }),
]

/** Outward normal of each side in the xz plane: a wall whose side faces the camera fades. */
export const NORMALS: Record<Side, readonly [number, number]> = {
  back: [0, -1],
  front: [0, 1],
  left: [-1, 0],
  right: [1, 0],
}
