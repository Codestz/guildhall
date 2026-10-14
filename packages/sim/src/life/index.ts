/**
 * The heroes' life on the island (plan-hud-events.md L1): itineraries planned from the world's events
 * on the walk graph, sampled as pure poses, and the source that draws them reads.
 *
 *   itineraries  `LifePlanner` (push events, advance the clock), `itineraries(log, kit)`, `poseAt`
 *   gait         how fast a body goes on foot and in which clip (walk, run, sprint): legs at their own pace
 *   craft        what a hero does where it stands: routines by craft and spot, the moments' routines
 *   source       `AgentSource`, `planAgents` (plain data a worker posts), `plannedSource`, `agentSourceFromLog`
 *   scaffold     `scaffoldProgress`: how far edits at a place have built its scaffold
 */
export {
  BEAT_FX,
  BEAT_SPAN,
  type Beat,
  BRIEF_MS,
  CHEER_MS,
  CLIP_SECONDS,
  craftRoutine,
  HAMMER_POSES,
  HERO_CLIPS,
  HERO_PROP_STANDIN,
  HERO_PROPS,
  type HeroClip,
  type LifeSample,
  type Move,
  PIN_MS,
  type Play,
  playRoutine,
  RISE_MS,
  type Routine,
  routineAt,
  routineMs,
  SETDOWN_MS,
} from "./craft.ts"
export {
  BRISK_WALK,
  GAIT_MPS,
  GAIT_RATE_MAX,
  GAIT_RATE_MIN,
  gaitMps,
  gaitOf,
  isRun,
  RUN_CLIP,
  RUN_FROM,
  RUN_TOP,
  SPRINT_CLIP,
  SPRINT_FROM,
  WALK_TOP,
  walkFor,
} from "./gait.ts"
export {
  asStruck,
  type GraveKit,
  type GraveStrike,
  GraveStrikes,
  STRIKE_LEAD_MS,
  STRIKE_PAUSE_MS,
  STRIKE_RUN_MPS,
  STRIKE_WALK_M,
  STRIKE_WATCH_MS,
  strikeWalkMs,
  struckAt,
} from "./graveStrike.ts"
export {
  type AgentPose,
  BECKON_MS,
  BRIEF_WITHIN,
  BURST_MS,
  FADE_AFTER_MS,
  FAIL_HOLD_MS,
  type HeroAct,
  type HeroStay,
  type HeroStep,
  type Itinerary,
  type ItineraryOptions,
  itineraries,
  LINGER_MS,
  type LifeKit,
  LifePlanner,
  poseAt,
  shownAt,
  stepPose,
  WORK_DWELL_MS,
  walkEnd,
} from "./itineraries.ts"
export { SCAFFOLD_EDITS, scaffoldProgress } from "./scaffold.ts"
export {
  type AgentInfo,
  type AgentSource,
  agentSourceFromLog,
  agentsOf,
  type PlannedAgents,
  planAgents,
  plannedSource,
} from "./source.ts"
