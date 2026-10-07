import { useFrame } from "@react-three/fiber"
import { type ComponentType, lazy, Suspense, useEffect, useRef, useSyncExternalStore } from "react"
import { audio } from "../../audio/engine.ts"
import { type EventKind, type Show, type WorldEvents, worldEventsOf } from "../../guild/events.ts"
import { PROBE } from "../../guild/mode.ts"
import { frameStats } from "../../guild/stats.ts"
import { proclaim } from "../../guild/story.ts"
import { useGuildStore } from "../../guild/useGuild.ts"
import { sky } from "../atmosphere/state.ts"
import { FRAME } from "../frame.ts"
import { NIGHT_AT } from "./common.ts"
import { type EventLook, hintCamera } from "./hint.ts"

/**
 * Secret world events on stage (guild/events.ts). Idle, this is one component and a 4 Hz check:
 * no geometry, no material, no draw call. Each event's scene code is its own chunk, fetched by a
 * dynamic import the first time that event plays (React.lazy), built on mount and freed on unmount
 * (scene/owned.ts). Ships reuse ships.glb, already loaded for the sea's traffic.
 *
 * As a show starts it is told (a renown caption through guild/story.ts), sounded (the audio
 * engine's renown motif, muted and capped like every cue) and pointed at (a focus hint for
 * Director v2, scene/events/hint.ts).
 *
 * PROBE: `window.worldEvents.force(kind)` starts any event now; `.dismiss(kind)` sends a lasting
 * one home; `.shows` lists what is on stage (scripts/shot.ts).
 */

export interface ShowProps {
  show: Show
  events: WorldEvents
}

const SCENES: Record<EventKind, ComponentType<ShowProps>> = {
  festival: lazy(() => import("./Festival.tsx")),
  "ghost-ship": lazy(() => import("./GhostShip.tsx")),
  rainbow: lazy(() => import("./Rainbow.tsx")),
  raid: lazy(() => import("./Raid.tsx")),
  comet: lazy(() => import("./Comet.tsx")),
  dragon: lazy(() => import("./Dragon.tsx")),
}

/**
 * Where the Director should look when each event starts (scene/events/hint.ts). The sky events aim
 * up (`y`): the dragon circles ~34 over the peaks, the rainbow's arc and the meteors are high above.
 */
const LOOK: Record<EventKind, EventLook> = {
  festival: { x: 0, z: 28, radius: 16, weight: 8, ttl: 14_000, shot: "medium" },
  "ghost-ship": { x: -108, z: 70, radius: 30, weight: 8, ttl: 16_000, shot: "establishing" },
  rainbow: { x: 0, z: 0, y: 50, radius: 60, weight: 6, ttl: 10_000, shot: "establishing" },
  raid: { x: 30, z: 96, radius: 22, weight: 7, ttl: 14_000, shot: "medium" },
  comet: { x: 0, z: 0, y: 45, radius: 60, weight: 5, ttl: 8_000, shot: "establishing" },
  dragon: { x: 2, z: -58, y: 30, radius: 34, weight: 8, ttl: 14_000, shot: "establishing" },
}
/** By night the festival is fireworks over the keep: the square below, the bursts above it, held longer. */
const FESTIVAL_NIGHT: EventLook = { x: 0, z: 28, y: 24, radius: 26, weight: 8, ttl: 20_000, shot: "medium" }

const TICK_S = 0.25

export function EventsLayer() {
  const store = useGuildStore()
  const events = worldEventsOf(store)
  useSyncExternalStore(events.subscribe, events.snapshot)
  const since = useRef(0)

  useEffect(() => {
    const off = events.onStart((show) => {
      proclaim(store.moments, show.renown)
      audio.renown(show.kind)
      // Read as Festival.tsx reads it when the show mounts: fireworks by night, confetti by day.
      const night = show.kind === "festival" && sky.night > NIGHT_AT
      hintCamera(store, night ? FESTIVAL_NIGHT : LOOK[show.kind], show.kind)
    })
    if (PROBE)
      Object.assign(window, {
        worldEvents: {
          events,
          force: (kind: EventKind) => events.force(kind).id,
          dismiss: (kind: EventKind) => events.dismiss(kind),
          /** End every show now (unmounts and frees them): for A/B measurements. */
          clear: () => {
            for (const show of [...events.shows]) events.done(show.id)
          },
          stats: frameStats,
          get shows() {
            return events.shows.map((s) => ({ id: s.id, kind: s.kind, leaving: s.leaving }))
          },
          get earned() {
            return events.ledger.earned.map((r) => r.key)
          },
        },
      })
    return off
  }, [events, store])

  useFrame((_, delta) => {
    since.current += delta
    if (since.current < TICK_S) return
    since.current = 0
    events.tick(store.moments)
  }, FRAME.WORLD)

  return (
    <>
      {events.shows.map((show) => {
        const Scene = SCENES[show.kind]
        return (
          <Suspense key={show.id} fallback={null}>
            <Scene show={show} events={events} />
          </Suspense>
        )
      })}
    </>
  )
}
