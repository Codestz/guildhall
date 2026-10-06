import { useFrame } from "@react-three/fiber"
import { useMemo, useRef } from "react"
import type { AmbientLight } from "three"
import { useGuildStore } from "../../guild/useGuild.ts"

/** A strike is seen this long after it happened (run time); later ones (a seek) stay dark. */
const FRESH_MS = 1000
const PEAK = 5

/**
 * Lightning: when `environment.lightningAt` names a new strike, the whole scene flashes — a bright
 * pulse and a weaker after-flicker — through one ambient light kept at zero otherwise (always
 * mounted, so no shader recompiles; no draw calls). The sky's own flash, if the Sky layer adds one,
 * can listen to the same `lightningAt`.
 */
export function Lightning() {
  const store = useGuildStore()
  const light = useRef<AmbientLight>(null)
  const state = useMemo(() => ({ seen: -1, age: Number.POSITIVE_INFINITY }), [])

  useFrame((_, delta) => {
    const at = store.environment.lightningAt
    if (at !== state.seen) {
      state.seen = at
      const late = store.time - at
      if (at >= 0 && late >= 0 && late < FRESH_MS) state.age = 0
    } else state.age += delta * 1000
    if (light.current) light.current.intensity = PEAK * flash(state.age)
  })

  return <ambientLight ref={light} color="#dfe8ff" intensity={0} />
}

/** A strike's brightness `ms` after it: a sharp flash, then a weaker flicker. */
function flash(ms: number): number {
  return pulse(ms, 0, 90) + 0.55 * pulse(ms, 160, 260)
}

function pulse(ms: number, from: number, to: number): number {
  if (ms < from || ms > to) return 0
  return Math.sin(((ms - from) / (to - from)) * Math.PI)
}
