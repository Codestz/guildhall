import { useFrame, useThree } from "@react-three/fiber"
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
import { useEffect, useMemo, useRef } from "react"
import type { Fog } from "three"
import { PROBE } from "../../guild/mode.ts"
import { reducedMotion } from "../../guild/opening.ts"
import { TIERS } from "../../guild/quality.ts"
import { useGuildStore } from "../../guild/useGuild.ts"
import { FRAME } from "../frame.ts"
import { useTier } from "../Quality.tsx"
import { GradeEffect } from "./GradeEffect.ts"
import { useLooks } from "./looks.ts"
import { MoodLutEffect } from "./MoodLut.ts"
import { sky } from "./state.ts"

/**
 * Post-processing per quality tier (ADR 0007, task "Sky"): bloom so flames and the sun glow, the
 * time-of-day colour grade (with ink outlines, ground mist and sun shafts folded in, per tier), Neutral
 * tone mapping, the mood LUT, tilt-shift on Ultra, and a vignette — one effect pass after the scene. Low has none of it. Levels change every frame from `sky` (through refs:
 * no re-render).
 *
 * Budget (120 fps, docs/perf-budget.md): no MSAA — 4× multisampling on the half-float buffers cost
 * High ~3× its frame time; and ambient occlusion (N8AO) is wired but off on every tier (`TIERS.ao`):
 * it re-renders the scene (+50–80 draw calls) and halved Medium's frame rate even at half size.
 */
export function Post() {
  const level = TIERS[useTier()]
  const looks = useLooks()
  const store = useGuildStore()
  const grade = useMemo(() => new GradeEffect(), [])
  const lut = useMemo(() => new MoodLutEffect(), [])
  const bloom = useRef<BloomEffect>(null)
  const vignette = useRef<VignetteEffect>(null)
  const scene = useThree((state) => state.scene)
  const radii = useMemo(() => ({ near: 1e4, far: 2e4 }), [])

  useEffect(() => grade.setLooks(looks), [grade, looks])
  useEffect(() => {
    grade.still = reducedMotion()
    // Probe hook: `postLook.grade.still = true` freezes the clouds for A/B screenshots.
    if (PROBE) Object.assign(window, { postLook: { grade, lut } })
  }, [grade, lut])
  useEffect(() => () => lut.dispose(), [lut])

  useFrame(({ camera, gl }, delta) => {
    const fog = scene.fog as Fog | null
    radii.near = fog?.near ?? 1e4
    radii.far = fog?.far ?? 2e4
    grade.apply(sky, camera, delta, radii, gl.getPixelRatio())
    if (looks.lut) lut.apply(sky, store.mood.id)
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
    // Draws the frame on every tier with post (scene/frame.ts: on Low, FrameStats does).
    <EffectComposer multisampling={0} renderPriority={FRAME.RENDER}>
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
      {looks.lut ? <primitive object={lut} /> : null}
      {level.tiltShift ? <TiltShift2 blur={0.12} /> : null}
      <Vignette ref={vignette} offset={0.3} darkness={0.3} />
      {/* Edges: the canvas has no MSAA (too costly on half-float buffers), so without this every
          roof, pillar and plank line stair-stepped. SMAA on the final image costs ~0.3–0.6 ms. */}
      <SMAA />
    </EffectComposer>
  )
}
