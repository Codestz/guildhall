import { useSyncExternalStore } from "react"
import { MODE } from "./mode.ts"

/**
 * The showcase's directed opening, shared by the camera (scene) and the overlay (HUD):
 *
 *   card    the title card while the world loads; the camera holds its top-down start
 *   reveal  assets are in: the card dissolves and the camera sweeps into the establishing shot
 *   arrive  the camera has landed: the HUD fades in, the letterbox retracts (a short beat)
 *   landed  the normal hall
 *
 * The app (local install, dev) has no opening: it starts landed and nothing here changes it.
 */
export type OpeningStage = "card" | "reveal" | "arrive" | "landed"

export interface OpeningState {
  stage: OpeningStage
  /** Share of the world's assets loaded, 0..1, never moving backwards. */
  loaded: number
}

/** How long the HUD takes to fade in after the camera lands. */
const ARRIVE_MS = 900

let state: OpeningState = { stage: MODE === "showcase" ? "card" : "landed", loaded: 0 }
const listeners = new Set<() => void>()

function set(patch: Partial<OpeningState>): void {
  state = { ...state, ...patch }
  for (const listener of listeners) listener()
}

export const opening = {
  get: (): OpeningState => state,
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  progress(ratio: number): void {
    if (state.stage !== "card" || ratio <= state.loaded) return
    set({ loaded: Math.min(1, ratio) })
  },
  /** The world is loaded and drawn: dissolve the card, start the reveal. */
  begin(): void {
    if (state.stage === "card") set({ stage: "reveal", loaded: 1 })
  },
  /** The camera has landed on the establishing shot. */
  land(): void {
    if (state.stage !== "reveal") return
    set({ stage: "arrive" })
    setTimeout(() => set({ stage: "landed" }), ARRIVE_MS)
  },
}

export function useOpening(): OpeningState {
  return useSyncExternalStore(opening.subscribe, opening.get)
}

/** The viewer asked for less motion: the opening cuts instead of sweeping. */
export function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
}
