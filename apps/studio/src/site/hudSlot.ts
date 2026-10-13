/**
 * The hall HUD's bottom-centre slot (the Viewer's `hud.bottom`), handed from the island's world to the
 * site's pieces: the hall's timeline bar is drawn there (`createPortal(<HallTimeline …/>, slot)`), so it
 * sits in the HUD's layout (clear of the Chronicle and the sheet, hidden with the HUD, under the
 * loading cover). Null off a hall, and until its island is built.
 */
import { useSyncExternalStore } from "react"

let slot: HTMLElement | null = null
const fns = new Set<() => void>()

export function setHudBottom(next: HTMLElement | null): void {
  if (next === slot) return
  slot = next
  for (const fn of fns) fn()
}

export const hudBottom = (): HTMLElement | null => slot

/** The slot, as a hook: re-renders when a hall's island comes up or goes. */
export function useHudBottom(): HTMLElement | null {
  return useSyncExternalStore((fn) => {
    fns.add(fn)
    return () => fns.delete(fn)
  }, hudBottom)
}
