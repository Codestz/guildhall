/**
 * The shadow map is rendered on demand, not every frame (docs/perf-budget.md): re-drawing every
 * tree, house and mountain from the sun's view cost most of the frame (p50 9.2 → 3.5 ms without).
 * Everything that casts into it is static, so it only needs redrawing when the sun turns, the
 * shadow box moves to a new grid cell, or a caster appears/disappears (a wall fading, a tier
 * change). Anything that changes casters calls `shadows.request()`.
 */
export const shadows = {
  dirty: true,
  /** Redraws so far (probes and Stats for nerds). */
  draws: 0,
  request(): void {
    shadows.dirty = true
  },
}
