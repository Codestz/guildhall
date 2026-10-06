import { Effect, EffectAttribute } from "postprocessing"
import { type Camera, Color, Matrix4, Uniform, Vector2, Vector3 } from "three"
import { WIND_DIRECTION } from "../weather/shared.ts"
import type { SkyState } from "./sky.ts"

/**
 * The colour grade (ADR 0007, task "Sky"): cloud shadows, exposure, saturation, a split tone
 * (shadows and highlights tinted separately) and contrast round mid-grey, in linear HDR before tone
 * mapping. One cheap per-pixel effect merged into the post pass (no extra draw call); its numbers
 * come from the time of day, the weather and the mood (sky.ts).
 *
 * Cloud shadows are how the weather's clouds show over the island: each pixel's world position
 * comes back from the depth buffer (the pass's one extra texture read), is followed along the key
 * light down to the ground, and samples a procedural noise that drifts with the wind. No cloud
 * meshes sit between the camera and the island; the sky (depth = far) is left alone. The Low tier
 * has no post pass, so no cloud shadows: its storms darken through the light levels alone.
 */
export class GradeEffect extends Effect {
  /**
   * How far each octave of the cloud field has drifted down the wind, in noise cells. The noise
   * tiles every 256 cells, so both wrap there without a seam; the fine octave runs a little faster,
   * so the banks change shape as they go.
   */
  private readonly drift = new Vector2()

  constructor() {
    super("GradeEffect", FRAGMENT, {
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map<string, Uniform>([
        ["exposure", new Uniform(1)],
        ["saturation", new Uniform(1)],
        ["darkSaturation", new Uniform(1)],
        ["contrast", new Uniform(1)],
        ["shadowTint", new Uniform(new Color(1, 1, 1))],
        ["highlightTint", new Uniform(new Color(1, 1, 1))],
        ["clipToWorld", new Uniform(new Matrix4())],
        ["keyDirection", new Uniform(new Vector3(0, 1, 0))],
        ["windDirection", new Uniform(new Vector2(WIND_DIRECTION.x, WIND_DIRECTION.z))],
        ["cloudDrift", new Uniform(new Vector2())],
        ["cloudShadow", new Uniform(0)],
        ["cloudThreshold", new Uniform(0.6)],
        ["cloudSoftness", new Uniform(0.08)],
      ]),
    })
  }

  /** Copy this frame's grade from the sky, and move the cloud field on by `delta` seconds of wind. */
  apply(sky: SkyState, camera: Camera, delta: number): void {
    const u = this.uniforms
    ;(u.get("exposure") as Uniform<number>).value = sky.exposure
    ;(u.get("saturation") as Uniform<number>).value = sky.saturation
    ;(u.get("darkSaturation") as Uniform<number>).value = sky.darkSaturation
    ;(u.get("contrast") as Uniform<number>).value = sky.contrast
    ;(u.get("shadowTint") as Uniform<Color>).value.copy(sky.shadows)
    ;(u.get("highlightTint") as Uniform<Color>).value.copy(sky.highlights)

    // Screen → world: inverse(projection × view) = world matrix × inverse projection.
    ;(u.get("clipToWorld") as Uniform<Matrix4>).value.multiplyMatrices(
      camera.matrixWorld,
      camera.projectionMatrixInverse,
    )
    const [kx, ky, kz] = sky.keyDirection
    ;(u.get("keyDirection") as Uniform<Vector3>).value.set(kx, ky, kz)
    const cells = (sky.cloudSpeed * Math.min(delta, 0.1)) / (CLOUD_SCALE * CLOUD_STRETCH)
    this.drift.x = (this.drift.x + cells) % 256
    this.drift.y = (this.drift.y + cells * 2 * 1.3) % 256
    ;(u.get("cloudDrift") as Uniform<Vector2>).value.copy(this.drift)
    ;(u.get("cloudShadow") as Uniform<number>).value = sky.cloudShadow
    // The noise sits roughly in 0.25–0.75: a coverage maps to the threshold that leaves that share.
    ;(u.get("cloudThreshold") as Uniform<number>).value = 0.66 - sky.cloudCoverage * 0.32
    ;(u.get("cloudSoftness") as Uniform<number>).value = sky.cloudSoftness
  }
}

/** World units across one cloud cell (the big octave), and how much longer they are down the wind. */
const CLOUD_SCALE = 20
const CLOUD_STRETCH = 1.4

const FRAGMENT = /* glsl */ `
uniform float exposure;
uniform float saturation;
uniform float darkSaturation;
uniform float contrast;
uniform vec3 shadowTint;
uniform vec3 highlightTint;
uniform mat4 clipToWorld;
uniform vec3 keyDirection;
uniform vec2 windDirection;
uniform vec2 cloudDrift;
uniform float cloudShadow;
uniform float cloudThreshold;
uniform float cloudSoftness;

#define CLOUD_SCALE ${CLOUD_SCALE.toFixed(1)}
#define CLOUD_STRETCH ${CLOUD_STRETCH.toFixed(1)}

float cloudHash(vec2 p) {
  p = fract(mod(p, 256.0) * vec2(0.1031, 0.1030));
  p += dot(p, p.yx + 33.33);
  return fract((p.x + p.y) * p.x);
}

/** Value noise, smooth-interpolated: 4 hashes, no texture. */
float cloudNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = cloudHash(i);
  float b = cloudHash(i + vec2(1.0, 0.0));
  float c = cloudHash(i + vec2(0.0, 1.0));
  float d = cloudHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

/** 0 in the open, 1 under a cloud. */
float cloudCover(float depth, vec2 uv) {
  if (cloudShadow <= 0.001 || depth >= 0.9999) return 0.0;
  vec4 world = clipToWorld * vec4(vec3(uv, depth) * 2.0 - 1.0, 1.0);
  world.xyz /= world.w;
  // Down the key light to the ground: a roof and the ground it shades share one patch.
  vec2 ground = world.xz - keyDirection.xz * (world.y / max(keyDirection.y, 0.2));
  // Stretched along the wind, so the patches read as drifting banks rather than spots.
  vec2 along = windDirection;
  vec2 across = vec2(-along.y, along.x);
  vec2 q = vec2(dot(ground, along) / CLOUD_STRETCH, dot(ground, across)) / CLOUD_SCALE;
  float n = cloudNoise(q - vec2(cloudDrift.x, 0.0)) * 0.68
    + cloudNoise(q * 2.0 + vec2(-cloudDrift.y, 37.0)) * 0.32;
  return smoothstep(cloudThreshold - cloudSoftness, cloudThreshold + cloudSoftness, n);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  vec3 c = inputColor.rgb * exposure * (1.0 - cloudShadow * cloudCover(depth, uv));
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = max(mix(vec3(l), c, mix(darkSaturation, saturation, smoothstep(0.02, 0.3, l))), 0.0);
  c *= mix(shadowTint, highlightTint, smoothstep(0.02, 0.5, l));
  c = 0.18 * pow(c / 0.18, vec3(contrast));
  outputColor = vec4(c, inputColor.a);
}
`
