import { useSyncExternalStore } from "react"

/**
 * Whether the repo legend (hud/RepoLegend.tsx) is unfolded, remembered per browser and per form
 * factor: collapsed by default (a chip with the repo's name), the viewer's own choice wins once made.
 * Storage can be missing (private mode, blocked site data); the choice then lasts for the visit.
 */
const PHONE = "(max-width: 720px)"
const KEY = "guildhall.repoLegend"

const phone = () => typeof window !== "undefined" && window.matchMedia(PHONE).matches
const keyFor = () => `${KEY}.${phone() ? "phone" : "desktop"}`

let open = false
const listeners = new Set<() => void>()

function read(): boolean {
  try {
    return window.localStorage.getItem(keyFor()) === "open"
  } catch {
    return false
  }
}

if (typeof window !== "undefined") {
  open = read()
  // Crossing the phone breakpoint switches to that form factor's own choice.
  window.matchMedia(PHONE).addEventListener("change", () => {
    open = read()
    for (const listener of listeners) listener()
  })
}

export const repoPanel = {
  get: (): boolean => open,
  set(next: boolean): void {
    open = next
    try {
      window.localStorage.setItem(keyFor(), next ? "open" : "closed")
    } catch {
      // Unavailable storage: keep the choice in memory only.
    }
    for (const listener of listeners) listener()
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

export function useRepoPanel(): boolean {
  return useSyncExternalStore(repoPanel.subscribe, repoPanel.get, () => false)
}
