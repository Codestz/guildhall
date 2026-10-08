import { useFrame, useThree } from "@react-three/fiber"
import { useEffect, useMemo } from "react"
import {
  type Camera,
  type Data3DTexture,
  type Fog,
  NeutralToneMapping,
  NoToneMapping,
  SRGBColorSpace,
  type Uniform,
  Vector2,
} from "three"
import { bloom } from "three/addons/tsl/display/BloomNode.js"
import { depthAwareBlur } from "three/addons/tsl/display/depthAwareBlur.js"
import { ao } from "three/addons/tsl/display/GTAONode.js"
import { lut3D } from "three/addons/tsl/display/Lut3DNode.js"
import { smaa } from "three/addons/tsl/display/SMAANode.js"
import {
  abs,
  clamp,
  convertToTexture,
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
  normalize,
  pass,
  perspectiveDepthToViewZ,
  pow,
  reference,
  renderOutput,
  screenCoordinate,
  screenSize,
  screenUV,
  select,
  sin,
  smoothstep,
  sqrt,
  texture3D,
  toneMapping,
  uniform,
  vec2,
  vec3,
  vec4,
} from "three/tsl"
import { type Node, RenderPipeline, type TextureNode, type WebGPURenderer } from "three/webgpu"
import { PROBE } from "../../guild/mode.ts"
import { reducedMotion } from "../../guild/opening.ts"
import { TIERS } from "../../guild/quality.ts"
import { useGuildStore } from "../../guild/useGuild.ts"
import { syncShadows } from "../../render/shims.ts"
import { FRAME } from "../frame.ts"
import { useTier } from "../Quality.tsx"
import { GradeEffect } from "./GradeEffect.ts"
import { useLooks } from "./looks.ts"
import { MoodLutEffect } from "./MoodLut.ts"
import { sky } from "./state.ts"

/** pmndrs Vignette's `offset` on the WebGL path (Post.tsx); its darkness follows `sky.vignette`. */
const VIGNETTE_OFFSET = 0.3

/**
 * The post chain on the `?renderer=webgpu` path: three's own node post-processing (RenderPipeline),
 * since pmndrs postprocessing is WebGL-only. The same steps as the WebGL composer (Post.tsx), in
 * its order:
 *
 *   bloom (TSL BloomNode, screen-blended as pmndrs blends it; level and threshold from `sky`) →
 *   the grade (GradeEffect.ts, node for node: its depth-read looks — cloud shadows, ink outlines
 *   (High and up), ground mist and sun shafts (Medium and up) — from the scene pass's depth, then
 *   exposure, saturation with its darker-shadows split, the split tone, contrast round mid-grey) →
 *   Neutral tone mapping → the mood LUT (MoodLut.ts's table, through three's Lut3D node) →
 *   tilt-shift (Ultra) → vignette (pmndrs' default formula) → sRGB → SMAA
 *
 * The grade's numbers are GradeEffect's own: an instance (never drawn) runs its `apply` each frame
 * (the clouds' and the mist's drift, the shafts' source, the ink's width and tolerance) and the
 * nodes read its uniform objects, so both backends move the same clouds the same way.
 *
 * Neutral tone mapping takes the exposure again, as on WebGL: there the composer's tone-mapping
 * effect reads the renderer's `toneMappingExposure`, which Atmosphere.tsx sets to `sky.exposure`
 * under post.
 *
 * Ambient occlusion first, on the tiers that have it (`TIERS.ao`), as N8AO leads the WebGL
 * composer: three's GTAO node from the scene pass's depth (normals rebuilt from it, as N8AO does),
 * blurred depth-aware, then laid over the frame as N8AO lays its own (`aoOver`).
 *
 * Like the composer, it draws the frame (FRAME.RENDER) on the tiers with post; Low draws in FrameStats.
 */
export function PostGPU() {
  const level = TIERS[useTier()]
  const looks = useLooks()
  const store = useGuildStore()
  const gl = useThree((state) => state.gl) as unknown as WebGPURenderer
  const scene = useThree((state) => state.scene)
  const camera = useThree((state) => state.camera)
  // The LUT's table and its blending through the day, exactly as the WebGL effect bakes them.
  const lut = useMemo(() => new MoodLutEffect(), [])
  useEffect(() => () => lut.dispose(), [lut])
  // The grade's uniforms, as the WebGL pass computes them (see above).
  const gradeLevers = useMemo(() => new GradeEffect(), [])
  useEffect(() => {
    gradeLevers.still = reducedMotion()
    return () => gradeLevers.dispose()
  }, [gradeLevers])
  const radii = useMemo(() => ({ near: 1e4, far: 2e4 }), [])

  const chain = useMemo(() => {
    const u = {
      exposure: uniform(1),
      darkness: uniform(0.3),
      lut: uniform(0),
      fog: uniform(new Vector2(1e4, 2e4)),
    }
    const scenePass = pass(scene, camera)
    const color = scenePass.getTextureNode("output")
    const depth = scenePass.getTextureNode("depth")
    const occlusion = level.ao === "off" ? null : aoOver(depth, camera, level.ao === "half", u.fog)
    const shaded = occlusion ? vec4(color.rgb.mul(occlusion.factor), 1) : color
    const glow = bloom(shaded, 0.6, 0.5, 1)
    glow.smoothWidth.value = 0.25
    const lit = screenBlend(shaded.rgb, glow.rgb)
    const looksOn = { outlines: looks.outlines, mist: looks.mist }
    const graded = grade(lit, depth, gradeNodes(gradeLevers, camera), looksOn)
    const mapped = (toneMapping(NeutralToneMapping, u.exposure, graded) as unknown as Node<"vec4">).rgb
    const table = (lut.uniforms.get("lut") as Uniform<Data3DTexture>).value
    const looked = mix(mapped, moodLut(mapped, table), u.lut)
    const shifted = level.tiltShift ? tiltShift(convertToTexture(vec4(looked, 1))) : looked
    const edge = screenUV.distance(0.5).mul(u.darkness.add(VIGNETTE_OFFSET))
    const vignetted = shifted.mul(float(1).sub(smoothstep(VIGNETTE_OFFSET * 0.799, 0.8, edge)))
    // Tone mapping is done above; the output node only converts to sRGB, so SMAA sees display values.
    const display = renderOutput(vec4(vignetted, 1), NoToneMapping, SRGBColorSpace)
    const pipeline = new RenderPipeline(gl, smaa(display))
    pipeline.outputColorTransform = false
    return { pipeline, glow, occlusion, u }
  }, [gl, scene, camera, lut, gradeLevers, level.tiltShift, level.ao, looks.outlines, looks.mist])

  useEffect(() => {
    // Probe hook, as on WebGL (Post.tsx): `postLook.grade.still = true` freezes the clouds; `ao` is the GTAO node.
    if (PROBE) Object.assign(window, { postLook: { grade: gradeLevers, lut, ao: chain.occlusion?.node } })
  }, [chain, gradeLevers, lut])
  useEffect(
    () => () => {
      chain.pipeline.dispose()
      chain.occlusion?.dispose()
    },
    [chain],
  )

  useFrame((_, delta) => {
    if (!level.post) return
    const { u } = chain
    const fog = scene.fog as Fog | null
    radii.near = fog?.near ?? 1e4
    radii.far = fog?.far ?? 2e4
    u.fog.value.set(radii.near, radii.far)
    gradeLevers.apply(sky, camera, delta, radii, gl.getPixelRatio())
    u.exposure.value = sky.exposure
    u.darkness.value = sky.vignette
    u.lut.value = looks.lut ? 1 : 0
    if (looks.lut) lut.apply(sky, store.mood.id)
    chain.glow.strength.value = sky.bloomIntensity
    chain.glow.threshold.value = sky.bloomThreshold
    syncShadows(gl, scene)
    chain.pipeline.render()
  }, FRAME.RENDER)

  return null
}

/**
 * N8AO as Post.tsx sets it, in GTAO's terms: the same reach (N8AO's `aoRadius` 2.4) and sample
 * counts; GTAO's `scale` is the exponent on the visibility, as N8AO's `intensity` is, but GTAO's
 * visibility is far lighter, so it takes a larger one. Tuned side by side against the WebGL composer
 * on the keep and the yard at noon on Ultra (.probe/gpucmp/aosweep.ts): the frame's brightness
 * matched, and the contact shadows under furniture, posts and people. N8AO's dark rims round
 * silhouettes (its halo) GTAO does not draw: those stay lighter.
 */
const AO = {
  half: { radius: 2.4, thickness: 3, scale: 5, samples: 8 },
  full: { radius: 2.4, thickness: 3, scale: 5.9, samples: 12 },
}

/**
 * The ambient occlusion, as a factor to multiply the frame by: GTAO from `depth` (at half size on
 * "half"), two depth-aware blur passes (N8AO's denoise), faded out with distance into the fog
 * (N8AO's own fog fade: the fog's planar near → far). `fog` holds the fog's near and far.
 */
function aoOver(depth: TextureNode, camera: Camera, half: boolean, fog: Node<"vec2">) {
  const look = half ? AO.half : AO.full
  // No normals pass: GTAO rebuilds them from depth (`null`).
  const gtao = ao(depth, null as unknown as Node, camera)
  gtao.resolutionScale = half ? 0.5 : 1
  gtao.radius.value = look.radius
  gtao.thickness.value = look.thickness
  gtao.scale.value = look.scale
  gtao.samples.value = look.samples
  const raw = gtao.getTextureNode()
  const step = vec2(half ? 4 : 2).div(screenSize)
  const across = convertToTexture(depthAwareBlur(raw, depth, vec2(step.x, 0), camera, 2, look.radius))
  const blurred = convertToTexture(depthAwareBlur(across, depth, vec2(0, step.y), camera, 2, look.radius))
  const near = reference("near", "float", camera) as F
  const far = reference("far", "float", camera) as F
  const distance = (perspectiveDepthToViewZ(depth.sample(screenUV).x, near, far) as unknown as F).negate()
  const factor = mix(blurred.sample(screenUV).x as unknown as F, float(1), smoothstep(fog.x, fog.y, distance))
  return {
    factor,
    node: gtao,
    dispose() {
      gtao.dispose()
    },
  }
}

/** pmndrs' SCREEN blend, as its Bloom effect lays the glow over the frame. */
function screenBlend(base: Node<"vec3">, glow: Node<"vec3">): Node<"vec3"> {
  return base.add(glow).sub(base.mul(glow).min(1))
}

type F = Node<"float">
type V2 = Node<"vec2">
type V3 = Node<"vec3">

/** GradeEffect's uniforms, read from its uniform objects (written by its `apply`), and the camera's range. */
function gradeNodes(effect: GradeEffect, camera: Camera) {
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
 * GradeEffect.ts's `mainImage`, node for node: the depth-read looks (behind the tier's looks, as
 * its defines), then the colour. Linear HDR in and out.
 */
function grade(
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

/** MoodLut.ts's lookup: the table is indexed by the square root of display colour, and squared back. */
function moodLut(display: Node<"vec3">, table: Data3DTexture): Node<"vec3"> {
  const size = (table.image as { depth: number }).depth
  const looked = lut3D(
    vec4(sqrt(clamp(display, 0, 1)), 1),
    texture3D(table),
    size,
    float(1),
  ) as unknown as Node<"vec4">
  return looked.rgb.mul(looked.rgb)
}

/** pmndrs TiltShift2 as Post.tsx sets it (blur 0.12, its defaults otherwise: a vertical focus line, 10 taps). */
const TILT = { blur: 0.12, taper: 0.5, samples: 10 }

/**
 * TiltShift2's shader in TSL (Evan Wallace's): a blur along the diagonal that grows with the
 * distance from the screen's vertical centre line, its taps jittered per pixel to hide their count.
 */
function tiltShift(frame: TextureNode): Node<"vec3"> {
  return Fn(() => {
    const diagonal = screenSize.length()
    const gradientRadius = diagonal.mul(TILT.taper)
    const blurRadius = diagonal.mul(TILT.blur / 16)
    const offset = fract(
      sin(dot(vec3(screenCoordinate.xy, 0), vec3(12.9898, 78.233, 151.7182))).mul(43758.5453),
    )
    const radius = smoothstep(0, 1, abs(screenUV.x.sub(0.5).mul(screenSize.x)).div(gradientRadius)).mul(
      blurRadius,
    )
    // pmndrs' direction (1, 1) is in GL's uv, y up; screenUV runs y down, so the same diagonal is (1, -1).
    const step = normalize(vec2(1, -1)).div(screenSize).mul(radius)
    const half = TILT.samples / 2
    let sum: Node<"vec3"> = vec3(0)
    let total: Node<"float"> = float(0)
    for (let i = 0; i < TILT.samples; i++) {
      const percent = float(i - half - 0.5)
        .add(offset)
        .div(half)
      const weight = float(1).sub(abs(percent))
      sum = sum.add(frame.sample(screenUV.add(step.mul(percent))).rgb.mul(weight))
      total = total.add(weight)
    }
    return sum.div(total)
  })() as unknown as Node<"vec3">
}
