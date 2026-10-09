import { DMath } from "../../dmath.ts"
import type { LandPlacement } from "../../lands.ts"
import { crowds, type Footprint, footprintsOf } from "./footprints.ts"

/**
 * The last word on room (dress.ts): whatever island the generator grew, no two buildings stand
 * through each other. Each building has a rank, and one makes way for any of lower rank (a higher
 * number) that it would touch. Rank 0 stands wherever it is (venues.ts keeps the venues clear of
 * one another and of the civic centre's halls); of equals, the first in the order given stays.
 */

export const RANK = {
  /** The civic centre's halls and the venues. */
  FIXED: 0,
  /** A district's landmark. */
  LANDMARK: 1,
  /** Lots, fields' mills, and the rest. */
  TOWN: 2,
  /** A plaza's well and stalls. */
  PLAZA: 3,
  /** The wall's pieces and towers, which meet end to end by design and so never make way for each other. */
  WALL: 4,
} as const

/** Buildings this far apart (centre to centre, world units) cannot touch: no footprint is wider. */
const FAR = 16

/** The buildings among `items` that make way for another. */
export function settle(
  items: readonly LandPlacement[],
  rank: (item: LandPlacement) => number,
): Set<LandPlacement> {
  const standing: { at: LandPlacement; shape: Footprint }[] = []
  const stand = (item: LandPlacement): void => {
    for (const shape of footprintsOf([item])) standing.push({ at: item, shape })
  }
  const clear = (item: LandPlacement): boolean =>
    footprintsOf([item]).every((shape) =>
      standing.every(
        (other) =>
          DMath.hypot(item.x - other.at.x, item.z - other.at.z) >= FAR || !crowds(shape, other.shape, 0),
      ),
    )
  const ranked = items.map((item) => [rank(item), item] as const)
  const dropped = new Set<LandPlacement>()
  for (const [, item] of ranked.filter(([r]) => r === RANK.FIXED)) stand(item)
  for (const next of [RANK.LANDMARK, RANK.TOWN, RANK.PLAZA, RANK.WALL])
    for (const [, item] of ranked.filter(([r]) => r === next)) {
      if (!clear(item)) dropped.add(item)
      else if (next !== RANK.WALL) stand(item)
    }
  return dropped
}
