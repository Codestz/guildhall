import { HEX_SCALE, type LandPiece, PIECES } from "../../lands.ts"

/**
 * How big the mountain's rocks may stand beside the town: the kit's rocks are scaled up on the flanks
 * (bigger higher up), but the largest of them is no more than about one and a half houses across, so
 * a boulder never dwarfs the buildings below it.
 */

/** A house's width, world units (the kit's `building_home_B`: 0.875 across at HEX_SCALE 5). */
export const HOUSE = 5
/** The widest a rock may be, world units. */
export const MOST_ROCK = 1.5 * HOUSE

/** `scale` for `piece`, held so its widest side is at most MOST_ROCK. */
export function fitRock(piece: LandPiece, scale: number): number {
  const [width, , depth] = PIECES[piece].size as [number, number, number]
  return Math.min(scale, MOST_ROCK / (Math.max(width, depth) * HEX_SCALE))
}
