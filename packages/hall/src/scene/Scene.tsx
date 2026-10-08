import { useGLTF } from "@react-three/drei"
import { useFrame, useThree } from "@react-three/fiber"
import { Suspense, use, useCallback, useEffect, useMemo, useReducer, useState } from "react"
import type { Object3D } from "three"
import { SoundStage } from "../audio/SoundStage.tsx"
import { MODE, PROBE } from "../guild/mode.ts"
import type { AdventurerView } from "../guild/store.ts"
import { useGuild, useGuildStore } from "../guild/useGuild.ts"
import { ANIMS_URL, MODELS, modelUrl } from "../world/cast.ts"
import { useWorld } from "../world/source.ts"
import { Adventurer, lookFrom } from "./Adventurer.tsx"
import { Atmosphere } from "./atmosphere/Atmosphere.tsx"
import { Post } from "./atmosphere/Post.tsx"
import { shadows } from "./atmosphere/shadows.ts"
import { Blobs } from "./Blobs.tsx"
import { CameraRig } from "./CameraRig.tsx"
import { Crisp } from "./Crisp.tsx"
import { declutter } from "./chips.ts"
import { castClock, castCrowd } from "./crowd/cast.ts"
import { ALL_HEROES } from "./crowd/lod.ts"
import { GLSL_SHADING, nodeShading, wantsNodes } from "./crowd/material.ts"
import { DeedEffects } from "./DeedEffect.tsx"
import { EventsLayer } from "./events/EventsLayer.tsx"
import { Exits } from "./exits.ts"
import { FrameStats } from "./FrameStats.tsx"
import { FRAME } from "./frame.ts"
import { Graveyard } from "./Graveyard.tsx"
import { Island } from "./Island.tsx"
import { Life } from "./life/Life.tsx"
import { AFTER_POSE } from "./lights/carried.ts"
import { NearLights } from "./lights/NearLights.tsx"
import { NightLife } from "./lights/NightLife.tsx"
import { StreetLights } from "./lights/StreetLights.tsx"
import { Nature } from "./nature/Nature.tsx"
import { OpeningCue } from "./OpeningCue.tsx"
import { Quality } from "./Quality.tsx"
import { Rings } from "./Rings.tsx"
import { Room } from "./Room.tsx"
import { Ships } from "./Ships.tsx"
import { Sigils } from "./Sigils.tsx"
import { Stations } from "./Stations.tsx"
import { stepFrame } from "./step.ts"
import { UndeadGate } from "./Undead.tsx"
import { WeatherLayer } from "./weather/WeatherLayer.tsx"

/**
 * Everything inside the Canvas. A repo's island (`?repo=`, world/source.ts) has the keep at the
 * origin like the hand map, and the story's sites mapped onto its districts (world/siteMap.ts), so
 * the guild works there as on the hand map; only the graveyard (and the undead it raises) is the
 * hand map's own.
 */
export function Scene() {
  const hand = useWorld().kind === "hand"
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
        {hand && (
          <>
            <Graveyard />
            {/* Lazy: the skeletons load on first need, under their own Suspense (scene/Undead.tsx). */}
            <UndeadGate />
          </>
        )}
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
 * (scene/exits.ts): fast-forward never cuts one off mid-walk. Each figure is memoised: what it reads
 * off the store is passed down as plain values, so a refresh re-renders only those that changed.
 * Their rings and deed motes are drawn together (one instanced layer each). Models are preloaded
 * (scene/Adventurer.tsx), so one Suspense boundary holds the whole cast.
 *
 * Past ALL_HEROES adventurers the cast has a baked crowd (scene/crowd/): whoever the camera isn't
 * close to joins it, one draw per model part for all of them (scene/crowd/lod.ts). At or under it —
 * every story the hall ships — there is no crowd at all and everyone draws as they always did.
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
  const crowd = useCrowd(views.length > ALL_HEROES)
  // The camera's view, once a frame, before any adventurer reads it (mixer culling, who is a hero).
  // One frustum and one declutter run (throttled in chips.ts) for the whole cast, not one per adventurer.
  useFrame((state, delta) => {
    castClock.now += delta
    if (crowd) crowd.time = castClock.now
    lookFrom(state.camera, state.size.height)
    declutter(state.camera, state.size.width, state.size.height)
  }, FRAME.SKY)
  // Every member written (the figures, at WORLD): each takes its mesh level, the slots go up once.
  useFrame((state) => crowd?.flush(state.camera, state.size.height), AFTER_POSE)
  const banners = store.parties.length > 1
  const dark = store.environment.daylight < 0.3
  return (
    <Suspense fallback={null}>
      {views.map((view) => (
        <Adventurer
          key={view.id}
          view={view}
          onGone={onGone}
          selected={store.selected === view.id}
          following={store.following}
          banners={banners}
          dark={dark}
          crowd={crowd}
        />
      ))}
      {crowd && <primitive object={crowd.root} />}
      <Rings />
      <DeedEffects />
    </Suspense>
  )
}

/**
 * The cast's baked crowd while `wanted` (made on first want, kept after: crowd/cast.ts), else null.
 * Every model is preloaded (scene/Adventurer.tsx), so reading them here never suspends for long.
 * On WebGPU (or `?tsl=1`) it suspends once more, first time wanted, for the node materials.
 */
function useCrowd(wanted: boolean) {
  const { animations } = useGLTF(ANIMS_URL)
  const scenes = useGLTF(MODELS.map(modelUrl))
  const gl = useThree((state) => state.gl)
  const shading = wanted && wantsNodes(gl) ? use(nodeShading(gl)) : GLSL_SHADING
  return useMemo(() => {
    if (!wanted) return null
    const models: Record<string, Object3D> = {}
    MODELS.forEach((model, i) => {
      const loaded = scenes[i]
      if (loaded) models[model] = loaded.scene
    })
    return castCrowd(animations, models, shading)
  }, [wanted, animations, scenes, shading])
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
