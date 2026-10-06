import { useFrame } from "@react-three/fiber"
import { useEffect, useMemo } from "react"
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  LineSegments,
  MathUtils,
  type OrthographicCamera,
  Points,
  ShaderMaterial,
  Vector2,
  Vector3,
} from "three"
import type { Tier } from "../../guild/quality.ts"
import { useGuildStore } from "../../guild/useGuild.ts"
import { EASE, pixelsPerUnit, seenWidth, targetOf, WIND_DIRECTION } from "./shared.ts"

/**
 * Rain and snow: a box of drops round the camera's target, sized to what the camera sees, so the
 * overview and a close-up both look wet. Every drop's place is computed on the GPU from its seed
 * and the time (fall, wind drift, wrap round the box), so nothing is written per frame but a few
 * uniforms, and density is a draw range. One draw call each.
 */
export function Precipitation({ tier }: { tier: Tier }) {
  const store = useGuildStore()
  const rain = useMemo(() => fall("rain", RAIN_COUNT[tier]), [tier])
  const snow = useMemo(() => fall("snow", SNOW_COUNT[tier]), [tier])
  const state = useMemo(() => ({ rain: 0, snow: 0, wind: 0, time: 0 }), [])

  useEffect(
    () => () => {
      for (const object of [rain, snow]) {
        object.geometry.dispose()
        object.material.dispose()
      }
    },
    [rain, snow],
  )

  useFrame(({ camera, controls, size, viewport }, delta) => {
    const env = store.environment
    const snowing = env.weather === "snow"
    state.rain = MathUtils.damp(state.rain, snowing ? 0 : env.precipitation, EASE, delta)
    state.snow = MathUtils.damp(state.snow, snowing ? env.precipitation : 0, EASE, delta)
    state.wind = MathUtils.damp(state.wind, env.wind, EASE, delta)
    state.time += delta

    const target = targetOf(controls)
    const ortho = (camera as OrthographicCamera).isOrthographicCamera
    view.target = target
    // The box is a little larger than what the camera sees.
    view.span = MathUtils.clamp(seenWidth(camera, size, target) * 1.1, 16, 220)
    // gl_PointSize is in device pixels.
    view.pixels = pixelsPerUnit(camera, size) * viewport.dpr
    view.perspective = ortho ? 0 : 1
    view.time = state.time
    view.wind = state.wind
    show(rain, state.rain, "rain", view)
    show(snow, state.snow, "snow", view)
  })

  return (
    <>
      <primitive object={rain} />
      <primitive object={snow} />
    </>
  )
}

const RAIN_COUNT: Record<Tier, number> = { 0: 2500, 1: 5000, 2: 7000, 3: 9000 }
const SNOW_COUNT: Record<Tier, number> = { 0: 1500, 1: 3000, 2: 4000, 3: 5000 }
/** How far the wind pushes each, per unit of fall speed. */
const WIND = { rain: 0.18, snow: 0.06 } as const
type Fall = LineSegments<BufferGeometry, ShaderMaterial> | Points<BufferGeometry, ShaderMaterial>

/** This frame's camera and wind, shared by both falls (one object, reused: no per-frame garbage). */
const view = { target: new Vector3(), span: 100, pixels: 10, perspective: 0, time: 0, wind: 0 }

/** Point one fall at this frame: how much of it, where, how slanted. */
function show(object: Fall, amount: number, kind: "rain" | "snow", frame: typeof view): void {
  const visible = amount > 0.01
  object.visible = visible
  if (!visible) return
  const vertices = kind === "rain" ? 2 : 1
  const drops = object.geometry.getAttribute("seed").count / vertices
  object.geometry.setDrawRange(0, Math.round(drops * MathUtils.clamp(amount, 0, 1)) * vertices)
  const { span } = frame
  const u = object.material.uniforms as Uniforms
  u.uTime.value = frame.time
  u.uCenter.value.copy(frame.target)
  u.uSpan.value = span
  u.uHeight.value = span * 0.55
  u.uSpeed.value = span * (kind === "rain" ? 0.55 : 0.05)
  u.uWind.value.set(WIND_DIRECTION.x, WIND_DIRECTION.z).multiplyScalar(span * frame.wind * WIND[kind])
  u.uLength.value = span * 0.014
  u.uSize.value = span * 0.0045
  u.uPixels.value = frame.pixels
  u.uPerspective.value = frame.perspective
  u.uOpacity.value = (kind === "rain" ? 0.55 : 0.9) * MathUtils.smoothstep(amount, 0, 0.25)
}

/** A box of `count` seeded drops: rain as streaks (two vertices each), snow as points. */
/** Exported for tests. */
export function fall(kind: "rain" | "snow", count: number): Fall {
  const vertices = kind === "rain" ? 2 : 1
  const seeds = new Float32Array(count * vertices * 4)
  let a = kind === "rain" ? 11 : 23
  const random = () => {
    a = (a * 16807) % 2147483647
    return a / 2147483647
  }
  for (let i = 0; i < count; i++) {
    const seed = [random(), random(), random(), random()]
    for (let v = 0; v < vertices; v++) {
      const at = (i * vertices + v) * 4
      seeds.set(seed, at)
      // The fourth number tells a streak's tail (≥ 2) from its head.
      if (kind === "rain" && v === 1) seeds[at + 3] = (seeds[at + 3] ?? 0) + 2
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute("position", new Float32BufferAttribute(new Float32Array(count * vertices * 3), 3))
  geometry.setAttribute("seed", new Float32BufferAttribute(seeds, 4))
  const material = new ShaderMaterial({
    uniforms: uniforms(kind),
    vertexShader: kind === "rain" ? RAIN_VERTEX : SNOW_VERTEX,
    fragmentShader: kind === "rain" ? RAIN_FRAGMENT : SNOW_FRAGMENT,
    transparent: true,
    depthWrite: false,
    // Snow keeps the default blending: passing `blending: undefined` makes three warn.
    ...(kind === "rain" ? { blending: AdditiveBlending } : {}),
  })
  const object = kind === "rain" ? new LineSegments(geometry, material) : new Points(geometry, material)
  object.frustumCulled = false
  object.visible = false
  object.renderOrder = 10
  return object
}

function uniforms(kind: "rain" | "snow") {
  return {
    uTime: { value: 0 },
    uCenter: { value: new Vector3() },
    uSpan: { value: 100 },
    uHeight: { value: 50 },
    uSpeed: { value: 50 },
    uWind: { value: new Vector2() },
    uLength: { value: 1 },
    uSize: { value: 0.4 },
    uPixels: { value: 10 },
    uPerspective: { value: 0 },
    uOpacity: { value: 0 },
    uColor: { value: new Color(kind === "rain" ? "#b9cadb" : "#ffffff") },
  }
}
type Uniforms = ReturnType<typeof uniforms>

/** Where a drop is: falling from the box's top, pushed by the wind, wrapped round the target. */
const DROP = /* glsl */ `
  uniform float uTime;
  uniform vec3 uCenter;
  uniform float uSpan;
  uniform float uHeight;
  uniform float uSpeed;
  uniform vec2 uWind;
  attribute vec4 seed;

  vec3 drop(float sway) {
    float fall = mod(uTime * uSpeed + seed.z * uHeight, uHeight);
    float seconds = fall / uSpeed;
    vec2 xz = (seed.xy - 0.5) * uSpan + uWind * seconds;
    xz += sway * vec2(sin(uTime * 1.3 + seed.w * 40.0), cos(uTime * 1.1 + seed.z * 40.0));
    xz = mod(xz - uCenter.xz + 0.5 * uSpan, uSpan) - 0.5 * uSpan + uCenter.xz;
    return vec3(xz.x, uHeight - fall - 0.5, xz.y);
  }
`

const RAIN_VERTEX = /* glsl */ `
  ${DROP}
  uniform float uLength;
  varying float vTail;
  void main() {
    vec3 head = drop(0.0);
    vTail = step(2.0, seed.w);
    vec3 velocity = normalize(vec3(uWind.x, -uSpeed, uWind.y));
    vec3 point = head - velocity * uLength * (0.6 + 0.8 * fract(seed.w)) * vTail;
    gl_Position = projectionMatrix * viewMatrix * vec4(point, 1.0);
  }
`

const RAIN_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vTail;
  void main() {
    gl_FragColor = vec4(uColor, uOpacity * (1.0 - 0.8 * vTail));
  }
`

const SNOW_VERTEX = /* glsl */ `
  ${DROP}
  uniform float uSize;
  uniform float uPixels;
  uniform float uPerspective;
  void main() {
    vec4 view = viewMatrix * vec4(drop(uSpan * 0.01), 1.0);
    gl_Position = projectionMatrix * view;
    float size = uSize * (0.6 + 0.8 * seed.w) * uPixels;
    gl_PointSize = clamp(uPerspective > 0.5 ? size / -view.z : size, 1.5, 48.0);
  }
`

const SNOW_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    gl_FragColor = vec4(uColor, uOpacity * smoothstep(0.5, 0.15, d));
  }
`
