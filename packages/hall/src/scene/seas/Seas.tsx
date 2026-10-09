import { lazy, Suspense } from "react"
import { useGuild } from "../../guild/useGuild.ts"
import { DocketChips } from "./DocketChips.tsx"

/** The sea's code and its pieces (seas.glb) load on first need: a guild without a GitHub sea pays nothing. */
const SeasLayer = lazy(() => import("./SeasLayer.tsx"))

/**
 * The guild's GitHub sea (PROTOCOL.md §7, scene/seas/fleet.ts): ships for pushes, pull requests and
 * releases, a lighthouse for CI, and the docket's piles of open work as chips (the issues' figures
 * are the cast's: scene/Scene.tsx). Nothing at all until the store has a sea event.
 */
export function Seas() {
  const store = useGuild()
  if (store.sea.length === 0) return null
  return (
    <>
      <Suspense fallback={null}>
        <SeasLayer />
      </Suspense>
      <DocketChips />
    </>
  )
}
