import type { Texture } from "three"
import {
  abs,
  attribute,
  cameraProjectionMatrix,
  cameraViewMatrix,
  clamp,
  exp,
  Fn,
  float,
  floor,
  fwidth,
  length,
  max,
  min,
  mix,
  normalize,
  positionGeometry,
  pow,
  reference,
  select,
  sin,
  smoothstep,
  step,
  texture,
  varying,
  vec2,
  vec3,
  vec4,
} from "three/tsl"
import { type Node, NodeMaterial } from "three/webgpu"

/**
 * Sigils.tsx's two materials as node materials, for WebGPU (which can't run their GLSL): the
 * medallions and the burst particles, node for node, reading the very uniform objects Sigils writes
 * each frame. Both place their quads on screen themselves (`vertexNode`, a clip position), as the
 * GLSL sets gl_Position. Loaded on demand: it pulls in three/webgpu.
 */

type Float = Node<"float">
type Vec2 = Node<"vec2">
type Vec4 = Node<"vec4">
type Holder = { value: unknown }

const float_ = (holder: Holder): Float => reference("value", "float", holder)
const vec2_ = (holder: Holder): Vec2 => reference("value", "vec2", holder) as unknown as Vec2
const vec4_ = (holder: Holder): Vec4 => reference("value", "vec4", holder) as unknown as Vec4
const color_ = (holder: Holder) => reference("value", "color", holder) as unknown as Node<"vec3">

/** What both materials read (Sigils.tsx `uniforms`). */
export interface SigilUniforms {
  uViewport: Holder
  uSize: Holder
  uBob: Holder
  uBright: Holder
  uPace: Holder
  uTime: Holder
  uInk: Holder
  uInkHi: Holder
  uPaper: Holder
}

/** Sigils.tsx SCREEN `anchorClip`: the anchor's clip position, and the medallion's size there in CSS px. */
function anchorClip(u: SigilUniforms, world: Node<"vec3">): { clip: Vec4; size: Float } {
  const clip = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1)) as unknown as Vec4
  const viewport = vec2_(u.uViewport)
  const size4 = vec4_(u.uSize)
  // GLSL projectionMatrix[1][1]: column 1, row 1.
  const projection = cameraProjectionMatrix as unknown as { element(column: number): Vec4 }
  const perUnit = projection.element(1).y.mul(viewport.y).mul(0.5).div(clip.w)
  const size = clamp(size4.x.mul(perUnit), size4.y, size4.z) as unknown as Float
  return { clip, size }
}

/** Sigils.tsx SCREEN `offsetPx`: a clip position moved by CSS px on screen. */
function offsetPx(u: SigilUniforms, clip: Vec4, px: Vec2): Vec4 {
  const moved = px.mul(2).div(vec2_(u.uViewport)).mul(clip.w)
  return vec4(clip.xy.add(moved), clip.zw)
}

function overlay(material: NodeMaterial): NodeMaterial {
  material.transparent = true
  material.depthTest = false
  material.depthWrite = false
  material.fog = false
  return material
}

/** Sigils.tsx `sigilMesh`'s material: an ink medallion, a role-tinted rim and the deed's glyph. */
export function sigilNodeMaterial(u: SigilUniforms, atlas: Texture, disc: number): NodeMaterial {
  const material = overlay(new NodeMaterial())
  const anchor = attribute<"vec4">("aAnchor", "vec4")
  const state = attribute<"vec4">("aState", "vec4")
  const rim = attribute<"vec4">("aRim", "vec4")
  const flash = attribute<"vec4">("aFlash", "vec4")
  const banner = attribute<"vec4">("aBanner", "vec4")

  const { clip, size } = anchorClip(u, anchor.xyz)
  const radius = size.div(2 * disc).mul(state.z)
  const bob = sin(float_(u.uTime).mul(2.1).add(rim.w)).mul(float_(u.uBob))
  const centre = vec2(anchor.w, state.w.add(vec4_(u.uSize).w).add(size.mul(0.5)).add(bob))
  material.vertexNode = offsetPx(u, clip, centre.add(positionGeometry.xy.mul(radius)))

  material.colorNode = Fn(() => {
    const local = varying(positionGeometry.xy, "vLocal") as unknown as Vec2
    const FACE = 0.69
    const ICON = 0.62
    const r = length(local)
    const aa = fwidth(r)
    const onDisc = smoothstep(aa.negate().add(disc), aa.add(disc), r).oneMinus()
    const onRim = smoothstep(aa.negate().add(FACE), aa.add(FACE), r)
    // Ink face, a touch warmer at the top: a struck coin, not a flat dot.
    const top = clamp(local.y.mul(0.7).add(0.5), 0, 1)
    const face = mix(color_(u.uInk), color_(u.uInkHi), top.mul(0.55))
    // Brass rim tinted by the role, lit from above; a pop washes it in success or failure.
    const rimColour = mix(rim.rgb, flash.rgb, flash.a).mul(top.mul(0.4).add(0.9))
    const colour = mix(face, rimColour, onRim).toVar()
    const seam = smoothstep(0, aa.mul(1.6), abs(r.sub(FACE))).oneMinus()
    const edge = smoothstep(aa.mul(-2.5).add(disc), aa.mul(-0.5).add(disc), r)
    colour.assign(mix(colour, color_(u.uInk), max(seam.mul(0.7), edge.mul(0.85))))
    // The glyph: from the atlas, always sampled, masked to its box.
    const g = local.div(ICON)
    const box = clamp(g, -1, 1)
    const cellIndex = state.x
    const cell = vec2(cellIndex.mod(4), floor(cellIndex.div(4)))
    const at = vec2(
      cell.x.add(box.x.mul(0.5)).add(0.5).div(4),
      float(1).sub(cell.y.add(0.5).sub(box.y.mul(0.5)).div(4)),
    )
    const glyph = texture(atlas, at)
      .bias(float(-0.6))
      .a.mul(step(max(abs(g.x), abs(g.y)), 1))
      .mul(onRim.oneMinus())
    colour.assign(mix(colour, mix(color_(u.uPaper), flash.rgb, flash.a.mul(0.45)), glyph))
    // A soft shadow just outside the rim, and the party's banner ring just outside the outer line.
    const shade = smoothstep(disc, 1, r).oneMinus().mul(0.4)
    const ring = banner.a
      .mul(onDisc.oneMinus())
      .mul(smoothstep(aa.negate().add(disc + 0.13), aa.add(disc + 0.13), r).oneMinus())
    const alpha = onDisc.add(ring).add(float(1).sub(onDisc).sub(ring).mul(shade))
    const lit = colour.mul(onDisc).add(banner.rgb.mul(ring)).mul(float_(u.uBright))
    return vec4(lit.div(max(alpha, 1e-4)), alpha.mul(state.y))
  })()
  return material
}

/** Sigils.tsx `burstMesh`'s material: a spark (four-point glint) or a soft puff, out of the rim. */
export function burstNodeMaterial(u: SigilUniforms): NodeMaterial {
  const material = overlay(new NodeMaterial())
  const origin = attribute<"vec3">("aOrigin", "vec3")
  const motion = attribute<"vec4">("aMotion", "vec4")
  const look = attribute<"vec4">("aLook", "vec4")
  const shape = attribute<"vec4">("aShape", "vec4")

  const age = float_(u.uTime).sub(motion.z).mul(float_(u.uPace))
  const t = age.div(max(motion.w, 1e-3))
  const dead = motion.w.lessThanEqual(0).or(t.lessThan(0)).or(t.greaterThan(1))
  const { clip, size } = anchorClip(u, origin)
  const centre = vec2(0, shape.x.add(vec4_(u.uSize).w).add(size.mul(0.5)))
  const dir = normalize(motion.xy.add(1e-4))
  // Out of the medallion's rim, slowing as it goes.
  const travel = exp(shape.w.negate().mul(age)).oneMinus().div(shape.w)
  const at = centre.add(dir.mul(size).mul(0.38)).add(motion.xy.mul(travel))
  const scale = shape.y.mul(max(0.2, shape.z.mul(t).add(1))).mul(0.5)
  // Dead: outside the clip box.
  material.vertexNode = select(
    dead,
    vec4(2, 2, 2, 1),
    offsetPx(u, clip, at.add(positionGeometry.xy.mul(scale))),
  )

  const local = varying(positionGeometry.xy, "vLocal") as unknown as Vec2
  const fade = varying(smoothstep(0, 0.06, t).mul(pow(t.oneMinus(), 1.3)), "vFade") as unknown as Float
  const r = length(local)
  const arms = smoothstep(0, 0.16, min(abs(local.x), abs(local.y)))
    .oneMinus()
    .mul(smoothstep(0.15, 1, r).oneMinus())
  const core = smoothstep(0, 0.45, r).oneMinus()
  const spark = look.a.lessThan(0.5)
  const alpha = select(spark, max(core, arms.mul(0.9)), smoothstep(0.25, 1, r).oneMinus().mul(0.7))
  const colour = select(spark, mix(look.rgb, vec3(1, 0.96, 0.86), core.mul(0.45)), look.rgb)
  material.colorNode = vec4(colour.mul(float_(u.uBright)), alpha.mul(fade))
  return material
}
