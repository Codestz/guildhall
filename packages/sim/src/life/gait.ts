/**
 * How fast a body goes on foot, and which clip it goes in (the run must look natural): every locomotion
 * clip of the rig has its own ground speed, the pace its planted feet push the ground back at, and is
 * drawn stride-matched (render crowd `strideStep`: clip rate = speed / that speed), so its feet keep
 * to the ground. A clip played much over its own pace whirls its legs, much under it floats, so each
 * gait keeps to its band of rates [`GAIT_RATE_MIN`, `GAIT_RATE_MAX`]:
 *
 *   walk     the look's walk, up to `WALK_TOP` m/s (a slow march gives way to `BRISK_WALK` past its own top);
 *   run      `RUN_CLIP` from `RUN_FROM`;
 *   sprint   `SPRINT_CLIP` (KayKit's long-striding run) from `SPRINT_FROM`, up to `RUN_TOP`, the fastest
 *            a hero goes (ItineraryOptions.hurry is held to it).
 *
 * A pace between the walk's top and the run's foot is none of them: a hurried way is pressed past it
 * (itineraries.ts `paced`), to `RUN_FROM`.
 */

/** The clip a hero's pose names while it runs (from `RUN_FROM` m/s): KayKit's run. */
export const RUN_CLIP = "Running_A"
/** The clip a hero's pose names while it sprints (from `SPRINT_FROM` m/s): KayKit's long-striding run. */
export const SPRINT_CLIP = "Running_B"
/** The walk a body whose own walk cannot keep a pace takes instead (KayKit's plain walk). */
export const BRISK_WALK = "Walking_A"

/**
 * Each locomotion clip's own ground speed, metres a second at look scale 1: its planted feet's backward
 * speed on the rig (rig-medium; a walk's two steps a cycle, a run's measured over its stances). The
 * carrying walk has Walking_A's legs.
 */
export const GAIT_MPS: Readonly<Record<string, number>> = {
  Walking_A: 0.78,
  Walking_B: 0.86,
  Walking_C: 0.5,
  Carry_Walk: 0.78,
  Running_A: 3,
  Running_B: 5,
}

/** A walk clip's own speed (one not measured goes as Walking_A). */
export const gaitMps = (clip: string): number => GAIT_MPS[clip] ?? (GAIT_MPS[BRISK_WALK] as number)

/** The most a locomotion clip plays over its own pace (render crowd `RATE_MAX`): past it the legs whirl. */
export const GAIT_RATE_MAX = 1.6
/** The least a run plays under its own pace: below it, it floats. */
export const GAIT_RATE_MIN = 0.6

/** The fastest walk (m/s): Walking_A at `GAIT_RATE_MAX`. */
export const WALK_TOP = gaitMps(BRISK_WALK) * GAIT_RATE_MAX
/** From this pace on (metres a second) a hero runs: `RUN_CLIP` at `GAIT_RATE_MIN`. */
export const RUN_FROM = gaitMps(RUN_CLIP) * GAIT_RATE_MIN
/** From this pace on a hero sprints (`RUN_CLIP` at ~1.47×, `SPRINT_CLIP` at 0.88×). */
export const SPRINT_FROM = 4.4
/** The fastest a hero goes, m/s: `SPRINT_CLIP` at `GAIT_RATE_MAX`. */
export const RUN_TOP = gaitMps(SPRINT_CLIP) * GAIT_RATE_MAX

/** The clip a way at `mps` names (none: the body's own walk). */
export function gaitOf(mps: number): string | undefined {
  if (mps >= SPRINT_FROM) return SPRINT_CLIP
  if (mps >= RUN_FROM) return RUN_CLIP
  return undefined
}

/** Whether a clip is one of the runs (a walk's pose may name it; it plays over the body's walk). */
export const isRun = (clip: string | undefined): boolean => clip === RUN_CLIP || clip === SPRINT_CLIP

/** The walk a body with walk clip `clip` takes at `mps`: its own while it keeps the pace, else `BRISK_WALK`. */
export const walkFor = (clip: string, mps: number): string =>
  mps <= gaitMps(clip) * GAIT_RATE_MAX ? clip : BRISK_WALK
