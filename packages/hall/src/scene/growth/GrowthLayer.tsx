import { useFrame } from "@react-three/fiber"
import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { useGuildStore } from "../../guild/useGuild.ts"
import { growth } from "../../world/chronicle/growthControl.ts"
import { festivalAt } from "../../world/chronicle/growthStory.ts"
import { useWorld, useWorldStatus } from "../../world/source.ts"
import type { World } from "../../world/world.ts"
import { shadows } from "../atmosphere/shadows.ts"
import { Builders } from "./Builders.tsx"
import { GrowthDriver } from "./drive.ts"
import { BURST_S, FestivalBurst, prefetchFestival } from "./FestivalBurst.tsx"
import { filmFor, markAddress, startOf } from "./film.ts"
import { clearRiseMask, RiseWriter, riseMaskOf } from "./mask.ts"
import { useOrbit } from "./orbit.ts"
import { restoreGrowables, veilGrowables } from "./registry.ts"

/** Least time between two shadow-map redraws while land rises (the map is drawn on demand). */
const SHADOW_EVERY_S = 0.25

/**
 * The growth timelapse on stage (`?grow`, ADR 0010), mounted only while a film is asked
 * (scene/growth/Growth.tsx) and fetched as its own chunk. It loads the film once the repo's island
 * is in, then once a frame: advances the clock (world/chronicle/growthControl.ts), draws the frame
 * onto the island's own batches (drive.ts) and the water and grass mask (mask.ts), asks for a shadow
 * redraw now and then, flies the establishing orbit (orbit.ts), and puts up the scaffolds, tents
 * (Builders.tsx) and a release's festival (FestivalBurst.tsx). While it runs the story is paused and
 * the Bard is off; unmounting (the film ended or was closed) puts the island, the story and the
 * camera back as they were.
 */
export default function GrowthLayer() {
  const store = useGuildStore()
  const world = useWorld()
  const status = useWorldStatus()
  useSyncExternalStore(growth.subscribe, growth.snapshot)
  const film = growth.film
  const [driver, setDriver] = useState<{ driver: GrowthDriver; writer: RiseWriter } | null>(null)
  const [burst, setBurst] = useState(-1)
  const filmWorld = useRef<World | null>(null)
  const shadowAt = useRef(0)
  const taken = useOrbit(
    () => driver?.driver.frame,
    film?.plan.duration ?? 1,
    () => growth.phase === "playing" || growth.phase === "paused",
  )

  // Load the film once the island asked for is in; a failed island ends it.
  useEffect(() => {
    const repo = growth.repo
    if (growth.phase !== "waiting" || !repo) return
    if (status.state === "failed") return growth.fail(status.reason)
    if (world.kind !== "repo" || status.state !== "repo") return
    let live = true
    filmFor(repo, world).then(
      (made) => {
        if (!live) return
        if (typeof made === "string") return growth.fail(made)
        filmWorld.current = world
        const { t, paused } = startOf(made, growth.start)
        growth.ready(made, t, paused)
        markAddress(true)
      },
      (error: Error) => live && growth.fail(error.message),
    )
    return () => {
      live = false
    }
  }, [world, status])

  // Another island swapped in under a film: the film is over.
  useEffect(() => {
    if (filmWorld.current && world !== filmWorld.current) growth.stop()
  }, [world])

  // The story pauses and the Bard steps back for the film; both come back after (the Bard only if
  // the camera is still the film's: read at the end on purpose).
  // biome-ignore lint/correctness/useExhaustiveDependencies: `taken` is read when the film ends
  useEffect(() => {
    const pace = store.speed
    const bard = store.bard
    if (store.mode === "sim") store.setSpeed(0)
    store.setBard(false)
    veilGrowables()
    clearRiseMask()
    return () => {
      if (store.mode === "sim") store.setSpeed(pace)
      if (!taken.current) store.setBard(bard)
      markAddress(false)
    }
  }, [store])

  // A driver per film; letting it go puts every piece back as it was built.
  // biome-ignore lint/correctness/useExhaustiveDependencies: one driver per film (growth.film is not React state)
  useEffect(() => {
    if (!film) return
    setDriver({ driver: new GrowthDriver(film.plan), writer: new RiseWriter(film.plan, riseMaskOf(world)) })
    // A release's festival is its own chunk: fetched now, not in the frame it is first wanted.
    if (film.story.festivals.length > 0) void prefetchFestival()
    return () => {
      setDriver(null)
      restoreGrowables()
      shadows.request()
    }
  }, [film])

  useFrame((state, delta) => {
    growth.tick(delta)
    const live = growth.film
    if (!driver || !live || driver.driver.g !== live.plan) return
    const moved = driver.driver.apply(growth.t)
    driver.writer.write(driver.driver.frame.up, driver.driver.green)
    const now = state.clock.elapsedTime
    if (moved && Math.abs(now - shadowAt.current) > SHADOW_EVERY_S) {
      shadowAt.current = now
      shadows.request()
    }
    const showing = growth.phase === "playing" ? festivalAt(live.story, growth.t, BURST_S) : -1
    if (showing !== burst) setBurst(showing)
  }, -0.5)

  if (!driver || !film) return null
  return (
    <>
      <Builders driver={driver.driver} world={world} />
      {burst >= 0 && (
        <FestivalBurst key={burst} id={burst} age={() => growth.t - (film.story.festivals[burst] ?? 0)} />
      )}
    </>
  )
}
