/**
 * The heroes' life on the island (plan-hud-events.md L1): itineraries planned from the world's events
 * on the walk graph, sampled as pure poses, and the source that draws them reads.
 *
 *   itineraries  `LifePlanner` (push events, advance the clock), `itineraries(log, kit)`, `poseAt`
 *   source       `AgentSource`, `planAgents` (plain data a worker posts), `plannedSource`, `agentSourceFromLog`
 */
export {
  type Itinerary,
  type ItineraryOptions,
  itineraries,
  type LifeKit,
  LifePlanner,
  poseAt,
  shownAt,
  stepPose,
  walkEnd,
} from "./itineraries.ts"
export {
  type AgentInfo,
  type AgentSource,
  agentSourceFromLog,
  agentsOf,
  type PlannedAgents,
  planAgents,
  plannedSource,
} from "./source.ts"
