/**
 * Rain: thin streaks falling through a box round where the camera looks, one draw of line segments,
 * moved wholly on the GPU (each streak's place is a seed wrapped into the box, so it stays put in the
 * world as the box follows the camera, and falls by the clock). It thins out as the camera pulls back,
 * long before a streak is under a pixel, so the far view never shimmers, and it fades in and out with
 * the weather. Nothing is drawn while it is dry.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  LineSegments,
  ShaderMaterial,
  Vector2,
  Vector3,
} from "three"
import type { Stage } from "../stage.ts"
import { random, smoothstep } from "./ease.ts"

/** Streaks in the box. */
export const RAIN_STREAKS = 2600
/** Fall speed, m/s, and a streak's length, m. */
const FALL = 16
const LENGTH = 1.5
/**
 * The box, metres across and high: fixed, so a zoom never reshuffles the streaks (each is anchored in
 * the world); far out it is a patch round the focus with soft edges, and the rain has faded by then.
 */
const BOX = 56
const HEIGHT = 40
/** Rain fades out as the camera pulls back over this range of orbit distance (m). */
export const RAIN_FAR: [number, number] = [110, 240]

const VERTEX = /* glsl */ `
attribute vec3 seed;
attribute float tip;
uniform vec3 uCentre;
uniform vec3 uBox;
uniform float uTime;
uniform vec2 uWind;
uniform float uLength;
varying float vTip;
varying float vFade;
void main() {
  // anchored in the world: the wrap is in world coordinates, so a streak does not slide as the box moves
  vec2 lo = uCentre.xz - 0.5 * uBox.xz;
  vec2 xz = lo + mod(seed.xz * uBox.xz - lo, uBox.xz);
  float y = uCentre.y - 0.5 * uBox.y + mod(seed.y * uBox.y - uTime * ${FALL.toFixed(1)}, uBox.y);
  vec3 p = vec3(xz.x, y, xz.y);
  // the tail trails up and against the wind
  p += tip * vec3(-uWind.x, 1.0, -uWind.y) * uLength;
  vTip = tip;
  // thin toward the box's sides and its top and bottom, so its edges never show
  vec3 q = abs(p - uCentre) / (0.5 * uBox);
  vFade = (1.0 - smoothstep(0.7, 1.0, max(q.x, q.z))) * (1.0 - smoothstep(0.75, 1.0, q.y));
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`

const FRAGMENT = /* glsl */ `
uniform vec3 uColour;
uniform float uOpacity;
varying float vTip;
varying float vFade;
void main() {
  gl_FragColor = vec4(uColour, uOpacity * vFade * (1.0 - 0.85 * vTip));
}
`

export interface Rain {
  /** 0 dry … 1 a downpour; `wind` (m/s along x, z) leans the streaks. */
  set(amount: number, wind: [number, number]): void
  dispose(): void
}

export function createRain(stage: Stage, seed = 1): Rain {
  const next = random(seed * 7919 + 13)
  const n = RAIN_STREAKS
  const seeds = new Float32Array(n * 2 * 3)
  const tips = new Float32Array(n * 2)
  for (let i = 0; i < n; i++) {
    const s = [next(), next(), next()]
    for (let k = 0; k < 2; k++) {
      seeds.set(s, (i * 2 + k) * 3)
      tips[i * 2 + k] = k
    }
  }
  const geometry = new BufferGeometry()
  // `position` is unused by the shader but three wants one to count the vertices
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(n * 2 * 3), 3))
  geometry.setAttribute("seed", new BufferAttribute(seeds, 3))
  geometry.setAttribute("tip", new BufferAttribute(tips, 1))
  const uniforms = {
    uCentre: { value: new Vector3() },
    uBox: { value: new Vector3(BOX, HEIGHT, BOX) },
    uTime: { value: 0 },
    uWind: { value: new Vector2() },
    uLength: { value: LENGTH },
    uColour: { value: new Color(0.62, 0.68, 0.78) },
    uOpacity: { value: 0 },
  }
  const material = new ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    fog: false,
  })
  const lines = new LineSegments(geometry, material)
  lines.name = "rain"
  lines.frustumCulled = false
  lines.visible = false
  lines.renderOrder = 10
  stage.scene.add(lines)
  stage.timing.gpu.tag(lines, "sky")

  let amount = 0
  const wind: [number, number] = [0, 0]
  const off = stage.onFrame((dt) => {
    const pose = stage.getCamera()
    const far = 1 - smoothstep(RAIN_FAR[0], RAIN_FAR[1], pose.distance)
    const opacity = 0.32 * amount * far
    lines.visible = opacity > 0.004
    if (!lines.visible) return
    // wraps on a whole number of falls through the box (3600 s × 16 m/s = 1440 × 40 m): no jump
    uniforms.uTime.value = (uniforms.uTime.value + Math.min(dt, 0.1)) % 3600
    const eye = stage.camera.position
    const [tx, ty, tz] = pose.target
    // between the focus and the eye, nearer the focus, from the ground up
    uniforms.uCentre.value.set(tx + (eye.x - tx) * 0.25, ty + HEIGHT * 0.42, tz + (eye.z - tz) * 0.25)
    uniforms.uWind.value.set(wind[0] / FALL, wind[1] / FALL)
    uniforms.uOpacity.value = opacity
  })

  return {
    set(next, w) {
      amount = Math.min(1, Math.max(0, next))
      wind[0] = w[0]
      wind[1] = w[1]
    },
    dispose() {
      off()
      lines.removeFromParent()
      geometry.dispose()
      material.dispose()
    },
  }
}
