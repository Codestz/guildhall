/**
 * The roster, ported from V1 (main:packages/roster) as it was: who an adventurer is in the world
 * (archetypes, cast), how seasoned (ranks), how a deed looks (deeds) and how much a change is worth
 * showing (interest), plus the roles the herald injects into the host. V2 adds the KayKit body table.
 */

export {
  ARCHETYPE_IDS,
  ARCHETYPES,
  type Archetype,
  type ArchetypeId,
  type Gear,
  isArchetype,
  type Site,
  type Station,
} from "./archetypes.ts"
export { BODIES, type Body, bodyOf, TINTS } from "./bodies.ts"
export { archetypeOf, type Casting, castOf } from "./cast.ts"
export { type Clip, type DeedLook, deedLook, type Effect } from "./deeds.ts"
export { interestOf } from "./interest.ts"
export {
  AGENT_RANK,
  COMMIT_FLOOR,
  COMMIT_QUANTILE,
  type CommitRule,
  commitRank,
  type Experience,
  gearAt,
  pipsOf,
  RANKS,
  type Rank,
  type RankRule,
  rankOf,
} from "./ranks.ts"
export { type Access, CHECKS, type Permissions, PROTECTED, type Rules, type Tier } from "./role.ts"
export { ROLES, type Role, roleOf } from "./roles.ts"
