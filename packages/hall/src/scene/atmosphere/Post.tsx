import { Bloom, EffectComposer, TiltShift2, Vignette } from "@react-three/postprocessing"
import { TIERS } from "../../guild/quality.ts"
import { useGuild } from "../../guild/useGuild.ts"
import { useTier } from "../Quality.tsx"

/** Post-processing per quality tier (ADR 0007, task "Sky" owns it from here). */
export function Post() {
  const { mood } = useGuild()
  const level = TIERS[useTier()]
  if (!level.post) return null
  return level.tiltShift ? (
    <EffectComposer multisampling={4}>
      <Bloom luminanceThreshold={mood.bloomThreshold} intensity={0.7} mipmapBlur />
      <TiltShift2 blur={0.12} />
      <Vignette offset={0.3} darkness={mood.vignette} />
    </EffectComposer>
  ) : (
    <EffectComposer multisampling={0}>
      <Bloom luminanceThreshold={mood.bloomThreshold} intensity={0.7} mipmapBlur />
      <Vignette offset={0.3} darkness={mood.vignette} />
    </EffectComposer>
  )
}
