/**
 * Locomotion drawn stride-matched: a walk or a run moves on through its cycle as far as the ground covered
 * says, one cycle per stride (the clip's own ground speed × its length, at the body's scale), so its
 * planted feet stay where they are put. Its rate (speed over its own speed) is held to `RATE_MAX`: past
 * it the legs would whirl, so a frame's leap (a shove from the crowd's personal space, a seek) does not
 * spin them. The caller's speeds keep under it (sim gait.ts), so the feet do not slide.
 */

/** The most a locomotion clip plays over its own pace (sim gait.ts `GAIT_RATE_MAX`). */
export const RATE_MAX = 1.6

/**
 * How far through its cycle (0–1 a cycle) a locomotion clip moves for `metres` covered over `dt` seconds:
 * `metres` over its stride (`mps`, its own ground speed at look scale 1, × its `seconds` × `scale`), at
 * most `RATE_MAX` × its own time.
 */
export function strideStep(metres: number, dt: number, mps: number, seconds: number, scale = 1): number {
  const stride = mps * seconds * scale
  if (!(stride > 0) || !(seconds > 0)) return 0
  return Math.min(metres / stride, (RATE_MAX * Math.max(0, dt)) / seconds)
}

/** A locomotion clip's rate at `speed` m/s (1: its own pace): its own ground speed `mps` at look scale `scale`. */
export const strideRate = (speed: number, mps: number, scale = 1): number => speed / (mps * scale)
