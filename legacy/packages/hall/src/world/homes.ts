import type { Fixture } from "./prefabs/index.ts"
import type { VenueDoor } from "./venues.ts"

/**
 * A home of a gen 2 island (generator v2's town lots, gen/dress/homes.ts): a door the townsfolk go
 * out of at dawn and back into at dusk, and the window that glows while someone is in (scene/life/
 * Venues.tsx lights it as it does a venue's). One per door of each lot, so a row house is two.
 */
export interface Home {
  /** "home:<n>": stable for an island. */
  id: string
  /** The district (its folder) the lot belongs to. */
  district: string
  /** As a venue's: stand at `step` facing `inward`, walk to `sill`. */
  door: VenueDoor
  /** The window beside the door, in the world. */
  window: Fixture
}
