import type { ArchetypeId } from "./archetypes.ts"

/**
 * The KayKit adventurer that draws each archetype on the hex island. Eleven archetypes share five
 * bodies, grouped by family (decisions, "HUD + agents + events phase"); a role is told apart by what
 * it carries and its banner's colour (`Archetype.gear`, `Archetype.color`), not by its body.
 *
 * V1's `Archetype.model` is V1's own cast and stays as it was; this table is V2's.
 */
export type Body = "mage" | "knight" | "ranger" | "barbarian" | "rogue"

export const BODIES: Readonly<Record<ArchetypeId, Body>> = {
  architect: "mage",
  scholar: "mage",
  illuminator: "mage",
  warden: "knight",
  guildmaster: "knight",
  scout: "ranger",
  herald: "ranger",
  artisan: "barbarian",
  archivist: "rogue",
  wanderer: "rogue",
  /** Not named by the decision: a bot is drawn as the plain fallback, the Wanderer's body. */
  automaton: "rogue",
}

export function bodyOf(archetype: ArchetypeId): Body {
  return BODIES[archetype]
}
