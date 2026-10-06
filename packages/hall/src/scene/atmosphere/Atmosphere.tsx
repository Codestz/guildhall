import { useFrame, useThree } from "@react-three/fiber"
import { useEffect, useRef } from "react"
import { type DirectionalLight, Vector3 } from "three"
import { TIERS } from "../../guild/quality.ts"
import { useGuild } from "../../guild/useGuild.ts"
import { useTier } from "../Quality.tsx"

/**
 * Sky and light (ADR 0007, task "Sky"): background, ambient fill and the sun. Reads the store's
 * `environment` (time of day, weather) and the mood palette. Owned by the Sky author.
 */
export function Atmosphere() {
  const { mood } = useGuild()
  return (
    <>
      <color attach="background" args={[mood.ground]} />
      <hemisphereLight args={[mood.sky, mood.bounce, mood.ambient]} />
      <Sun />
    </>
  )
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
