/**
 * Snow: soft flakes drifting down through a box round where the camera looks, one draw of points, moved
 * wholly on the GPU like the rain (each flake's place is a seed wrapped into the box, so it stays put in
 * the world as the box follows the camera). Slower and wider than rain, swaying on its own phase, sized
 * in world metres so a flake reads as a flake near and as a speck far, and it thins out with the camera's
 * distance. Nothing is drawn while it is dry.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  NormalBlending,
  Points,
  ShaderMaterial,
  Vector2,
  Vector3,
} from "three"
import type { Stage } from "../stage.ts"
import { warmPrograms } from "../warm.ts"
import { random, smoothstep } from "./ease.ts"
import { RAIN_FAR } from "./rain.ts"

export const SNOW_FLAKES = 3600
/** Fall speed, m/s, a flake's diameter, m, and the sway's reach, m. */
const FALL = 1.6
const SIZE = 0.24
const SWAY = 0.7
const BOX = 56
const HEIGHT = 40

const VERTEX = /* glsl */ `
attribute vec3 seed;
uniform vec3 uCentre;
uniform vec3 uBox;
uniform float uTime;
uniform vec2 uWind;
uniform float uPixels;
varying float vFade;
varying float vBlur;
void main() {
  vec2 lo = uCentre.xz - 0.5 * uBox.xz;
  float fall = uTime * ${FALL.toFixed(1)};
  // drift with the wind as it falls, and sway on its own phase (whole cycles per hour: no jump at the wrap)
  float phase = seed.x * 6.2831853 + seed.z * 17.0;
  vec2 sway = ${SWAY.toFixed(2)} * vec2( sin( uTime * 0.6981317 + phase ), cos( uTime * 0.5585054 + phase * 1.3 ) );
  vec2 drift = uWind * fall;
  vec2 xz = lo + mod( seed.xz * uBox.xz - lo + drift, uBox.xz ) + sway;
  float y = uCentre.y - 0.5 * uBox.y + mod( seed.y * uBox.y - fall, uBox.y );
  vec4 mv = viewMatrix * vec4( xz.x, y, xz.y, 1.0 );
  vec3 p = vec3( xz.x, y, xz.y );
  vec3 q = abs( p - uCentre ) / ( 0.5 * uBox );
  vFade = ( 1.0 - smoothstep( 0.7, 1.0, max( q.x, q.z ) ) ) * ( 1.0 - smoothstep( 0.75, 1.0, q.y ) );
  // a flake's own size, 0.6 … 1.4 of the mean
  float size = ${SIZE.toFixed(2)} * ( 0.6 + 0.8 * fract( seed.z * 7.31 ) );
  float px = clamp( size * uPixels / max( -mv.z, 0.1 ), 1.6, 16.0 );
  // under three pixels a flake is a fainter speck, not a flicker
  vBlur = smoothstep( 1.6, 3.0, px );
  gl_PointSize = px;
  gl_Position = projectionMatrix * mv;
}
`

const FRAGMENT = /* glsl */ `
uniform vec3 uColour;
uniform float uOpacity;
varying float vFade;
varying float vBlur;
void main() {
  float d = length( gl_PointCoord - 0.5 ) * 2.0;
  float a = 1.0 - smoothstep( 0.35, 1.0, d );
  gl_FragColor = vec4( uColour, uOpacity * vFade * a * mix( 0.45, 1.0, vBlur ) );
}
`

export interface Snow {
  /** 0 none … 1 a heavy fall; `wind` (m/s along x, z) leans the drift; `bright` 0 night … 1 day dims the flakes. */
  set(amount: number, wind: [number, number], bright: number): void
  dispose(): void
}

export function createSnow(stage: Stage, seed = 1): Snow {
  const next = random(seed * 6271 + 5)
  const seeds = new Float32Array(SNOW_FLAKES * 3)
  for (let i = 0; i < seeds.length; i++) seeds[i] = next()
  const geometry = new BufferGeometry()
  // `position` is unused by the shader but three wants one to count the vertices
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(SNOW_FLAKES * 3), 3))
  geometry.setAttribute("seed", new BufferAttribute(seeds, 3))
  const uniforms = {
    uCentre: { value: new Vector3() },
    uBox: { value: new Vector3(BOX, HEIGHT, BOX) },
    uTime: { value: 0 },
    uWind: { value: new Vector2() },
    uPixels: { value: 1 },
    uColour: { value: new Color(0.96, 0.98, 1) },
    uOpacity: { value: 0 },
  }
  const material = new ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: NormalBlending,
    fog: false,
  })
  const points = new Points(geometry, material)
  points.name = "snow"
  points.frustumCulled = false
  points.visible = false
  points.renderOrder = 10
  stage.scene.add(points)
  stage.timing.gpu.tag(points, "sky")
  // its program links in the background before its first draw (warm.ts), as the rain's does
  let warmed = false
  void warmPrograms(stage, points).then(() => {
    warmed = true
  })

  let amount = 0
  let bright = 1
  const wind: [number, number] = [0, 0]
  const size = new Vector2()
  const off = stage.onFrame((dt) => {
    const pose = stage.getCamera()
    const far = 1 - smoothstep(RAIN_FAR[0], RAIN_FAR[1], pose.distance)
    const opacity = 1.0 * amount * far
    points.visible = warmed && opacity > 0.004
    if (!points.visible) return
    // a whole number of falls through the box (3600 s × 1.6 m/s = 144 × 40 m) and of sway cycles: no jump
    uniforms.uTime.value = (uniforms.uTime.value + Math.min(dt, 0.1)) % 3600
    const eye = stage.camera.position
    const [tx, ty, tz] = pose.target
    uniforms.uCentre.value.set(tx + (eye.x - tx) * 0.25, ty + HEIGHT * 0.42, tz + (eye.z - tz) * 0.25)
    uniforms.uWind.value.set(wind[0] / FALL, wind[1] / FALL).multiplyScalar(0.12)
    stage.renderer.getDrawingBufferSize(size)
    // device pixels per metre at one metre: half the buffer's height times the projection's focal scale
    uniforms.uPixels.value = 0.5 * size.y * stage.camera.projectionMatrix.elements[5]
    uniforms.uColour.value.setRGB(0.3 + 0.66 * bright, 0.34 + 0.64 * bright, 0.46 + 0.54 * bright)
    uniforms.uOpacity.value = opacity
  })

  return {
    set(next, w, b) {
      amount = Math.min(1, Math.max(0, next))
      wind[0] = w[0]
      wind[1] = w[1]
      bright = Math.min(1, Math.max(0, b))
    },
    dispose() {
      off()
      points.removeFromParent()
      geometry.dispose()
      material.dispose()
    },
  }
}
