import type { EventKind } from "../guild/events.ts"
import type { MomentKind } from "../guild/moments.ts"
import type { SigilKind } from "../scene/sigilBoard.ts"
import type { Mood } from "../world/moods.ts"

/**
 * The guild's music, as numbers (docs/research/roadmap.md S1): Listen-to-Wikipedia for agents. Every
 * live deed is one soft note — pitch from how much it wrote (bigger → lower, rounder), quantized to a
 * pentatonic scale in a key set by the mood, minor at night — and the other moments are tiny motifs.
 * Pure: no WebAudio here, so what plays can be tested (audio/synth.ts renders a `Note`).
 */

/** Instruments, one per deed kind (mirroring the sigils, scene/sigilBoard.ts) plus the motifs' own. */
export type Timbre = "harp" | "marimba" | "bell" | "pluck" | "kalimba" | "glass" | "horn" | "thud"

/** One note of a cue. */
export interface Note {
  timbre: Timbre
  /** MIDI note number (60 = middle C). */
  midi: number
  /** Seconds after the cue starts. */
  delay: number
  /** Seconds the note rings (its envelope's length). */
  dur: number
  /** 0–1, before the bus and the distance. */
  gain: number
}

export interface Key {
  /** MIDI number of the lowest degree a deed can sound. */
  root: number
  mode: "major" | "minor"
}

export const PENTATONIC: Record<Key["mode"], readonly number[]> = {
  major: [0, 2, 4, 7, 9],
  minor: [0, 3, 5, 7, 10],
}

/** Each mood's home key (low register root): Morning Keep in D, Hearth in F, Moonstone in A, Arcane in E. */
const MOOD_ROOT: Record<Mood["id"], number> = { keep: 50, hearth: 53, moonstone: 45, arcane: 52 }
/** Below this daylight the scale turns minor: the night guild sounds like night. */
const NIGHT = 0.25

export function keyOf(mood: Mood["id"], daylight: number): Key {
  return { root: MOOD_ROOT[mood], mode: daylight < NIGHT ? "minor" : "major" }
}

/** The `degree`-th note of the key's scale, counting up from its root across octaves. */
export function degreeOf(key: Key, degree: number): number {
  const scale = PENTATONIC[key.mode]
  const octave = Math.floor(degree / scale.length)
  const step = degree - octave * scale.length
  return key.root + 12 * octave + (scale[step] ?? 0)
}

/** The scale note nearest `midi` (ties go down: rounder). */
export function quantize(midi: number, key: Key): number {
  const scale = PENTATONIC[key.mode]
  const rel = midi - key.root
  const octave = Math.floor(rel / 12)
  let best = key.root
  let distance = Number.POSITIVE_INFINITY
  for (const o of [octave - 1, octave, octave + 1])
    for (const step of [...scale, 12]) {
      const candidate = key.root + 12 * o + step
      const d = Math.abs(candidate - midi)
      if (d < distance || (d === distance && candidate < best)) {
        best = candidate
        distance = d
      }
    }
  return best
}

export function frequencyOf(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12)
}

/** Degrees a deed can land on: about two and a half octaves above the root. */
export const DEED_DEGREES = 12
/** Each doubling of the lines written drops the note this many degrees. */
const DEGREES_PER_DOUBLING = 1.4

/**
 * A deed's pitch. With a size (lines written) the note falls as the diff grows: one line is near the
 * top, a hundred lines near the bottom. Without one (a read, a search, a run) it is a high note picked
 * by hashing the call, so a busy guild's reads sparkle instead of repeating one pitch.
 */
export function pitchOfDeed(size: number | undefined, call: string, key: Key): number {
  if (size === undefined) {
    const upper = Math.floor(DEED_DEGREES / 2)
    return degreeOf(key, upper + (hash(call) % (DEED_DEGREES - upper)))
  }
  const fall = Math.round(Math.log2(1 + Math.max(0, size)) * DEGREES_PER_DOUBLING)
  return degreeOf(key, Math.max(0, DEED_DEGREES - 1 - fall))
}

/** The instrument for each deed kind (the sigil a deed showed while it ran). */
export const TIMBRE_OF: Record<SigilKind, Timbre> = {
  read: "harp",
  edit: "marimba",
  search: "kalimba",
  test: "bell",
  run: "pluck",
  think: "glass",
  dispatch: "horn",
  consult: "glass",
  work: "pluck",
}

/** What a moment needs from the hall to be scored: the deed's sigil kind, the key now. */
export interface Score {
  key: Key
  /** The deed's kind (scene/sigilBoard.ts sigilOfCraft), for `deed` moments. */
  sigil?: SigilKind
}

/**
 * The notes a moment plays, or none. Pure: same moment, same score → same notes.
 *
 *   deed           one note, timbre by kind, pitch by size; bigger diffs ring longer and softer-edged
 *   deed-failed    a low muted thud
 *   fail           a minor descending figure
 *   recover        a rising figure in the key
 *   plea           a gentle two-note call (audio/engine.ts repeats it until answered)
 *   loot           a short major cadence (V → I)
 *   join           a soft horn swell
 *   quest, plea-answered, leave   nothing: the deeds that follow speak for them
 */
export function motifOf(
  moment: { kind: MomentKind; size?: number | undefined; call?: string },
  score: Score,
): Note[] {
  const { key } = score
  const root = key.root
  switch (moment.kind) {
    case "deed": {
      const midi = pitchOfDeed(moment.size, moment.call ?? "", key)
      const low = 1 - (midi - root) / 30
      const timbre = TIMBRE_OF[score.sigil ?? "work"]
      return [{ timbre, midi, delay: 0, dur: 0.7 + 0.9 * clamp01(low), gain: 0.5 }]
    }
    case "deed-failed":
      return [{ timbre: "thud", midi: root - 12, delay: 0, dur: 0.45, gain: 0.55 }]
    case "fail":
      return [7, 3, 0].map((step, i) => ({
        timbre: "harp" as const,
        midi: root + 12 + step,
        delay: i * 0.24,
        dur: 1.1,
        gain: 0.42 - i * 0.05,
      }))
    case "recover":
      return [0, 2, 4].map((degree, i) => ({
        timbre: "kalimba" as const,
        midi: degreeOf(key, 5 + degree),
        delay: i * 0.16,
        dur: 0.8,
        gain: 0.38,
      }))
    case "plea":
      return [
        { timbre: "glass", midi: degreeOf(key, 9), delay: 0, dur: 0.9, gain: 0.32 },
        { timbre: "glass", midi: degreeOf(key, 7), delay: 0.32, dur: 1.2, gain: 0.28 },
      ]
    case "loot":
      return [
        { timbre: "marimba", midi: root + 12 + 7, delay: 0, dur: 0.5, gain: 0.36 },
        { timbre: "marimba", midi: root + 12 + 2, delay: 0, dur: 0.5, gain: 0.24 },
        { timbre: "bell", midi: root + 24, delay: 0.2, dur: 1.4, gain: 0.34 },
        { timbre: "marimba", midi: root + 12 + 4, delay: 0.2, dur: 1, gain: 0.22 },
        { timbre: "marimba", midi: root + 12 + 7, delay: 0.2, dur: 1, gain: 0.2 },
      ]
    case "join":
      return [
        { timbre: "horn", midi: root, delay: 0, dur: 1.6, gain: 0.34 },
        { timbre: "horn", midi: root + 7, delay: 0.08, dur: 1.5, gain: 0.22 },
      ]
    default:
      return []
  }
}

/**
 * The motif for a secret world event (guild/events.ts) as it begins: longer and grander than a
 * moment's, still in the guild's key and on its pentatonic, still a handful of notes. Pure.
 *
 *   festival    a bright fanfare: marimba arpeggio climbing an octave, a bell chord on top
 *   ghost-ship  a slow, hollow minor arpeggio in glass, low, and one distant bell (minor even by day)
 *   rainbow     a quick rising glass-and-kalimba run up the scale, landing on a bell
 *   raid        a horn call in the minor and two drum thuds: the pirates' signal
 *   comet       a falling shimmer of glass high up, then a soft bell
 *   dragon      a low horn growl a semitone apart, and the thud of wings
 */
export function renownMotifOf(kind: EventKind, key: Key): Note[] {
  const root = key.root
  switch (kind) {
    case "festival": {
      const run = [0, 2, 3, 4, 5].map((degree, i) => ({
        timbre: "marimba" as const,
        midi: degreeOf(key, 5 + degree),
        delay: i * 0.11,
        dur: 0.6,
        gain: 0.4,
      }))
      return [
        ...run,
        { timbre: "bell", midi: degreeOf(key, 10), delay: 0.6, dur: 1.8, gain: 0.36 },
        { timbre: "bell", midi: degreeOf(key, 12), delay: 0.62, dur: 1.8, gain: 0.26 },
        { timbre: "horn", midi: root, delay: 0.55, dur: 1.8, gain: 0.22 },
      ]
    }
    case "ghost-ship":
      return [
        ...[0, 3, 7, 10].map((step, i) => ({
          timbre: "glass" as const,
          midi: root + step,
          delay: i * 0.55,
          dur: 2.2,
          gain: 0.3 - i * 0.03,
        })),
        { timbre: "bell", midi: root - 12, delay: 2.4, dur: 2.6, gain: 0.22 },
      ]
    case "rainbow":
      return [
        ...[0, 1, 2, 3, 4, 5, 6].map((degree, i) => ({
          timbre: i % 2 ? ("kalimba" as const) : ("glass" as const),
          midi: degreeOf(key, 5 + degree),
          delay: i * 0.09,
          dur: 0.9,
          gain: 0.3,
        })),
        { timbre: "bell", midi: degreeOf(key, 12), delay: 0.7, dur: 2, gain: 0.32 },
      ]
    case "raid":
      return [
        { timbre: "thud", midi: root - 12, delay: 0, dur: 0.45, gain: 0.5 },
        { timbre: "horn", midi: root, delay: 0.1, dur: 0.7, gain: 0.34 },
        { timbre: "horn", midi: root + 3, delay: 0.55, dur: 0.6, gain: 0.32 },
        { timbre: "thud", midi: root - 12, delay: 0.95, dur: 0.45, gain: 0.5 },
        { timbre: "horn", midi: root + 7, delay: 1.0, dur: 1.4, gain: 0.34 },
      ]
    case "comet":
      return [
        ...[14, 13, 12, 11, 10, 9].map((degree, i) => ({
          timbre: "glass" as const,
          midi: degreeOf(key, degree),
          delay: i * 0.07,
          dur: 0.8,
          gain: 0.24,
        })),
        { timbre: "bell", midi: degreeOf(key, 10), delay: 0.55, dur: 2.2, gain: 0.28 },
      ]
    case "dragon":
      return [
        { timbre: "horn", midi: root - 12, delay: 0, dur: 2.2, gain: 0.36 },
        { timbre: "horn", midi: root - 11, delay: 0.25, dur: 2, gain: 0.2 },
        { timbre: "thud", midi: root - 17, delay: 0.9, dur: 0.5, gain: 0.5 },
        { timbre: "thud", midi: root - 17, delay: 1.6, dur: 0.5, gain: 0.45 },
      ]
  }
}

/** String → small non-negative integer, stable (FNV-1a). */
export function hash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  return (h >>> 0) % 1009
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}
