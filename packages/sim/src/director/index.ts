/**
 * The director (plan-hud-events.md D1): which shot the camera runs, chosen from the guild's world and
 * its moments by V1's rule (plea > failed > quest > loot > walk, hold ≥ 4 s, the user's 10 s). Pure.
 */
export {
  DISTANCE,
  type DirectorState,
  type Distance,
  director,
  type Focus,
  type FocusHint,
  focusKey,
  HOLD_MS,
  LIFE_MS,
  LONG_HOLD_MS,
  pick,
  RANK,
  RECENT_MS,
  RELEASE_HOLD_MS,
  type Reason,
  SAME_RANK_MS,
  type Shot,
  USER_MS,
  WALK_MS,
} from "./pick.ts"
