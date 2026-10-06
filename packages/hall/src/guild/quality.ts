/**
 * Quality (docs/perf-budget.md). Low / Medium / High are adaptive: with the viewer's choice on
 * "auto", drei's PerformanceMonitor steps between them from the frame rate it measures. Ultra
 * (tilt-shift miniature look, full Retina density, ambient occlusion) is opt-in only — auto never
 * picks it. Pinning any tier in Settings turns the monitor off and is remembered.
 */
export type Tier = 0 | 1 | 2 | 3
export type QualityChoice = "auto" | Tier

export const TIERS: Record<
  Tier,
  {
    name: string
    dpr: number
    post: boolean
    tiltShift: boolean
    shadowMap: number
    /** Ambient occlusion (N8AO): off, at half resolution, or full. Needs `post`. Off everywhere
     * for the 120 fps budget (it re-renders the scene); kept for a future Ultra tier. */
    ao: "off" | "half" | "full"
  }
> = {
  0: { name: "Low", dpr: 1, post: false, tiltShift: false, shadowMap: 1024, ao: "off" },
  1: { name: "Medium", dpr: 1.25, post: true, tiltShift: false, shadowMap: 2048, ao: "off" },
  2: { name: "High", dpr: 1.5, post: true, tiltShift: false, shadowMap: 2048, ao: "off" },
  3: { name: "Ultra", dpr: 2, post: true, tiltShift: true, shadowMap: 4096, ao: "half" },
}

/** Highest tier the monitor may climb to on its own. */
const AUTO_MAX: Tier = 2
const STORAGE_KEY = "guildhall.quality"

function storedChoice(): QualityChoice {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY)
    if (value === "auto" || value === null) return "auto"
    const tier = Number(value)
    return tier >= 0 && tier <= 3 ? (tier as Tier) : "auto"
  } catch {
    return "auto"
  }
}

/** Phones and small machines start at Medium; the monitor moves them from there. */
function startingTier(): Tier {
  if (typeof window === "undefined") return 2
  const coarse = window.matchMedia?.("(pointer: coarse)").matches
  const cores = navigator.hardwareConcurrency ?? 8
  return coarse || cores <= 4 ? 1 : 2
}

const listeners = new Set<() => void>()

const initialChoice: QualityChoice = typeof window === "undefined" ? "auto" : storedChoice()

export const quality = {
  /** What the viewer chose: "auto" (adaptive) or a pinned tier. */
  choice: initialChoice,
  tier: (initialChoice === "auto" ? startingTier() : initialChoice) as Tier,
  /** Whether the frame-rate monitor may change the tier. */
  get auto(): boolean {
    return quality.choice === "auto"
  },
  set(tier: Tier): void {
    if (tier === quality.tier) return
    quality.tier = tier
    for (const listener of listeners) listener()
  },
  /** The Settings lever: pin a tier, or hand it back to the monitor. Remembered per browser. */
  choose(choice: QualityChoice): void {
    quality.choice = choice
    try {
      window.localStorage.setItem(STORAGE_KEY, String(choice))
    } catch {
      // Private mode or blocked storage: the choice still applies for this visit.
    }
    if (choice === "auto") quality.set(Math.min(quality.tier, AUTO_MAX) as Tier)
    else quality.set(choice)
    for (const listener of listeners) listener()
  },
  up(): void {
    if (quality.auto) quality.set(Math.min(AUTO_MAX, quality.tier + 1) as Tier)
  },
  down(): void {
    if (quality.auto) quality.set(Math.max(0, quality.tier - 1) as Tier)
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  snapshot(): Tier {
    return quality.tier
  },
}
