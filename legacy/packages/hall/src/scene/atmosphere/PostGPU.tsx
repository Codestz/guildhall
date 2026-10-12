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
  Vector3,
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
import { useWorld } from "../../world/source.ts"
import { reachOf } from "../../world/world.ts"
import { FRAME } from "../frame.ts"
import { useTier } from "../Quality.tsx"
import { HAZE } from "./aerial.ts"
import { GradeEffect } from "./GradeEffect.ts"
import { type F, grade, gradeNodes } from "./gradeGPU.ts"
import { useLooks } from "./looks.ts"
import { MoodLutEffect } from "./MoodLut.ts"
import { sky } from "./state.ts"
import { WIDE_VIEW } from "./wideView.ts"

/** pmndrs Vignette's `offset` on the WebGL path (Post.tsx); its darkness follows `sky.vignette`. */
const VIGNETTE_OFFSET = 0.3
const ORIGIN = new Vector3()

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
  // Aerial perspective is a gen 2 island's, as on WebGL (Post.tsx).
  const world = useWorld()
  const haze = world.repo?.gen === 2 && WIDE_VIEW.haze
  const reach = useMemo(() => reachOf(world), [world])

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

  useFrame(({ controls }, delta) => {
    if (!level.post) return
    const { u } = chain
    const fog = scene.fog as Fog | null
    radii.near = fog?.near ?? 1e4
    radii.far = fog?.far ?? 2e4
    u.fog.value.set(radii.near, radii.far)
    gradeLevers.apply(sky, camera, delta, radii, gl.getPixelRatio())
    const at = (controls as unknown as { target?: Vector3 } | null)?.target
    gradeLevers.aerial(sky, camera, at ?? ORIGIN, looks.mist && haze ? HAZE : 0, reach)
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
