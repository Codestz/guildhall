/**
 * The relief's art directions (`?relief=a|b|c|d|current`): coherent takes on the same massifs. The
 * default is the hybrid (d). Everything a style changes is read from here, so the field, the mesh
 * and the dressing agree.
 *
 *   a  chunky facets: a coarse lattice, colour by smooth regional zones (foothill, wood, rock)
 *   b  strata: the massif stands in stacked ledges, rock bands between grassy and snowy tops
 *   c  sculpted peaks: taller, sharper summits, chunky facets, and the kit's rocks and conifer clumps
 *   d  hybrid, the default: b's ledges (as true stairs) up to the tree line, c's faceted peak above
 *   current  the relief as it was before the styles (`?relief=current`)
 */
export type ReliefStyle = "current" | "a" | "b" | "c" | "d"

/** The style a link asks for (`relief=a`), else the default (the hybrid). */
export function reliefStyleOf(search: string): ReliefStyle {
  const asked = new URLSearchParams(search).get("relief")
  return asked === "a" || asked === "b" || asked === "c" || asked === "current" ? asked : "d"
}

/**
 * The lattice stride a style is meshed at: every second vertex (24 triangles a hex at RES 4) for the
 * facets, every vertex for strata (b), whose ramped ledges need the finer lattice to keep their edges clean.
 */
export const strideOf = (style: ReliefStyle): number => (style === "b" ? 1 : 2)
/** The ledge spacing of strata, world units: two of the hex pack's terraces. */
export const LEDGE_STEP = 5
/** How much taller sculpted peaks stand than the asked height. */
export const PEAK_BOOST = 1.3
/** Styles whose peaks are sculpted (taller, sharpened) and dressed with the kit's clumps and rocks. */
export const isSculpted = (style: ReliefStyle): boolean => style === "c" || style === "d"
/** Where d's ledges end, as a share of its height: above the top ledge the faceted peak rises. */
export const LEDGE_SHARE = 0.5
