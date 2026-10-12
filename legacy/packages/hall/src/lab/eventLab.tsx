import { OrbitControls } from "@react-three/drei"
import { Canvas, useThree } from "@react-three/fiber"
import { type ComponentType, lazy, Suspense, useEffect, useSyncExternalStore } from "react"
import { createRoot } from "react-dom/client"
import { EVENT_KINDS, type EventKind, worldEventsOf } from "../guild/events.ts"
import { GuildStore } from "../guild/store.ts"
import { requestedBackend } from "../render/backend.ts"
import { glFor } from "../render/renderer.ts"
import { sky } from "../scene/atmosphere/state.ts"
import type { ShowProps } from "../scene/events/EventsLayer.tsx"

/**
 * The event lab (dev only, `?lab=event&kind=dragon&night=1`): one world event alone over a flat sea,
 * forced again each time it ends, without the island. `night=1` plays it by night (fireworks,
 * shooting stars). Drag to orbit. `window.lab.play(kind)` switches in place.
 */

/**
 * Each event's scene, loaded on first need like EventsLayer loads them. Found by a glob (the file
 * named after the kind: ghost-ship → GhostShip.tsx), never imported by name: the events test holds
 * that nothing outside the layer imports an event scene directly.
 */
const FILES = import.meta.glob<{ default: ComponentType<ShowProps> }>("../scene/events/*.tsx")
const fileOf = (kind: EventKind): string =>
  `../scene/events/${kind
    .split("-")
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join("")}.tsx`
const SCENES = {} as Record<EventKind, ComponentType<ShowProps>>
for (const kind of EVENT_KINDS) {
  const load = FILES[fileOf(kind)]
  SCENES[kind] = lazy(load ?? (() => Promise.reject(new Error(`no scene file for ${kind}`))))
}

/** Where to look for each, and from how far: the director's own marks (scene/events/EventsLayer.tsx LOOK). */
const AIM: Record<EventKind, { at: [number, number, number]; distance: number }> = {
  festival: { at: [0, 4, 28], distance: 60 },
  "ghost-ship": { at: [-108, 2, 70], distance: 90 },
  rainbow: { at: [0, 30, 0], distance: 230 },
  raid: { at: [30, 2, 96], distance: 70 },
  comet: { at: [0, 45, 0], distance: 200 },
  dragon: { at: [2, 30, -58], distance: 110 },
}

export function start(root: HTMLElement, params: URLSearchParams): void {
  const night = params.get("night") === "1"
  sky.night = night ? 1 : 0
  sky.lamps = night ? 1 : 0.1
  const store = new GuildStore()
  const events = worldEventsOf(store)
  const asked = params.get("kind") as EventKind | null
  let kind: EventKind = asked && EVENT_KINDS.includes(asked) ? asked : "dragon"
  const listeners = new Set<() => void>()
  const play = (next: EventKind): string => {
    if (!EVENT_KINDS.includes(next)) return `no event "${next}": ${EVENT_KINDS.join(", ")}`
    kind = next
    // Ending the old show re-forces `kind` (the listener below); force only if nothing was on.
    for (const show of [...events.shows]) events.done(show.id)
    if (!events.shows.some((show) => show.kind === kind)) events.force(kind)
    for (const listener of listeners) listener()
    return "ok"
  }
  play(kind)
  // A show that ends comes back: the lab always has one on stage.
  events.subscribe(() => {
    if (events.shows.length === 0) events.force(kind)
  })
  Object.assign(window, { lab: { play, kinds: () => [...EVENT_KINDS] } })
  const onKind = (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  function Lab() {
    useSyncExternalStore(events.subscribe, events.snapshot)
    useSyncExternalStore(onKind, () => kind)
    const aim = AIM[kind]
    useEffect(() => {
      document.title = `lab · ${kind}`
    })
    return (
      <Canvas
        key={kind}
        gl={glFor(requestedBackend(location.search))}
        camera={{
          position: [
            aim.at[0] + aim.distance * 0.6,
            aim.at[1] + aim.distance * 0.4,
            aim.at[2] + aim.distance * 0.7,
          ],
          fov: 40,
          far: 3000,
        }}
        style={{ width: "100vw", height: "100vh", background: night ? "#0c1324" : "#9cc3e0" }}
        frameloop="demand"
      >
        <Sixty />
        <ambientLight intensity={night ? 0.35 : 1.2} />
        <directionalLight position={[40, 80, 30]} intensity={night ? 0.4 : 2.2} />
        <mesh rotation-x={-Math.PI / 2}>
          <planeGeometry args={[800, 800]} />
          <meshStandardMaterial color={night ? "#18324a" : "#3d7fa6"} />
        </mesh>
        <OrbitControls target={aim.at} makeDefault />
        <Suspense fallback={null}>
          {events.shows.map((show) => {
            const Scene = SCENES[show.kind]
            return <Scene key={show.id} show={show} events={events} />
          })}
        </Suspense>
      </Canvas>
    )
  }

  root.innerHTML = ""
  createRoot(root).render(<Lab />)
}

/**
 * Frames at 60 a second: probe Chrome is uncapped, and a scene this small would otherwise draw
 * thousands a second and starve screenshots (8 s each).
 */
function Sixty() {
  const invalidate = useThree((state) => state.invalidate)
  useEffect(() => {
    const timer = setInterval(() => invalidate(), 1000 / 60)
    return () => clearInterval(timer)
  }, [invalidate])
  return null
}
