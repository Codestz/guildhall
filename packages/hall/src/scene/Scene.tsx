import { useFrame, useThree } from "@react-three/fiber"
import { Suspense, useCallback, useEffect, useReducer, useState } from "react"
import { SoundStage } from "../audio/SoundStage.tsx"
import { MODE, PROBE } from "../guild/mode.ts"
import type { AdventurerView } from "../guild/store.ts"
import { useGuild, useGuildStore } from "../guild/useGuild.ts"
import { Adventurer } from "./Adventurer.tsx"
import { Atmosphere } from "./atmosphere/Atmosphere.tsx"
import { Post } from "./atmosphere/Post.tsx"
import { shadows } from "./atmosphere/shadows.ts"
import { Blobs } from "./Blobs.tsx"
import { CameraRig } from "./CameraRig.tsx"
import { Crisp } from "./Crisp.tsx"
import { EventsLayer } from "./events/EventsLayer.tsx"
import { Exits } from "./exits.ts"
import { FrameStats } from "./FrameStats.tsx"
import { FRAME } from "./frame.ts"
import { Graveyard } from "./Graveyard.tsx"
import { Island } from "./Island.tsx"
import { Life } from "./life/Life.tsx"
import { NearLights } from "./lights/NearLights.tsx"
import { NightLife } from "./lights/NightLife.tsx"
import { StreetLights } from "./lights/StreetLights.tsx"
import { Nature } from "./nature/Nature.tsx"
import { OpeningCue } from "./OpeningCue.tsx"
import { Quality } from "./Quality.tsx"
import { Room } from "./Room.tsx"
import { Ships } from "./Ships.tsx"
import { Sigils } from "./Sigils.tsx"
import { Stations } from "./Stations.tsx"
import { stepFrame } from "./step.ts"
import { UndeadGate } from "./Undead.tsx"
import { WeatherLayer } from "./weather/WeatherLayer.tsx"

/** Everything inside the Canvas. */
export function Scene() {
  return (
    <Quality>
      <Clock />
      <ReleaseLater />
      <Crisp />
      <FrameStats />
      {/* Sound: moments and a 10 Hz sample of the world; never renders (audio/README.md). */}
      <SoundStage />
      {PROBE && <DevBridge />}
      <Atmosphere />
      <Suspense fallback={null}>
        <Island />
        <Graveyard />
        {/* Lazy: the skeletons load on first need, under their own Suspense (scene/Undead.tsx). */}
        <UndeadGate />
        <StreetLights />
        <NearLights />
        <NightLife />
        <Nature />
        <Life />
        <Room />
        <Stations />
        <Cast />
        <Blobs />
        {/* What everyone is doing, as an icon over their head: readable with the HUD hidden. */}
        <Sigils />
        <WorldReady />
        {/* Showcase: mounts with the world, then lifts the title card (guild/opening.ts). */}
        {MODE === "showcase" && <OpeningCue />}
      </Suspense>
      {/* Ships: their own Suspense, so the sea's traffic never holds up the island. */}
      <Suspense fallback={null}>
        <Ships />
      </Suspense>
      {/* Secret world events (guild/events.ts): nothing when idle; each event's code loads on first need. */}
      <EventsLayer />
      <WeatherLayer />
      <CameraRig />
      <Post />
    </Quality>
  )
}

/**
 * Everyone on stage. A leaver the store has let go of stays mounted until their dissolve is done
 * (scene/exits.ts): fast-forward never cuts one off mid-walk.
 */
function Cast() {
  const store = useGuild()
  const [exits] = useState(() => new Exits<AdventurerView>())
  const [, redraw] = useReducer((n: number) => n + 1, 0)
  const onGone = useCallback(
    (id: string) => {
      if (exits.gone(id)) redraw()
    },
    [exits],
  )
  const views = exits.stage(store.views, store.rebuilds, performance.now())
  return (
    <>
      {views.map((view) => (
        <Suspense key={view.id} fallback={null}>
          <Adventurer view={view} onGone={onGone} />
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

/**
 * Dev only: lets automation step frames by hand when the tab is hidden (rAF paused). `step(dt)`
 * draws the next frame exactly `dt` s later (frameloop "never"): scripts/record.ts films with it.
 */
function DevBridge() {
  const advance = useThree((state) => state.advance)
  const clock = useThree((state) => state.clock)
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const setDpr = useThree((state) => state.setDpr)
  const setFrameloop = useThree((state) => state.setFrameloop)
  useEffect(() => {
    // setFrameloop("never") + advance(t) at one timestamp: the same instant re-drawn under two
    // settings, for pixel-identical A/B crops (docs/perf-budget.md).
    const step = (dt: number) => stepFrame(clock, advance, dt)
    Object.assign(window, { r3f: { advance, gl, scene, setDpr, setFrameloop, shadows, step } })
  }, [advance, clock, gl, scene, setDpr, setFrameloop])
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
