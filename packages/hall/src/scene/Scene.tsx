import { useFrame, useThree } from "@react-three/fiber"
import { Suspense, useEffect } from "react"
import { MODE, PROBE } from "../guild/mode.ts"
import { useGuild, useGuildStore } from "../guild/useGuild.ts"
import { Adventurer } from "./Adventurer.tsx"
import { Atmosphere } from "./atmosphere/Atmosphere.tsx"
import { Post } from "./atmosphere/Post.tsx"
import { shadows } from "./atmosphere/shadows.ts"
import { Blobs } from "./Blobs.tsx"
import { CameraRig } from "./CameraRig.tsx"
import { Crisp } from "./Crisp.tsx"
import { FrameStats } from "./FrameStats.tsx"
import { FRAME } from "./frame.ts"
import { Island } from "./Island.tsx"
import { Life } from "./life/Life.tsx"
import { NearLights } from "./lights/NearLights.tsx"
import { NightLife } from "./lights/NightLife.tsx"
import { StreetLights } from "./lights/StreetLights.tsx"
import { Nature } from "./nature/Nature.tsx"
import { OpeningCue } from "./OpeningCue.tsx"
import { Quality } from "./Quality.tsx"
import { Room } from "./Room.tsx"
import { Stations } from "./Stations.tsx"
import { WeatherLayer } from "./weather/WeatherLayer.tsx"

/** Everything inside the Canvas. */
export function Scene() {
  return (
    <Quality>
      <Clock />
      <ReleaseLater />
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
        <WorldReady />
        {/* Showcase: mounts with the world, then lifts the title card (guild/opening.ts). */}
        {MODE === "showcase" && <OpeningCue />}
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

/** Drives the guild's clock from the render loop (first, FRAME.SIM); long frames are capped. */
function Clock() {
  const store = useGuildStore()
  useFrame((_, delta) => store.tick(Math.min(delta, 0.1) * 1000), FRAME.SIM)
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

/**
 * Mounts in the same commit as the island (inside its Suspense): the world is built, so the
 * store may start notifying again (GuildStore.hold). A safety release after 20 s keeps the HUD
 * alive even if the world can't load.
 */
function WorldReady() {
  const store = useGuildStore()
  useEffect(() => store.release(), [store])
  return null
}

/** The safety release for GuildStore.hold, outside the world's Suspense. */
function ReleaseLater() {
  const store = useGuildStore()
  useEffect(() => {
    const timer = setTimeout(() => store.release(), 20_000)
    return () => clearTimeout(timer)
  }, [store])
  return null
}
