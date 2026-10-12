/**
 * Emissive by palette (night): the library's light sources glow on their own after dusk. Which
 * vertices are a light source is decided per piece, by swatch, when the static batch bakes the piece
 * (`_glow` = 1 on them, batchGeometry.ts): a swatch alone cannot say it, since the light's swatches
 * are shared with other things (the "glow" swatch 44 is also yellow banners, coins and flowers; the
 * lanterns' orange glass is the orange ramp; Kenney's lamp head is whitewash). The palette material
 * adds `glowColour × level` to every `_glow` vertex's emissive light, one uniform for the whole town.
 *
 * Measured from the library GLBs (the glass or flame's swatches, each used nowhere else on the piece).
 */
import { Color, type WebGLProgramParametersWithUniforms } from "three"

export const GLOW_SWATCHES: Readonly<Record<string, readonly number[]>> = {
  // KayKit Halloween lanterns: the glass panes are the orange ramp (54–56).
  "kaykit-halloween/post-lantern": [54, 55, 56],
  "kaykit-halloween/lantern-standing": [54, 55, 56],
  "kaykit-halloween/lantern-hanging": [54, 55, 56],
  // Kenney Fantasy Town's lamp post: the head's shade (whitewash 17) and its pane (snow-light 14).
  "kenney-town/lantern": [14, 17],
  // KayKit Dungeon flames: the glow swatch core (44) under orange tongues (54, 55).
  "kaykit-dungeon/torch-lit": [44, 54, 55],
  "kaykit-dungeon/candle-lit": [44, 54, 55],
  "kaykit-dungeon/candle-thin-lit": [44, 54, 55],
  // Kenney Graveyard's lamp posts and lantern: an orange-light pane (56).
  "kenney-graveyard/lightpost-single": [56],
  "kenney-graveyard/lightpost-double": [56],
  "kenney-graveyard/lightpost-all": [56],
  "kenney-graveyard/lantern-glass": [56],
}

/** Warm lamplight, in HDR so the glass reads brighter than anything lit by it. */
const GLOW_COLOUR = new Color("#ffb458")
const GLOW_PEAK = 3.2

/** The one level every glowing vertex shares; `setGlow` moves it. */
const uniforms = {
  uGlow: { value: 0 },
  uNight: { value: 0 },
  uGlowColour: { value: GLOW_COLOUR.clone().multiplyScalar(GLOW_PEAK) },
}

/** How lit the town's light sources are, 0 (day) to 1 (night). */
export function setGlow(level: number): void {
  uniforms.uGlow.value = Math.min(1, Math.max(0, level))
}

export const glowLevel = (): number => uniforms.uGlow.value

/**
 * The night grade, 0 (day) to 1 (deep night): what only moonlight lights goes grey-blue (night
 * vision), what a lamp or a window lights keeps its colour, as V1's grade did without a post pass.
 */
export function setNightGrade(night: number): void {
  uniforms.uNight.value = Math.min(1, Math.max(0, night))
}

const GRADE = /* glsl */ `
{
  vec3 lit = outgoingLight - totalEmissiveRadiance;
  float lum = dot(lit, vec3(0.2126, 0.7152, 0.0722));
  float amount = uNight * (0.3 + 0.5 * (1.0 - smoothstep(0.03, 0.3, lum)));
  outgoingLight = mix(lit, lum * vec3(0.9, 0.96, 1.1), amount) + totalEmissiveRadiance;
}`

/**
 * `onBeforeCompile` for a lit material: vertices with `_glow` add the lamplight to their emissive, and
 * dark tones are graded toward a cool grey by night (the emissive light is left out of the grade).
 */
export function patchGlow(shader: WebGLProgramParametersWithUniforms): void {
  Object.assign(shader.uniforms, uniforms)
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nattribute float _glow;\nvarying float vGlow;")
    .replace("#include <begin_vertex>", "#include <begin_vertex>\nvGlow = _glow;")
  shader.fragmentShader = shader.fragmentShader
    .replace(
      "#include <common>",
      "#include <common>\nuniform float uGlow;\nuniform float uNight;\nuniform vec3 uGlowColour;\nvarying float vGlow;",
    )
    .replace(
      "#include <emissivemap_fragment>",
      "#include <emissivemap_fragment>\ntotalEmissiveRadiance += vGlow * uGlow * uGlowColour;",
    )
    .replace("#include <opaque_fragment>", `${GRADE}\n#include <opaque_fragment>`)
}
