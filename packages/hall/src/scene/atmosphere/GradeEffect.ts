import { Effect } from "postprocessing"
import { Color, Uniform } from "three"
import type { SkyState } from "./sky.ts"

/**
 * The colour grade (ADR 0007, task "Sky"): exposure, saturation, a split tone (shadows and
 * highlights tinted separately) and contrast round mid-grey, in linear HDR before tone mapping.
 * One cheap per-pixel effect merged into the post pass (no extra draw call); its numbers come
 * from the time of day, the weather and the mood (sky.ts).
 */
export class GradeEffect extends Effect {
  constructor() {
    super("GradeEffect", FRAGMENT, {
      uniforms: new Map<string, Uniform>([
        ["exposure", new Uniform(1)],
        ["saturation", new Uniform(1)],
        ["darkSaturation", new Uniform(1)],
        ["contrast", new Uniform(1)],
        ["shadowTint", new Uniform(new Color(1, 1, 1))],
        ["highlightTint", new Uniform(new Color(1, 1, 1))],
      ]),
    })
  }

  /** Copy this frame's grade from the sky. */
  apply(sky: SkyState): void {
    const u = this.uniforms
    ;(u.get("exposure") as Uniform<number>).value = sky.exposure
    ;(u.get("saturation") as Uniform<number>).value = sky.saturation
    ;(u.get("darkSaturation") as Uniform<number>).value = sky.darkSaturation
    ;(u.get("contrast") as Uniform<number>).value = sky.contrast
    ;(u.get("shadowTint") as Uniform<Color>).value.copy(sky.shadows)
    ;(u.get("highlightTint") as Uniform<Color>).value.copy(sky.highlights)
  }
}

const FRAGMENT = /* glsl */ `
uniform float exposure;
uniform float saturation;
uniform float darkSaturation;
uniform float contrast;
uniform vec3 shadowTint;
uniform vec3 highlightTint;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb * exposure;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = max(mix(vec3(l), c, mix(darkSaturation, saturation, smoothstep(0.02, 0.3, l))), 0.0);
  c *= mix(shadowTint, highlightTint, smoothstep(0.02, 0.5, l));
  c = 0.18 * pow(c / 0.18, vec3(contrast));
  outputColor = vec4(c, inputColor.a);
}
`
