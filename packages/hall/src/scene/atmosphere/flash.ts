/**
 * Lightning for the sky (ADR 0007): the weather layer calls `flash()` when a bolt strikes and the
 * whole sky — dome, fog, ambient fill — flares cold white and fades. The atmosphere also flashes
 * on its own whenever `environment.lightningAt` changes, so calling this is optional.
 */
export const lightning = {
  /** Current flash level, 0–1+, decayed every frame by the atmosphere. */
  level: 0,
  /** A second, weaker flicker a moment after the first, like a real strike. */
  echo: 0,
}

/** Light the sky up; `strength` 1 is a close strike, 0.3 a distant one. */
export function flash(strength = 1): void {
  lightning.level = Math.max(lightning.level, strength)
  lightning.echo = 0.12
}

/** Advance the flash by `delta` seconds; returns the level to draw this frame. */
export function stepLightning(delta: number): number {
  if (lightning.echo > 0) {
    lightning.echo -= delta
    if (lightning.echo <= 0) lightning.level = Math.max(lightning.level, 0.7)
  }
  lightning.level *= Math.exp(-delta * 7)
  if (lightning.level < 0.002) lightning.level = 0
  return lightning.level
}
