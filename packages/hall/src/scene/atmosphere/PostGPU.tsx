import { useFrame, useThree } from "@react-three/fiber"
import { useEffect, useMemo } from "react"
import {
  Color,
  type Data3DTexture,
  NeutralToneMapping,
  NoToneMapping,
  SRGBColorSpace,
  type Uniform,
} from "three"
import { bloom } from "three/addons/tsl/display/BloomNode.js"
import { lut3D } from "three/addons/tsl/display/Lut3DNode.js"
import { smaa } from "three/addons/tsl/display/SMAANode.js"
import {
  abs,
  clamp,
  convertToTexture,
  dot,
  Fn,
  float,
  fract,
  luminance,
  mix,
  normalize,
  pass,
  pow,
  renderOutput,
  screenCoordinate,
  screenSize,
  screenUV,
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
import { TIERS } from "../../guild/quality.ts"
import { useGuildStore } from "../../guild/useGuild.ts"
import { syncShadows } from "../../render/shims.ts"
import { FRAME } from "../frame.ts"
import { useTier } from "../Quality.tsx"
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
 *   the grade's colour (GradeEffect.ts: exposure, saturation with its darker-shadows split, the
 *   split tone, contrast round mid-grey) → Neutral tone mapping → the mood LUT (MoodLut.ts's table,
 *   through three's Lut3D node) → tilt-shift (Ultra) → vignette (pmndrs' default formula) → sRGB → SMAA
 *
 * Neutral tone mapping takes the exposure again, as on WebGL: there the composer's tone-mapping
 * effect reads the renderer's `toneMappingExposure`, which Atmosphere.tsx sets to `sky.exposure`
 * under post.
 *
 * TODO(depth): the grade's depth-read looks are WebGL-only still: cloud shadows, ink outlines,
 * ground mist and sun shafts (GradeEffect.ts reads the depth buffer; here they need the scene pass's
 * depth texture and the world-from-depth reconstruction ported).
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

  const chain = useMemo(() => {
    const u = {
      exposure: uniform(1),
      saturation: uniform(1),
      darkSaturation: uniform(1),
      contrast: uniform(1),
      shadowTint: uniform(new Color(1, 1, 1)),
      highlightTint: uniform(new Color(1, 1, 1)),
      darkness: uniform(0.3),
      lut: uniform(0),
    }
    const scenePass = pass(scene, camera)
    const color = scenePass.getTextureNode("output")
    const glow = bloom(color, 0.6, 0.5, 1)
    glow.smoothWidth.value = 0.25
    const lit = screenBlend(color.rgb, glow.rgb)
    const mapped = (toneMapping(NeutralToneMapping, u.exposure, grade(lit, u)) as unknown as Node<"vec4">).rgb
    const table = (lut.uniforms.get("lut") as Uniform<Data3DTexture>).value
    const looked = mix(mapped, moodLut(mapped, table), u.lut)
    const shifted = level.tiltShift ? tiltShift(convertToTexture(vec4(looked, 1))) : looked
    const edge = screenUV.distance(0.5).mul(u.darkness.add(VIGNETTE_OFFSET))
    const vignetted = shifted.mul(float(1).sub(smoothstep(VIGNETTE_OFFSET * 0.799, 0.8, edge)))
    // Tone mapping is done above; the output node only converts to sRGB, so SMAA sees display values.
    const display = renderOutput(vec4(vignetted, 1), NoToneMapping, SRGBColorSpace)
    const pipeline = new RenderPipeline(gl, smaa(display))
    pipeline.outputColorTransform = false
    return { pipeline, glow, u }
  }, [gl, scene, camera, lut, level.tiltShift])

  useEffect(() => () => chain.pipeline.dispose(), [chain])

  useFrame(() => {
    if (!level.post) return
    const { u } = chain
    u.exposure.value = sky.exposure
    u.saturation.value = sky.saturation
    u.darkSaturation.value = sky.darkSaturation
    u.contrast.value = sky.contrast
    u.shadowTint.value.copy(sky.shadows)
    u.highlightTint.value.copy(sky.highlights)
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

/** pmndrs' SCREEN blend, as its Bloom effect lays the glow over the frame. */
function screenBlend(base: Node<"vec3">, glow: Node<"vec3">): Node<"vec3"> {
  return base.add(glow).sub(base.mul(glow).min(1))
}

/** The grade's levers (GradeEffect.ts), as uniform nodes PostGPU writes each frame. */
interface GradeUniforms {
  exposure: Node<"float">
  saturation: Node<"float">
  darkSaturation: Node<"float">
  contrast: Node<"float">
  shadowTint: Node<"color">
  highlightTint: Node<"color">
}

/** GradeEffect.ts's colour, node for node, without its depth-read looks (see PostGPU's TODO). Linear HDR in and out. */
function grade(input: Node<"vec3">, u: GradeUniforms): Node<"vec3"> {
  return Fn(() => {
    const exposed = input.mul(u.exposure)
    const l = luminance(exposed)
    const saturated = mix(
      vec3(l),
      exposed,
      mix(u.darkSaturation, u.saturation, smoothstep(0.02, 0.3, l)),
    ).max(0)
    const tinted = saturated.mul(mix(u.shadowTint, u.highlightTint, smoothstep(0.02, 0.5, l)))
    return pow(tinted.div(0.18), vec3(u.contrast)).mul(0.18)
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
    const step = normalize(vec2(1, 1)).div(screenSize).mul(radius)
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
