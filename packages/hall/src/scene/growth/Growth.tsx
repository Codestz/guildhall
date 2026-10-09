import { lazy, Suspense, useSyncExternalStore } from "react"
import { PROBE } from "../../guild/mode.ts"
import { growing, growParam, growth } from "../../world/chronicle/growthControl.ts"

/** The film's layer: its own chunk, fetched the first time a film is asked. */
const GrowthLayer = lazy(() => import("./GrowthLayer.tsx"))

// A link's `?grow` (with `?repo=`) asks for the film as the hall loads (ADR 0021).
if (typeof location !== "undefined") {
  const asked = growParam(location.search)
  const repo = new URLSearchParams(location.search).get("repo")
  if (asked && repo) growth.request(repo, asked.start)
  // Probes: `growth.seek(30)`, `growth.pause()`, `growth.t` (scripts/probe.ts eval).
  if (PROBE) Object.assign(window, { growth })
}

/** True while a film holds the island (the scene hides what lives on today's island meanwhile). */
export function useGrowing(): boolean {
  return useSyncExternalStore(growth.subscribe, growing)
}

/**
 * The growth timelapse's place in the scene (`?grow`, ADR 0021): nothing at all until a film is
 * asked (the repo legend's "Watch it grow", the repo door, or the link), then its lazy layer.
 */
export function Growth() {
  if (!useGrowing()) return null
  return (
    <Suspense fallback={null}>
      <GrowthLayer />
    </Suspense>
  )
}
