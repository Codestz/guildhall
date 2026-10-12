import {
  AdditiveBlending,
  type Blending,
  DoubleSide,
  type MeshBasicMaterial,
  type MeshStandardMaterial,
  NormalBlending,
  type Side,
} from "three"
import {
  abs,
  atan,
  cameraProjectionMatrix,
  clamp,
  cos,
  dot,
  exp,
  float,
  fract,
  length,
  materialEmissive,
  materialOpacity,
  max,
  min,
  mix,
  mod,
  modelViewMatrix,
  normalize,
  normalView,
  positionGeometry,
  positionLocal,
  positionViewDirection,
  pow,
  reference,
  select,
  sin,
  smoothstep,
  uv,
  varying,
  vec2,
  vec3,
  vec4,
  attribute as vertexAttribute,
  vertexColor,
} from "three/tsl"
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial, type Node, NodeMaterial } from "three/webgpu"

/**
 * The world events' shaders as node materials, for WebGPU (which runs neither their GLSL
 * ShaderMaterials nor their onBeforeCompile patches): the flag and sail flutter (raid, ghost ship),
 * the festival's reveal, the dragon's wingbeat and its fire, the ghost ship's rim, fade and wisps,
 * the meteors and the comet, the rainbow, the fireworks and the confetti. Each is its GLSL node for
 * node, reading the very uniform objects the show writes each frame; the GLSL stays the default on
 * WebGL. Picked by scene/events/common.ts `useShowMeshes`. Loaded on demand: it pulls in three/webgpu.
 *
 * Forms changed, never results: a GLSL `if` that leaves a value alone is a select (or a weight that
 * is zero there); `if (a < x) discard` is the mask `a >= x`; a quad flung out of the clip box is a
 * select on its clip position (sigilNodes.ts's way).
 */

type Float = Node<"float">
type Vec2 = Node<"vec2">
type Vec3 = Node<"vec3">
type Vec4 = Node<"vec4">
type Holder = { value: number }

const uniformOf = (holder: Holder): Float => reference("value", "float", holder)
const float1 = (name: string): Float => vertexAttribute<"float">(name, "float")
const float3 = (name: string): Vec3 => vertexAttribute<"vec3">(name, "vec3")
const float2 = (name: string): Vec2 => vertexAttribute<"vec2">(name, "vec2")

/** Outside the clip box: what the GLSL writes for a particle not alive now. */
const NOWHERE = vec4(2, 2, 2, 1)

/** `projectionMatrix * mv` with the quad's corner moved by `offset` in view space (a camera-facing quad). */
function facing(centre: Vec3, offset: Vec2): Vec4 {
  const mv = modelViewMatrix.mul(vec4(centre, 1)) as unknown as Vec4
  return cameraProjectionMatrix.mul(vec4(mv.xy.add(offset), mv.zw)) as unknown as Vec4
}

/**
 * A material that places its own quads (`vertexNode`, a clip position): the stock position step
 * (instancing, normals, skinning, morphs) is skipped, as the GLSL skips it. Built, it reads the
 * geometry's normals as one more vertex buffer: a comet's streak (six per-instance attributes,
 * position, uv) would then need nine of the eight a WebGPU pipeline may have, and fail to build.
 */
class ParticleNodeMaterial extends NodeMaterial {
  override setupPosition(): Node {
    return positionLocal
  }
}

/** A self-placing particle material (the GLSL ShaderMaterials' defaults: unlit, unfogged, untonemapped). */
function particles(options: {
  vertex: Vec4
  colour: Vec4
  keep: Node<"bool">
  blending: Blending
  transparent?: boolean
  side?: Side
}): NodeMaterial {
  const material = new ParticleNodeMaterial()
  material.vertexNode = options.vertex
  material.colorNode = options.colour
  material.maskNode = options.keep
  material.transparent = options.transparent ?? true
  material.depthWrite = false
  material.blending = options.blending
  material.side = options.side ?? material.side
  material.fog = false
  material.toneMapped = false
  return material
}

// ─────────────────────────────── patched standard materials ───────────────────────────────

/** common.ts `flutter`: flags and sails (`aFlag`) wave across the cloth, more further from the mast. */
function flutterPosition(time: Holder, amount: number): Vec3 {
  const p = positionGeometry
  const wave = sin(uniformOf(time).mul(7).add(p.z.mul(2.6)).add(p.y.mul(1.3)))
  // aFlag is 0 on the hull: it stays where it is, as the GLSL's `if (aFlag > 0.0)` leaves it.
  const dx = wave.mul(amount).mul(float1("aFlag")).mul(abs(p.z).mul(0.25).add(0.35))
  return positionLocal.add(vec3(dx, 0, 0)) as unknown as Vec3
}

function standardCopy(base: MeshStandardMaterial): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  material.copy(base)
  return material
}

/** common.ts `flutter` on WebGPU: a node copy of `base` whose flags and sails flutter. */
export function flutterNodeMaterial(
  base: MeshStandardMaterial,
  uniforms: { uTime: Holder },
  amount: number,
): MeshStandardNodeMaterial {
  const material = standardCopy(base)
  material.positionNode = flutterPosition(uniforms.uTime, amount)
  return material
}

/**
 * GhostShip.tsx's hull: its sails flutter, a spectral rim glows where the hull turns from the eye
 * (pulsing), and it is half there, dissolving below the waterline (its height as modelled).
 */
export function ghostHullNodeMaterial(
  base: MeshStandardMaterial,
  uniforms: { uTime: Holder; uFade: Holder },
  amount: number,
): MeshStandardNodeMaterial {
  const material = standardCopy(base)
  material.positionNode = flutterPosition(uniforms.uTime, amount)
  const rim = pow(float(1).sub(abs(dot(normalView, positionViewDirection))), 2)
  const pulse = sin(uniformOf(uniforms.uTime).mul(1.7)).mul(0.25).add(0.85)
  material.emissiveNode = materialEmissive.add(vec3(0.32, 1, 0.7).mul(rim.mul(2.1).add(0.26)).mul(pulse))
  material.opacityNode = materialOpacity
    .mul(uniformOf(uniforms.uFade))
    .mul(0.8)
    .mul(smoothstep(0.2, 2.4, positionGeometry.y))
  return material
}

/**
 * Dragon.tsx's hide: the wings beat about the shoulders (the outer wing bending further), the tail
 * sways, the eyes glow and the hide keeps an ember. The GLSL turns the wings' normals too; the hide
 * is flat-shaded, so lighting reads its faces' own normals either way and they are not turned here.
 */
export function dragonNodeMaterial(
  base: MeshStandardMaterial,
  uniforms: { uTime: Holder; uFlap: Holder; uEmber: Holder },
  shoulder: { x: number; y: number },
): MeshStandardNodeMaterial {
  const material = standardCopy(base)
  const wing = float1("aWing")
  const tail = float1("aTail")
  const flap = uniformOf(uniforms.uFlap)
  const p = positionLocal
  // bendWing: about the shoulder; on the body (aWing 0) the angle is 0 and nothing moves.
  const pivot = vec3(wing.mul(shoulder.x), shoulder.y, 0)
  const q = p.sub(pivot)
  const reach = smoothstep(2, 8.5, abs(p.x))
  const angle = wing.mul(flap.add(reach.mul(0.35).mul(flap)))
  const c = cos(angle)
  const s = sin(angle)
  const bent = vec3(q.x.mul(c).sub(q.y.mul(s)), q.x.mul(s).add(q.y.mul(c)), q.z).add(pivot)
  const sway = sin(uniformOf(uniforms.uTime).mul(2.4).sub(tail.mul(3.2)))
    .mul(tail)
    .mul(tail)
    .mul(1.4)
  material.positionNode = bent.add(vec3(sway, 0, 0))
  const glow = float1("aGlow")
  material.emissiveNode = materialEmissive.add(
    vertexColor().rgb.mul(glow.mul(2.5).add(uniformOf(uniforms.uEmber))),
  )
  return material
}

/**
 * Festival.tsx's reveal (bunting and lanterns): each vertex grows out of its anchor once `uReveal`
 * passes its order, and cloth sways with `aSway`. A node copy of `base`, lit or unlit as it is.
 */
export function revealNodeMaterial(
  base: MeshStandardMaterial | MeshBasicMaterial,
  uniforms: { uTime: Holder; uReveal: Holder },
): MeshStandardNodeMaterial | MeshBasicNodeMaterial {
  const material = (base as MeshStandardMaterial).isMeshStandardMaterial
    ? new MeshStandardNodeMaterial()
    : new MeshBasicNodeMaterial()
  material.copy(base)
  const anchor = float3("aAnchor")
  const order = float1("aOrder")
  const sway = float1("aSway")
  const time = uniformOf(uniforms.uTime)
  const grown = smoothstep(order, order.add(0.12), uniformOf(uniforms.uReveal))
  const p = anchor.add(positionLocal.sub(anchor).mul(grown))
  const gust = sin(time.mul(4.2).add(anchor.z.mul(0.8)).add(anchor.x.mul(0.55)))
  const drift = cos(time.mul(3.1).add(anchor.x.mul(0.7))).mul(0.1)
  material.positionNode = p.add(vec3(gust.mul(0.16).mul(sway), 0, drift.mul(sway)))
  return material
}

// ─────────────────────────────── the shows' own shaders ───────────────────────────────

/** Dragon.tsx `fire`: flames out of the jaws, each looping while the breath lasts. */
export function dragonFireNodeMaterial(uniforms: { uTime: Holder; uBreath: Holder }): NodeMaterial {
  const LIFE = 0.55
  const breath = uniformOf(uniforms.uBreath)
  const spread = float2("aSpread")
  const t = fract(uniformOf(uniforms.uTime).div(LIFE).add(float1("aSeed")))
  const p = vec3(0, 1.4, 5.3).add(
    vec3(spread.x.mul(2.6).mul(t), t.mul(-1.6).add(spread.y.mul(2).mul(t)), t.mul(9.5)),
  )
  const heat = varying(t.oneMinus().mul(breath), "vHeat") as unknown as Float
  const size = mix(float(0.7), float(3.4), t).mul(breath)
  const d = length(uv().sub(0.5)).mul(2)
  const a = smoothstep(0.3, 1, d)
    .oneMinus()
    .mul(smoothstep(0, 0.25, heat))
    .mul(0.92)
  const colour = mix(vec3(0.95, 0.25, 0.05), vec3(1, 0.9, 0.45), heat.mul(heat))
  return particles({
    vertex: facing(p, positionGeometry.xy.mul(size)),
    colour: vec4(colour.mul(heat.mul(1.2).add(1)), a),
    keep: a.greaterThanEqual(0.01),
    blending: NormalBlending,
  })
}

/**
 * Comet.tsx STREAK_VERTEX: a streak flying from `aFrom` along `aDir` for `aLife` s from `aBirth`,
 * stretched along its flight on screen (head at the quad's +y), with its life so far (`vLife`).
 */
function streak(time: Holder): { vertex: Vec4; life: Float } {
  const from = float3("aFrom")
  const dir = float3("aDir")
  const t = uniformOf(time).sub(float1("aBirth")).div(float1("aLife"))
  const head = from.add(dir.mul(t))
  const a = modelViewMatrix.mul(vec4(head, 1)) as unknown as Vec4
  const b = modelViewMatrix.mul(vec4(head.sub(normalize(dir).mul(float1("aTail"))), 1)) as unknown as Vec4
  const along = a.xy.sub(b.xy)
  const axis = along.div(max(length(along), 1e-4))
  const side = vec2(axis.y.negate(), axis.x)
  // position.y in [-0.5, 0.5]: -0.5 the tail's end, +0.5 the head.
  const k = positionGeometry.y.add(0.5)
  const mv = mix(b, a, k)
  const width = side
    .mul(positionGeometry.x)
    .mul(float1("aSize"))
    .mul(mix(float(0.25), float(1), k))
  const clip = cameraProjectionMatrix.mul(vec4(mv.xy.add(width), mv.zw)) as unknown as Vec4
  const dead = t.lessThan(0).or(t.greaterThan(1))
  return { vertex: select(dead, NOWHERE, clip), life: varying(t, "vLife") as unknown as Float }
}

/** Comet.tsx `meteors`' material: blue-white streaks that flare and burn out, added to the sky. */
export function meteorNodeMaterial(uniforms: { uTime: Holder; uFade: Holder }): NodeMaterial {
  const { vertex, life } = streak(uniforms.uTime)
  const across = abs(uv().x.sub(0.5)).mul(2).oneMinus()
  const along = uv().y
  const burn = sin(life.mul(Math.PI))
  const a = pow(along, 2.2).mul(across).mul(across).mul(burn).mul(uniformOf(uniforms.uFade))
  const colour = mix(vec3(0.55, 0.7, 1), vec3(1, 0.97, 0.88), pow(along, 4))
  return particles({
    vertex,
    colour: vec4(colour.mul(pow(along, 6).mul(2.5).add(1)), a),
    keep: a.greaterThanEqual(0.004),
    blending: AdditiveBlending,
    side: DoubleSide,
  })
}

/** Comet.tsx `comet`'s material: a pale gold head and a long fading tail. */
export function cometNodeMaterial(uniforms: { uTime: Holder; uFade: Holder }): NodeMaterial {
  const { vertex } = streak(uniforms.uTime)
  const across = abs(uv().x.sub(0.5)).mul(2).oneMinus()
  const along = uv().y
  const head = smoothstep(0.86, 1, along).mul(smoothstep(0, 0.6, across))
  const tail = pow(along, 1.6).mul(pow(across, 1.5)).mul(0.75)
  const a = clamp(max(head, tail), 0, 1).mul(uniformOf(uniforms.uFade))
  const colour = mix(vec3(1, 0.86, 0.55), vec3(1, 1, 0.97), head)
  return particles({
    vertex,
    colour: vec4(colour.mul(head.mul(1.4).add(1)), a),
    keep: a.greaterThanEqual(0.004),
    blending: NormalBlending,
    side: DoubleSide,
  })
}

/** Rainbow.tsx's arc: the bands, soft edges, feet melting into the haze, drawn in foot to foot. */
export function rainbowNodeMaterial(
  uniforms: { uReveal: Holder; uFade: Holder; uNight: Holder },
  radius: number,
  width: number,
): NodeMaterial {
  const local = positionGeometry.xy
  const night = uniformOf(uniforms.uNight)
  const reveal = uniformOf(uniforms.uReveal)
  const r = length(local)
  const band = clamp(r.sub(radius - width).div(width), 0, 1)
  const along = atan(local.y, local.x).div(Math.PI).oneMinus()
  const edge = smoothstep(0, 0.2, band).mul(smoothstep(0.8, 1, band).oneMinus())
  const feet = smoothstep(4, 34, local.y)
  const shown = smoothstep(reveal.sub(0.12), reveal, along).oneMinus()
  const h = clamp(band.sub(0.14).div(0.72), 0, 1)
  const colour = mix(hue(h.oneMinus().mul(0.74)).mul(0.9).add(0.1), vec3(0.86, 0.9, 1), night.mul(0.82))
  const a = edge
    .mul(feet)
    .mul(shown)
    .mul(uniformOf(uniforms.uFade))
    .mul(mix(float(0.5), float(0.26), night))
  const material = new NodeMaterial()
  material.colorNode = vec4(colour, a)
  material.maskNode = a.greaterThanEqual(0.003)
  material.transparent = true
  material.depthWrite = false
  material.side = DoubleSide
  material.blending = NormalBlending
  material.fog = false
  material.toneMapped = false
  return material
}

/** Rainbow.tsx `hue`: a smooth spectrum, 0 red … 1 back to red. */
function hue(h: Float): Vec3 {
  const k = clamp(abs(mod(h.mul(6).add(vec3(0, 4, 2)), 6).sub(3)).sub(1), 0, 1)
  return k.mul(k).mul(k.mul(-2).add(3)) as unknown as Vec3
}

/**
 * GhostShip.tsx `wisps`' material: will-o'-the-wisps bobbing round the deck, mist banks rolling
 * by the hull, and one still halo behind it all (`aBank`: 0 wisp, 1 mist, 2 halo).
 */
export function wispNodeMaterial(uniforms: { uTime: Holder; uFade: Holder }): NodeMaterial {
  const time = uniformOf(uniforms.uTime)
  const seed = float1("aSeed")
  const bank = float1("aBank")
  const halo = bank.greaterThan(1.5)
  const mist = bank.greaterThan(0.5)
  const t = time.mul(seed.mul(0.5).add(0.5)).add(seed.mul(40))
  const seat = float3("aSeat")
  const drift = select(
    mist,
    vec3(sin(t.mul(0.3)).mul(1.5), 0, cos(t.mul(0.25)).mul(2)),
    vec3(sin(t).mul(0.9), sin(t.mul(1.7)).mul(0.6), cos(t.mul(0.8)).mul(1.2)),
  )
  const p = select(halo, seat, seat.add(drift))
  const size = select(halo, float(20), select(mist, seed.mul(7).add(9), seed.mul(0.8).add(1.5)))
  const stretch = select(halo, vec2(1, 0.85), select(mist, vec2(1, 0.45), vec2(1, 1)))
  const glowAt = select(
    halo,
    sin(time.mul(1.1)).mul(0.15).add(0.85),
    select(mist, sin(t.mul(0.5)).mul(0.4).add(0.6), sin(t.mul(3)).mul(0.45).add(0.55)),
  )
  const glow = varying(glowAt, "vGlow") as unknown as Float
  const fade = uniformOf(uniforms.uFade)
  const soft = smoothstep(0, 1, length(uv().sub(0.5)).mul(2)).oneMinus()
  const a = select(halo, soft.mul(0.32), select(mist, soft.mul(0.3), soft.mul(soft)))
    .mul(glow)
    .mul(fade)
  const colour = select(
    halo,
    vec3(0.35, 1, 0.7),
    select(mist, vec3(0.55, 0.8, 0.7), vec3(0.55, 1, 0.75).mul(2.6)),
  )
  return particles({
    vertex: facing(p, positionGeometry.xy.mul(size).mul(stretch)),
    colour: vec4(colour, a),
    keep: a.greaterThanEqual(0.004),
    blending: AdditiveBlending,
  })
}

/**
 * Festival.tsx `fireworks`' material: a rocket (the burst's lead spark) climbs from the keep's
 * roofs, then the burst's sparks fly out, droop under drag and gravity, and twinkle out (`still`:
 * reduced motion, no twinkle).
 */
export function fireworkNodeMaterial(
  uniforms: { uTime: Holder; uFade: Holder },
  still: boolean,
): NodeMaterial {
  const RISE = 1
  const LIFE = 3
  const origin = float3("aOrigin")
  const dir = float3("aDir")
  const age = uniformOf(uniforms.uTime).sub(float1("aBirth"))
  const rising = age.lessThan(RISE)
  // The rocket.
  const k = age.div(RISE)
  const from = vec3(origin.x.mul(0.5), 3, origin.z.mul(0.5))
  const climbed = mix(from, origin, k.oneMinus().mul(k.oneMinus()).oneMinus())
  const rocket = climbed.add(vec3(sin(age.mul(22)).mul(0.08), 0, 0))
  // The burst.
  const t = age.sub(RISE)
  const drag = exp(t.mul(-2.4)).oneMinus().div(2.4)
  const spark = origin.add(dir.mul(drag)).sub(vec3(0, t.mul(t).mul(1.5), 0))
  const life = t.div(LIFE).oneMinus()
  const flash = select(t.lessThan(0.15), float(1.8), float(1))
  const twinkle = still
    ? float(1)
    : sin(t.mul(34).add(dir.x.mul(9)))
        .mul(0.4)
        .add(0.6)
  const p = select(rising, rocket, spark)
  const size = select(rising, float(0.9), mix(float(0.35), float(1.25), life).mul(flash))
  const alpha = varying(
    select(rising, float1("aLead"), life.mul(life).mul(twinkle)),
    "vAlpha",
  ) as unknown as Float
  const tint = varying(
    select(rising, vec3(1, 0.85, 0.6), mix(vec3(1, 0.95, 0.85), float3("aColor"), smoothstep(0, 0.25, t))),
    "vColor",
  ) as unknown as Vec3
  const dead = age.lessThan(0).or(age.greaterThan(RISE + LIFE))
  const core = smoothstep(0, 1, length(uv().sub(0.5)).mul(2)).oneMinus()
  const a = core.mul(core).mul(alpha).mul(uniformOf(uniforms.uFade))
  return particles({
    vertex: select(dead, NOWHERE, facing(p, positionGeometry.xy.mul(size))),
    colour: vec4(tint.mul(core.mul(3).add(1.6)), a),
    keep: a.greaterThanEqual(0.003),
    blending: AdditiveBlending,
  })
}

/** Festival.tsx `confetti`'s material: paper scraps shot up, tumbling down on the breeze (opaque, cut out). */
export function confettiNodeMaterial(uniforms: { uTime: Holder; uFade: Holder }): NodeMaterial {
  const LIFE = 7
  const lead = float1("aLead")
  const t = uniformOf(uniforms.uTime).sub(float1("aBirth"))
  const drag = exp(t.mul(-3)).oneMinus().div(3)
  const soon = min(float(1), t)
  const flown = float3("aOrigin").add(float3("aDir").mul(drag))
  const p = vec3(
    flown.x.add(
      sin(t.mul(2.6).add(lead.mul(20)))
        .mul(0.45)
        .mul(soon),
    ),
    max(
      flown.y.sub(
        lead
          .mul(0.5)
          .add(0.7)
          .mul(max(float(0), t.sub(0.35))),
      ),
      0.05,
    ),
    flown.z.add(
      cos(t.mul(2.1).add(lead.mul(13)))
        .mul(0.3)
        .mul(soon),
    ),
  )
  // Tumbling: the scrap turns edge-on and back (its width flips through zero).
  const spin = cos(t.mul(lead.mul(6).add(6)).add(lead.mul(30)))
  const corner = vec2(positionGeometry.x.mul(spin), positionGeometry.y).mul(0.5)
  const dead = t.lessThan(0).or(t.greaterThan(LIFE))
  const tint = varying(float3("aColor").mul(abs(spin).mul(0.35).add(0.75)), "vColor") as unknown as Vec3
  const alpha = varying(smoothstep(LIFE - 1.2, LIFE, t).oneMinus(), "vAlpha") as unknown as Float
  const material = particles({
    vertex: select(dead, NOWHERE, facing(p, corner)),
    colour: vec4(tint, 1),
    keep: alpha.mul(uniformOf(uniforms.uFade)).greaterThanEqual(0.5),
    blending: NormalBlending,
    transparent: false,
    side: DoubleSide,
  })
  // An opaque cut-out: it writes depth, as the GLSL material's defaults do.
  material.depthWrite = true
  return material
}
