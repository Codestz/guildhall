/**
 * The relief's shaping constants: ledges as true stairs up to the tree line, a sculpted faceted
 * peak above (the one art direction the massifs are built in). The field, the mesh and the dressing
 * all read from here, so they agree.
 */

/** The lattice stride the trails are laid on: every second vertex (a shelf two triangles wide). */
export const TRAIL_STRIDE = 2
/** The ledge spacing, world units: two of the hex pack's terraces. */
export const LEDGE_STEP = 5
/** How much taller the sculpted peaks stand than the asked height. */
export const PEAK_BOOST = 1.3
/** Where the ledges end, as a share of the height: above the top ledge the faceted peak rises. */
export const LEDGE_SHARE = 0.5
