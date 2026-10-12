/**
 * The draw contracts render reads: the flat draw list of pieces, the ground's and the water's outlines,
 * and the lights after dark. Positions are `[x, z]` on the ground plane, in metres.
 */
import type { Vec2 } from "../geom/vec.ts"

/** The two levels of the flat world (metres): everything stands on land; water sits below it. */
export const LEVELS = { land: 0, water: -0.6 } as const

export interface PieceInstance {
  piece: string
  x: number
  y: number
  z: number
  rot: number
  scale: number
  swatchMap?: Record<number, number>
}

export interface TownDraw {
  pieces: PieceInstance[]
  ground: {
    /** The main land (the island) and its holes (lakes). */
    land: Vec2[]
    holes: Vec2[][]
    /** Further land pieces beside it (islets), outlines without holes. */
    islets?: Vec2[][]
    overlays: { kind: "cobble" | "plaza" | "dirt" | "field" | "garden" | "sand"; poly: Vec2[] }[]
    /** Building and wall footprints, for contact darkening. */
    footprints: Vec2[][]
  }
  /** `level` is `LEVELS.water`. */
  water: { polys: Vec2[][]; level: number; shore: Vec2[][] }
}

/** How shaded, light, dry or worn the grass is at a point, each 0–1 (the ground's `Tint` returns it). */
export interface GroundTint {
  shade: number
  light: number
  dry: number
  worn: number
}

export const LIGHT_KINDS = ["street", "market", "torch", "door", "pier"] as const
export type LightKind = (typeof LIGHT_KINDS)[number]

/** One light: its kind, where the flame or glass is (`[x, y, z]`, metres) and its pool's radius. */
export interface LightPoint {
  kind: LightKind
  at: [x: number, y: number, z: number]
  radius: number
}

/**
 * One lit window: the pane's centre, its heading (`rot`, the pane faces local +x turned by it), size,
 * the house's rank (0–1: the late-night share of dark houses that leaves it lit is below it) and the
 * room's (a few rooms stay dark in a lit house).
 */
export interface WindowLight {
  at: [x: number, y: number, z: number]
  rot: number
  w: number
  h: number
  house: number
  room: number
}

/** What glows after dark: the lamp pieces, their lights and the lit windows. */
export interface TownLights {
  pieces: PieceInstance[]
  points: LightPoint[]
  windows: WindowLight[]
}
