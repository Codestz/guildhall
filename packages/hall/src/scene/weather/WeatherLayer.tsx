import { Suspense } from "react"
import { useTier } from "../Quality.tsx"
import { Clouds } from "./Clouds.tsx"
import { Lightning } from "./Lightning.tsx"
import { Precipitation } from "./Precipitation.tsx"

/**
 * Weather (ADR 0007): clouds, rain, snow and storm flashes, all read per frame from the store's
 * `environment` (no re-renders). Five draw calls at most: clouds 2 (Explore view only; the Diorama sees cloud shadows, drawn by the grade), rain 1, snow 1 (only one of
 * the two is ever on), lightning 0. Counts scale with the quality tier.
 */
export function WeatherLayer() {
  const tier = useTier()
  return (
    <>
      <Suspense fallback={null}>
        <Clouds tier={tier} />
      </Suspense>
      <Precipitation tier={tier} />
      <Lightning />
    </>
  )
}
