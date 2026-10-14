/**
 * What a grave's skeleton plays at a time (pure, worker-safe: no three), V1's scene/Undead.tsx as a
 * function of the grave's times instead of a mixer's clock, so a scrub and a play draw the same:
 *
 *   rise     lying still in the earth (`STIR_MS`, Skeletons_Inactive_Floor_Pose, sunk a little), then
 *            Skeletons_Awaken_Floor, coming up out of the mound as it stands
 *   vigil    Skeletons_Idle, with a taunt now and then (each skeleton on its own beat)
 *   struck   the fixer's blow: Hit_A
 *   sink     Skeletons_Death (it falls back: the body slides forward as it falls so the bones land on
 *            their own grave), then down into the earth
 *
 * Times are the run's clock, ms (the world events' `Grave`). Lengths are in the hero's metres at scale 1:
 * multiply by the figure's scale.
 */

/** A grave's skeleton, as the undead draw it. */
export interface UndeadFigure {
  /** Its show's id (stable): its taunts' beat. */
  id: string
  /** Which grave (`HexGraveyard.graves`), 0 nearest the gate. */
  slot: number
  kind: "warrior" | "mage" | "rogue" | "minion"
  /** Run time, ms: it starts to rise, stands, is struck (none: no blow), dies (none: still standing). */
  rise: number
  vigil: number
  strike?: number
  sink?: number
}

export interface UndeadPose {
  clip: string
  /** 0–1 through the clip. */
  phase: number
  /** Metres under its grave's ground (≤ 0), at scale 1. */
  y: number
  /** Metres slid forward along its facing as it falls (the death), at scale 1. */
  forward: number
}

/** Lying still before it stirs. */
export const STIR_MS = 500
/** How deep it lies before it stirs, and how deep the dead go (V1's, at a hero of 1.8 m). */
export const BURIED = -0.32
export const SUNK = -1.8
/** Its death plays this long before it goes down, then sinks over SINK_DOWN_MS. */
export const DIE_MS = 1500
export const SINK_DOWN_MS = 1000
/** How far its death falls back (root and hips, measured on the rig). */
export const DRIFT = 1.7

/** The rig's skeleton clips (and the blow's), seconds. */
export const UNDEAD_CLIP_SECONDS = {
  Skeletons_Inactive_Floor_Pose: 0,
  Skeletons_Awaken_Floor: 2.3,
  Skeletons_Idle: 4.267,
  Skeletons_Taunt: 1.033,
  Skeletons_Death: 2,
  Hit_A: 0.667,
} as const
export const UNDEAD_CLIPS = Object.keys(UNDEAD_CLIP_SECONDS) as (keyof typeof UNDEAD_CLIP_SECONDS)[]

/** Each skeleton taunts every TAUNT_EVERY…+TAUNT_SPREAD ms, its first after TAUNT_FIRST…+spread. */
const TAUNT_EVERY = 11_000
const TAUNT_SPREAD = 7000
const TAUNT_FIRST = 4000

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const smooth = (u: number) => u * u * (3 - 2 * u)
/** A stable 0–1 from a string (FNV-1a). */
export function seeded(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return (h >>> 0) / 4294967296
}

/** Once through a clip `ms` in: its phase, held just short of its end. */
const once = (clip: keyof typeof UNDEAD_CLIP_SECONDS, ms: number) =>
  Math.min(0.999, Math.max(0, ms / (UNDEAD_CLIP_SECONDS[clip] * 1000)))

/** The skeleton at run time `t`; null before it rises and once it has gone under. */
export function undeadPose(f: UndeadFigure, t: number): UndeadPose | null {
  if (t < f.rise) return null
  if (f.sink !== undefined && t >= f.sink) {
    const ms = t - f.sink
    if (ms >= DIE_MS + SINK_DOWN_MS + 100) return null
    const fall = clamp01(ms / (UNDEAD_CLIP_SECONDS.Skeletons_Death * 1000))
    return {
      clip: "Skeletons_Death",
      phase: once("Skeletons_Death", ms),
      y: SUNK * smooth(clamp01((ms - DIE_MS) / SINK_DOWN_MS)) || 0,
      forward: DRIFT * smooth(fall),
    }
  }
  if (f.strike !== undefined && t >= f.strike)
    return { clip: "Hit_A", phase: once("Hit_A", t - f.strike), y: 0, forward: 0 }
  if (t < f.vigil) {
    const ms = t - f.rise
    if (ms < STIR_MS) return { clip: "Skeletons_Inactive_Floor_Pose", phase: 0, y: BURIED, forward: 0 }
    const up = ms - STIR_MS
    const awaken = UNDEAD_CLIP_SECONDS.Skeletons_Awaken_Floor * 1000
    return {
      clip: "Skeletons_Awaken_Floor",
      phase: once("Skeletons_Awaken_Floor", up),
      y: BURIED * (1 - smooth(clamp01(up / (awaken * 0.6)))) || 0,
      forward: 0,
    }
  }
  // the vigil: idle, a taunt on its own beat now and then
  const ms = t - f.vigil
  const r = seeded(f.id)
  const first = TAUNT_FIRST + r * TAUNT_SPREAD
  const every = TAUNT_EVERY + r * TAUNT_SPREAD
  const taunt = UNDEAD_CLIP_SECONDS.Skeletons_Taunt * 1000
  if (ms >= first) {
    const into = (ms - first) % every
    if (into < taunt) return { clip: "Skeletons_Taunt", phase: into / taunt, y: 0, forward: 0 }
  }
  const idle = UNDEAD_CLIP_SECONDS.Skeletons_Idle * 1000
  return { clip: "Skeletons_Idle", phase: (ms % idle) / idle, y: 0, forward: 0 }
}

/** The moments a skeleton throws up earth (a dirt puff): as it claws up, and as it goes under. */
export function undeadPuffs(f: UndeadFigure): number[] {
  const out = [f.rise + STIR_MS]
  if (f.sink !== undefined) out.push(f.sink + DIE_MS)
  return out
}
