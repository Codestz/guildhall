import { ARCHETYPES, type Archetype, isArchetype } from "./archetypes.ts"
import { ROLES } from "./roles.ts"

/**
 * The adapter from a source's actor to the world's cast (ADR 0010). The wire keeps the source's own
 * names (`guild-verifier`, `Explore`, `dependabot[bot]`); this says which archetype draws them and
 * what to call them in the source's own words.
 */
export interface Casting {
  archetype: Archetype
  /** The source's own name for them, as a subtitle: `verifier`, `general`, `dependabot[bot]`. */
  source: string
  /** The source's own title for them, for the plain-names setting: `Verifier`, `general`. */
  sourceTitle: string
}

/** GitHub's mark of an app account (`dependabot[bot]`, `github-actions[bot]`). */
const BOT = /\[bot\]$/i

/**
 * Who `agent` is in the world. An archetype the source sent (`session.archetype`) wins; else a
 * roster role's own; else a bot account is an Automaton; else a Wanderer.
 */
export function castOf(agent: string, declared?: string): Casting {
  const role = ROLES.find((r) => r.id === agent)
  const archetype = isArchetype(declared)
    ? ARCHETYPES[declared]
    : role
      ? ARCHETYPES[role.archetype]
      : ARCHETYPES[BOT.test(agent) ? "automaton" : "wanderer"]
  return role
    ? { archetype, source: role.title.toLowerCase(), sourceTitle: role.title }
    : { archetype, source: agent, sourceTitle: agent }
}
