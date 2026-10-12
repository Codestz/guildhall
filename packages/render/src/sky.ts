import { BackSide, Color, Fog, Mesh, ShaderMaterial, SphereGeometry, Vector3 } from "three"
import { AIR, GRADE_GLSL, SKY_GLSL } from "./atmosphere/air.ts"
import { airAt } from "./atmosphere/hour.ts"
import { applyLight, type DayLight, GOLDEN_HOUR, keyLight, lightAt } from "./light.ts"
import type { Stage } from "./stage.ts"
import type { Sun } from "./sun/index.ts"

/** The air's parts, each switchable (for before/after comparisons; all on by default). */
export interface SkyLook {
  /** The sky's light by direction in place of the flat hemisphere fill (atmosphere/air.ts). */
  skyLight: boolean
  /** Aerial perspective: distance and height haze toward the sky's own colour. */
  haze: boolean
  /** The per-hour colour grade. */
  grade: boolean
}

export const DEFAULT_SKY_LOOK: SkyLook = { skyLight: true, haze: true, grade: true }

export interface SkyPreset {
  /** The hour to start at (0–24); golden hour when left out. */
  hour?: number
  /** The stable-cascade sun, marked dirty whenever the hour moves it. */
  sun?: Sun
  /** How far the scene reaches from the camera's target (metres): the haze thickens past it. */
  reach?: number
  /** The air's parts on or off; all on when left out. */
  look?: Partial<SkyLook>
}

export interface Sky {
  /** Moves the sun, the lights, the dome and the haze to `hour` (0–24, wraps). */
  setHour(hour: number): void
  light(): DayLight
  /** Turns parts of the air on or off (before/after shots). */
  setLook(look: Partial<SkyLook>): void
  look(): SkyLook
  dispose(): void
}

/** The dome's radius: inside the camera's far plane (stage.ts: 2000). */
const DOME_RADIUS = 1500
const DEFAULT_REACH = 120
/** The haze starts this many `reach`es past the camera's target: the focus stays crisp. */
const CLEAR = 0.05
/** Radians the key light turns before the cascades are redrawn (a quarter of a degree). */
const SHADOW_TURN = (0.25 * Math.PI) / 180
const smoothstep01 = (x: number) => {
  const t = Math.min(1, Math.max(0, x))
  return t * t * (3 - 2 * t)
}

const VERTEX = /* glsl */ `
varying vec3 vDirection;
void main() {
  vDirection = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position.z = gl_Position.w; // on the far plane: behind everything
}
`

const FRAGMENT = /* glsl */ `
${SKY_GLSL}
${GRADE_GLSL}
uniform float sunDisc;
uniform vec3 sunColor;
uniform vec3 moonDirection;
uniform float moonDisc;
uniform float stars;
uniform float uCirrus;
uniform vec3 uCirrusLit;
uniform vec2 uCirrusDrift;
varying vec3 vDirection;
float cirrusHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float cirrusNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(cirrusHash(i), cirrusHash(i + vec2(1.0, 0.0)), f.x),
             mix(cirrusHash(i + vec2(0.0, 1.0)), cirrusHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
// The high thin layer: wisps stretched along the wind on a plane far above the low clouds.
float cirrus(vec3 d) {
  vec2 p = d.xz / (d.y + 0.12) * 1.6 + uCirrusDrift * 0.004;
  vec2 q = vec2(p.x * 0.45 + p.y * 0.2, p.y * 2.6 - p.x * 0.3);
  float n = 0.55 * cirrusNoise(q) + 0.3 * cirrusNoise(q * 2.3 + 7.1) + 0.15 * cirrusNoise(q * 5.1 + 3.3);
  return smoothstep(0.55, 0.85, n) * smoothstep(0.03, 0.2, d.y) * (1.0 - smoothstep(0.55, 0.9, d.y));
}
float starHash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
void main() {
  vec3 d = normalize(vDirection);
  float up = d.y;
  vec3 colour = skyAt(d);
  if (uCirrus > 0.0 && up > 0.0) colour = mix(colour, uCirrusLit, 0.45 * uCirrus * cirrus(d));
  float toward = max(dot(d, uAirSun), 0.0);
  colour = mix(colour, sunColor * 1.6, sunDisc * smoothstep(0.9993, 0.9997, toward));
  // Stars: one in a few hundred cells of a fine grid over the dome, a round dot jittered in its cell,
  // faded toward the horizon (the haze) and by the dusk.
  if (stars > 0.0 && up > 0.0) {
    vec3 q = d * 240.0;
    vec3 cell = floor(q);
    float h = starHash(cell);
    if (h > 0.992) {
      vec3 c = cell + 0.5 + 0.5 * (vec3(starHash(cell + 1.7), starHash(cell + 3.1), starHash(cell + 5.3)) - 0.5);
      float twinkle = 0.35 + 0.65 * fract(h * 977.0);
      colour += vec3(0.8, 0.86, 1.0) * stars * twinkle * smoothstep(0.38, 0.0, length(q - c)) * smoothstep(0.0, 0.3, up);
    }
  }
  // The moon: a pale disc with a faint halo.
  float moonward = max(dot(d, moonDirection), 0.0);
  colour += vec3(0.62, 0.7, 0.92) * moonDisc * (0.05 * pow(moonward, 80.0) + 0.04 * pow(moonward, 12.0));
  colour = mix(colour, vec3(0.92, 0.95, 1.0), moonDisc * smoothstep(0.99955, 0.9998, moonward));
  gl_FragColor = vec4(colour, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor.rgb = airGrade(gl_FragColor.rgb);
}
`

/**
 * The sky (plan §5): one gradient dome round the camera (zenith → horizon, warm toward the sun and
 * cool away from it, its glow and disc; by night stars and the moon), the lights for the hour
 * (`light.ts`) and the air (`atmosphere/air.ts`): the sky's light on the shade, a haze past `reach`
 * from the camera's target that fades into exactly the dome behind it, and the hour's grade on both.
 * One draw call; the dome follows the camera.
 */
export function createSky(stage: Stage, preset: SkyPreset = {}): Sky {
  const reach = preset.reach ?? DEFAULT_REACH
  let look: SkyLook = { ...DEFAULT_SKY_LOOK, ...preset.look }
  const uniforms = {
    ...AIR,
    sunColor: { value: new Color() },
    sunDisc: { value: 0 },
    moonDirection: { value: new Vector3(0, 1, 0) },
    moonDisc: { value: 0 },
    stars: { value: 0 },
  }
  const material = new ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    side: BackSide,
    depthWrite: false,
    fog: false,
  })
  const dome = new Mesh(new SphereGeometry(DOME_RADIUS, 48, 24), material)
  dome.frustumCulled = false
  dome.renderOrder = -1000
  dome.name = "sky"
  stage.scene.add(dome)

  let current = lightAt(preset.hour ?? GOLDEN_HOUR)
  let air = airAt(current)
  /** The key light's direction when the cascades were last redrawn (a slow cycle moves it a little a frame). */
  const shadowDir = new Vector3()
  const keyDir = new Vector3()
  const applyLook = () => {
    AIR.uSkyLight.value = look.skyLight ? 1 : 0
    AIR.uGrade.value = look.grade ? 1 : 0
    AIR.uHazeDensity.value = look.haze ? air.haze.density : 0
    AIR.uHazeFar.value = look.haze ? stage.camera.far : 1e9
  }
  const setHour = (hour: number) => {
    current = lightAt(hour)
    air = airAt(current)
    applyLight(stage, current)
    AIR.uAirZenith.value.copy(current.zenith)
    AIR.uAirHorizon.value.copy(current.horizon)
    AIR.uAirAway.value.copy(air.haze.away)
    AIR.uAirGlow.value.copy(current.glow)
    AIR.uAirSun.value.set(...current.sunTrue)
    AIR.uAirSplit.value = 0.35 + 0.65 * current.golden
    AIR.uSkyTop.value.copy(air.sky.top)
    AIR.uSkyAway.value.copy(air.sky.away)
    AIR.uSkyToward.value.copy(air.sky.toward)
    AIR.uSkyBounce.value.copy(air.sky.bounce)
    AIR.uSkyIntensity.value = air.sky.intensity
    AIR.uHazeFalloff.value = air.haze.falloff
    AIR.uHazeMax.value = air.haze.max
    AIR.uGradeShadows.value.copy(air.grade.shadows)
    AIR.uGradeHighlights.value.copy(air.grade.highlights)
    AIR.uGradeSaturation.value = air.grade.saturation
    AIR.uGradeContrast.value = air.grade.contrast
    applyLook()
    uniforms.sunColor.value.copy(current.sun)
    uniforms.sunDisc.value = current.elevation > -1 ? 1 : 0
    uniforms.moonDirection.value.set(...current.moonTrue)
    uniforms.moonDisc.value = current.night * smoothstep01(current.moonElevation / 6)
    uniforms.stars.value = current.night * current.night
    // The cascades redraw when the key light has turned a quarter of a degree since they last did.
    keyDir.set(...keyLight(current).dir)
    if (keyDir.angleTo(shadowDir) > SHADOW_TURN || shadowDir.lengthSq() === 0) {
      shadowDir.copy(keyDir)
      preset.sun?.markDirty()
    }
  }
  setHour(current.hour)

  // Haze from the camera: clear up to the target and a little past it, thicker beyond. Three's linear
  // fog (for programs without the air patch) follows the same zone.
  const unsubscribe = stage.onFrame(() => {
    dome.position.copy(stage.camera.position)
    const distance = stage.getCamera().distance
    AIR.uHazeClear.value = distance + reach * CLEAR
    if (look.haze) AIR.uHazeFar.value = stage.camera.far
    const fog = stage.scene.fog
    if (!(fog instanceof Fog)) return
    const thick = 0.35 + 0.4 * current.golden
    fog.near = distance + reach * 0.8
    fog.far = distance + reach * (4.5 - 2 * thick)
  })

  return {
    setHour,
    light: () => current,
    setLook(next) {
      look = { ...look, ...next }
      applyLook()
    },
    look: () => ({ ...look }),
    dispose() {
      unsubscribe()
      dome.removeFromParent()
      dome.geometry.dispose()
      material.dispose()
      stage.scene.fog = null
      AIR.uSkyLight.value = 0
      AIR.uGrade.value = 0
      AIR.uHazeDensity.value = 0
      AIR.uHazeFar.value = 1e9
    },
  }
}
