/**
 * Frame priorities: the order `useFrame` callbacks run in, lowest first. Per-frame state lives in
 * module singletons (sky, wind, life) written once a frame and read by later callbacks, so writers
 * run at a named priority before their readers instead of relying on mount order.
 *
 *   SIM     the guild's clock advances (Scene `Clock` → store.tick)
 *   SKY     per-frame singletons derived from the store: `sky` and `wind` (atmosphere Weathervane),
 *           the `life` counters (life/Life readGuild)
 *   WORLD   everything that moves or draws: layers, characters, camera, post uniforms. R3F's
 *           default (0), so an unmarked useFrame is WORLD. Crisp runs here too.
 *   RENDER  who draws the frame, by tier:
 *             Medium and up (TIERS.post)  the EffectComposer (atmosphere/Post), at RENDER
 *             Low (no post)               FrameStats, at STATS, calls gl.render itself
 *           Any positive priority turns R3F's own render off, so with the composer gone something
 *           else must draw: that is FrameStats on Low.
 *           A tier with post whose composer is not built yet (`composer.live`, the frames after a
 *           Low -> Medium switch) is drawn by FrameStats too: the switch resizes the canvas, which
 *           clears it, and a frame nobody draws is the page's colour, shown as a flash.
 *   STATS   FrameStats reads `renderer.info` after the whole frame is drawn (and renders on Low).
 *
 * The shadow map is drawn on demand (atmosphere/shadows.ts): anything that adds, removes or moves a
 * caster calls `shadows.request()` (scene/owned.ts does it for layers that cast).
 */
export const FRAME = {
  SIM: -3,
  SKY: -2,
  WORLD: 0,
  RENDER: 1,
  STATS: 2,
} as const

/** Whether the post-processing composer (atmosphere/Post.tsx) is built, and so draws the frame. */
export const composer = { live: false }
