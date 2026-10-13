import type { FrameStats } from "@guildhall/core"

/** The renderer's per-frame counters that go into `FrameStats`. */
export interface FrameCounters {
  /** All passes. */
  calls: number
  tris: number
  /** The shadow-map passes; the main pass is the rest. */
  shadowCalls: number
  shadowTris: number
  geometries: number
  textures: number
}

export const NO_COUNTERS: FrameCounters = {
  calls: 0,
  tris: 0,
  shadowCalls: 0,
  shadowTris: 0,
  geometries: 0,
  textures: 0,
}

/** The p-th percentile (0..100) of some values, nearest-rank; 0 when there are none. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.ceil((Math.min(100, Math.max(0, p)) / 100) * sorted.length)
  return sorted[Math.max(0, rank - 1)] as number
}

const percentiles = (values: readonly number[]) => ({
  p50: percentile(values, 50),
  p95: percentile(values, 95),
})

/**
 * `FrameStats` for a stretch of frames: the gaps between them (`intervalMs`, which give the rate), the
 * work each one took (`costMs`), the last frame's counters split into main and shadow passes, and the
 * GPU and CPU split by pass when the stage's timing has it (timing.ts).
 */
export function summarize(
  intervalMs: readonly number[],
  costMs: readonly number[],
  counters: FrameCounters,
  dpr: number,
  timing?: { passes: Record<string, number>; cpu: Record<string, number> },
): FrameStats {
  const total = intervalMs.reduce((sum, ms) => sum + ms, 0)
  const { calls, tris, shadowCalls, shadowTris, geometries, textures } = counters
  return {
    fps: total > 0 ? (intervalMs.length * 1000) / total : 0,
    frameMs: percentiles(intervalMs),
    costMs: percentiles(costMs),
    calls,
    tris,
    mainCalls: calls - shadowCalls,
    mainTris: tris - shadowTris,
    shadowCalls,
    shadowTris,
    geometries,
    textures,
    dpr,
    ...(timing ? { passes: timing.passes, cpu: timing.cpu } : {}),
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
