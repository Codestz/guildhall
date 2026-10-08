import type { DirectionalLight, Texture } from "three"
import {
  abs,
  attribute,
  cameraPosition,
  clamp,
  dot,
  exp,
  Fn,
  float,
  floor,
  fract,
  If,
  Loop,
  length,
  max,
  mix,
  normalize,
  positionWorld,
  pow,
  reference,
  reflect,
  select,
  shadow,
  sin,
  smoothstep,
  step,
  texture,
  uniformArray,
  vec2,
  vec3,
  vec4,
} from "three/tsl"
import { type Node, NodeMaterial } from "three/webgpu"
import type { WaterUniforms } from "./Water.tsx"

/**
 * The water as a TSL node material (`?tsl=1`, scene/tsl.ts): nature/shaders.ts `waterFragment`,
 * node for node, so either path draws the same picture. It reads the very uniform objects Water
 * writes each frame (`reference`), so nothing else changes with the path.
 *
 * Lighting: as in the GLSL, none of three's lights — the sky state's key and hemisphere colours
 * arrive as uniforms. The one thing three supplies is the key light's shadow (GLSL
 * `getShadowMask()`); here it is that light's `shadow()` node, read from the map WebGLRenderer
 * already draws (the handler points shadow nodes at it), so the material needs the light itself.
 * Without it (the first frames, before the key light has drawn its map) the water is unshadowed.
 *
 * Fog: `fog` on, the handler's radial fog (scene/tsl.ts). Output: the handler's output step, which
 * follows the target as the GLSL chunks do.
 */
export function waterNodeMaterial(
  u: WaterUniforms,
  options: { low: boolean; v2: boolean; flames: number; key: DirectionalLight | null },
): NodeMaterial {
  const material = new NodeMaterial()
  material.fog = true
  material.colorNode = waterColour(u, options)
  return material
}

const RECIPROCAL_PI = 1 / Math.PI

/** A `{ value }` uniform, read each draw. */
const float_ = (holder: { value: number }) => reference("value", "float", holder)
const vec3_ = (holder: { value: object }) => reference("value", "vec3", holder)
// A Color is a "color" uniform (a vec3 in the shader).
const color_ = (holder: { value: object }) => reference("value", "color", holder) as unknown as Node<"vec3">

/** Rain: one ring per cell of a jittered grid, each on its own clock. Returns slope, crest. */
function ripples(p: Node<"vec2">, t: Node<"float">): Node<"vec3"> {
  const cell = floor(p)
  const f = fract(p).sub(0.5)
  const h = fract(sin(dot(cell, vec2(127.1, 311.7))).mul(43758.5453))
  const g = fract(h.mul(17.31))
  const centre = vec2(h, g).sub(0.5).mul(0.5)
  const d = f.sub(centre)
  const r = length(d)
  const age = fract(t.mul(0.9).add(h))
  const ring = r.sub(age.mul(0.45))
  const wave = sin(ring.mul(40))
    .mul(exp(ring.mul(ring).mul(-160)))
    .mul(age.oneMinus())
  const on = step(g, 0.8)
  return vec3(d.div(max(r, 1e-3)).mul(wave), max(wave, 0)).mul(on)
}

function waterColour(
  u: WaterUniforms,
  { low, v2, flames, key }: { low: boolean; v2: boolean; flames: number; key: DirectionalLight | null },
): Node<"vec4"> {
  const uTime = float_(u.uTime)
  const uWind = float_(u.uWind)
  const uWindDir = reference("value", "vec2", u.uWindDir)
  const uShoreHalf = float_(u.uShoreHalf)
  const uShoreMax = float_(u.uShoreMax)
  const uRain = float_(u.uRain)
  const uGloom = float_(u.uGloom)
  const uCloud = float_(u.uCloud)
  const uFlash = float_(u.uFlash)
  const uKeyIntensity = float_(u.uKeyIntensity)
  const uHemiIntensity = float_(u.uHemiIntensity)
  const uKeyDir = vec3_(u.uKeyDir)
  const uMoonDir = vec3_(u.uMoonDir)
  const uMoon = float_(u.uMoon)
  const uNight = float_(u.uNight)
  const uLamps = float_(u.uLamps)
  const uCaustics = float_(u.uCaustics)
  const uRingMax = float_(u.uRingMax)
  const uWheel = reference("value", "vec4", u.uWheel)
  const uMoonColor = color_(u.uMoonColor)
  const uZenith = color_(u.uZenith)
  const uHorizon = color_(u.uHorizon)
  const uKeyColor = color_(u.uKeyColor)
  const uHemiSky = color_(u.uHemiSky)
  const uDeep = color_(u.uDeep)
  const uShallow = color_(u.uShallow)
  const uFlames = uniformArray<"vec4">(u.uFlames.value, "vec4")
  // One sampler for every noise read (`sample` shares its uniform), as the GLSL has.
  const noise = texture(u.uNoise.value as Texture)

  return Fn(() => {
    const p = positionWorld.xz
    // The shore bake lands after the first frames: the texture is re-read from its uniform.
    // Anything read both inside and outside an `If` is a `toVar` here, before the first branch: a
    // node is emitted where it is first used, so one first used in a branch is unset outside it.
    const shore = texture(u.uShore.value, vec2(p.x, p.y.negate()).div(uShoreHalf.mul(2)).add(0.5))
      .onObjectUpdate(() => u.uShore.value)
      .toVar()
    const dist = shore.r.mul(uShoreMax).toVar()
    const flow = shore.gb.mul(2).sub(1).toVar()
    const t = uTime
    const river = attribute<"float">("aRiver", "float").greaterThan(0.5)

    // Surface slope: wind-blown swell on the sea and the lake; on the river, two phases of noise
    // dragged along the flow (a flow map), cross-faded so the stretching never shows.
    const slope = vec2(0).toVar()
    If(river, () => {
      const a = fract(t.mul(0.35))
      const b = fract(t.mul(0.35).add(0.5))
      const wa = float(1).sub(abs(a.mul(2).sub(1)))
      const q = p.mul(0.11)
      const na = noise.sample(q.sub(flow.mul(a).mul(0.9)))
      const nb = noise.sample(q.sub(flow.mul(b).mul(0.9)).add(vec2(0.37, 0.61)))
      slope.assign(na.rg.mul(2).sub(1).mul(wa).add(nb.rg.mul(2).sub(1).mul(wa.oneMinus())).mul(0.5))
    }).Else(() => {
      const drift = uWindDir.mul(t)
      const n1 = noise.sample(p.mul(0.021).add(drift.mul(0.01)))
      const n2 = noise.sample(p.mul(0.057).sub(drift.yx.mul(0.017)).add(vec2(0.3, 0.7)))
      slope.assign(n1.rg.mul(2).sub(1).mul(0.55).add(n2.rg.mul(2).sub(1).mul(0.45)))
    })
    slope.mulAssign(uWind.mul(0.55).add(0.22))
    const crests = float(0).toVar()
    if (!low) {
      If(uRain.greaterThan(0.01), () => {
        const rings = ripples(p.mul(0.8), t).add(ripples(p.mul(0.8).add(vec2(0.5, 0.31)), t.add(0.47)))
        slope.addAssign(rings.xy.mul(0.6).mul(uRain))
        crests.assign(rings.z.mul(uRain))
      })
    }
    const n = normalize(vec3(slope.x.negate(), 1, slope.y.negate())).toVar()

    const v = normalize(cameraPosition.sub(positionWorld)).toVar()
    const shade = (key ? (shadow(key) as unknown as Node<"float">) : float(1)).toVar()
    const facing = max(dot(n, v), 0)
    const schlick = float(0.04).add(pow(facing.oneMinus(), 5).mul(0.96))
    const fresnel = mix(schlick, schlick.mul(0.65).add(0.35), 0.5)

    // Light on a flat surface (normal up), as the tiles take it: the hemisphere's sky half (GLSL
    // `fill(up)`: its ground colour weighs nothing straight up) and the key.
    const fill = uHemiSky.mul(uHemiIntensity)
    const keyLight = uKeyColor.mul(uKeyIntensity).mul(max(uKeyDir.y, 0)).mul(shade)
    const lightUp = fill.add(keyLight).mul(RECIPROCAL_PI).toVar()

    // Body: shallow by the shore, deep further out. Water v2 steps it through soft toon bands.
    const depth = select(
      river,
      smoothstep(0.3, 2.0, dist).mul(0.35).add(0.35),
      smoothstep(0.4, 7.5, dist),
    ).toVar()
    if (v2) {
      const steps = depth.mul(3).add(slope.x.add(slope.y).mul(0.6))
      const banded = floor(steps)
        .add(smoothstep(0.35, 0.65, fract(steps)))
        .div(3)
      depth.assign(mix(depth, clamp(banded, 0, 1), 0.7))
    }
    const body = mix(uShallow, uDeep, depth).mul(uGloom.mul(-0.4).add(1))
    const lit = body.mul(lightUp).toVar()

    if (v2 && !low) {
      // Caustics: a bright wiggly net where two drifting layers of noise cross, sunlit shallows only.
      const shallow = smoothstep(0.5, select(river, 1.8, 3.5), dist)
        .oneMinus()
        .mul(smoothstep(0.15, 0.6, dist))
      If(shallow.greaterThan(0.01).and(uKeyIntensity.greaterThan(0.05)), () => {
        const cq = p.mul(0.24)
        const c1 = noise.sample(cq.add(vec2(uCaustics.mul(0.021), uCaustics.mul(0.013)))).a
        const c2 = noise.sample(
          cq
            .mul(1.31)
            .sub(vec2(uCaustics.mul(0.017), uCaustics.mul(-0.019)))
            .add(vec2(0.5, 0.2)),
        ).a
        const net = smoothstep(0, 0.05, abs(c1.sub(c2))).oneMinus()
        lit.addAssign(
          uKeyColor
            .mul(vec3(0.85, 1.0, 0.95))
            .mul(uKeyIntensity)
            .mul(net.mul(net))
            .mul(shallow)
            .mul(shade)
            .mul(uCloud.mul(-0.85).add(1))
            .mul(select(river, 0.045, 0.08)),
        )
      })
    }

    // Reflection: the sky's own colours by the reflected ray's height — no render target.
    const r = reflect(v.negate(), n).toVar()
    const horizon = mix(uHorizon, uZenith, smoothstep(0, 0.7, r.y))
    const sky = mix(horizon, vec3(dot(horizon, vec3(0.3, 0.55, 0.15))), uCloud.mul(0.35)).add(
      vec3(0.6, 0.65, 0.8).mul(uFlash),
    )
    const colour = mix(lit, sky.mul(0.85), fresnel.mul(uGloom.mul(-0.3).add(1))).toVar()

    // Glints: the key light off the ripples, broken up by the fine noise; gone under cloud.
    const h = normalize(uKeyDir.add(v))
    const sparkle = noise.sample(p.mul(0.31).add(slope.mul(0.4))).a.toVar()
    const spec = pow(max(dot(n, h), 0), 220).mul(sparkle.mul(1.6).add(0.6))
    colour.addAssign(uKeyColor.mul(uKeyIntensity).mul(spec).mul(shade).mul(uCloud.mul(-0.9).add(1)).mul(1.2))
    // Rain rings catch the grey sky light.
    colour.addAssign(fill.mul(RECIPROCAL_PI).mul(crests).mul(0.35))

    // Night: the moon's path — a broad, broken lobe of cool silver round the moon's mirror image.
    If(uMoon.greaterThan(0.01), () => {
      const toMoon = max(dot(r, uMoonDir), 0)
      const path = pow(toMoon, 90).mul(sparkle.mul(sparkle).mul(1.1).add(0.15)).add(pow(toMoon, 700).mul(1.4))
      colour.addAssign(
        uMoonColor
          .mul(path)
          .mul(uMoon)
          .mul(select(river, 0.45, 0.8)),
      )
    })
    // Torches by the water: each throws a wavering warm streak across the water towards the viewer.
    If(uLamps.greaterThan(0.01), () => {
      const glow = vec3(0).toVar()
      Loop(flames, ({ i }) => {
        const flame = uFlames.element(i)
        If(flame.w.greaterThanEqual(0.5), () => {
          const toEye = cameraPosition.xz.sub(flame.xz)
          const along = toEye.div(max(length(toEye), 1e-3))
          const d = p.sub(flame.xz)
          const ahead = dot(d, along)
          const side = dot(d, vec2(along.y.negate(), along.x)).add(
            slope.x
              .add(slope.y)
              .mul(4)
              .mul(smoothstep(0, 4, ahead).mul(0.6).add(0.4)),
          )
          const reach = flame.y.mul(2.2).add(3)
          const streak = exp(side.mul(side).mul(-4))
            .mul(smoothstep(-0.6, 0.6, ahead))
            .mul(exp(max(ahead, 0).negate().div(reach)))
          glow.addAssign(vec3(streak.mul(sparkle.mul(0.9).add(0.55))))
        })
      })
      colour.addAssign(vec3(1.0, 0.55, 0.22).mul(glow).mul(uLamps).mul(4))
    })

    // Foam: a soft rim where the water meets land, and wave lines rolling in towards the shore.
    const breakup = noise.sample(p.mul(0.13).add(vec2(t.mul(0.01), 0))).a.toVar()
    const foam = smoothstep(0.05, breakup.mul(0.35).add(0.55), dist).oneMinus().toVar()
    If(river.not(), () => {
      const band = fract(dist.mul(0.42).sub(t.mul(0.16)).add(breakup.mul(0.9)))
      const lines = smoothstep(0.78, 0.93, band).mul(smoothstep(0.93, 1, band).oneMinus())
      foam.assign(
        max(
          foam,
          lines.mul(smoothstep(0.6, 3.2, dist).oneMinus()).mul(smoothstep(0.35, 0.65, breakup.add(0.25))),
        ),
      )
    }).Else(() => {
      const streak = noise.sample(p.mul(0.4).sub(flow.mul(t).mul(0.5))).a
      foam.assign(
        max(
          foam.mul(0.8),
          smoothstep(0.72, 0.9, streak)
            .mul(0.35)
            .mul(smoothstep(0.4, 1.6, dist).oneMinus()),
        ),
      )
    })
    if (v2) {
      // Rings round whatever stands in the water: a hugging rim and a ripple rolling outward.
      const stand = shore.a.mul(uRingMax)
      If(stand.lessThan(uRingMax.mul(0.98)), () => {
        const hug = smoothstep(0.02, breakup.mul(0.25).add(0.2), stand).oneMinus().mul(0.85)
        const wave = fract(stand.mul(0.8).sub(uCaustics.mul(0.3)).add(breakup.mul(0.35)))
        const ripple = smoothstep(0.82, 0.93, wave).mul(smoothstep(0.93, 1, wave).oneMinus())
        foam.assign(max(foam, max(hug, ripple.mul(smoothstep(0.3, 2.2, stand).oneMinus()).mul(0.8))))
      })
      // The mill's tailrace: churned foam where the wheel's water rejoins the river, down the flow.
      If(uWheel.w.greaterThan(0), () => {
        const d = p.sub(uWheel.xz)
        const along = select(length(flow).greaterThan(0.1), normalize(flow), vec2(1, 0))
        const across = vec2(along.y.negate(), along.x)
        const down = dot(d, along)
        const side = abs(dot(d, across))
        const reach = smoothstep(uWheel.w.mul(-0.6), 0, down).mul(smoothstep(0, 7, down).oneMinus())
        const width = smoothstep(down.mul(0.18).add(0.6), down.mul(0.25).add(1.2), side).oneMinus()
        const q = vec2(down.mul(0.12).sub(uCaustics.mul(0.35)), dot(d, across).mul(0.9))
        const churn = noise
          .sample(q)
          .a.mul(0.65)
          .add(noise.sample(q.mul(2.1).add(vec2(0.3, 0.6))).a.mul(0.35))
        foam.assign(
          max(foam, smoothstep(reach.mul(-0.12).add(0.62), 0.78, churn).mul(reach).mul(width).mul(0.85)),
        )
      })
    }
    foam.mulAssign(uWind.mul(0.15).add(0.85))
    const foamLit = vec3(0.92, 0.95, 0.97).mul(lightUp)
    colour.assign(mix(colour, foamLit, clamp(foam, 0, 1).mul(uNight.mul(-0.4).add(0.9))))
    return vec4(colour, 1)
  })()
}
