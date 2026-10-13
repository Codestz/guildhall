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
  /** A bot account (`…[bot]`): the knight's body cast in bronze (`TINTS`), a clockwork construct. */
  automaton: "knight",
}

/** Archetypes drawn with their body re-coloured (one colour over the whole body), as a hex colour. */
export const TINTS: Readonly<Partial<Record<ArchetypeId, string>>> = {
  automaton: "#b0793a",
}

export function bodyOf(archetype: ArchetypeId): Body {
  return BODIES[archetype]
}
