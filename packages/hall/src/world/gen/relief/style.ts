/**
 * The relief's art directions (`?relief=a|b|c`): three coherent takes on the same massifs, while
 * the default (`current`) stays as it was until one is picked. Everything a style changes is read
 * from here, so the field, the mesh and the dressing agree.
 *
 *   a  chunky facets: a coarse lattice, colour by smooth regional zones (foothill, wood, rock)
 *   b  strata: the massif stands in stacked ledges, rock bands between grassy and snowy tops
 *   c  sculpted peaks: taller, sharper summits, chunky facets, and the kit's rocks and conifer clumps
 */
export type ReliefStyle = "current" | "a" | "b" | "c"

/** The style a link asks for (`relief=a`), else the default. */
export function reliefStyleOf(search: string): ReliefStyle {
  const asked = new URLSearchParams(search).get("relief")
  return asked === "a" || asked === "b" || asked === "c" ? asked : "current"
}

/**
 * The lattice stride a style is meshed at: every second vertex (24 triangles a hex at RES 4) for the
 * facets, every vertex for strata, whose ledges need the finer lattice to keep their edges clean.
 */
export const strideOf = (style: ReliefStyle): number => (style === "b" ? 1 : 2)
/** The ledge spacing of strata, world units: two of the hex pack's terraces. */
export const LEDGE_STEP = 5
/** How much taller sculpted peaks stand than the asked height. */
export const PEAK_BOOST = 1.3
