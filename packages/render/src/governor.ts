import { log } from "@guildhall/core"
import { divisorFor, initialPace, type PacePick, paceWindow } from "./pace.ts"
import type { Stage } from "./stage.ts"

/** How far one governor move changes the DPR. */
export const DPR_STEP = 0.25
/** Consecutive over-budget windows (one a second) before the DPR steps down. */
export const DOWN_WINDOWS = 2
/** Consecutive comfortable windows before it steps back up; doubled each time a raise does not hold. */
export const UP_WINDOWS = 5
/** "Comfortable" is under this share of the budget: the gap between it and 1 is the hysteresis. */
export const UP_RATIO = 0.7
/** The longest the governor waits to raise, and how long a raise must hold to be trusted again. */
export const MAX_UP_WINDOWS = 60
const WINDOW_MS = 1000

const logger = log("render:dpr")

/**
 * The DPR after one more window, given the p95 frame cost (ms) of each recent window, newest last.
 * Steps down when the last `DOWN_WINDOWS` were all over `targetMs`, up when the last `upWindows` were
 * all under `UP_RATIO` of it; otherwise it stays. Never leaves `[min, max]`.
 */
export function nextDpr(
  p95History: readonly number[],
  dpr: number,
  [min, max]: readonly [number, number],
  targetMs: number,
  upWindows = UP_WINDOWS,
): number {
  const last = (n: number) => (p95History.length >= n ? p95History.slice(-n) : null)
  if (dpr > min && last(DOWN_WINDOWS)?.every((ms) => ms > targetMs)) return Math.max(min, dpr - DPR_STEP)
  if (dpr < max && last(upWindows)?.every((ms) => ms < targetMs * UP_RATIO))
    return Math.min(max, dpr + DPR_STEP)
  return dpr
}

export interface GovernorState {
  dpr: number
  /** The p95 cost of each window since the last move, newest last. */
  history: number[]
  /** How many comfortable windows the next raise needs. */
  upWindows: number
  lastMove: "up" | "down" | null
}

export const initialGovernor = (dpr: number): GovernorState => ({
  dpr,
  history: [],
  upWindows: UP_WINDOWS,
  lastMove: null,
})

/**
 * The governor after one window whose p95 frame cost was `p95` ms. A move clears the history, so the
 * next decision is made on frames drawn at the new DPR. A drop that comes soon after a raise means the
 * raise did not hold, so the next one waits twice as long: the DPR cannot oscillate.
 */
export function governorStep(
  state: GovernorState,
  p95: number,
  range: readonly [number, number],
  targetMs: number,
): GovernorState {
  const history = [...state.history, p95].slice(-MAX_UP_WINDOWS)
  const dpr = nextDpr(history, state.dpr, range, targetMs, state.upWindows)
  if (dpr === state.dpr) return { ...state, history }
  const move = dpr < state.dpr ? "down" : "up"
  let upWindows = state.upWindows
  if (move === "down" && state.lastMove === "up")
    upWindows = history.length < MAX_UP_WINDOWS ? Math.min(MAX_UP_WINDOWS, upWindows * 2) : UP_WINDOWS
  return { dpr, history: [], upWindows, lastMove: move }
}

/**
 * One window of the governor with the viewer's own pick in force: a pick (a DPR) holds the DPR there,
 * whatever the frame cost, and the governor keeps no history while it does; no pick (Auto) is
 * `governorStep`. So the governor never overrides an explicit choice, and once Auto is chosen again it
 * starts afresh.
 */
export function governWindow(
  state: GovernorState,
  p95: number,
  range: readonly [number, number],
  targetMs: number,
  pick: number | null,
): GovernorState {
  if (pick !== null) return { ...initialGovernor(pick), upWindows: state.upWindows }
  return governorStep(state, p95, range, targetMs)
}

/** The quality tiers a viewer can pick, and the DPR each pins (Auto: none, the governor's). */
export const QUALITY_DPR = { auto: null, low: 1, medium: 1.5, high: 2 } as const
export type QualityPick = keyof typeof QUALITY_DPR

/** A stored or chosen quality, or Auto when it names none. */
export const qualityOf = (value: unknown): QualityPick =>
  typeof value === "string" && Object.hasOwn(QUALITY_DPR, value) ? (value as QualityPick) : "auto"

/**
 * The DPR a pick pins on a screen of `device` pixel ratio (never sharper than the screen: High on a
 * DPR 1 screen is 1), or null for Auto.
 */
export function qualityDpr(pick: QualityPick, device: number): number | null {
  const dpr = QUALITY_DPR[pick]
  if (dpr === null) return null
  return Math.min(dpr, device > 0 ? device : 1)
}

/** The ladder tier a pick holds (High the full look, Medium one down, Low the lowest), or null for Auto. */
export function qualityTier(pick: QualityPick): number | null {
  if (pick === "auto") return null
  return pick === "high" ? 0 : pick === "medium" ? 1 : TIERS.length - 1
}

/** The DPR a `?dpr=` query pins, or undefined when it names none (or nothing usable). */
export function parseDprPin(search: string): number | undefined {
  const text = new URLSearchParams(search).get("dpr")
  if (text === null) return undefined
  const dpr = Number(text)
  if (text.trim() === "" || !Number.isFinite(dpr) || dpr <= 0) {
    logger.warn("ignoring ?dpr=", { value: text })
    return undefined
  }
  return dpr
}

export interface GovernorOpts {
  /** The p95 frame cost (ms) the DPR is lowered to hold. */
  targetMs: number
  /** The DPR range. It never rises above where the stage started (a raise only wins back a drop). */
  dpr: [number, number]
  /** A fixed DPR (`?dpr=`): set once, and the governor never moves it. */
  pin?: number
  /** Applies a tier's lever values (the stage hands them to the modules that registered levers). */
  apply?: (values: TierValues) => void
  /** The tier to start at (`startTier` of the device's profile); default 0. */
  start?: number
}

// ── the quality ladder (perf round 3, item 3) ─────────────────────────────────────────────────────
//
// Tiers step down in a sensible order once pacing at 30 cannot hold the frame: the DPR floor first
// (the governor trades resolution within the tier's range), then the shadow maps, then the crowd's far
// LOD distance with the particle cap. Tier 0 is the full look; every lower tier may look simpler. Auto
// steps with hysteresis (down after a few bad seconds, back up after a long calm stretch that doubles
// each time a raise did not hold) and never overrides a viewer's pick (Settings, Quality).

export type LeverName = "shadowMap" | "lodBias" | "particles"
export interface TierValues extends Record<LeverName, number> {
  /** The lowest DPR the governor may trade down to at this tier. */
  dprFloor: number
}

/** The tiers, full quality first. */
export const TIERS: readonly TierValues[] = [
  { dprFloor: 1.5, shadowMap: 2048, lodBias: 1, particles: 256 },
  { dprFloor: 1, shadowMap: 2048, lodBias: 1, particles: 256 },
  { dprFloor: 1, shadowMap: 1024, lodBias: 1.6, particles: 128 },
  { dprFloor: 0.75, shadowMap: 1024, lodBias: 2.5, particles: 64 },
]
/** Bad seconds in a row (paced at 30, still over budget, DPR at its floor) before a tier steps down. */
export const TIER_DOWN_WINDOWS = 3
/** Calm seconds before a tier steps back up; doubled each time a raise did not hold. */
export const TIER_UP_WINDOWS = 20
export const TIER_MAX_UP_WINDOWS = 240

export interface LadderState {
  tier: number
  bad: number
  calm: number
  upWindows: number
  lastMove: "up" | "down" | null
}
export const initialLadder = (tier = 0): LadderState => ({
  tier: Math.max(0, Math.min(TIERS.length - 1, tier)),
  bad: 0,
  calm: 0,
  upWindows: TIER_UP_WINDOWS,
  lastMove: null,
})

/** One second of evidence for the ladder. */
export interface LadderWindow {
  /** Paced at 30 (the pacer's divisor over 1), or Max picked: the frames are not the pacer's to hold. */
  pacedOut: boolean
  /** The p95 frame cost over the budget in force. */
  over: boolean
  /** The DPR governor is at the tier's floor (nothing left for it to trade). */
  dprAtFloor: boolean
  /** The p95 frame cost well under the budget (room to afford more). */
  calm: boolean
}

/** The ladder after one window, in Auto. */
export function ladderStep(state: LadderState, w: LadderWindow): LadderState {
  const last = TIERS.length - 1
  if (w.pacedOut && w.over && w.dprAtFloor && state.tier < last) {
    const bad = state.bad + 1
    if (bad >= TIER_DOWN_WINDOWS) {
      const upWindows =
        state.lastMove === "up" ? Math.min(TIER_MAX_UP_WINDOWS, state.upWindows * 2) : state.upWindows
      return { tier: state.tier + 1, bad: 0, calm: 0, upWindows, lastMove: "down" }
    }
    return { ...state, bad, calm: 0 }
  }
  if (w.calm && state.tier > 0) {
    const calm = state.calm + 1
    if (calm >= state.upWindows) return { ...state, tier: state.tier - 1, bad: 0, calm: 0, lastMove: "up" }
    return { ...state, bad: 0, calm }
  }
  return { ...state, bad: 0, calm: w.calm ? state.calm : 0 }
}

/** What the device says about itself, for the starting tier. */
export interface DeviceProfile {
  /** The WebGL renderer string (`WEBGL_debug_renderer_info`), or "". */
  renderer: string
  cores: number
  /** `navigator.deviceMemory` in GB, or 0 when unknown. */
  memory: number
  touch: boolean
  /** The screen's device pixel ratio. */
  dpr: number
}

/** The device's profile, read from the page (a bare environment reads as a strong desktop). */
export function deviceProfile(): DeviceProfile {
  const nav = globalThis.navigator as (Navigator & { deviceMemory?: number }) | undefined
  let renderer = ""
  try {
    const canvas = globalThis.document?.createElement("canvas")
    const gl = canvas?.getContext("webgl2") ?? canvas?.getContext("webgl")
    const info = gl?.getExtension("WEBGL_debug_renderer_info")
    if (gl && info) renderer = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL) ?? "")
  } catch {
    renderer = ""
  }
  return {
    renderer,
    cores: nav?.hardwareConcurrency ?? 8,
    memory: nav?.deviceMemory ?? 0,
    touch: (nav?.maxTouchPoints ?? 0) > 0,
    dpr: globalThis.devicePixelRatio || 1,
  }
}

/**
 * The tier a device starts at, so a weak one never draws its first seconds at full cost: a phone or a
 * tablet (touch) starts a tier down, two with few cores or little memory or a weak GPU (Mali, Adreno 5xx
 * and below, PowerVR, Intel HD); a laptop with an integrated Intel GPU starts a tier down. A strong
 * desktop starts at 0. The ladder steps from there either way.
 */
export function startTier(d: DeviceProfile): number {
  const r = d.renderer.toLowerCase()
  const weakGpu =
    /mali|powervr|adreno \(tm\) [1-5]\d\d|adreno [1-5]\d\d|intel.*(hd|uhd) graphics|swiftshader|llvmpipe/.test(
      r,
    )
  const few = d.cores > 0 && d.cores <= 4
  const little = d.memory > 0 && d.memory <= 4
  if (d.touch) return weakGpu || few || little ? 2 : 1
  if (weakGpu) return 1
  return 0
}

export interface Governor {
  /** Pinned by `?dpr=`. */
  readonly pinned: boolean
  /**
   * The viewer's pick (Settings, Quality): the DPR held there with the governor standing aside, until
   * `null` (Auto) hands it back, from the DPR the stage started at.
   */
  pick(dpr: number | null): void
  /** The viewer's motion pick (Settings, Motion; pace.ts). */
  pickPace(pick: PacePick): void
  pacePick(): PacePick
  /** The ladder's tier now and the viewer's fixed tier (null: Auto). */
  tier(): { tier: number; pick: number | null }
  /** Holds the ladder at a tier (a quality pick), or hands it back with null. */
  pickTier(tier: number | null): void
  /** The lever values of the tier in force. */
  tierValues(): TierValues
  dispose(): void
}

/**
 * The DPR governor's budget while the stage is paced: the paced frame (the display's interval times the
 * divisor), less a margin. At the display's rate it is `targetMs`.
 */
export function pacedBudget(targetMs: number, divisor: number, vsyncMs: number): number {
  return divisor > 1 ? vsyncMs * divisor * 0.85 : targetMs
}

/**
 * Holds the stage's frame cost under `targetMs` by trading resolution: once a second it reads the p95
 * cost of the frames drawn in that second and steps the DPR (see `governorStep`). Logs every change on
 * `render:dpr`. The pacer (pace.ts) runs in the same window, first: in Auto the DPR steps down only
 * once the stage is paced at 30 and still over its paced budget (the user: quality never drops to buy
 * fps); with Max picked the frame rate is what is wanted, so the DPR trades for it as before.
 */
export function createGovernor(stage: Stage, opts: GovernorOpts): Governor {
  const start = stage.stats().dpr
  let pacePick: PacePick = "auto"
  let pace = initialPace()
  // the ladder: its tier, the viewer's fixed tier, and the levers applied for the tier in force
  let ladder = initialLadder(opts.start ?? 0)
  let tierPick: number | null = null
  const tierNow = () => tierPick ?? ladder.tier
  const values = () => TIERS[tierNow()] as TierValues
  const applyTier = () => opts.apply?.(values())
  if (opts.start) logger.info("start tier", { tier: ladder.tier })
  if (opts.pin !== undefined) {
    const pin = opts.pin
    stage.setDpr(pin)
    logger.info("pinned", { dpr: pin })
    return {
      pinned: true,
      pick: (dpr) => stage.setDpr(dpr ?? pin),
      pickPace(next) {
        pacePick = next
        if (next !== "auto") stage.setPace(next === "max" ? 1 : divisorFor(stage.pace().vsyncMs))
      },
      pacePick: () => pacePick,
      tier: () => ({ tier: tierNow(), pick: tierPick }),
      pickTier(next) {
        tierPick = next
        applyTier()
      },
      tierValues: values,
      dispose() {},
    }
  }
  const hi = Math.min(opts.dpr[1], start)
  /** The DPR range at the tier in force: the tier's floor, never over where the stage started. */
  const rangeNow = (): [number, number] => [Math.min(values().dprFloor, hi), hi]
  let state = initialGovernor(start)
  let running = true
  let pick: number | null = null

  const loop = async () => {
    while (running) {
      const reading = await stage.sample(WINDOW_MS)
      // A hidden tab draws nothing: no frames is no evidence either way; nor are the frames drawn under
      // a loading cover (held, or on every 4th vsync while the island is built).
      if (!running || reading.fps === 0 || !reading.costMs || reading.covered) continue
      // the pace first
      const { vsyncMs } = stage.pace()
      const nextPace = paceWindow(
        pace,
        { vsyncMs, intervals: reading.intervals ?? [], costP95: reading.costMs.p95 },
        pacePick,
      )
      if (nextPace.divisor !== pace.divisor) stage.setPace(nextPace.divisor)
      pace = nextPace
      // then the DPR, against the paced budget; in Auto only once paced (else the frames are the pacer's to hold)
      const divisor = pace.divisor
      const budget = pacedBudget(opts.targetMs, divisor, vsyncMs)
      const mayDrop = pacePick === "max" || divisor > 1 || divisorFor(vsyncMs) === 1
      const range = rangeNow()
      // the ladder, once the DPR has nothing left to trade (a viewer's tier pick holds it)
      if (tierPick === null && pick === null) {
        const p95 = reading.costMs.p95
        const nextLadder = ladderStep(ladder, {
          pacedOut: mayDrop,
          over: p95 > budget,
          dprAtFloor: state.dpr <= range[0] + 1e-6,
          calm: p95 < budget * UP_RATIO,
        })
        if (nextLadder.tier !== ladder.tier) {
          logger.info(nextLadder.tier > ladder.tier ? "tier down" : "tier up", {
            from: ladder.tier,
            to: nextLadder.tier,
            p95: Number(p95.toFixed(2)),
            budget: Number(budget.toFixed(1)),
          })
          ladder = nextLadder
          applyTier()
          // a step up lifts the floor: the DPR starts from the new floor and earns its way back
          const lifted = rangeNow()
          if (state.dpr < lifted[0]) {
            state = { ...initialGovernor(lifted[0]), upWindows: state.upWindows }
            stage.setDpr(lifted[0])
          }
          continue
        }
        ladder = nextLadder
      }
      const next = governWindow(state, reading.costMs.p95, range, budget, pick)
      if (!mayDrop && next.dpr < state.dpr) {
        state = { ...state, history: [] }
        continue
      }
      if (pick === null && next.dpr !== state.dpr) {
        logger.info(next.dpr < state.dpr ? "down" : "up", {
          from: state.dpr,
          to: next.dpr,
          p95: Number(reading.costMs.p95.toFixed(2)),
          targetMs: Number(budget.toFixed(1)),
          pace: divisor,
        })
        stage.setDpr(next.dpr)
      }
      state = next
    }
  }
  void loop()
  return {
    pinned: false,
    pick(dpr) {
      pick = dpr
      // a pick holds the DPR; Auto again starts from where the stage started, its history forgotten
      state = { ...initialGovernor(dpr ?? start), upWindows: state.upWindows }
      stage.setDpr(dpr ?? start)
      logger.info(dpr === null ? "auto" : "picked", { dpr: dpr ?? start })
    },
    pickPace(next) {
      pacePick = next
      pace = initialPace()
      // a pick takes at once; Auto starts afresh at the display's rate and measures from there
      const divisor = next === "smooth" ? divisorFor(stage.pace().vsyncMs) : 1
      pace = { ...pace, divisor }
      stage.setPace(divisor)
      logger.info("motion", { pick: next, divisor })
    },
    pacePick: () => pacePick,
    tier: () => ({ tier: tierNow(), pick: tierPick }),
    pickTier(next) {
      tierPick = next
      // Auto again starts the ladder afresh from the device's tier
      if (next === null) ladder = initialLadder(opts.start ?? 0)
      applyTier()
      logger.info(next === null ? "tier auto" : "tier picked", { tier: tierNow() })
    },
    tierValues: values,
    dispose() {
      running = false
    },
  }
}
