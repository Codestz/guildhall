import { useFrame } from "@react-three/fiber"
import { lazy, Suspense, useEffect, useMemo, useRef } from "react"
import type { Group } from "three"
import { audio } from "../../audio/engine.ts"
import type { Show, WorldEvents } from "../../guild/events.ts"
import { FRAME } from "../frame.ts"

/** The hall's own festival (scene/events/Festival.tsx), only fetched when a release throws one. */
export const prefetchFestival = () => import("../events/Festival.tsx")
const Festival = lazy(prefetchFestival)

/** How long a release's festival stays up in the timelapse (film s), and how long it sinks away. */
export const BURST_S = 9
const SINK_S = 1.2

/**
 * A major release in the timelapse (ADR 0021): the hall's festival — bunting, lanterns, confetti
 * by day and fireworks by night — for a few seconds of film, then it sinks into the square like
 * everything else that goes. It is the event as the guild earns it, mounted on its own (never
 * through the scheduler: it isn't the guild's renown and doesn't enter the book).
 */
export function FestivalBurst({ id, age }: { id: number; age: () => number }) {
  const group = useRef<Group>(null)
  useEffect(() => audio.renown("festival"), [])
  const { show, events } = useMemo(() => {
    const show = {
      id: 10_000 + id,
      kind: "festival",
      started: performance.now(),
      leaving: false,
      forced: true,
    }
    // Festival calls `done` when its own animation ends; the burst is gone well before.
    return { show: show as unknown as Show, events: { done() {} } as unknown as WorldEvents }
  }, [id])

  useFrame(() => {
    const object = group.current
    if (!object) return
    object.scale.y = Math.max(0.001, Math.min(1, (BURST_S - age()) / SINK_S))
  }, FRAME.WORLD)

  return (
    <group ref={group}>
      <Suspense fallback={null}>
        <Festival show={show} events={events} />
      </Suspense>
    </group>
  )
}
