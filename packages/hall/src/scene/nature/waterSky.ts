import { useFrame } from "@react-three/fiber"
import { useMemo } from "react"
import { type DirectionalLight, MathUtils, type Object3D, Vector3 } from "three"
import { reducedMotion } from "../../guild/opening.ts"
import { useGuildStore } from "../../guild/useGuild.ts"
import { sky } from "../atmosphere/state.ts"
import { EASE } from "../weather/shared.ts"
import type { WaterUniforms } from "./Water.tsx"

/**
 * The sky and weather as a water material reads them, written into its uniforms every frame: the
 * eased rain, gloom and cloud, the key and fill, the moon's path, Water v2's own clock. the frame
 * step for the uniforms every water shares: the sea (Water.tsx, which adds its torches) and the
 * inland water (Rivers.tsx) both take it from here. `onKey` hears of the scene's shadow-casting
 * key light once it has a map (the node materials take their shadow from it).
 */
export function useWaterSky(
  uniforms: Pick<
    WaterUniforms,
    | "uRain"
    | "uGloom"
    | "uCloud"
    | "uKeyIntensity"
    | "uHemiIntensity"
    | "uFlash"
    | "uCaustics"
    | "uKeyDir"
    | "uMoonDir"
    | "uNight"
    | "uMoon"
  >,
  onKey?: (key: DirectionalLight | null) => void,
): void {
  const store = useGuildStore()
  const eased = useMemo(
    () => ({ rain: 0, gloom: 0, cloud: 0, clock: 0, key: null as DirectionalLight | null }),
    [],
  )
  const still = useMemo(reducedMotion, [])
  useFrame((state, delta) => {
    if (onKey && !eased.key?.parent) {
      eased.key = keyLight(state.scene)
      if (eased.key) onKey(eased.key)
    }
    const env = store.environment
    const u = uniforms
    eased.rain = MathUtils.damp(eased.rain, env.weather === "snow" ? 0 : env.precipitation, EASE, delta)
    const gloom = env.weather === "storm" ? 1 : env.weather === "rain" ? 0.4 : 0
    eased.gloom = MathUtils.damp(eased.gloom, gloom, EASE, delta)
    eased.cloud = MathUtils.damp(eased.cloud, env.cloudCover, EASE, delta)
    u.uRain.value = eased.rain
    u.uGloom.value = eased.gloom
    u.uCloud.value = eased.cloud
    u.uKeyIntensity.value = sky.keyIntensity
    u.uHemiIntensity.value = sky.hemiIntensity
    u.uFlash.value = sky.flash
    if (!still) eased.clock = (eased.clock + Math.min(delta, 0.1)) % 1000
    u.uCaustics.value = eased.clock
    const [x, y, z] = sky.keyDirection
    u.uKeyDir.value.set(x, y, z)
    // The photogenic moon (as Water.tsx): its path swings round towards where the camera looks.
    const [mx, my, mz] = env.moon
    state.camera.getWorldDirection(look)
    look.y = 0
    look.normalize()
    const lift = Math.max(0.15, Math.min(0.75, (my + 0.6) * 0.5))
    u.uMoonDir.value
      .set(mx, 0, mz)
      .normalize()
      .lerp(look, 0.75)
      .setY(0)
      .normalize()
      .multiplyScalar(Math.sqrt(1 - lift * lift))
      .setY(lift)
    u.uNight.value = sky.night
    u.uMoon.value = sky.moonDisc * sky.night
  })
}

const look = new Vector3()

/**
 * The scene's shadow-casting directional light (Atmosphere's key), once its shadow map exists, or
 * on a cascaded WebGPU key (whose maps are its cascade node's) as soon as it has the node.
 */
export function keyLight(scene: Object3D): DirectionalLight | null {
  let found: DirectionalLight | null = null
  scene.traverse((object) => {
    const light = object as DirectionalLight
    if (
      !found &&
      light.isDirectionalLight &&
      light.castShadow &&
      (light.shadow.map || light.shadow.shadowNode)
    )
      found = light
  })
  return found
}
