import { useFrame, useThree } from "@react-three/fiber"
import { Suspense, useEffect } from "react"
import { PROBE } from "../guild/mode.ts"
import { useGuild, useGuildStore } from "../guild/useGuild.ts"
import { Adventurer } from "./Adventurer.tsx"
import { Atmosphere } from "./atmosphere/Atmosphere.tsx"
import { Post } from "./atmosphere/Post.tsx"
import { shadows } from "./atmosphere/shadows.ts"
import { Blobs } from "./Blobs.tsx"
import { CameraRig } from "./CameraRig.tsx"
import { Crisp } from "./Crisp.tsx"
import { FrameStats } from "./FrameStats.tsx"
import { Island } from "./Island.tsx"
import { Life } from "./life/Life.tsx"
import { NearLights } from "./lights/NearLights.tsx"
import { NightLife } from "./lights/NightLife.tsx"
import { StreetLights } from "./lights/StreetLights.tsx"
import { Nature } from "./nature/Nature.tsx"
import { Quality } from "./Quality.tsx"
import { Room } from "./Room.tsx"
import { Stations } from "./Stations.tsx"
import { WeatherLayer } from "./weather/WeatherLayer.tsx"

/** Everything inside the Canvas. */
export function Scene() {
  return (
    <Quality>
      <Clock />
      <Crisp />
      <FrameStats />
      {PROBE && <DevBridge />}
      <Atmosphere />
      <Suspense fallback={null}>
        <Island />
        <StreetLights />
        <NearLights />
        <NightLife />
        <Nature />
        <Life />
        <Room />
        <Stations />
        <Cast />
        <Blobs />
      </Suspense>
      <WeatherLayer />
      <CameraRig />
      <Post />
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
  const scene = useThree((state) => state.scene)
  const setDpr = useThree((state) => state.setDpr)
  useEffect(() => {
    Object.assign(window, { r3f: { advance, gl, scene, setDpr, shadows } })
  }, [advance, gl, scene, setDpr])
  return null
}
