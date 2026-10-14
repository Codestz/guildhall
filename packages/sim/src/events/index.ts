/**
 * The world's events (plan-hud-events.md E4): the wire normalised into world events, folded into the
 * guild's world, kept in a log that seeks by checkpoints, and read by the HUD's selectors.
 *
 *   world      `WorldEvent`, the normalised vocabulary
 *   normalize  `normalize(input, ctx)`: a `GuildEvent` or `SeaEvent` in, world events out
 *   reduce     `reduce(world, ev)`: the `GuildWorld`, with the hysteresis rule for where a hero stands
 *   log        `EventLog`: append, `stateAt(t)` from the nearest checkpoint
 *   select     heroes, pleas, recent events, the harbour (PRs, CI weather)
 */
export { CHECKPOINT_EVERY, EventLog } from "./log.ts"
export {
  CLOSED_MS,
  flush,
  type NormalizeContext,
  type NormalizeOptions,
  normalize,
  normalizer,
  pathsOf,
  type WireInput,
} from "./normalize.ts"
export {
  type ActorStatus,
  type Ci,
  DWELL_MS,
  emptyWorld,
  type GuildWorld,
  type Intent,
  leadOf,
  type Mark,
  type Pr,
  placeAt,
  RECENT,
  reduce,
  type SeaState,
  settle,
  WINDOW_MS,
  type WorldActor,
  weightOf,
} from "./reduce.ts"
export {
  type Harbour,
  type HeroView,
  harbourOf,
  heroes,
  type Plea,
  pleas,
  recent,
  type Weather,
  weatherOf,
} from "./select.ts"
export {
  GONE_MS,
  type PrState,
  type Who,
  type Work,
  type WorldEvent,
  type WorldHappening,
} from "./world.ts"
