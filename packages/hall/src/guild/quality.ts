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
  } & Looks
> = {
  0: {
    name: "Low",
    dpr: 1,
    post: false,
    tiltShift: false,
    shadowMap: 1024,
    ao: "off",
    ...looks(false, false),
  },
  1: {
    name: "Medium",
    dpr: 1.1,
    post: true,
    tiltShift: false,
    shadowMap: 2048,
    ao: "off",
    ...looks(false, true),
  },
  2: {
    name: "High",
    // 1.25, not 1.5: the frame is fill-rate bound at Retina, and with SMAA on the final image 1.25
    // looked identical side by side (.probe/c-dpr-*.png) while saving 2.7 ms (10.9 → 8.2 ms).
    dpr: 1.25,
    post: true,
    tiltShift: false,
    shadowMap: 2048,
    ao: "off",
    ...looks(true, true),
  },
  3: {
    name: "Ultra",
    dpr: 2,
    post: true,
    tiltShift: true,
    shadowMap: 4096,
    ao: "half",
    ...looks(true, true),
  },
}

/**
 * The per-pixel looks folded into the post pass we already pay for (docs/perf-budget.md, "Visual
 * upgrades"): none adds a pass.
 *   outlines  soft ink lines round silhouettes, from the depth buffer (High and up; needs post)
 *   mist      ground mist and golden-hour sun shafts (Medium and up; needs post)
 *   lut       the mood's colour-grade LUT, blended through the day (Medium and up; needs post)
 *   water     water v2 — toon bands, foam rings, the mill's wake on every tier (it's the water's own
 *             shader, no post needed); its caustics skip Low
 */
export interface Looks {
  outlines: boolean
  mist: boolean
  lut: boolean
  water: boolean
}
export type Look = keyof Looks

function looks(outlines: boolean, rest: boolean): Looks {
  return { outlines, mist: rest, lut: rest, water: true }
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
  /**
   * Probe lever for A/B measurements (window.quality under PROBE): force a look on or off over the
   * tier's own choice, or `undefined` to hand it back. Not remembered.
   */
  overrides: {} as Partial<Looks>,
  /** Bumped on every override, so `useLooks` re-renders. */
  revision: 0,
  look(name: Look, on: boolean | undefined): void {
    if (on === undefined) delete quality.overrides[name]
    else quality.overrides[name] = on
    quality.revision++
    for (const listener of listeners) listener()
  },
  /** The looks in force: the tier's, with any probe override on top. */
  looks(): Looks {
    return { ...pick(TIERS[quality.tier]), ...quality.overrides }
  },
}

function pick({ outlines, mist, lut, water }: Looks): Looks {
  return { outlines, mist, lut, water }
}
