import { ContactShadows } from "@react-three/drei"
import { useFrame, useThree } from "@react-three/fiber"
import { Bloom, EffectComposer, TiltShift2, Vignette } from "@react-three/postprocessing"
import { Suspense, useEffect } from "react"
import { useGuild, useGuildStore } from "../guild/useGuild.ts"
import { ROOM } from "../world/layout.ts"
import { Adventurer } from "./Adventurer.tsx"
import { Bard } from "./Bard.tsx"
import { Room } from "./Room.tsx"
import { Stations } from "./Stations.tsx"

/** Everything inside the Canvas. */
export function Scene() {
  const { mood } = useGuild()
  return (
    <>
      <Clock />
      {import.meta.env.DEV && <DevBridge />}
      <color attach="background" args={[mood.ground]} />
      <hemisphereLight args={[mood.sky, mood.bounce, mood.ambient]} />
      <directionalLight
        position={[-22, 34, 18]}
        color={mood.key}
        intensity={mood.keyIntensity}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-26}
        shadow-camera-right={26}
        shadow-camera-top={26}
        shadow-camera-bottom={-26}
        shadow-camera-far={120}
        shadow-bias={-0.0004}
      />
      <Suspense fallback={null}>
        <Room />
        <Stations />
        <Cast />
      </Suspense>
      <ContactShadows
        position={[0, 0.005, 0]}
        scale={[ROOM.width, ROOM.depth]}
        resolution={1024}
        opacity={0.45}
        blur={2.4}
        far={3}
      />
      <Bard />
      <EffectComposer multisampling={4}>
        <Bloom luminanceThreshold={mood.bloomThreshold} intensity={0.7} mipmapBlur />
        <TiltShift2 blur={0.12} />
        <Vignette offset={0.3} darkness={mood.vignette} />
      </EffectComposer>
    </>
  )
}

function Cast() {
  const { views } = useGuild()
  return (
    <>
      {views.map((view) => (
        <Adventurer key={view.id} view={view} />
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
  useEffect(() => {
    Object.assign(window, { r3f: { advance } })
  }, [advance])
  return null
}
