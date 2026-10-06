/**
 * Adaptive quality (docs/perf-budget.md): three tiers, stepped by drei's PerformanceMonitor from
 * the frame rate it measures. Every expensive knob reads the tier from here.
 */
export type Tier = 0 | 1 | 2

export const TIERS: Record<
  Tier,
  { name: string; dpr: number; post: boolean; tiltShift: boolean; shadowMap: number }
> = {
  0: { name: "Low", dpr: 1, post: false, tiltShift: false, shadowMap: 1024 },
  1: { name: "Medium", dpr: 1.5, post: true, tiltShift: false, shadowMap: 2048 },
  2: { name: "High", dpr: 2, post: true, tiltShift: true, shadowMap: 2048 },
}

/** Phones and small machines start at Medium; the monitor moves them from there. */
function startingTier(): Tier {
  if (typeof window === "undefined") return 2
  const coarse = window.matchMedia?.("(pointer: coarse)").matches
  const cores = navigator.hardwareConcurrency ?? 8
  return coarse || cores <= 4 ? 1 : 2
}

const listeners = new Set<() => void>()

export const quality = {
  tier: startingTier() as Tier,
  set(tier: Tier): void {
    if (tier === quality.tier) return
    quality.tier = tier
    for (const listener of listeners) listener()
  },
  up(): void {
    quality.set(Math.min(2, quality.tier + 1) as Tier)
  },
  down(): void {
    quality.set(Math.max(0, quality.tier - 1) as Tier)
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  snapshot(): Tier {
    return quality.tier
  },
}
