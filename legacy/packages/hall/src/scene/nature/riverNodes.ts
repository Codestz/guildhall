import type { DirectionalLight, Texture } from "three"
import {
  abs,
  attribute,
  cameraPosition,
  clamp,
  Discard,
  dot,
  exp,
  Fn,
  float,
  floor,
  fract,
  If,
  length,
  max,
  mix,
  normalize,
  normalWorld,
  positionWorld,
  pow,
  reference,
  reflect,
  sin,
  smoothstep,
  step,
  texture,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl"
import { type Node, NodeMaterial } from "three/webgpu"
import { keyShadow } from "./grassNodes.ts"
import type { WaterUniforms } from "./Water.tsx"

/**
 * The inland water as TSL node materials (WebGPU, always; WebGL with `?tsl=1`, scene/tsl.ts):
 * riverShaders.ts' `riverFragment` and `fallFragment`, node for node, reading the very uniform
 * objects Rivers.tsx writes each frame (`reference`). Lit as the GLSL is (the sky state's key and
 * hemisphere colours as uniforms; the key light's own shadow through grassNodes.ts `keyShadow`,
 * unshadowed until that light has a map), fogged by the scene's radial fog, output by the renderer.
 */
export function riverNodeMaterial(
  u: WaterUniforms,
  options: { low: boolean; v2: boolean; key: DirectionalLight | null },
): NodeMaterial {
  const material = new NodeMaterial()
  material.fog = true
  material.colorNode = surfaceColour(u, options)
  return material
}

export function fallNodeMaterial(u: WaterUniforms, { key }: { key: DirectionalLight | null }): NodeMaterial {
  const material = new NodeMaterial()
  material.fog = true
  material.colorNode = fallColour(u, key)
  return material
}

const RECIPROCAL_PI = 1 / Math.PI

/** A `{ value }` uniform, read each draw. */
const float_ = (holder: { value: number }) => reference("value", "float", holder)
// A Color is a "color" uniform (a vec3 in the shader).
const color_ = (holder: { value: object }) => reference("value", "color", holder) as unknown as Node<"vec3">

/** The uniforms both materials read, as nodes. */
function nodesOf(u: WaterUniforms) {
  return {
    uTime: float_(u.uTime),
    uWind: float_(u.uWind),
    uWindDir: reference("value", "vec2", u.uWindDir),
    uRain: float_(u.uRain),
    uGloom: float_(u.uGloom),
    uCloud: float_(u.uCloud),
    uFlash: float_(u.uFlash),
    uKeyIntensity: float_(u.uKeyIntensity),
    uHemiIntensity: float_(u.uHemiIntensity),
    uKeyDir: reference("value", "vec3", u.uKeyDir),
    uMoonDir: reference("value", "vec3", u.uMoonDir),
    uMoon: float_(u.uMoon),
    uNight: float_(u.uNight),
    uCaustics: float_(u.uCaustics),
    uMoonColor: color_(u.uMoonColor),
    uZenith: color_(u.uZenith),
    uHorizon: color_(u.uHorizon),
    uKeyColor: color_(u.uKeyColor),
    uHemiSky: color_(u.uHemiSky),
    uHemiGround: color_(u.uHemiGround),
    uDeep: color_(u.uDeep),
    uShallow: color_(u.uShallow),
    // One sampler for every noise read (`sample` shares its uniform), as the GLSL has.
    noise: texture(u.uNoise.value as Texture),
  }
}

/** Rain: one ring per cell of a jittered grid, each on its own clock. Returns slope, crest. */
function ripples(p: Node<"vec2">, t: Node<"float">): Node<"vec3"> {
  const cell = floor(p)
  const h = fract(sin(dot(cell, vec2(127.1, 311.7))).mul(43758.5453))
  const g = fract(h.mul(17.31))
  const d = fract(p).sub(0.5).sub(vec2(h, g).sub(0.5).mul(0.5))
  const r = length(d)
  const age = fract(t.mul(0.9).add(h))
  const ring = r.sub(age.mul(0.45))
  const wave = sin(ring.mul(40))
    .mul(exp(ring.mul(ring).mul(-160)))
    .mul(age.oneMinus())
  return vec3(d.div(max(r, 1e-3)).mul(wave), max(wave, 0)).mul(step(g, 0.8))
}

function surfaceColour(
  u: WaterUniforms,
  { low, v2, key }: { low: boolean; v2: boolean; key: DirectionalLight | null },
): Node<"vec4"> {
  const n_ = nodesOf(u)
  const { noise, uWind, uWindDir, uRain, uGloom, uCloud, uKeyIntensity, uKeyDir, uKeyColor } = n_
  return Fn(() => {
    const p = positionWorld.xz
    const t = n_.uTime
    const flow = attribute<"vec2">("aFlow", "vec2").toVar()
    const shore = attribute<"float">("aShore", "float").toVar()
    const dist = max(shore, 0).toVar()
    const foot = attribute<"vec3">("aFoot", "vec3").toVar()
    const speed = length(flow).toVar()
    const runs = smoothstep(0.15, 0.6, speed).toVar()

    // Slope: the sea's swell on still water, a flow map on running water.
    const drift = uWindDir.mul(t)
    const n1 = noise.sample(p.mul(0.021).add(drift.mul(0.01)))
    const n2 = noise.sample(p.mul(0.057).sub(drift.yx.mul(0.017)).add(vec2(0.3, 0.7)))
    const swell = n1.rg.mul(2).sub(1).mul(0.55).add(n2.rg.mul(2).sub(1).mul(0.45))
    const a = fract(t.mul(0.35))
    const b = fract(t.mul(0.35).add(0.5))
    const wa = float(1).sub(abs(a.mul(2).sub(1)))
    const q = p.mul(0.11)
    const na = noise.sample(q.sub(flow.mul(a).mul(0.9)))
    const nb = noise.sample(q.sub(flow.mul(b).mul(0.9)).add(vec2(0.37, 0.61)))
    const running = na.rg
      .mul(2)
      .sub(1)
      .mul(wa)
      .add(nb.rg.mul(2).sub(1).mul(wa.oneMinus()))
      .mul(0.5)
      .mul(speed.mul(0.3).add(0.8))
    const slope = mix(swell, running, runs).mul(uWind.mul(0.55).add(0.22)).toVar()
    const crests = float(0).toVar()
    if (!low) {
      If(uRain.greaterThan(0.01), () => {
        const calm = runs.mul(-0.7).add(1)
        const rings = ripples(p.mul(0.8), t).add(ripples(p.mul(0.8).add(vec2(0.5, 0.31)), t.add(0.47)))
        slope.addAssign(rings.xy.mul(0.6).mul(uRain).mul(calm))
        crests.assign(rings.z.mul(uRain).mul(calm))
      })
    }
    // The surface's own tilt (a graded reach runs downhill; flat water's is straight up), and the ripples on it.
    const n = normalize(normalize(normalWorld).add(vec3(slope.x.negate(), 0, slope.y.negate()))).toVar()

    const v = normalize(cameraPosition.sub(positionWorld)).toVar()
    const shade = (key ? keyShadow(key) : float(1)).toVar()
    const schlick = float(0.04).add(pow(max(dot(n, v), 0).oneMinus(), 5).mul(0.96))
    const fresnel = mix(schlick, schlick.mul(0.65).add(0.35), 0.5)

    // Body: shallow at the banks, deeper out in a lake; a river's channel stays mid-deep.
    const depth = mix(
      smoothstep(0.4, 5.0, dist),
      smoothstep(0.3, 2.0, dist).mul(0.35).add(0.35),
      runs,
    ).toVar()
    if (v2) {
      const steps = depth.mul(3).add(slope.x.add(slope.y).mul(0.6))
      const banded = floor(steps)
        .add(smoothstep(0.35, 0.65, fract(steps)))
        .div(3)
      depth.assign(mix(depth, clamp(banded, 0, 1), 0.7))
    }
    const fill = n_.uHemiSky.mul(n_.uHemiIntensity)
    const lightUp = fill
      .add(uKeyColor.mul(uKeyIntensity).mul(max(uKeyDir.y, 0)).mul(shade))
      .mul(RECIPROCAL_PI)
      .toVar()
    const lit = mix(n_.uShallow, n_.uDeep, depth).mul(uGloom.mul(-0.4).add(1)).mul(lightUp)

    // Reflection: the sky's own colours by the reflected ray's height.
    const r = reflect(v.negate(), n).toVar()
    const horizon = mix(n_.uHorizon, n_.uZenith, smoothstep(0, 0.7, r.y))
    const sky = mix(horizon, vec3(dot(horizon, vec3(0.3, 0.55, 0.15))), uCloud.mul(0.35)).add(
      vec3(0.6, 0.65, 0.8).mul(n_.uFlash),
    )
    const colour = mix(lit, sky.mul(0.85), fresnel.mul(uGloom.mul(-0.3).add(1))).toVar()

    // Glints, rain crests, and by night the moon's broken path.
    const sparkle = noise.sample(p.mul(0.31).add(slope.mul(0.4))).a.toVar()
    const spec = pow(max(dot(n, normalize(uKeyDir.add(v))), 0), 220).mul(sparkle.mul(1.6).add(0.6))
    colour.addAssign(uKeyColor.mul(uKeyIntensity).mul(spec).mul(shade).mul(uCloud.mul(-0.9).add(1)).mul(1.2))
    colour.addAssign(fill.mul(RECIPROCAL_PI).mul(crests).mul(0.35))
    If(n_.uMoon.greaterThan(0.01), () => {
      const toMoon = max(dot(r, n_.uMoonDir), 0)
      const path = pow(toMoon, 90).mul(sparkle.mul(sparkle).mul(1.1).add(0.15)).add(pow(toMoon, 700).mul(1.4))
      colour.addAssign(
        n_.uMoonColor
          .mul(path)
          .mul(n_.uMoon)
          .mul(mix(0.8, 0.45, runs)),
      )
    })

    // Foam: a band round the banks' estimated waterline, streaks riding the current (thicker racing
    // to a lip), a fall's foot.
    const breakup = noise.sample(p.mul(0.13).add(vec2(t.mul(0.01), 0))).a.toVar()
    const rim = smoothstep(0.05, breakup.mul(0.35).add(0.55), dist)
      .oneMinus()
      .mul(smoothstep(-1.6, -0.5, shore))
    const streak = noise.sample(p.mul(0.4).sub(flow.mul(t).mul(0.5))).a
    const race = smoothstep(1.05, 1.6, speed)
    const near = smoothstep(0.4, 1.6, dist).mul(race.oneMinus()).oneMinus()
    // White water: a graded reach racing down a steep flank (speed past 1.9) breaks up into churn.
    const white = smoothstep(1.9, 3.0, speed)
    const churn = noise.sample(p.mul(0.9).sub(flow.mul(t).mul(0.9)).add(vec2(0.5, 0.2))).a
    const foam = max(
      rim.mul(mix(1, 0.8, runs)),
      smoothstep(race.mul(-0.18).sub(white.mul(0.3)).add(0.72), 0.9, streak)
        .mul(race.mul(0.4).add(white.mul(0.3)).add(0.35))
        .mul(near)
        .mul(runs),
    ).toVar()
    foam.assign(
      max(
        foam,
        white
          .mul(smoothstep(0.42, 0.78, churn))
          .mul(0.9)
          .mul(smoothstep(0.6, 1.8, dist).mul(-0.5).add(1)),
      ),
    )
    If(foot.z.greaterThan(0.5), () => {
      const d = p.sub(foot.xy)
      const off = length(d)
      const away = d.div(max(off, 1e-3))
      const boil = noise
        .sample(p.mul(0.45).sub(away.mul(n_.uCaustics).mul(0.6)))
        .a.mul(0.65)
        .add(noise.sample(p.mul(0.9).add(vec2(0.3, 0.6)).sub(away.mul(n_.uCaustics).mul(0.9))).a.mul(0.35))
      const reach = smoothstep(0.8, 4.2, off.add(breakup.mul(0.8))).oneMinus()
      const landing = smoothstep(0.4, 1.5, off).oneMinus()
      foam.assign(
        max(foam, max(landing.mul(0.95), smoothstep(reach.mul(-0.3).add(0.66), 0.8, boil).mul(reach))),
      )
    })
    foam.mulAssign(uWind.mul(0.15).add(0.85))
    const foamLit = vec3(0.92, 0.95, 0.97).mul(lightUp)
    colour.assign(mix(colour, foamLit, clamp(foam, 0, 1).mul(n_.uNight.mul(-0.4).add(0.9))))
    return vec4(colour, 1)
  })()
}

function fallColour(u: WaterUniforms, key: DirectionalLight | null): Node<"vec4"> {
  const n_ = nodesOf(u)
  const { noise } = n_
  return Fn(() => {
    const n = normalize(normalWorld).toVar()
    const v = normalize(cameraPosition.sub(positionWorld)).toVar()
    const t = n_.uCaustics
    const st = uv()
    const sheet = attribute<"vec2">("aSheet", "vec2")
    const foam = float(0.85).toVar()
    const glass = float(0).toVar()
    If(attribute<"float">("aPart", "float").lessThan(0.5), () => {
      // The sheet: across it in world units, how far from its sides, how far down it has come.
      const across = st.x.sub(0.5).mul(sheet.y)
      const side = float(0.5)
        .sub(abs(st.x.sub(0.5)))
        .mul(sheet.y)
      const down = st.y
      const rag = noise.sample(vec2(across.mul(0.21), down.mul(0.07).sub(t.mul(0.35)))).a
      If(
        side.lessThan(
          rag
            .mul(0.75)
            .mul(smoothstep(0.6, 2.5, down))
            .add(0.12),
        ),
        () => {
          Discard()
        },
      )
      const streak = noise.sample(vec2(across.mul(0.33), down.mul(0.08).sub(t.mul(0.6)))).a
      const fine = noise.sample(vec2(across.mul(0.9).add(0.3), down.mul(0.22).sub(t.mul(1.5)))).a
      glass.assign(smoothstep(0.9, 1.8, down).oneMinus())
      foam.assign(smoothstep(0.38, 0.72, streak.mul(0.65).add(fine.mul(0.5))).mul(glass.mul(-0.85).add(1)))
      foam.assign(max(foam, smoothstep(sheet.x.sub(1.8), sheet.x.sub(0.4), down)))
    }).Else(() => {
      // The spray: boiling up from the water, thinning to nothing at its crown.
      const boil = noise.sample(vec2(st.x.mul(2.6), st.y.mul(0.6).sub(t.mul(0.8)))).a
      If(boil.lessThan(st.y.mul(0.55).add(0.18)), () => {
        Discard()
      })
    })
    const shade = key ? keyShadow(key) : float(1)
    const fill = mix(n_.uHemiGround, n_.uHemiSky, n.y.mul(0.5).add(0.5)).mul(n_.uHemiIntensity)
    const light = fill
      .add(
        n_.uKeyColor
          .mul(n_.uKeyIntensity)
          .mul(max(dot(n, n_.uKeyDir), 0))
          .mul(shade),
      )
      .mul(RECIPROCAL_PI)
      .toVar()
    const body = mix(n_.uShallow, n_.uDeep, glass.mul(0.25).add(0.3))
      .mul(n_.uGloom.mul(-0.4).add(1))
      .mul(light)
    const r = reflect(v.negate(), n)
    const sky = mix(n_.uHorizon, n_.uZenith, smoothstep(0, 0.7, r.y))
    const fresnel = pow(max(dot(n, v), 0).oneMinus(), 3)
      .mul(0.5)
      .add(0.1)
    const colour = mix(body, sky.mul(0.85), fresnel.mul(glass.mul(0.6).add(0.4)))
    const foamLit = vec3(0.92, 0.95, 0.97).mul(light)
    return vec4(mix(colour, foamLit, clamp(foam, 0, 1).mul(n_.uNight.mul(-0.35).add(0.92))), 1)
  })()
}
