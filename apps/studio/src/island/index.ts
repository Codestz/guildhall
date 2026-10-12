/**
 * The island (`/island?seed=…&hour=…`): the terrain-first island in full, its towns, fields, woods,
 * landmarks and water under the real sky, clouds and night. The same view the terrain lab's 3D button
 * opens, at its own address for the showcase.
 */
import type { Screen } from "../screens.ts"
import { terra3d } from "../terra3d/index.ts"

export const island: Screen = { ...terra3d, id: "island", title: "Island" }
