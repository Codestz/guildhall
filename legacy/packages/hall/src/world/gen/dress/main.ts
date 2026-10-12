import { cellToWorld, type LandPlacement } from "../../lands.ts"
import type { Spot } from "../../layout.ts"
import { composed } from "../../prefabs/composite/index.ts"
import { type Door, doorsOf, type Fixture, fixturesOf, instantiate } from "../../prefabs/index.ts"
import type { IslandPlan } from "../plan.ts"

/**
 * An island's main building: its heart's composite landmark (prefabs/composite), stood on the hex
 * the plan reserved for it (plan/heart.ts), as the seed varies it and in the palette's colour. Its
 * pieces are the civic centre's, and what the world and the camera know of it is this record: where
 * it stands, which way it faces, where the eye lands, and its doors.
 */

export interface MainBuilding {
  /** The composite's id (prefabs/composite) and the seed that varied it. */
  id: string
  label: string
  seed: number
  at: Spot
  rot: number
  rings: 0 | 1 | 2
  /** Where the eye lands, in the world (y up): its keep's top, its spire. */
  focal: Fixture
  /** Where someone goes in, in the world. */
  doors: Door[]
  /** How far its pieces reach from `at`, world units (a coastal one's dock, out in the sea, included). */
  reach: number
}

/** A hex's corner: how far a composite's parts reach past its last ring (composite/index.ts' footprint rule), and a dock a hex beyond. */
const CORNER = 5.78
const DOCK = 10

/** The island's main building and its pieces, or none (a plan without a heart: generator 1's). */
export function mainOf(plan: IslandPlan): { main: MainBuilding; placements: LandPlacement[] } | undefined {
  const { heart } = plan
  if (!heart) return undefined
  const kit = plan.identity?.palette.roof ?? "blue"
  const made = composed(heart.id, heart.seed, kit)
  const at = cellToWorld(heart.cell)
  const focal = fixturesOf([made.focal], at, heart.rot)[0] as Fixture
  return {
    placements: instantiate(made, at, heart.rot, kit),
    main: {
      id: heart.id,
      label: made.label,
      seed: heart.seed,
      at,
      rot: heart.rot,
      rings: heart.rings,
      focal,
      doors: doorsOf(made, at, heart.rot),
      reach: heart.rings * 10 + CORNER + (made.composite.coastal ? DOCK : 0),
    },
  }
}
