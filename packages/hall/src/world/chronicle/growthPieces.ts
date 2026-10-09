/**
 * What each placed piece of the island does while it grows (ADR 0021), pure: read off its hex's
 * frame (growthFrame.ts) and the piece's role.
 *
 *   sea     never moves (the sea floor's own tiles)
 *   land    rides its hex up and down: tiles, mountains, hills
 *   nature  grows (scales up) a moment after its land is up: trees, rocks, the wilds
 *   build   a building: a scaffold goes up on the risen land, then the building rises out of it
 *   prop    small things round buildings (fences, crates, flags, a farm's dirt plots) pop up once the
 *           building is done
 */

export type Role = "sea" | "land" | "nature" | "build" | "prop"

/** How far a piece sinks below its place when its hex is fully sunk, plus its own height (world units). */
export const DEPTH = 3.5

/** Scaffold up / building rising / building done, film seconds after the land is up (+ jitter). */
const SCAFFOLD_AT = 0.15
const BUILD_AT = 1.05
const BUILT_AT = 1.65
const PROP_AT = 1.75
const GREEN_AT = 0.3
const GREEN_S = 0.8
const POP_S = 0.25

export function roleOf(piece: string): Role {
  if (piece === "hex_water") return "sea"
  if (/^(hex_|mountain_|hills_)/.test(piece)) return "land"
  if (/^(trees?_|tree_|rock_|bush|grass|plant|flower|mushroom|waterlily|waterplant)/i.test(piece))
    return "nature"
  if (/^building_dirt/.test(piece)) return "prop"
  if (/^building_/.test(piece)) return "build"
  return "prop"
}

export interface PieceState {
  visible: boolean
  /** Multiplies (DEPTH + the piece's own height): the piece's y offset. */
  rise: number
  /** Uniform scale, and the extra vertical scale a rising building has. */
  scale: number
  scaleY: number
  /** A scaffold's own scale (0: none) round a building that is going up. */
  scaffold: number
}

const smooth = (a: number, b: number, v: number): number => {
  const p = Math.min(1, Math.max(0, (v - a) / (b - a)))
  return p * p * (3 - 2 * p)
}
/** 0 → 1 over `span` with a small overshoot (the pop). */
const pop = (v: number, span: number): number => {
  const p = Math.min(1, Math.max(0, v / span))
  return p >= 1 ? 1 : 1 + 2.7 * (p - 1) ** 3 + 1.7 * (p - 1) ** 2
}

/**
 * A piece of `role` on a hex at `rise` / `up` / `since` (growthFrame.ts), `salt` 0–1 its own
 * jitter, written into `out`.
 */
export function pieceAt(
  role: Role,
  rise: number,
  up: number,
  since: number,
  salt: number,
  out: PieceState,
): PieceState {
  out.rise = role === "sea" ? 0 : rise
  out.scale = 1
  out.scaleY = 1
  out.scaffold = 0
  out.visible = role === "sea" || up > 0
  if (role === "sea" || role === "land" || !out.visible) return out
  const jitter = salt * 0.5
  if (role === "nature") {
    const grown = smooth(GREEN_AT + jitter, GREEN_AT + jitter + GREEN_S, since)
    out.scale = grown
    out.visible = grown > 0.01
    return out
  }
  if (role === "prop") {
    out.scale = pop(since - PROP_AT - jitter, POP_S)
    out.visible = out.scale > 0.01
    return out
  }
  // A building: scaffold first, then it rises out of it, then the scaffold comes down.
  const s = since - jitter
  out.scaffold = Math.min(pop(s - SCAFFOLD_AT, POP_S), 1 - smooth(BUILT_AT, BUILT_AT + 0.3, s))
  const rising = smooth(BUILD_AT, BUILT_AT, s)
  out.scaleY = 0.04 + 0.96 * rising
  out.visible = rising > 0
  return out
}

/** A stable 0–1 from an instance's place (no sequence, so order never matters). */
export function saltOf(x: number, z: number): number {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453
  return s - Math.floor(s)
}
