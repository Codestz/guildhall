import { useSyncExternalStore } from "react"
import { HOME, type Stop } from "../world/islandRing.ts"
import type { Spot } from "../world/layout.ts"

/**
 * Where the viewer asked the camera to be in an archipelago (world/archipelagoSource.ts): the home
 * island, a far island, or the map of them all. The HUD's switcher and keys, the map's labels and a
 * followed adventurer's crossing ask; scene/CameraRig.tsx flies there. Module state, like
 * guild/opening.ts: one camera, one request at a time, each numbered so a repeat is a new trip.
 */
export interface IslandView {
  stop: Stop
  /** Counts requests: the rig flies once per new `n`. */
  n: number
  /** Go there at once (a deep link's `island=`). */
  cut: boolean
  /** Only note where the camera already is (the Bard took it home): no trip at all. */
  quiet: boolean
  /**
   * Fly to this spot on the stop's island instead of the island's overview, close in, and keep
   * following whoever is followed: the one case where a trip leaves the pick be.
   */
  at?: Spot
}

type Listener = () => void
const listeners = new Set<Listener>()
let view: IslandView = { stop: HOME, n: 0, cut: false, quiet: false }

export const islandView = {
  get(): IslandView {
    return view
  },
  go(stop: Stop, options: { cut?: boolean; quiet?: boolean; at?: Spot } = {}): void {
    view = {
      stop,
      n: view.n + 1,
      cut: options.cut ?? false,
      quiet: options.quiet ?? false,
      ...(options.at ? { at: options.at } : {}),
    }
    for (const listener of listeners) listener()
  },
  /** A link's `island=`: start there, the camera cut to it (home is where it starts anyway). */
  start(stop: Stop): void {
    if (stop !== HOME) this.go(stop, { cut: true })
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

export function useIslandView(): IslandView {
  return useSyncExternalStore(islandView.subscribe, islandView.get)
}
