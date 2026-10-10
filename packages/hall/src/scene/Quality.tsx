import { PerformanceMonitor } from "@react-three/drei"
import { useThree } from "@react-three/fiber"
import { type ReactNode, useEffect, useSyncExternalStore } from "react"
import { quality, TIERS, type Tier } from "../guild/quality.ts"

/** The current quality tier, re-rendering the caller when it changes. */
export function useTier(): Tier {
  return useSyncExternalStore(quality.subscribe, quality.snapshot)
}

/**
 * Watches the frame rate and steps quality down when it sags, up when there is headroom.
 * Bounds are relative to the display's refresh rate, so a 120 Hz screen isn't "slow" at 70 fps.
 * After three flip-flops it settles on the lower tier for good (`onFallback`).
 */
export function Quality({ children }: { children: ReactNode }) {
  const tier = useTier()
  const gl = useThree((state) => state.gl)
  const setDpr = useThree((state) => state.setDpr)
  const advance = useThree((state) => state.advance)

  useEffect(() => {
    const dpr = Math.min(window.devicePixelRatio, TIERS[tier].dpr)
    if (gl.getPixelRatio() === dpr) return
    setDpr(dpr)
    // A new pixel ratio resizes the canvas, which clears it, and this runs after the frame's own
    // draw (a state change in a frame callback is committed right after it): left to the next
    // frame the page would show the cleared canvas, a flash. Draw now, before anything is shown.
    advance(performance.now(), false)
  }, [tier, gl, setDpr, advance])

  return (
    <PerformanceMonitor
      bounds={(refresh) => [refresh * 0.75, refresh * 0.95]}
      flipflops={3}
      onDecline={() => quality.down()}
      onIncline={() => quality.up()}
      onFallback={() => {
        if (quality.auto) quality.set(Math.min(quality.tier, 1) as Tier)
      }}
    >
      {children}
    </PerformanceMonitor>
  )
}
