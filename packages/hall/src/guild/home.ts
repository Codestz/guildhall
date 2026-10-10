import { useSyncExternalStore } from "react"
import { MODE } from "./mode.ts"

/**
 * The showcase's home (`/`, no params): React as an archipelago, opened by a ~20 s cut of its growth
 * film (guild/homeShow.ts drives it). This module is its state and its link rules; nothing here
 * touches the scene.
 *
 *   film     the cut of React's growth plays on its island
 *   swap     the film is over (or there is none): on to the packages, the loader up
 *   invite   settled in the archipelago: the card asks for the viewer's repo
 *   off      not the home (a link asked for something else), or the card is dismissed
 */
export type HomePhase = "film" | "swap" | "invite" | "off"

export const HOME_REPO = "facebook/react"

/** Link params that leave the home as it is: the viewer's own (`gen=1`, `split=0`), or pure noise. */
const KEPT = new Set(["showcase", "gen", "split", "quality", "hud", "fbclid"])

export interface HomeLink {
  /** The repo's packages follow the film as an archipelago; false (`split=0`): it stays the one island. */
  split: boolean
  /** The film plays: not with reduced motion (`reduced`), which opens straight on the packages. */
  film: boolean
}

/**
 * What the home does for this link, or null when the link asks for something else (a story, a repo,
 * the labs…: they open as they always did).
 */
export function homeOf(search: string, reduced: boolean, mode = MODE): HomeLink | null {
  if (mode !== "showcase") return null
  const params = new URLSearchParams(search)
  for (const key of params.keys()) if (!KEPT.has(key) && !key.startsWith("utm_")) return null
  const split = (params.get("split") ?? "").toLowerCase()
  return { split: split !== "0" && split !== "false", film: !reduced }
}

type Listener = () => void

class HomeState {
  phase: HomePhase = "off"
  private listeners = new Set<Listener>()
  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  /** The home is on stage (its film, its swap or its card). */
  get active(): boolean {
    return this.phase !== "off"
  }
  set(phase: HomePhase): void {
    if (phase === this.phase) return
    this.phase = phase
    for (const listener of this.listeners) listener()
  }
}

export const home = new HomeState()

export function useHome(): HomePhase {
  return useSyncExternalStore(home.subscribe, () => home.phase)
}
