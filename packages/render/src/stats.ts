import type { FrameStats } from "@guildhall/core"

/** The renderer's per-frame counters that go into `FrameStats`. */
export interface FrameCounters {
  calls: number
  tris: number
  geometries: number
  textures: number
}

/** The p-th percentile (0..100) of some values, nearest-rank; 0 when there are none. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.ceil((Math.min(100, Math.max(0, p)) / 100) * sorted.length)
  return sorted[Math.max(0, rank - 1)] as number
}

/** Frame rate and frame-time percentiles of some frame times (ms), plus the counters, as `FrameStats`. */
export function summarize(frameMs: readonly number[], counters: FrameCounters, dpr: number): FrameStats {
  const total = frameMs.reduce((sum, ms) => sum + ms, 0)
  return {
    fps: total > 0 ? (frameMs.length * 1000) / total : 0,
    frameMs: { p50: percentile(frameMs, 50), p95: percentile(frameMs, 95) },
    ...counters,
    dpr,
  }
}

/** The last `capacity` frame times (ms), oldest overwritten first. */
export class FrameRing {
  private readonly times: number[] = []
  private next = 0

  constructor(private readonly capacity = 240) {}

  push(ms: number): void {
    if (this.times.length < this.capacity) this.times.push(ms)
    else this.times[this.next] = ms
    this.next = (this.next + 1) % this.capacity
  }

  values(): readonly number[] {
    return this.times
  }
}
