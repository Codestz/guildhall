import type { Clock } from "three"

/**
 * PROBE only (scene/Scene.tsx's bridge, scripts/record.ts): one hand-stepped frame, exactly `dt`
 * seconds after the last, with the render loop set to frameloop "never".
 *
 * R3F's `advance(t)` measures a frame as `t − clock.elapsedTime`, but first lets a running clock
 * add its own real-time delta (performance.now() in ms against an `oldTime` it has just overwritten
 * with seconds). A first manual frame then came out tens of seconds negative, and the store's clock
 * (Math.min(delta, 0.1) per tick) went backwards into NaN. Stopping the clock once leaves
 * `elapsedTime` to the stepped timestamps alone: every frame is `dt`, on any machine.
 */
export function stepFrame(clock: Clock, advance: (timestamp: number) => void, dt: number): void {
  if (clock.running) clock.stop()
  advance(clock.elapsedTime + dt)
}
