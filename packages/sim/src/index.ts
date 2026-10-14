/**
 * The sim layer (ADR 001's order: core < assets < world < sim < render): the guild's domain logic,
 * pure and worker-safe. It reads core's wire vocabulary and never imports three, react or node.
 *
 *   guild/   the session model built from changes, its views, and the moments a change makes
 *   roster/  who an adventurer is (archetype, body), how seasoned (rank), how interesting a change is
 *   story/   what the moments mean in words: captions, the Legends book, the Chronicle card's recap,
 *            and a repository's story by era (story/repo)
 *   repo/    the Repo Chronicle: a repository's history (V1's format), read at a day
 *   events/  the wire normalised into world events, folded into the guild's world, logged with checkpoints
 *   stories/ told guild runs for the demos: V1's Script DSL and stories, and the saga for the hex island
 *   director/ which shot the camera runs: V1's ranking, holds and user override, as a pure pick
 *   life/    the heroes' itineraries on the walk graph, planned from those events, sampled as poses
 */

export * from "./director/index.ts"
export * from "./events/index.ts"
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
  experienceOf,
  firstWords,
  type Node,
  rootOf,
  subagentsOf,
  titleOf,
  toolTarget,
} from "./guild/views.ts"
export * from "./life/index.ts"
export * from "./repo/index.ts"
export * from "./roster/index.ts"
export * from "./stories/index.ts"
export * from "./story/index.ts"
