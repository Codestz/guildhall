import { type PointerEvent, useEffect, useRef } from "react"
import { islandView, useIslandView } from "../guild/islandView.ts"
import { reducedMotion } from "../guild/opening.ts"
import { archipelagoSource } from "../world/archipelagoSource.ts"
import { HOME, islandParam, neighbour, placesOf, ringOf, type Stop } from "../world/islandRing.ts"

/**
 * Travelling between an archipelago's islands, from the keyboard, the URL and the screen (the
 * switcher chip is hud/Islands.tsx; the camera's flight is scene/archipelago/flight.ts). Nothing
 * without an archipelago.
 */

/** Fly to the island `step` along the ring from the current one (home, then the others clockwise round it). */
export function hop(step: 1 | -1): void {
  const archipelago = archipelagoSource.archipelago
  if (!archipelago) return
  const to = neighbour(ringOf(placesOf(archipelago)), islandView.get().stop, step)
  if (to !== undefined) islandView.go(to)
}

/**
 * The travel keys, listened to whatever the HUD shows (the hidden HUD too): M the map (back from
 * it to where you were), 0 home, 1–6 the far islands, [ and ] — or ← and → — the previous and next
 * island round the ring.
 */
export function IslandKeys() {
  const before = useRef<Stop>(HOME)
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const archipelago = archipelagoSource.archipelago
      if (!archipelago || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target
      if (target instanceof HTMLElement && /input|textarea|select/i.test(target.tagName)) return
      // A modal (the Legends, the repo door) keeps its keys to itself.
      if (target instanceof HTMLElement && target.closest('[aria-modal="true"]')) return
      const now = islandView.get().stop
      if (event.key === "m" || event.key === "M") {
        if (now === "map") islandView.go(before.current)
        else {
          before.current = now
          islandView.go("map")
        }
        return
      }
      if (event.key === "]" || event.key === "ArrowRight") {
        event.preventDefault()
        return hop(1)
      }
      if (event.key === "[" || event.key === "ArrowLeft") {
        event.preventDefault()
        return hop(-1)
      }
      if (!/^[0-9]$/.test(event.key)) return
      const n = Number(event.key)
      if (n === 0) islandView.go(HOME)
      else if (n <= archipelago.islands.length) islandView.go(n - 1)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
  return null
}

/**
 * Keeps the address in step with where the camera is (`island=`, world/archipelagoLink.ts), without
 * a history entry: a copied link opens on the island you are looking at. Home is the link's default.
 */
export function IslandUrl() {
  useEffect(
    () =>
      islandView.subscribe(() => {
        const archipelago = archipelagoSource.archipelago
        if (!archipelago) return
        const param = islandParam(islandView.get().stop, archipelago)
        const url = new URL(location.href)
        if ((url.searchParams.get("island") ?? null) === param) return
        if (param === null) url.searchParams.delete("island")
        else url.searchParams.set("island", param)
        try {
          history.replaceState(history.state, "", url)
        } catch {}
      }),
    [],
  )
  return null
}

/** With reduced motion a trip is a cut under a quick cross-fade (scene/archipelago/flight.ts): the veil. */
export function TravelFade() {
  const view = useIslandView()
  if (view.n === 0 || view.quiet || view.cut || !reducedMotion()) return null
  return <div key={view.n} className="travel-fade" aria-hidden="true" />
}

/** Swipe distance (px) that hops an island on the chip. */
const SWIPE = 36

/**
 * Pointer handlers for a swipe along a chip: left hops to the next island, right to the previous.
 * `swiped()` says whether the gesture just ended was one, so the click after it can be ignored.
 */
export function useSwipe(): { handlers: Record<string, unknown>; swiped: () => boolean } {
  const start = useRef<number | null>(null)
  const did = useRef(false)
  return {
    handlers: {
      onPointerDown(event: PointerEvent) {
        start.current = event.clientX
        did.current = false
      },
      onPointerUp(event: PointerEvent) {
        if (start.current === null) return
        const dx = event.clientX - start.current
        start.current = null
        if (Math.abs(dx) < SWIPE) return
        did.current = true
        hop(dx < 0 ? 1 : -1)
      },
      onPointerCancel() {
        start.current = null
      },
    },
    swiped: () => did.current,
  }
}
