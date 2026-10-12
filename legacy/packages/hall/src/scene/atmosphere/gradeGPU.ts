import type { Camera, Uniform } from "three"
import {
  clamp,
  dot,
  Fn,
  float,
  floor,
  fract,
  If,
  length,
  luminance,
  max,
  min,
  mix,
  perspectiveDepthToViewZ,
  pow,
  reference,
  screenSize,
  screenUV,
  select,
  smoothstep,
  vec2,
  vec3,
  vec4,
} from "three/tsl"
import type { Node, TextureNode } from "three/webgpu"
import type { GradeEffect } from "./GradeEffect.ts"

/**
 * The colour grade of the `?renderer=webgpu` post chain (PostGPU.tsx), as TSL: GradeEffect.ts's
 * `mainImage` node for node, its numbers read from the very uniform objects the GLSL effect is fed.
 */

export type F = Node<"float">
type V2 = Node<"vec2">
type V3 = Node<"vec3">

/** GradeEffect's uniforms, read from its uniform objects (written by its `apply`), and the camera's range. */
export function gradeNodes(effect: GradeEffect, camera: Camera) {
  const get = (name: string) => effect.uniforms.get(name) as Uniform
  const f = (name: string): F => reference("value", "float", get(name))
  const v2 = (name: string): V2 => reference("value", "vec2", get(name)) as unknown as V2
  const c = (name: string): V3 => reference("value", "color", get(name)) as unknown as V3
  return {
    exposure: f("exposure"),
    saturation: f("saturation"),
    darkSaturation: f("darkSaturation"),
    contrast: f("contrast"),
    shadowTint: c("shadowTint"),
    highlightTint: c("highlightTint"),
    clipToWorld: reference("value", "mat4", get("clipToWorld")) as unknown as Node<"mat4">,
    keyDirection: reference("value", "vec3", get("keyDirection")) as unknown as V3,
    windDirection: v2("windDirection"),
    cloudDrift: v2("cloudDrift"),
    cloudShadow: f("cloudShadow"),
    cloudThreshold: f("cloudThreshold"),
    cloudSoftness: f("cloudSoftness"),
    fogRadii: v2("fogRadii"),
    inkStrength: f("inkStrength"),
    inkWidth: f("inkWidth"),
    inkTolerance: f("inkTolerance"),
    inkTint: c("inkTint"),
    mist: f("mist"),
    mistTop: f("mistTop"),
    mistColor: c("mistColor"),
    mistDrift: v2("mistDrift"),
    shafts: f("shafts"),
    shaftColor: c("shaftColor"),
    shaftSource: v2("shaftSource"),
    shaftAxis: v2("shaftAxis"),
    shaftClock: f("shaftClock"),
    haze: f("haze"),
    hazeColor: c("hazeColor"),
    hazeEye: reference("value", "vec3", get("hazeEye")) as unknown as V3,
    hazeForward: v2("hazeForward"),
    hazeRange: v2("hazeRange"),
    near: reference("near", "float", camera) as F,
    far: reference("far", "float", camera) as F,
    perspective: (camera as { isPerspectiveCamera?: boolean }).isPerspectiveCamera === true,
  }
}
type GradeNodes = ReturnType<typeof gradeNodes>

/** GradeEffect.ts CLOUD_SCALE, CLOUD_STRETCH. */
const CLOUD_SCALE = 20
const CLOUD_STRETCH = 1.4

/** GradeEffect.ts `cloudHash`. */
function cloudHash(at: V2): F {
  const p = fract(at.mod(256).mul(vec2(0.1031, 0.103))).toVar()
  p.addAssign(dot(p, p.yx.add(33.33)))
  return fract(p.x.add(p.y).mul(p.x))
}

/** GradeEffect.ts `cloudNoise`: value noise, smooth-interpolated. */
function cloudNoise(p: V2): F {
  const i = floor(p)
  const t = fract(p)
  const f = t.mul(t).mul(t.mul(-2).add(3))
  const a = cloudHash(i)
  const b = cloudHash(i.add(vec2(1, 0)))
  const c = cloudHash(i.add(vec2(0, 1)))
  const d = cloudHash(i.add(vec2(1, 1)))
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y)
}

/** GradeEffect.ts `cloudCover`: 0 in the open, 1 under a cloud. */
function cloudCover(world: V3, g: GradeNodes): F {
  const key = g.keyDirection
  const ground = world.xz.sub(key.xz.mul(world.y.div(max(key.y, 0.2))))
  const along = g.windDirection
  const across = vec2(along.y.negate(), along.x)
  const q = vec2(dot(ground, along).div(CLOUD_STRETCH), dot(ground, across)).div(CLOUD_SCALE)
  const n = cloudNoise(q.sub(vec2(g.cloudDrift.x, 0)))
    .mul(0.68)
    .add(cloudNoise(q.mul(2).add(vec2(g.cloudDrift.y.negate(), 37))).mul(0.32))
  const cover = smoothstep(g.cloudThreshold.sub(g.cloudSoftness), g.cloudThreshold.add(g.cloudSoftness), n)
  return select(g.cloudShadow.greaterThan(0.001), cover, float(0))
}

/** The distance in front of the camera of a depth-buffer value (GLSL `-getViewZ(depth)`). */
function viewDistance(depth: F, g: GradeNodes): F {
  return (perspectiveDepthToViewZ(depth, g.near, g.far) as unknown as F).negate()
}

/** GradeEffect.ts `inkEdge`: 0–1, how much this pixel is the near side of a silhouette. */
function inkEdge(depthTexture: TextureNode, uv: V2, depth: F, g: GradeNodes): F {
  const o = vec2(1).div(screenSize).mul(g.inkWidth)
  const at = (offset: V2): F => depthTexture.sample(uv.add(offset)).x as unknown as F
  const x = at(vec2(o.x.negate(), 0))
    .add(at(vec2(o.x, 0)))
    .sub(depth.mul(2))
  const y = at(vec2(0, o.y.negate()))
    .add(at(vec2(0, o.y)))
    .sub(depth.mul(2))
  const range = g.far.sub(g.near)
  if (!g.perspective) return smoothstep(g.inkTolerance, g.inkTolerance.mul(3), max(x, y).mul(range))
  const z = viewDistance(depth, g)
  // dz / d(depth): the same for WebGL's depth range and WebGPU's.
  const jump = max(x, y).mul(z).mul(z).mul(range).div(g.near.mul(g.far))
  const tolerance = g.inkTolerance.mul(0.5).add(z.mul(0.01))
  return smoothstep(tolerance, tolerance.mul(3), jump).mul(smoothstep(50, 140, z).oneMinus())
}

/** GradeEffect.ts `mistAt`: how much mist lies between the eye and the surface at `world`. */
function mistAt(world: V3, distance: F, g: GradeNodes): F {
  const low = clamp(g.mistTop.sub(world.y).div(1.2), 0, 1)
  const n = cloudNoise(world.xz.div(30).add(g.mistDrift))
  const banks = smoothstep(0.3, 0.7, n).mul(0.85).add(0.15)
  const far = g.perspective ? smoothstep(8, 70, distance) : float(1)
  return g.mist.mul(low).mul(banks).mul(far.mul(0.75).add(0.25))
}

/** GradeEffect.ts `shaftAt`: the beams radiating from the sun's direction. */
function shaftAt(uv: V2, g: GradeNodes): F {
  const d = uv.sub(g.shaftSource).mul(vec2(screenSize.x.div(screenSize.y), 1))
  const along = max(dot(d, g.shaftAxis), 1e-3)
  const x = dot(d, vec2(g.shaftAxis.y.negate(), g.shaftAxis.x)).div(along).mul(16).add(g.shaftClock.mul(3))
  const i = floor(x)
  const f = fract(x)
  const n = mix(cloudHash(vec2(i, 7)), cloudHash(vec2(i.add(1), 7)), f.mul(f).mul(f.mul(-2).add(3)))
  return smoothstep(0.45, 0.85, n).div(along.mul(along).add(1))
}

/**
 * GradeEffect.ts `hazeAt`: 0 to `haze`, aerial perspective. The further a surface is behind what the
 * camera looks at (an orthographic view: level distance past the target along the way it looks; a
 * perspective one: from the lens), the more of the sky's tint lies between, ground and valleys more
 * than peaks.
 */
function hazeAt(world: V3, g: GradeNodes): F {
  const distance = g.perspective
    ? length(world.sub(g.hazeEye))
    : dot(world.xz.sub(g.hazeEye.xz), g.hazeForward)
  const far = smoothstep(g.hazeRange.x, g.hazeRange.y, distance)
  return g.haze.mul(far).mul(mix(1, 0.6, smoothstep(0, 40, world.y)))
}

/**
 * GradeEffect.ts's `mainImage`, node for node: the depth-read looks (behind the tier's looks, as
 * its defines), then the colour. Linear HDR in and out.
 */
export function grade(
  input: Node<"vec3">,
  depthTexture: TextureNode,
  g: GradeNodes,
  looks: { outlines: boolean; mist: boolean },
): Node<"vec3"> {
  return Fn(() => {
    const c = vec3(input).toVar()
    const uv = screenUV
    // GradeEffect's screen positions (the shafts' source) are the composer's: y up from the bottom.
    const up = vec2(uv.x, uv.y.oneMinus())
    const depth = (depthTexture.sample(uv).x as unknown as F).toVar()
    If(depth.lessThan(0.9999), () => {
      const clip = g.clipToWorld.mul(vec4(up.mul(2).sub(1), depth, 1))
      const world = clip.xyz.div(clip.w).toVar()
      const cover = cloudCover(world, g).toVar()
      const clear = smoothstep(g.fogRadii.x, g.fogRadii.y, length(world.xz)).oneMinus().toVar()
      if (looks.outlines)
        c.assign(mix(c, c.mul(g.inkTint), g.inkStrength.mul(inkEdge(depthTexture, uv, depth, g)).mul(clear)))
      c.mulAssign(g.exposure.mul(g.cloudShadow.mul(cover).oneMinus()))
      if (looks.mist) {
        // Lights glow through the mist (it veils what they light, not the flames themselves).
        const m = float(0).toVar()
        If(g.mist.greaterThan(0.002), () => {
          m.assign(
            mistAt(world, viewDistance(depth, g), g)
              .mul(clear)
              .mul(smoothstep(0.7, 2.5, luminance(c)).oneMinus()),
          )
          // Mist only ever lifts: under a storm's dark sky it must not drag the ground down with it.
          c.assign(mix(c, max(c, g.mistColor.mul(g.exposure)), min(m, 0.85)))
        })
        // Aerial perspective (a gen 2 island's): the far side takes the sky's cooler tint, lamps excepted.
        If(g.haze.greaterThan(0.002), () => {
          const glow = smoothstep(0.7, 2.5, luminance(c)).oneMinus()
          c.assign(mix(c, g.hazeColor.mul(g.exposure), hazeAt(world, g).mul(clear).mul(glow)))
        })
        If(g.shafts.greaterThan(0.001), () => {
          c.addAssign(
            g.shaftColor
              .mul(g.exposure)
              .mul(g.shafts)
              .mul(shaftAt(up, g))
              .mul(cover.oneMinus())
              .mul(min(m.mul(3), 1).mul(0.55).add(0.45)),
          )
        })
      }
    }).Else(() => {
      c.mulAssign(g.exposure)
    })
    const l = luminance(c)
    const saturated = mix(vec3(l), c, mix(g.darkSaturation, g.saturation, smoothstep(0.02, 0.3, l))).max(0)
    const tinted = saturated.mul(mix(g.shadowTint, g.highlightTint, smoothstep(0.02, 0.5, l)))
    return pow(tinted.div(0.18), vec3(g.contrast)).mul(0.18)
  })() as unknown as Node<"vec3">
}
