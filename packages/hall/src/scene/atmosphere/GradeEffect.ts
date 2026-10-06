import { Effect, EffectAttribute } from "postprocessing"
import { type Camera, Color, Matrix4, type OrthographicCamera, Uniform, Vector2, Vector3 } from "three"
import type { Looks } from "../../guild/quality.ts"
import type { SkyState } from "./sky.ts"
import { WIND_DIRECTION } from "./wind.ts"

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
 *
 * Three more looks ride the same depth read, each behind a define so a tier without it pays
 * nothing (quality.ts `Looks`; costs in docs/perf-budget.md):
 *   OUTLINES  soft ink round silhouettes: where a neighbour's depth jumps away from the plane this
 *             pixel lies on (a second difference, so steep walls seen edge-on don't ink). Darker by
 *             day, lighter at night, thinner far away, gone into the fog.
 *   MIST      ground mist: thick where the surface is low (sea, river, valley floors), wispy with a
 *             drifting noise; plus golden-hour sun shafts, a radial term from where the sun sits
 *             off screen, only in the open (not under cloud).
 */
export class GradeEffect extends Effect {
  /**
   * How far each octave of the cloud field has drifted down the wind, in noise cells. The noise
   * tiles every 256 cells, so both wrap there without a seam; the fine octave runs a little faster,
   * so the banks change shape as they go.
   */
  private readonly drift = new Vector2()
  /** The mist's own drift (noise cells) and the shafts' slow shimmer clock. */
  private readonly mistDrift = new Vector2()
  private shaftClock = 0
  /** The pass's width / height (setSize). */
  private aspect = 1.6
  private looks = ""
  /** Frozen under prefers-reduced-motion: the cloud shadows, the mist and the shafts hold still. */
  still = false

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
        ["fogRadii", new Uniform(new Vector2(100, 150))],
        ["inkStrength", new Uniform(0)],
        ["inkWidth", new Uniform(1)],
        ["inkTolerance", new Uniform(0.4)],
        ["inkTint", new Uniform(new Color(0.3, 0.32, 0.42))],
        ["mist", new Uniform(0)],
        ["mistTop", new Uniform(1)],
        ["mistColor", new Uniform(new Color())],
        ["mistDrift", new Uniform(new Vector2())],
        ["shafts", new Uniform(0)],
        ["shaftColor", new Uniform(new Color())],
        ["shaftSource", new Uniform(new Vector2(2, 2))],
        ["shaftAxis", new Uniform(new Vector2(1, 0))],
        ["shaftClock", new Uniform(0)],
      ]),
    })
  }

  override setSize(width: number, height: number): void {
    this.aspect = width / Math.max(height, 1)
  }

  /** Turn the optional looks on or off (a recompile of the pass, only when they change). */
  setLooks(looks: Looks): void {
    const key = `${looks.outlines}${looks.mist}`
    if (key === this.looks) return
    this.looks = key
    if (looks.outlines) this.defines.set("OUTLINES", "1")
    else this.defines.delete("OUTLINES")
    if (looks.mist) this.defines.set("MIST", "1")
    else this.defines.delete("MIST")
    this.setChanged()
  }

  /**
   * Copy this frame's grade from the sky, and move the cloud field on by `delta` seconds of wind.
   * `fog` is the island fog's near/far radii (world units), `pixelRatio` the canvas's.
   */
  apply(
    sky: SkyState,
    camera: Camera,
    delta: number,
    fog: { near: number; far: number },
    pixelRatio: number,
  ): void {
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
    const dt = this.still ? 0 : Math.min(delta, 0.1)
    const cells = (sky.cloudSpeed * dt) / (CLOUD_SCALE * CLOUD_STRETCH)
    this.drift.x = (this.drift.x + cells) % 256
    this.drift.y = (this.drift.y + cells * 2 * 1.3) % 256
    ;(u.get("cloudDrift") as Uniform<Vector2>).value.copy(this.drift)
    ;(u.get("cloudShadow") as Uniform<number>).value = sky.cloudShadow
    // The noise sits roughly in 0.25–0.75: a coverage maps to the threshold that leaves that share.
    ;(u.get("cloudThreshold") as Uniform<number>).value = 0.66 - sky.cloudCoverage * 0.32
    ;(u.get("cloudSoftness") as Uniform<number>).value = sky.cloudSoftness
    ;(u.get("fogRadii") as Uniform<Vector2>).value.set(fog.near, fog.far)

    // Ink: ~1.5 CSS pixels wide whatever the density; the depth jump that counts as an edge is in
    // world units, and grows with what one pixel covers (zoomed out, small steps stop inking).
    ;(u.get("inkStrength") as Uniform<number>).value = sky.ink
    ;(u.get("inkWidth") as Uniform<number>).value = Math.max(1, 1.5 * pixelRatio)
    const ortho = camera as OrthographicCamera
    const perPixel = ortho.isOrthographicCamera ? (ortho.top - ortho.bottom) / ortho.zoom / 900 : 0
    ;(u.get("inkTolerance") as Uniform<number>).value = 0.28 + perPixel * 6
    ;(u.get("inkTint") as Uniform<Color>).value.copy(sky.shadows).multiplyScalar(0.34)

    // Mist drifts with the wind, slower than the clouds.
    const mistCells = (sky.cloudSpeed * 0.25 * dt) / 22
    this.mistDrift.x = (this.mistDrift.x + mistCells * WIND_DIRECTION.x) % 256
    this.mistDrift.y = (this.mistDrift.y + mistCells * WIND_DIRECTION.z) % 256
    ;(u.get("mistDrift") as Uniform<Vector2>).value.copy(this.mistDrift)
    ;(u.get("mist") as Uniform<number>).value = sky.mist
    ;(u.get("mistTop") as Uniform<number>).value = sky.mistTop
    ;(u.get("mistColor") as Uniform<Color>).value.copy(sky.mistColor)

    // Shafts radiate from where the sun is, seen from the camera: off screen in its direction.
    view.set(kx, ky, kz).transformDirection(camera.matrixWorldInverse)
    const across = Math.hypot(view.x, view.y) || 1
    const sx = view.x / across
    const sy = view.y / across
    ;(u.get("shaftSource") as Uniform<Vector2>).value.set(0.5 + sx * 0.95, 0.5 + sy * 0.95)
    // From the source towards the screen's centre, in aspect-corrected units.
    const ax = -sx * this.aspect
    const ay = -sy
    const length = Math.hypot(ax, ay) || 1
    ;(u.get("shaftAxis") as Uniform<Vector2>).value.set(ax / length, ay / length)
    this.shaftClock = (this.shaftClock + dt * 0.05) % 256
    ;(u.get("shaftClock") as Uniform<number>).value = this.shaftClock
    ;(u.get("shafts") as Uniform<number>).value = sky.shafts
    ;(u.get("shaftColor") as Uniform<Color>).value.copy(sky.shaftColor)
  }
}

const view = new Vector3()

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

uniform vec2 fogRadii;
#ifdef OUTLINES
uniform float inkStrength;
uniform float inkWidth;
uniform float inkTolerance;
uniform vec3 inkTint;
#endif
#ifdef MIST
uniform float mist;
uniform float mistTop;
uniform vec3 mistColor;
uniform vec2 mistDrift;
uniform float shafts;
uniform vec3 shaftColor;
uniform vec2 shaftSource;
uniform vec2 shaftAxis;
uniform float shaftClock;
#endif

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

vec3 worldAt(vec2 uv, float depth) {
  vec4 world = clipToWorld * vec4(vec3(uv, depth) * 2.0 - 1.0, 1.0);
  return world.xyz / world.w;
}

/** 0 in the open, 1 under a cloud. */
float cloudCover(vec3 world) {
  if (cloudShadow <= 0.001) return 0.0;
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

#ifdef OUTLINES
/**
 * 0–1: how much this pixel is the near side of a silhouette. The depth buffer is affine in screen
 * space across any flat face, for both cameras (that is how it is interpolated), so left + right −
 * 2 × centre is ~0 however steeply a face is seen; where a neighbour drops away behind an edge it
 * jumps by the gap. Raw depth taps only: the gap goes back to world units once, at the centre.
 */
float inkEdge(vec2 uv, float depth) {
  vec2 o = texelSize * inkWidth;
  float x = readDepth(uv - vec2(o.x, 0.0)) + readDepth(uv + vec2(o.x, 0.0)) - 2.0 * depth;
  float y = readDepth(uv - vec2(0.0, o.y)) + readDepth(uv + vec2(0.0, o.y)) - 2.0 * depth;
  float range = cameraFar - cameraNear;
  #ifdef PERSPECTIVE_CAMERA
  float z = -getViewZ(depth);
  // dz / d(depth) for a perspective depth buffer.
  float jump = max(x, y) * z * z * range / (cameraNear * cameraFar);
  // What counts as a gap grows with distance, and lines thin out far away.
  float tolerance = inkTolerance * 0.5 + z * 0.01;
  float fade = 1.0 - smoothstep(50.0, 140.0, z);
  #else
  float jump = max(x, y) * range;
  float tolerance = inkTolerance;
  float fade = 1.0;
  #endif
  return smoothstep(tolerance, tolerance * 3.0, jump) * fade;
}
#endif

#ifdef MIST
/**
 * 0–1: how much mist lies between the eye and a surface at this world point: it pools on the
 * water and the lowest ground (thickness = how far the surface sits under the mist's top), comes
 * in drifting banks, and — in a perspective view — thickens with distance, so the near ground
 * stays crisp. Above the mist (most of the island) it costs one comparison.
 */
float mistAt(vec3 world, float distance) {
  float low = clamp((mistTop - world.y) / 1.2, 0.0, 1.0);
  if (low <= 0.0) return 0.0;
  float n = cloudNoise(world.xz / 30.0 + mistDrift);
  float banks = 0.15 + 0.85 * smoothstep(0.3, 0.7, n);
  #ifdef PERSPECTIVE_CAMERA
  float far = smoothstep(8.0, 70.0, distance);
  #else
  float far = 1.0;
  #endif
  return mist * low * banks * (0.25 + 0.75 * far);
}

/** 1D value noise: 2 hashes. */
float shaftNoise(float x) {
  float i = floor(x);
  float f = fract(x);
  return mix(cloudHash(vec2(i, 7.0)), cloudHash(vec2(i + 1.0, 7.0)), f * f * (3.0 - 2.0 * f));
}

/**
 * 0–1: the beams radiating from the sun's direction. The source sits off screen, so the beams'
 * coordinate is the tangent of their angle from the source's axis (one division, no atan; the seam
 * is behind the source), through one octave of 1D noise that slowly slides sideways.
 */
float shaftAt(vec2 uv) {
  vec2 d = (uv - shaftSource) * vec2(aspect, 1.0);
  float along = max(dot(d, shaftAxis), 1e-3);
  float n = shaftNoise(dot(d, vec2(-shaftAxis.y, shaftAxis.x)) / along * 16.0 + shaftClock * 3.0);
  return smoothstep(0.45, 0.85, n) / (1.0 + along * along);
}
#endif

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  vec3 c = inputColor.rgb;
  float cover = 0.0;
  if (depth < 0.9999) {
    vec3 world = worldAt(uv, depth);
    cover = cloudCover(world);
    float clear = 1.0 - smoothstep(fogRadii.x, fogRadii.y, length(world.xz));
    #ifdef OUTLINES
    c = mix(c, c * inkTint, inkStrength * inkEdge(uv, depth) * clear);
    #endif
    c *= exposure * (1.0 - cloudShadow * cover);
    #ifdef MIST
    // Lights glow through the mist (it veils what they light, not the flames themselves).
    float m = 0.0;
    if (mist > 0.002) {
      m = mistAt(world, -getViewZ(depth)) * clear * (1.0 - smoothstep(0.7, 2.5, dot(c, vec3(0.2126, 0.7152, 0.0722))));
      // Mist only ever lifts: under a storm's dark sky it must not drag the ground down with it.
      c = mix(c, max(c, mistColor * exposure), min(m, 0.85));
    }
    if (shafts > 0.001)
      c += shaftColor * exposure * shafts * shaftAt(uv) * (1.0 - cover) * (0.45 + 0.55 * min(m * 3.0, 1.0));
    #endif
  } else {
    c *= exposure;
  }
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = max(mix(vec3(l), c, mix(darkSaturation, saturation, smoothstep(0.02, 0.3, l))), 0.0);
  c *= mix(shadowTint, highlightTint, smoothstep(0.02, 0.5, l));
  c = 0.18 * pow(c / 0.18, vec3(contrast));
  outputColor = vec4(c, inputColor.a);
}
`
