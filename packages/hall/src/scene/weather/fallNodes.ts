import {
  AdditiveBlending,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LineSegments,
  Mesh,
} from "three"
import {
  attribute,
  cameraProjectionMatrix,
  cameraViewMatrix,
  clamp,
  cos,
  Discard,
  Fn,
  float,
  fract,
  mod,
  normalize,
  positionGeometry,
  screenSize,
  select,
  sin,
  smoothstep,
  step,
  uniform,
  varying,
  vec2,
  vec3,
  vec4,
} from "three/tsl"
import { type Node, NodeMaterial } from "three/webgpu"
import { type Fall, seeds, type Uniforms, uniforms } from "./Precipitation.tsx"

/**
 * The falls as TSL node materials (`?tsl=1`, scene/tsl.ts): the same drops as Precipitation's GLSL,
 * node for node, so either path draws the same picture. The one change of shape is snow: a point
 * bigger than a pixel doesn't port (three's GLSL node builder pins `gl_PointSize = 1.0`, and WebGPU
 * has no point size at all), so each flake is an instanced quad sized in pixels as the point was —
 * still one draw call. Loaded on demand: it pulls in three/webgpu.
 */
export function nodeFall(kind: "rain" | "snow", count: number): Fall {
  const u = nodeUniforms(kind)
  const material = new NodeMaterial()
  material.transparent = true
  material.depthWrite = false
  material.fog = false
  if (kind === "rain") material.blending = AdditiveBlending

  if (kind === "rain") {
    const geometry = seeds("rain", count)
    const seed = attribute<"vec4">("seed", "vec4")
    const tail = step(2, seed.w)
    const velocity = normalize(vec3(u.uWind.x, u.uSpeed.negate(), u.uWind.y))
    const point = drop(u, seed, 0).sub(velocity.mul(u.uLength.mul(fract(seed.w).mul(0.8).add(0.6))).mul(tail))
    material.vertexNode = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(point, 1))
    material.fragmentNode = vec4(u.uColor, u.uOpacity.mul(float(1).sub(varying(tail).mul(0.8))))
    const object = new LineSegments(geometry, material)
    return dressed(object, u, count, (drops) => geometry.setDrawRange(0, drops * 2))
  }

  const geometry = flakes(count)
  const seed = attribute<"vec4">("seed", "vec4")
  const view = cameraViewMatrix.mul(vec4(drop(u, seed, u.uSpan.mul(0.01)), 1))
  const clip = cameraProjectionMatrix.mul(view)
  const size = u.uSize.mul(seed.w.mul(0.8).add(0.6)).mul(u.uPixels)
  const pixels = clamp(select(u.uPerspective.greaterThan(0.5), size.div(view.z.negate()), size), 1.5, 48)
  // The corner, in clip space: pixels over the target's half-size, times w (undoing the divide).
  const corner = positionGeometry.xy.mul(pixels).div(screenSize.mul(0.5)).mul(clip.w)
  material.vertexNode = vec4(clip.xy.add(corner), clip.zw)
  const coord = varying(positionGeometry.xy)
  material.fragmentNode = Fn(() => {
    const d = coord.length()
    Discard(d.greaterThan(0.5))
    return vec4(u.uColor, u.uOpacity.mul(smoothstep(0.5, 0.15, d)))
  })()
  const object = new Mesh(geometry, material)
  return dressed(object, u, count, (drops) => {
    geometry.instanceCount = drops
  })
}

type NodeUniforms = ReturnType<typeof nodeUniforms>

/** The GLSL fall's uniforms, as uniform nodes (same names and values: Precipitation writes both). */
function nodeUniforms(kind: "rain" | "snow") {
  const v = uniforms(kind)
  return {
    uTime: uniform(v.uTime.value),
    uCenter: uniform(v.uCenter.value),
    uSpan: uniform(v.uSpan.value),
    uHeight: uniform(v.uHeight.value),
    uSpeed: uniform(v.uSpeed.value),
    uWind: uniform(v.uWind.value),
    uLength: uniform(v.uLength.value),
    uSize: uniform(v.uSize.value),
    uPixels: uniform(v.uPixels.value),
    uPerspective: uniform(v.uPerspective.value),
    uOpacity: uniform(v.uOpacity.value),
    uColor: uniform(v.uColor.value),
  }
}

/** Where a drop is (Precipitation's DROP): falling from the box's top, pushed by the wind, wrapped round the target. */
function drop(u: NodeUniforms, seed: ReturnType<typeof attribute<"vec4">>, sway: Node<"float"> | number) {
  const fall = mod(u.uTime.mul(u.uSpeed).add(seed.z.mul(u.uHeight)), u.uHeight)
  const seconds = fall.div(u.uSpeed)
  const swayed = seed.xy
    .sub(0.5)
    .mul(u.uSpan)
    .add(u.uWind.mul(seconds))
    .add(vec2(sin(u.uTime.mul(1.3).add(seed.w.mul(40))), cos(u.uTime.mul(1.1).add(seed.z.mul(40)))).mul(sway))
  const half = u.uSpan.mul(0.5)
  const xz = mod(swayed.sub(u.uCenter.xz).add(half), u.uSpan).sub(half).add(u.uCenter.xz)
  return vec3(xz.x, u.uHeight.sub(fall).sub(0.5), xz.y)
}

/** `count` flakes: one unit quad (corners ±0.5), instanced, each instance a drop's seed. */
function flakes(count: number): InstancedBufferGeometry {
  const quad = new InstancedBufferGeometry()
  quad.setAttribute(
    "position",
    new Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3),
  )
  quad.setIndex([0, 1, 2, 0, 2, 3])
  const seed = seeds("snow", count).getAttribute("seed")
  quad.setAttribute("seed", new InstancedBufferAttribute(seed.array as Float32Array, 4))
  quad.instanceCount = count
  return quad
}

/** The fall's object as Precipitation sets them up (unculled, hidden until it falls, drawn late). */
function dressed(
  object: LineSegments | Mesh,
  u: Uniforms,
  drops: number,
  draw: (drops: number) => void,
): Fall {
  object.frustumCulled = false
  object.visible = false
  object.renderOrder = 10
  return { object: object as Fall["object"], uniforms: u, drops, draw }
}
