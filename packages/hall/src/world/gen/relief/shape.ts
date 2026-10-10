/**
 * The relief's shaping constants: one terrace language from the foot to the summit. A massif is
 * stairs all the way up (ledges of one height, each narrower than the one below, strata.ts), the
 * summit a stepped top: no sculpted faces, no kit rocks. The field, the mesh and the dressing all
 * read from here, so they agree.
 */

/** The lattice stride the trails are laid on: every second vertex (a shelf two triangles wide). */
export const TRAIL_STRIDE = 2
/** The ledge spacing, world units: two of the hex pack's terraces. Every riser of a massif is this high. */
export const LEDGE_STEP = 5
/** How much taller the peaks are asked than the height they come to (the steps cut the tops down). */
export const PEAK_BOOST = 1.5
