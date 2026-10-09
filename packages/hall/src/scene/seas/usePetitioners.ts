import { useRef } from "react"
import { CAPS, docketAt } from "../../guild/docket.ts"
import { petitionersOf } from "../../guild/petitions.ts"
import { quality } from "../../guild/quality.ts"
import { useGuild } from "../../guild/useGuild.ts"
import type { AdventurerView } from "../../guild/views.ts"
import { useWorld } from "../../world/source.ts"

const NONE: readonly AdventurerView[] = []

/**
 * The petitioners now at the quay (guild/petitions.ts) as views for the cast: the docket's open
 * issues, as the store's sea and run time say. The cast re-renders with the store (about ten times
 * a second), which is all the pace a queue needs; a view whose figure did not change is handed back
 * as the very same object, so only the petitioners that did re-render.
 */
export function usePetitioners(): readonly AdventurerView[] {
  const store = useGuild()
  const world = useWorld()
  const kept = useRef(new Map<string, AdventurerView>())
  if (store.sea.length === 0) {
    kept.current.clear()
    return NONE
  }
  const docket = docketAt(store.sea, store.time, CAPS[quality.tier])
  const views = petitionersOf(docket, store.time, world, store.names, kept.current)
  kept.current = new Map(views.map((view) => [view.id, view]))
  return views
}
