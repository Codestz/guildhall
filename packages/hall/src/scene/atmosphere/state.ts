import { createSky, type SkyState } from "./sky.ts"

/**
 * The sky's state this frame, shared by everything that lights or grades the scene (the post
 * pass, the hearth, the station sigils, the lamps). Written once a frame by `Atmosphere`, before
 * any of them reads it.
 */
export const sky: SkyState = createSky()
