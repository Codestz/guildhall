import { islandIndexOf } from "../world/archipelagoLink.ts"
import { archipelagoSource } from "../world/archipelagoSource.ts"
import { islandView } from "./islandView.ts"

/**
 * A link's `island=` (world/archipelagoLink.ts) in an archipelago whose islands arrive as they are
 * grown: the camera starts there as soon as it can. An island's name waits for the island (its stop
 * is its place in the archipelago's list, which only grows); "map" frames what is there at each
 * arrival, so the whole sea is held as the last island lands, unless the viewer has gone elsewhere.
 */
export function startOnIsland(wanted: string): () => void {
  let seen = 0
  let ours = -1
  const stop = archipelagoSource.subscribe(() => {
    const islands = archipelagoSource.archipelago?.islands ?? []
    if (islands.length === seen) return
    seen = islands.length
    const where = islandIndexOf(
      wanted,
      islands.map((island) => island.repo),
    )
    if (where === "map") {
      // Ours while nobody else has asked for a trip since: the first is a cut, the rest glide.
      if (ours >= 0 && islandView.get().n !== ours) return stop()
      islandView.go("map", { cut: ours < 0 })
      ours = islandView.get().n
    } else if (where !== undefined) {
      islandView.start(where)
      stop()
    }
  })
  return stop
}
