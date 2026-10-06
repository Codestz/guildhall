import { useFrame, useThree } from "@react-three/fiber"
import { Bloom, EffectComposer, TiltShift2, Vignette } from "@react-three/postprocessing"
import { Suspense, useEffect, useRef } from "react"
import { type DirectionalLight, Vector3 } from "three"
import { TIERS } from "../guild/quality.ts"
import { useGuild, useGuildStore } from "../guild/useGuild.ts"
import { Adventurer } from "./Adventurer.tsx"
import { CameraRig } from "./CameraRig.tsx"
import { FrameStats } from "./FrameStats.tsx"
import { Island } from "./Island.tsx"
import { Quality, useTier } from "./Quality.tsx"
import { Room } from "./Room.tsx"
import { Stations } from "./Stations.tsx"

/** Everything inside the Canvas. */
export function Scene() {
  const { mood } = useGuild()
  const level = TIERS[useTier()]
  return (
    <Quality>
      <Clock />
      <FrameStats />
      {import.meta.env.DEV && <DevBridge />}
      <color attach="background" args={[mood.ground]} />
      <hemisphereLight args={[mood.sky, mood.bounce, mood.ambient]} />
      <Sun />
      <Suspense fallback={null}>
        <Island />
        <Room />
        <Stations />
        <Cast />
      </Suspense>
      <CameraRig />
      {level.post && level.tiltShift && (
        <EffectComposer multisampling={4}>
          <Bloom luminanceThreshold={mood.bloomThreshold} intensity={0.7} mipmapBlur />
          <TiltShift2 blur={0.12} />
          <Vignette offset={0.3} darkness={mood.vignette} />
        </EffectComposer>
      )}
      {level.post && !level.tiltShift && (
        <EffectComposer multisampling={0}>
          <Bloom luminanceThreshold={mood.bloomThreshold} intensity={0.7} mipmapBlur />
          <Vignette offset={0.3} darkness={mood.vignette} />
        </EffectComposer>
      )}
    </Quality>
  )
}

function Cast() {
  const { views } = useGuild()
  return (
    <>
      {views.map((view) => (
        <Suspense key={view.id} fallback={null}>
          <Adventurer view={view} />
        </Suspense>
      ))}
    </>
  )
}

/** Drives the guild's clock from the render loop; long frames (a hidden tab) are capped. */
function Clock() {
  const store = useGuildStore()
  useFrame((_, delta) => store.tick(Math.min(delta, 0.1) * 1000))
  return null
}

/** Dev only: lets automation step frames by hand when the tab is hidden (rAF paused). */
function DevBridge() {
  const advance = useThree((state) => state.advance)
  const gl = useThree((state) => state.gl)
  useEffect(() => {
    Object.assign(window, { r3f: { advance, gl } })
  }, [advance, gl])
  return null
}

/**
 * One shadow-casting light that follows the camera's target: a tight shadow box (sharp shadows,
 * one 2048 map) over whatever the Bard is looking at, instead of one huge box over the island.
 */
function Sun() {
  const { mood } = useGuild()
  const map = TIERS[useTier()].shadowMap
  const light = useRef<DirectionalLight>(null)
  const scene = useThree((state) => state.scene)

  useEffect(() => {
    const target = light.current?.target
    if (!target) return
    scene.add(target)
    return () => {
      scene.remove(target)
    }
  }, [scene])

  useFrame((state) => {
    const sun = light.current
    if (!sun) return
    const controls = state.controls as unknown as { target?: Vector3 } | null
    const at = controls?.target ?? ORIGIN
    sun.position.set(at.x - 22, 34, at.z + 18)
    sun.target.position.set(at.x, 0, at.z)
    sun.target.updateMatrixWorld()
  })

  return (
    <directionalLight
      ref={light}
      color={mood.key}
      intensity={mood.keyIntensity}
      castShadow
      key={map}
      shadow-mapSize={[map, map]}
      shadow-camera-left={-40}
      shadow-camera-right={40}
      shadow-camera-top={40}
      shadow-camera-bottom={-40}
      shadow-camera-far={140}
      shadow-bias={-0.0004}
    />
  )
}

const ORIGIN = new Vector3()
