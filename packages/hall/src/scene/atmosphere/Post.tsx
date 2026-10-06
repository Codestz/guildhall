import { useFrame } from "@react-three/fiber"
import {
  Bloom,
  EffectComposer,
  N8AO,
  SMAA,
  TiltShift2,
  ToneMapping,
  Vignette,
} from "@react-three/postprocessing"
import { type BloomEffect, ToneMappingMode, type VignetteEffect } from "postprocessing"
import { useMemo, useRef } from "react"
import { TIERS } from "../../guild/quality.ts"
import { useTier } from "../Quality.tsx"
import { GradeEffect } from "./GradeEffect.ts"
import { sky } from "./state.ts"

/**
 * Post-processing per quality tier (ADR 0007, task "Sky"): bloom so flames and the sun glow, the
 * time-of-day colour grade, Neutral tone mapping, tilt-shift on High, and a vignette — one effect
 * pass after the scene. Low has none of it. Levels change every frame from `sky` (through refs:
 * no re-render).
 *
 * Budget (120 fps, docs/perf-budget.md): no MSAA — 4× multisampling on the half-float buffers cost
 * High ~3× its frame time; and ambient occlusion (N8AO) is wired but off on every tier (`TIERS.ao`):
 * it re-renders the scene (+50–80 draw calls) and halved Medium's frame rate even at half size.
 */
export function Post() {
  const level = TIERS[useTier()]
  const grade = useMemo(() => new GradeEffect(), [])
  const bloom = useRef<BloomEffect>(null)
  const vignette = useRef<VignetteEffect>(null)

  useFrame(({ camera }, delta) => {
    grade.apply(sky, camera, delta)
    const glow = bloom.current
    if (glow) {
      glow.intensity = sky.bloomIntensity
      glow.luminanceMaterial.threshold = sky.bloomThreshold
    }
    if (vignette.current) vignette.current.darkness = sky.vignette
  })

  if (!level.post) return null
  const half = level.ao === "half"
  return (
    <EffectComposer multisampling={0}>
      {level.ao !== "off" ? (
        <N8AO
          aoRadius={2.4}
          distanceFalloff={1.2}
          intensity={half ? 2.2 : 2.6}
          aoSamples={half ? 8 : 12}
          denoiseSamples={half ? 4 : 6}
          denoiseRadius={10}
          halfRes={half}
          depthAwareUpsampling
        />
      ) : null}
      <Bloom ref={bloom} luminanceThreshold={1} luminanceSmoothing={0.25} intensity={0.6} mipmapBlur />
      <primitive object={grade} />
      <ToneMapping mode={ToneMappingMode.NEUTRAL} />
      {level.tiltShift ? <TiltShift2 blur={0.12} /> : null}
      <Vignette ref={vignette} offset={0.3} darkness={0.3} />
      {/* Edges: the canvas has no MSAA (too costly on half-float buffers), so without this every
          roof, pillar and plank line stair-stepped. SMAA on the final image costs ~0.3–0.6 ms. */}
      <SMAA />
    </EffectComposer>
  )
}
