import { lazy, Suspense } from "react"
import { useGuild } from "../../guild/useGuild.ts"

/** The sea's code and its pieces (seas.glb) load on first need: a guild without a GitHub sea pays nothing. */
const SeasLayer = lazy(() => import("./SeasLayer.tsx"))

/**
 * The guild's GitHub sea (PROTOCOL.md §7, scene/seas/fleet.ts): ships for pushes, pull requests and
 * releases, and a lighthouse for CI. Nothing at all until the store has a sea event.
 */
export function Seas() {
  const store = useGuild()
  if (store.sea.length === 0) return null
  return (
    <Suspense fallback={null}>
      <SeasLayer />
    </Suspense>
  )
}
