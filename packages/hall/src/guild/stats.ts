/**
 * Live renderer numbers for the "stats for nerds" panel (docs/perf-budget.md). Written once per
 * frame by scene/FrameStats.tsx, read by the HUD on its own ~10 Hz re-render — no React state.
 */
export const frameStats = {
  fps: 0,
  /** Smoothed frame time, ms. */
  ms: 0,
  /** One full frame, every pass: scene, shadows, post-processing. */
  calls: 0,
  triangles: 0,
  geometries: 0,
  textures: 0,
  programs: 0,
}

/** The budget the panel compares against (docs/perf-budget.md). */
export const BUDGET = { calls: 250, triangles: 600_000, geometries: 300, fps: 60 } as const
