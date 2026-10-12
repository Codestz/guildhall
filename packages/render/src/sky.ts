import { BackSide, Color, Fog, Mesh, ShaderMaterial, SphereGeometry, Vector3 } from "three"
import { applyLight, type DayLight, GOLDEN_HOUR, hazeColour, lightAt } from "./light.ts"
import type { Stage } from "./stage.ts"
import type { Sun } from "./sun/index.ts"

export interface SkyPreset {
  /** The hour to start at (0–24); golden hour when left out. */
  hour?: number
  /** The stable-cascade sun, marked dirty whenever the hour moves it. */
  sun?: Sun
  /** How far the scene reaches from the camera's target (metres): the haze thickens past it. */
  reach?: number
}

export interface Sky {
  /** Moves the sun, the lights, the dome and the haze to `hour` (0–24, wraps). */
  setHour(hour: number): void
  light(): DayLight
  dispose(): void
}

/** The dome's radius: inside the camera's far plane (stage.ts: 2000). */
const DOME_RADIUS = 1500
const DEFAULT_REACH = 120

const VERTEX = /* glsl */ `
varying vec3 vDirection;
void main() {
  vDirection = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position.z = gl_Position.w; // on the far plane: behind everything
}
`

const FRAGMENT = /* glsl */ `
uniform vec3 zenith;
uniform vec3 horizon;
uniform vec3 haze;
uniform vec3 glow;
uniform vec3 sunColor;
uniform vec3 sunDirection;
uniform float sunDisc;
varying vec3 vDirection;
void main() {
  vec3 d = normalize(vDirection);
  float up = d.y;
  vec3 colour = mix(horizon, zenith, pow(smoothstep(0.0, 1.0, up), 0.55));
  colour = mix(haze, colour, smoothstep(-0.12, 0.04, up));
  float toward = max(dot(d, sunDirection), 0.0);
  colour += glow * (0.35 * pow(toward, 6.0) + 0.25 * pow(toward, 48.0)) * (1.0 - smoothstep(0.1, 0.7, up));
  colour = mix(colour, sunColor * 1.6, sunDisc * smoothstep(0.9993, 0.9997, toward));
  gl_FragColor = vec4(colour, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

/**
 * The sky (plan §5): one gradient dome round the camera (zenith → horizon → the haze below it, a warm
 * glow round the sun and its disc), the lights for the hour (`light.ts`) and a light haze that thickens
 * past `reach` from the camera's target, for depth. One draw call; the dome follows the camera.
 */
export function createSky(stage: Stage, preset: SkyPreset = {}): Sky {
  const reach = preset.reach ?? DEFAULT_REACH
  const uniforms = {
    zenith: { value: new Color() },
    horizon: { value: new Color() },
    haze: { value: new Color() },
    glow: { value: new Color() },
    sunColor: { value: new Color() },
    sunDirection: { value: new Vector3(0, 1, 0) },
    sunDisc: { value: 0 },
  }
  const material = new ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    side: BackSide,
    depthWrite: false,
    fog: false,
  })
  const dome = new Mesh(new SphereGeometry(DOME_RADIUS, 32, 16), material)
  dome.frustumCulled = false
  dome.renderOrder = -1000
  dome.name = "sky"
  stage.scene.add(dome)

  let current = lightAt(preset.hour ?? GOLDEN_HOUR)
  const setHour = (hour: number) => {
    current = lightAt(hour)
    applyLight(stage, current)
    uniforms.zenith.value.copy(current.zenith)
    uniforms.horizon.value.copy(current.horizon)
    uniforms.haze.value.copy(hazeColour(current))
    uniforms.glow.value.copy(current.glow)
    uniforms.sunColor.value.copy(current.sun)
    // The disc and glow sit where the sun really is, even below the shadow clamp.
    const { elevation } = current
    const rad = (elevation * Math.PI) / 180
    const flat = Math.hypot(current.sunDir[0], current.sunDir[2]) || 1
    uniforms.sunDirection.value
      .set(
        (current.sunDir[0] / flat) * Math.cos(rad),
        Math.sin(rad),
        (current.sunDir[2] / flat) * Math.cos(rad),
      )
      .normalize()
    uniforms.sunDisc.value = elevation > -1 ? 1 : 0
    preset.sun?.markDirty()
  }
  setHour(current.hour)

  // Haze from the camera: clear up to the target and a little past it, thick far beyond `reach`.
  const unsubscribe = stage.onFrame(() => {
    dome.position.copy(stage.camera.position)
    const fog = stage.scene.fog
    if (!(fog instanceof Fog)) return
    const distance = stage.getCamera().distance
    const thick = 0.35 + 0.4 * current.golden
    fog.near = distance + reach * 0.8
    fog.far = distance + reach * (4.5 - 2 * thick)
  })

  return {
    setHour,
    light: () => current,
    dispose() {
      unsubscribe()
      dome.removeFromParent()
      dome.geometry.dispose()
      material.dispose()
      stage.scene.fog = null
    },
  }
}
