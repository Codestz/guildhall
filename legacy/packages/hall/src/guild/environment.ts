import { type Entry, failedDeed, type Model, type Session } from "@guildhall/core"

/**
 * The world's conditions (ADR 0007): time of day, weather, temperature. One pure function of the
 * clock, the session model and the viewer's settings, computed by the store ~10×/s. Every visual
 * layer (sky, lights, water, grass, rain, life) reads `Environment` and nothing else, so they all
 * agree on what time it is and what the weather is doing.
 *
 * What drives what (each idea must mean something — docs/ideas.md):
 *   time of day   the viewer's real clock, a compressed demo day, a fixed hour, or the story's own
 *                 clock (a told story like the Saga sets the hour of each act)
 *   weather       repo health: the share of recent deeds that failed (a red check included), and failed
 *                 sessions
 *   temperature   activity: how busy the guild has been lately (busy = warm, long quiet = cold)
 */

export type Weather = "clear" | "cloudy" | "rain" | "storm" | "snow"
export type TimeMode = "real" | "cycle" | "fixed" | "story"

/** One keyframe of a story's clock: the hour of day at a run time (ms). */
export interface StoryHour {
  at: number
  hour: number
}

export interface EnvironmentSettings {
  /**
   * real: the viewer's clock · cycle: one day every `cycleMinutes` · fixed: always `hour` · story:
   * the hours the story being played sets (the viewer's clock for a story that sets none).
   */
  time: TimeMode
  hour: number
  cycleMinutes: number
  /** "auto" follows repo health and activity; anything else pins the weather (the demo's lever). */
  weather: Weather | "auto"
}

export const DEFAULT_SETTINGS: EnvironmentSettings = {
  time: "real",
  hour: 10,
  cycleMinutes: 6,
  weather: "auto",
}

export interface EnvironmentInput {
  /** Wall clock, ms since the epoch: real time of day. */
  wallClock: number
  /** Run time, ms (simulated or live): drives the demo cycle and the recent-window maths. */
  runTime: number
  /** `Change.at` of run time 0 — to turn `at` into run time. */
  runStart: number
  model: Model
  settings: EnvironmentSettings
  /** The played story's clock, keyframes in run-time order (time mode "story"). */
  story?: readonly StoryHour[]
}

export type Vec3 = readonly [x: number, y: number, z: number]

export interface Environment {
  /** 0–24, local. */
  hour: number
  /** 0 at night, 1 at noon; smooth through dawn and dusk. */
  daylight: number
  /** Unit vector from the ground towards the sun (y < 0: below the horizon). */
  sun: Vec3
  /** Unit vector towards the moon: roughly opposite the sun. */
  moon: Vec3
  weather: Weather
  /** 0–1 each. */
  cloudCover: number
  precipitation: number
  wind: number
  /** Run time (ms) of the latest lightning strike, for a storm's flashes; -1 when none. */
  lightningAt: number
  /** Degrees Celsius: below ~0 rain becomes snow. */
  temperature: number
  /** 0–1: share of recent deeds that succeeded (1 with no data). */
  health: number
  /** 0–1: how busy the guild is right now. */
  activity: number
}

const TAU = Math.PI * 2

/** The hour the settings ask for. */
export function hourOf(
  input: Pick<EnvironmentInput, "wallClock" | "runTime" | "settings" | "story">,
): number {
  const { settings } = input
  if (settings.time === "fixed") return ((settings.hour % 24) + 24) % 24
  if (settings.time === "story" && input.story && input.story.length > 0)
    return storyHour(input.story, input.runTime)
  if (settings.time === "cycle") {
    const day = Math.max(0.5, settings.cycleMinutes) * 60_000
    // Start the demo day at 7 am so the first thing a visitor sees is a sunrise.
    return (7 + (input.runTime / day) * 24) % 24
  }
  const date = new Date(input.wallClock)
  return date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600
}

/**
 * The story's hour at `runTime`: straight lines between its keyframes, held before the first and
 * after the last. Keyframe hours may run past 24 (a night that crosses midnight) and are wrapped.
 */
export function storyHour(story: readonly StoryHour[], runTime: number): number {
  let hour = story[0]?.hour ?? 0
  for (let i = 0; i < story.length; i++) {
    const key = story[i] as StoryHour
    const next = story[i + 1]
    if (runTime < key.at) break
    hour =
      next && next.at > key.at
        ? key.hour + (next.hour - key.hour) * Math.min(1, (runTime - key.at) / (next.at - key.at))
        : key.hour
  }
  return ((hour % 24) + 24) % 24
}

/**
 * Sun and moon from the hour: the sun rises in the east (+x) at 6, is highest at noon, sets in the
 * west at 18; its arc leans south (+z) so shadows fall towards the back of the hall.
 */
export function skyOf(hour: number): Pick<Environment, "hour" | "daylight" | "sun" | "moon"> {
  const angle = ((hour - 6) / 24) * TAU
  const elevation = Math.sin(angle)
  const sun: Vec3 = normalize([Math.cos(angle), elevation, 0.45])
  const moon: Vec3 = normalize([-sun[0], -sun[1] * 0.85 + 0.15, 0.35])
  const daylight = smoothstep(-0.12, 0.35, elevation)
  return { hour, daylight, sun, moon }
}

// ---------------------------------------------------------------------------------------------------
// Weather and temperature: logic over the session model. Pure in what it returns — smoothness comes
// from time windows: every input is weighted by its age, and the weather holds its worst state of the
// last few seconds, so one event never flips it back and forth. Its one memory is a cache that keeps
// the cost bounded in a long session (`Cursor`); it changes how fast, not what.

/** Deeds weigh in on health for this long (run time), less the older they are. */
const HEALTH_WINDOW_MS = 120_000
/** Imagined successes behind every verdict: a single failure clouds the sky, it doesn't flood it. */
const HEALTH_PRIOR = 3
/** A failure is news, a success routine: a failed deed weighs this many completed ones. */
const FAILURE_WEIGHT = 2
/** Health this low is full gloom (1); a perfect record is none. */
const GLOOM_AT_HEALTH = 0.4
/** Gloom from which the sky is cloudy, and from which it rains: health ≈ 0.93 and 0.7. */
const CLOUDY_GLOOM = 0.12
const RAIN_GLOOM = 0.5
/** A failed session is a full storm for this long, then fades out by `STORM_FADE_MS`. */
const STORM_FULL_MS = 45_000
const STORM_FADE_MS = 100_000
/** A burst: failed deeds in this window, `BURST_FAILURES` of them (recency-weighted) make a full storm. */
const BURST_WINDOW_MS = 20_000
const BURST_FAILURES = 4
const STORM_PRESSURE = 0.5
/** The weather holds its worst state over these samples (now, 2.5 s ago, … 10 s ago). */
const HOLD_SAMPLES = 5
const HOLD_STEP_MS = 2500
/** For the continuous values, each event eases in over this long instead of landing at once. */
const RISE_MS = 6000
/** Activity counts deeds started in the last minute (recency-weighted); this many is "busy". */
const ACTIVITY_WINDOW_MS = 60_000
const ACTIVITY_SCALE = 10
/** Warmth: each deed adds heat that decays with this time constant; the run's start adds a mild baseline. */
const HEAT_DECAY_MS = 600_000
const HEAT_BASELINE = 22
const HEAT_SCALE = 20
/** Temperature from no heat (a long idle stretch) to a busy guild's summer. */
const COLDEST = -6
const WARMEST = 24
/** Below this, precipitation falls as snow. */
const FREEZING = 1
/** Lightning: one chance per bucket of run time, at a hashed moment inside it. */
const LIGHTNING_BUCKET_MS = 1200
const LIGHTNING_CHANCE = 0.4
const LIGHTNING_LOOKBACK = 6

/** Weather a pinned setting shows: fixed conditions, so the demo's lever looks the same every time. */
const PINNED: Record<Weather, Pick<Environment, "cloudCover" | "precipitation" | "wind">> = {
  clear: { cloudCover: 0.15, precipitation: 0, wind: 0.2 },
  cloudy: { cloudCover: 0.65, precipitation: 0, wind: 0.35 },
  rain: { cloudCover: 0.85, precipitation: 0.65, wind: 0.45 },
  storm: { cloudCover: 1, precipitation: 1, wind: 0.9 },
  snow: { cloudCover: 0.8, precipitation: 0.6, wind: 0.25 },
}

/**
 * The world for this moment.
 *
 *   health        deeds (tool calls) that ended in the last 2 min, completed vs failed (a failure
 *                 counts twice), newer ones weighing more, plus 3 imagined successes; 1 with no data
 *   weather       storm while a session failed in the last ~75 s or failures come in a burst (≈3 in
 *                 10 s); otherwise rain when health < ~0.7, cloudy < ~0.93, else clear. It holds the
 *                 worst of the last 10 s, so it worsens at once and clears only when it stays better.
 *                 Rain or storm below 1 °C is snow. A pinned setting wins.
 *   cloudCover…   continuous, from the same pressures with every event easing in over 6 s, kept
 *                 inside the band of the weather they show
 *   lightningAt   during a storm: hashed strikes per 1.2 s bucket of run time (replays strike alike)
 *   activity      deeds started in the last minute (recency-weighted), saturating at ~10
 *   temperature   heat: every deed adds 1, decaying over ~10 min; the run's start adds a mild
 *                 baseline (14 °C). Busy → ~24 °C; ~10 min idle → autumn (~8 °C); ~30 min → below 0
 */
export function environmentOf(input: EnvironmentInput): Environment {
  const sky = skyOf(hourOf(input))
  const now = input.runStart + input.runTime
  const reading = readModel(input.model, now, input.runStart)
  const temperature = temperatureOf(reading.heat)
  const pinned = input.settings.weather
  if (pinned !== "auto") {
    return {
      ...sky,
      weather: pinned,
      ...PINNED[pinned],
      lightningAt: pinned === "storm" ? lightningAt(input.runTime, 1) : -1,
      // Keep the numbers agreeing with the sky: pinned snow is below freezing, pinned rain above.
      temperature:
        pinned === "snow"
          ? Math.min(temperature, FREEZING - 2)
          : pinned === "rain" || pinned === "storm"
            ? Math.max(temperature, FREEZING + 1)
            : temperature,
      health: reading.health,
      activity: reading.activity,
    }
  }

  const gloomHeld = Math.max(...reading.gloom)
  const stormHeld = Math.max(...reading.storm)
  const { gloom, storm } = reading.soft
  let weather: Weather =
    stormHeld >= STORM_PRESSURE
      ? "storm"
      : gloomHeld >= RAIN_GLOOM
        ? "rain"
        : gloomHeld >= CLOUDY_GLOOM
          ? "cloudy"
          : "clear"
  const intensity = Math.max(gloom, storm)
  const band = BANDS[weather]
  const cloudCover = clamp(0.1 + 0.9 * smoothstep(0, 0.75, intensity), band.cloud)
  const precipitation = clamp(smoothstep(RAIN_GLOOM - 0.15, 1, intensity), band.rain)
  const wind = clamp(0.15 + 0.3 * gloom + 0.55 * storm, band.wind)
  if ((weather === "rain" || weather === "storm") && temperature < FREEZING) weather = "snow"
  return {
    ...sky,
    weather,
    cloudCover,
    precipitation,
    wind,
    lightningAt: weather === "storm" ? lightningAt(input.runTime, storm) : -1,
    temperature,
    health: reading.health,
    activity: reading.activity,
  }
}

type Range = readonly [min: number, max: number]
/** What each weather allows of the continuous values, so they never contradict the name. */
const BANDS: Record<Exclude<Weather, "snow">, { cloud: Range; rain: Range; wind: Range }> = {
  clear: { cloud: [0, 0.35], rain: [0, 0], wind: [0, 0.4] },
  cloudy: { cloud: [0.4, 0.75], rain: [0, 0], wind: [0.15, 0.6] },
  rain: { cloud: [0.7, 0.95], rain: [0.25, 0.8], wind: [0.25, 0.75] },
  storm: { cloud: [0.9, 1], rain: [0.7, 1], wind: [0.7, 1] },
}

interface Reading {
  /** Health now. */
  health: number
  activity: number
  heat: number
  /** Gloom (from health) and storm pressure at each hold sample, now first. */
  gloom: number[]
  storm: number[]
  /** The same now, with every event easing in over `RISE_MS`: for the continuous values. */
  soft: { gloom: number; storm: number }
}

/** Slots 0…HOLD_SAMPLES-1 are the hold samples; the last is `soft`. */
const SLOTS = HOLD_SAMPLES + 1
const SOFT = HOLD_SAMPLES
const offsetOf = (slot: number) => (slot === SOFT ? 0 : slot * HOLD_STEP_MS)
const easeOf = (slot: number, age: number) => (slot === SOFT ? Math.min(1, age / RISE_MS) : 1)

/** What one slot (a hold sample, or the soft "now") has gathered. */
interface Tally {
  ok: number
  failed: number
  burst: number
  storm: number
}

/**
 * After this long a finished deed weighs nothing in any window (health over the oldest hold sample,
 * activity); all that is left of it is decaying heat.
 */
const SETTLED_MS = Math.max(HEALTH_WINDOW_MS + (HOLD_SAMPLES - 1) * HOLD_STEP_MS, ACTIVITY_WINDOW_MS)

type Deed = Extract<Entry, { kind: "tool" }>

/**
 * Per session, what has been read of its deeds: those settled (finished, older than SETTLED_MS) are
 * folded into one heat number, decayed to `at`; the rest (`open`) are read each time. A session's
 * entries only grow, and `now` only moves on for one model (a seek or a restart builds a new one);
 * should it go back, the cursor starts over.
 */
interface Cursor {
  scanned: number
  open: Deed[]
  heat: number
  at: number
}
const cursors = new WeakMap<Session, Cursor>()

/** The session's deeds still inside some window, with the heat of the rest folded up to `now`. */
function deedsOf(session: Session, now: number): Cursor {
  let cursor = cursors.get(session)
  if (!cursor || now < cursor.at) {
    cursor = { scanned: 0, open: [], heat: 0, at: now }
    cursors.set(session, cursor)
  }
  cursor.heat *= decay(now - cursor.at)
  cursor.at = now
  const { entries } = session
  for (; cursor.scanned < entries.length; cursor.scanned++) {
    const entry = entries[cursor.scanned]
    if (entry?.kind === "tool") cursor.open.push(entry)
  }
  let kept = 0
  for (const entry of cursor.open) {
    const finished = entry.state === "completed" || entry.state === "failed"
    if (finished && now - entry.at >= SETTLED_MS && now - (entry.ended ?? entry.at) >= SETTLED_MS)
      cursor.heat += decay(now - entry.at)
    else cursor.open[kept++] = entry
  }
  cursor.open.length = kept
  return cursor
}

/** One pass over every session and its recent deeds: everything the weather and temperature need. */
function readModel(model: Model, now: number, runStart: number): Reading {
  const tallies: Tally[] = Array.from({ length: SLOTS }, () => ({ ok: 0, failed: 0, burst: 0, storm: 0 }))
  let busy = 0
  let heat = HEAT_BASELINE * decay(now - runStart)

  for (const session of model.sessions.values()) {
    const failedAt = session.status === "failed" ? session.ended : undefined
    if (failedAt !== undefined) {
      tallies.forEach((tally, k) => {
        const age = now - offsetOf(k) - failedAt
        tally.storm = Math.max(tally.storm, stormAfter(age) * easeOf(k, age))
      })
    }
    const deeds = deedsOf(session, now)
    heat += deeds.heat
    for (const entry of deeds.open) {
      if (entry.at > now) continue
      heat += decay(now - entry.at)
      if (entry.state === "running" || entry.state === "pending") busy += 1
      else busy += fade(now - entry.at, ACTIVITY_WINDOW_MS)
      if (entry.state !== "completed" && entry.state !== "failed") continue
      const ended = entry.ended ?? entry.at
      // A check that exited non-zero is completed but red (core's `failedDeed`): it brings the weather too.
      const succeeded = !failedDeed(entry)
      tallies.forEach((tally, k) => {
        const age = now - offsetOf(k) - ended
        const weight = fade(age, HEALTH_WINDOW_MS) ** 2 * easeOf(k, age)
        if (weight === 0) return
        if (succeeded) tally.ok += weight
        else {
          tally.failed += weight * FAILURE_WEIGHT
          tally.burst += fade(age, BURST_WINDOW_MS) * easeOf(k, age)
        }
      })
    }
  }

  const healthOf = (tally: Tally) => (tally.ok + HEALTH_PRIOR) / (tally.ok + tally.failed + HEALTH_PRIOR)
  const gloomOf = (tally: Tally) => Math.min(1, (1 - healthOf(tally)) / (1 - GLOOM_AT_HEALTH))
  const stormOf = (tally: Tally) => Math.max(tally.storm, Math.min(1, tally.burst / BURST_FAILURES))
  const held = tallies.slice(0, HOLD_SAMPLES)
  const soft = tallies[SOFT] ?? tallies[0]
  return {
    health: held[0] ? healthOf(held[0]) : 1,
    activity: 1 - Math.exp(-busy / ACTIVITY_SCALE),
    heat,
    gloom: held.map(gloomOf),
    storm: held.map(stormOf),
    soft: soft ? { gloom: gloomOf(soft), storm: stormOf(soft) } : { gloom: 0, storm: 0 },
  }
}

/** 1 for an event just now, falling linearly to 0 at `window`; 0 for the future. */
function fade(age: number, window: number): number {
  return age < 0 || age >= window ? 0 : 1 - age / window
}

/** What's left of a deed's heat after `age` ms. */
function decay(age: number): number {
  return age < 0 ? 0 : Math.exp(-age / HEAT_DECAY_MS)
}

/** Storm pressure `age` ms after a session failed. */
function stormAfter(age: number): number {
  if (age < 0 || age >= STORM_FADE_MS) return 0
  if (age < STORM_FULL_MS) return 1
  return 1 - (age - STORM_FULL_MS) / (STORM_FADE_MS - STORM_FULL_MS)
}

function temperatureOf(heat: number): number {
  return COLDEST + (WARMEST - COLDEST) * (1 - Math.exp(-heat / HEAT_SCALE))
}

/** The run time of the latest strike at or before `runTime`, or -1. Hash of the bucket: replays agree. */
function lightningAt(runTime: number, intensity: number): number {
  const bucket = Math.floor(runTime / LIGHTNING_BUCKET_MS)
  const chance = LIGHTNING_CHANCE * (0.5 + 0.5 * intensity)
  for (let b = bucket; b > bucket - LIGHTNING_LOOKBACK; b--) {
    if (hash(b * 2) >= chance) continue
    const at = Math.floor((b + hash(b * 2 + 1)) * LIGHTNING_BUCKET_MS)
    if (at <= runTime) return at
  }
  return -1
}

/** Integer → [0, 1), well mixed (a lowbias32 finaliser). */
function hash(n: number): number {
  let x = (n | 0) ^ 0x9e3779b9
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d)
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b)
  x ^= x >>> 16
  return (x >>> 0) / 4294967296
}

function clamp(value: number, [min, max]: Range): number {
  return Math.min(max, Math.max(min, value))
}

function normalize([x, y, z]: Vec3): Vec3 {
  const length = Math.hypot(x, y, z) || 1
  return [x / length, y / length, z / length]
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}
