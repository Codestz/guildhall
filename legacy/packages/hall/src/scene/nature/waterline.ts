import { HEX_SCALE } from "../../world/lands.ts"

/**
 * Where the water lies, world y: a hair above the pack's flat water (sea and lake at y −1, the
 * river's channel at −0.5), so the land's own geometry clips it where the tiles put the shore.
 */
export const SEA_Y = -0.2 * HEX_SCALE + 0.05
export const RIVER_Y = -0.1 * HEX_SCALE + 0.06

/** The land is what stands above this (world y): a wet strip of sea-level sand is under the water. */
export const LAND_ABOVE = SEA_Y + 0.02
/** Seen from below, a surface lower than this (world y) stands in the water: a post, a rock's foot. */
export const STANDS_BELOW = RIVER_Y + 0.35
