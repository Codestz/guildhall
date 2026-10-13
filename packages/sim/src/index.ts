/**
 * The sim layer (ADR 001's order: core < assets < world < sim < render): the guild's domain logic,
 * pure and worker-safe. It reads core's wire vocabulary and never imports three, react or node.
 *
 *   guild/   the session model built from changes, its views, and the moments a change makes
 *   roster/  who an adventurer is (archetype, body), how seasoned (rank), how interesting a change is
 *   story/   what the moments mean in words: captions, the Legends book, the Chronicle card's recap
 */

export { GuildModel } from "./guild/guildModel.ts"
export {
  apply,
  applyAll,
  type Entry,
  emptyModel,
  type Model,
  ORPHANED,
  type Session,
  type Status,
  working,
} from "./guild/model.ts"
export {
  type Glance,
  glance,
  type Happening,
  type Moment,
  type MomentKind,
  momentsOf,
  type SeaMoment,
  type SeaMomentKind,
  seaMomentOf,
  sizeOf,
} from "./guild/moments.ts"
export {
  type Activity,
  activityOf,
  callsOf,
  countsOf,
  experienceOf,
  firstWords,
  type Group,
  groupsOf,
  groupWorking,
  type Node,
  rootOf,
  roundStart,
  roundsOf,
  runTime,
  subagentsOf,
  titleOf,
  toolTarget,
} from "./guild/views.ts"
export * from "./roster/index.ts"
export * from "./story/index.ts"
