/**
 * The post pipeline's GLSL (WebGL2, GLSL3 via three's ShaderMaterial): the bloom's bright pass and mip
 * chain, and the one composite pass that does everything else. Ported from V1's post chain
 * (v1:packages/hall/src/scene/atmosphere/Post.tsx, GradeEffect.ts, MoodLut.ts): bloom, ink outlines
 * from the depth buffer, exposure and Neutral tone mapping, the mood LUT, the hour's grade (V2's own
 * `airGrade`, which the palette material draws in place when there is no post) and the vignette.
 */
import { GRADE_GLSL } from "../atmosphere/air.ts"

export const FULLSCREEN_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

/** The bright pass, into the first (half-size) level: a 4-tap box and a soft-knee threshold. */
export const PREFILTER_FRAGMENT = /* glsl */ `
uniform sampler2D tInput;
uniform vec2 texel;
uniform float threshold;
uniform float knee;
varying vec2 vUv;
vec3 tap(vec2 uv) {
  // Clamped: one glint pixel must not flare into a disc.
  return min(texture2D(tInput, uv).rgb, vec3(24.0));
}
void main() {
  vec3 c = 0.25 * (tap(vUv + texel * vec2(-0.5, -0.5)) + tap(vUv + texel * vec2(0.5, -0.5))
    + tap(vUv + texel * vec2(-0.5, 0.5)) + tap(vUv + texel * vec2(0.5, 0.5)));
  float bright = max(c.r, max(c.g, c.b));
  float soft = clamp(bright - threshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 1e-4);
  float keep = max(soft, bright - threshold) / max(bright, 1e-4);
  gl_FragColor = vec4(c * keep, 1.0);
}
`

/** One level down the chain: Jimenez's 13-tap downsample (no flicker from single bright texels). */
export const DOWN_FRAGMENT = /* glsl */ `
uniform sampler2D tInput;
uniform vec2 texel;
varying vec2 vUv;
vec3 tap(vec2 o) { return texture2D(tInput, vUv + texel * o).rgb; }
void main() {
  vec3 a = tap(vec2(-2.0, 2.0)), b = tap(vec2(0.0, 2.0)), c = tap(vec2(2.0, 2.0));
  vec3 d = tap(vec2(-2.0, 0.0)), e = tap(vec2(0.0, 0.0)), f = tap(vec2(2.0, 0.0));
  vec3 g = tap(vec2(-2.0, -2.0)), h = tap(vec2(0.0, -2.0)), i = tap(vec2(2.0, -2.0));
  vec3 j = tap(vec2(-1.0, 1.0)), k = tap(vec2(1.0, 1.0)), l = tap(vec2(-1.0, -1.0)), m = tap(vec2(1.0, -1.0));
  vec3 sum = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  gl_FragColor = vec4(sum, 1.0);
}
`

/** One level up: a 9-tap tent of the smaller level, added onto this one (additive blending). */
export const UP_FRAGMENT = /* glsl */ `
uniform sampler2D tInput;
uniform vec2 texel;
uniform float radius;
varying vec2 vUv;
vec3 tap(vec2 o) { return texture2D(tInput, vUv + texel * o * radius).rgb; }
void main() {
  vec3 sum = tap(vec2(0.0)) * 4.0
    + (tap(vec2(-1.0, 0.0)) + tap(vec2(1.0, 0.0)) + tap(vec2(0.0, -1.0)) + tap(vec2(0.0, 1.0))) * 2.0
    + tap(vec2(-1.0, -1.0)) + tap(vec2(1.0, -1.0)) + tap(vec2(-1.0, 1.0)) + tap(vec2(1.0, 1.0));
  gl_FragColor = vec4(sum / 16.0, 1.0);
}
`

/** Everything after the scene, in one pass to the canvas. */
export const COMPOSITE_FRAGMENT = /* glsl */ `
precision highp sampler3D;
${GRADE_GLSL}
uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform sampler2D tBloom;
uniform sampler3D tLut;
uniform vec2 texel;
uniform float cameraNear;
uniform float cameraFar;
uniform float exposure;
uniform float bloom;
uniform float inkStrength;
uniform float inkWidth;
uniform float inkTolerance;
uniform vec3 inkTint;
uniform vec2 inkFade;
uniform float lut;
uniform float lutScale;
uniform float lutOffset;
uniform float vignette;
uniform float vignetteOffset;
uniform float time;
varying vec2 vUv;

float viewZ(float depth) {
  // A perspective depth buffer's window depth back to metres in front of the lens.
  return cameraNear * cameraFar / (cameraFar - depth * (cameraFar - cameraNear));
}
float readDepth(vec2 uv) { return texture2D(tDepth, uv).r; }

/**
 * V1's ink (GradeEffect.ts inkEdge): 0-1, how much this pixel is the near side of a silhouette. The
 * depth buffer is affine in screen space across any flat face, so left + right - 2 * centre is ~0
 * however steeply a face is seen; where a neighbour drops away behind an edge it jumps by the gap.
 */
float inkEdge(vec2 uv, float depth) {
  vec2 o = texel * inkWidth;
  float x = readDepth(uv - vec2(o.x, 0.0)) + readDepth(uv + vec2(o.x, 0.0)) - 2.0 * depth;
  float y = readDepth(uv - vec2(0.0, o.y)) + readDepth(uv + vec2(0.0, o.y)) - 2.0 * depth;
  float z = viewZ(depth);
  float jump = max(x, y) * z * z * (cameraFar - cameraNear) / (cameraNear * cameraFar);
  float tolerance = inkTolerance * 0.5 + z * 0.01;
  float fade = 1.0 - smoothstep(inkFade.x, inkFade.y, z);
  return smoothstep(tolerance, tolerance * 3.0, jump) * fade;
}

vec3 neutral(vec3 color) {
  const float start = 0.8 - 0.04;
  const float desaturation = 0.15;
  float x = min(color.r, min(color.g, color.b));
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color -= offset;
  float peak = max(color.r, max(color.g, color.b));
  if (peak < start) return color;
  float d = 1.0 - start;
  float newPeak = 1.0 - d * d / (peak + d - start);
  color *= newPeak / peak;
  float g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
  return mix(color, vec3(newPeak), g);
}

vec3 toSrgb(vec3 c) {
  return mix(pow(c, vec3(0.41666)) * 1.055 - vec3(0.055), c * 12.92, vec3(lessThanEqual(c, vec3(0.0031308))));
}

void main() {
  vec3 c = texture2D(tScene, vUv).rgb;
  float depth = readDepth(vUv);
  if (inkStrength > 0.0 && depth < 0.9999) c = mix(c, c * inkTint, inkStrength * inkEdge(vUv, depth));
  c += texture2D(tBloom, vUv).rgb * bloom;
  c = clamp(neutral(c * exposure), 0.0, 1.0);
  // The mood LUT (V1 MoodLut.ts): indexed by the square root of the tone-mapped linear colour.
  if (lut > 0.5) {
    vec3 g = texture(tLut, sqrt(c) * lutScale + lutOffset).rgb;
    c = g * g;
  }
  c = airGrade(toSrgb(c));
  // V1's vignette (postprocessing's default technique).
  float d = distance(vUv, vec2(0.5));
  c *= smoothstep(0.8, vignetteOffset * 0.799, d * (vignette + vignetteOffset));
  // A hair of noise against banding in the long sky and water gradients.
  float n = fract(sin(dot(gl_FragCoord.xy + time, vec2(12.9898, 78.233))) * 43758.5453);
  gl_FragColor = vec4(c + (n - 0.5) / 255.0, 1.0);
}
`
