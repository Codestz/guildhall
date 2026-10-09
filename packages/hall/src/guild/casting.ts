import type { Session } from "@guildhall/core"
import { AGENT_RANK, ARCHETYPES, type Archetype, castOf, type Rank } from "@guildhall/roster"

/**
 * Who a session is in the hall, and what the hall calls them (ADR 0010). The one place the rule
 * "a party's root is its Guildmaster" lives: the store, the ordinals, the log and the moments all
 * ask here.
 *
 * Two ways to name the cast (Settings → Names, hud/prefs.ts):
 *   world   the archetype (`Warden`), subtitled with the source's own name (`verifier`)
 *   source  the source's own names alone (`Verifier`, `general`), as the hall named them before
 */
export type Names = "world" | "source"

export interface Named {
  archetype: Archetype
  /** The unnumbered name shown (`Warden`, or `Verifier` with source names). Ordinals count by it. */
  name: string
  /** The source's own name under it (`verifier`); empty when it says nothing the name doesn't. */
  subtitle: string
  /** The sigil's two letters. */
  glyph: string
  plural: string
}

type Who = Pick<Session, "agent" | "archetype" | "parentID">

/**
 * A party's root is its Guildmaster, whatever agent runs it; anyone else is cast by the roster.
 * `root`: whether `s` leads its party (by default: it has no parent).
 */
export function namedOf(s: Who, names: Names = "world", root = !s.parentID): Named {
  const cast = castOf(s.agent, s.archetype)
  const archetype = root ? ARCHETYPES.guildmaster : cast.archetype
  if (names === "source" && !root) {
    const name = cast.sourceTitle
    return { archetype, name, subtitle: "", glyph: initials(name), plural: `${name}s` }
  }
  const subtitle =
    names === "world" && cast.source.toLowerCase() !== archetype.name.toLowerCase() ? cast.source : ""
  return { archetype, name: archetype.name, subtitle, glyph: archetype.glyph, plural: archetype.plural }
}

export const RANK_LABEL: Readonly<Record<Rank, string>> = {
  apprentice: "Apprentice",
  journeyman: "Journeyman",
  master: "Master",
}

/** How seasoned an agent session is (roster ranks.ts): by its deeds and tokens so far. */
export function rankOf(s: Pick<Session, "entries" | "tokens">): Rank {
  let deeds = 0
  for (const entry of s.entries) if (entry.kind === "tool") deeds++
  return AGENT_RANK({ deeds, tokens: s.tokens })
}

/** Two letters for a sigil from a plain name: `Verifier` → `Ve`, `Product owner` → `Po`. */
export function initials(name: string): string {
  const words = name.split(/[\s-]+/).filter(Boolean)
  const letters = words.length > 1 ? (words[0]?.[0] ?? "") + (words[1]?.[0] ?? "") : name.slice(0, 2)
  return (letters[0] ?? "").toUpperCase() + letters.slice(1).toLowerCase()
}
