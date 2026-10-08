import { useFrame, useThree } from "@react-three/fiber"
import { useEffect, useMemo } from "react"
import { NeutralToneMapping, NoToneMapping, SRGBColorSpace } from "three"
import { bloom } from "three/addons/tsl/display/BloomNode.js"
import { fxaa } from "three/addons/tsl/display/FXAANode.js"
import {
  float,
  luminance,
  mix,
  pass,
  renderOutput,
  screenUV,
  smoothstep,
  toneMapping,
  uniform,
  vec3,
  vec4,
} from "three/tsl"
import { RenderPipeline, type WebGPURenderer } from "three/webgpu"
import { TIERS } from "../../guild/quality.ts"
import { syncShadows } from "../../render/shims.ts"
import { FRAME } from "../frame.ts"
import { useTier } from "../Quality.tsx"
import { sky } from "./state.ts"

/** pmndrs Vignette's `offset` on the WebGL path (Post.tsx); its darkness follows `sky.vignette`. */
const VIGNETTE_OFFSET = 0.3

/**
 * The post chain on the `?renderer=webgpu` path: three's own node post-processing (RenderPipeline),
 * since pmndrs postprocessing is WebGL-only. One scene pass, then, in order:
 *
 *   bloom (TSL BloomNode; level and threshold from `sky`) → exposure and saturation (the grade's two
 *   global levers) → Neutral tone mapping → vignette (pmndrs' default formula) → sRGB → FXAA
 *
 * Not here yet (the WebGL chain has them, Post.tsx): the rest of the grade (cloud shadows, ink
 * outlines, ground mist, sun shafts, split tone: GradeEffect.ts, GLSL with a depth read), the mood
 * LUT, tilt-shift, and SMAA (FXAA stands in). Like the composer, it draws the frame (FRAME.RENDER),
 * on the tiers with post; Low draws in FrameStats.
 */
export function PostGPU() {
  const level = TIERS[useTier()]
  const gl = useThree((state) => state.gl) as unknown as WebGPURenderer
  const scene = useThree((state) => state.scene)
  const camera = useThree((state) => state.camera)

  const chain = useMemo(() => {
    const exposure = uniform(1)
    const saturation = uniform(1)
    const darkness = uniform(0.3)
    const scenePass = pass(scene, camera)
    const color = scenePass.getTextureNode("output")
    const glow = bloom(color, 0.6, 0.5, 1)
    glow.smoothWidth.value = 0.25
    const lit = color.rgb.add(glow.rgb).mul(exposure)
    const graded = mix(vec3(luminance(lit)), lit, saturation).max(0)
    const mapped = toneMapping(NeutralToneMapping, float(1), graded)
    const edge = screenUV.distance(0.5).mul(darkness.add(VIGNETTE_OFFSET))
    const vignetted = mapped.mul(float(1).sub(smoothstep(VIGNETTE_OFFSET * 0.799, 0.8, edge)))
    // Tone mapping is done above; the output node only converts to sRGB, so FXAA sees display values.
    const display = renderOutput(vec4(vignetted.rgb, 1), NoToneMapping, SRGBColorSpace)
    const pipeline = new RenderPipeline(gl, fxaa(display))
    pipeline.outputColorTransform = false
    return { pipeline, glow, exposure, saturation, darkness }
  }, [gl, scene, camera])

  useEffect(() => () => chain.pipeline.dispose(), [chain])

  useFrame(() => {
    if (!level.post) return
    chain.exposure.value = sky.exposure
    chain.saturation.value = sky.saturation
    chain.darkness.value = sky.vignette
    chain.glow.strength.value = sky.bloomIntensity
    chain.glow.threshold.value = sky.bloomThreshold
    syncShadows(gl, scene)
    chain.pipeline.render()
  }, FRAME.RENDER)

  return null
}
