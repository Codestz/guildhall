import { frequencyOf, type Note, type Timbre } from "./music.ts"

/**
 * The instruments: a few oscillators and envelopes per note, built when a cue starts and
 * disconnected when its last oscillator ends. Nothing here runs per frame.
 *
 * A cue is one panner + gain on a bus; its notes feed it. `play` returns when the cue goes quiet.
 */

/** A partial: frequency ratio, level, how fast it dies relative to the note, and its wave. */
type Partial = readonly [ratio: number, level: number, life: number, wave: OscillatorType]

interface Voice {
  partials: readonly Partial[]
  /** Seconds to reach the peak. */
  attack: number
  /** Low-pass cutoff as a multiple of the fundamental (rounds the tone); none when absent. */
  tone?: number
  /** Pitch drop over the note, as a ratio of the start (the thud). */
  drop?: number
}

const VOICES: Record<Timbre, Voice> = {
  harp: {
    partials: [
      [1, 1, 1, "triangle"],
      [2, 0.25, 0.5, "sine"],
      [3, 0.1, 0.3, "sine"],
    ],
    attack: 0.004,
    tone: 6,
  },
  marimba: {
    partials: [
      [1, 1, 1, "sine"],
      [4, 0.35, 0.15, "sine"],
      [10, 0.08, 0.05, "sine"],
    ],
    attack: 0.003,
  },
  bell: {
    partials: [
      [1, 1, 1, "sine"],
      [2.76, 0.45, 0.6, "sine"],
      [5.4, 0.2, 0.35, "sine"],
      [8.93, 0.08, 0.2, "sine"],
    ],
    attack: 0.002,
  },
  pluck: {
    partials: [
      [1, 1, 1, "triangle"],
      [2, 0.3, 0.4, "triangle"],
    ],
    attack: 0.003,
    tone: 2.5,
  },
  kalimba: {
    partials: [
      [1, 1, 1, "sine"],
      [5.2, 0.18, 0.12, "sine"],
    ],
    attack: 0.003,
  },
  glass: {
    partials: [
      [1, 1, 1, "sine"],
      [2.003, 0.3, 0.7, "sine"],
    ],
    attack: 0.02,
  },
  horn: {
    partials: [
      [1, 1, 1, "sawtooth"],
      [1.004, 0.6, 1, "sawtooth"],
    ],
    attack: 0.45,
    tone: 3,
  },
  thud: {
    partials: [
      [1, 1, 1, "sine"],
      [1.5, 0.3, 0.4, "triangle"],
    ],
    attack: 0.004,
    tone: 4,
    drop: 0.6,
  },
}

/** Overall trim per instrument, so a horn's saws and a bell's sines sit at one loudness. */
const TRIM: Record<Timbre, number> = {
  harp: 0.5,
  marimba: 0.6,
  bell: 0.35,
  pluck: 0.6,
  kalimba: 0.55,
  glass: 0.35,
  horn: 0.16,
  thud: 0.9,
}

/** Plays `notes` as one cue into `bus` at `pan` / `gain`, starting `at` (ctx time). Returns its end. */
export function play(
  ctx: BaseAudioContext,
  bus: AudioNode,
  notes: readonly Note[],
  pan: number,
  gain: number,
  at = ctx.currentTime,
): number {
  const panner = ctx.createStereoPanner()
  panner.pan.value = pan
  const level = ctx.createGain()
  level.gain.value = gain
  level.connect(panner).connect(bus)
  const nodes: AudioNode[] = [level, panner]
  let end = at
  let last: OscillatorNode | undefined
  for (const note of notes) {
    const start = at + note.delay
    const stop = start + note.dur + 0.05
    const voice = VOICES[note.timbre]
    const f = frequencyOf(note.midi)
    let into: AudioNode = level
    if (voice.tone) {
      const lowpass = ctx.createBiquadFilter()
      lowpass.type = "lowpass"
      lowpass.frequency.value = Math.min(16000, f * voice.tone)
      lowpass.Q.value = 0.3
      lowpass.connect(level)
      nodes.push(lowpass)
      into = lowpass
    }
    for (const [ratio, partLevel, life, wave] of voice.partials) {
      const osc = ctx.createOscillator()
      osc.type = wave
      osc.frequency.setValueAtTime(f * ratio, start)
      if (voice.drop) osc.frequency.exponentialRampToValueAtTime(f * ratio * voice.drop, start + note.dur)
      const env = ctx.createGain()
      const peak = note.gain * partLevel * TRIM[note.timbre]
      const decay = Math.max(0.03, note.dur * life)
      env.gain.setValueAtTime(0, start)
      env.gain.linearRampToValueAtTime(peak, start + voice.attack)
      // An exponential tail that reaches silence by the note's end (a sustained horn fades late).
      env.gain.setTargetAtTime(0, start + voice.attack + (voice.attack > 0.1 ? decay * 0.4 : 0), decay / 4)
      osc.connect(env).connect(into)
      osc.start(start)
      osc.stop(stop)
      nodes.push(osc, env)
      if (stop >= end) {
        end = stop
        last = osc
      }
    }
  }
  if (last) last.onended = () => disconnect(nodes)
  else disconnect(nodes)
  return end
}

/** Plays a decoded sample as one cue. */
export function playBuffer(
  ctx: BaseAudioContext,
  bus: AudioNode,
  buffer: AudioBuffer,
  rate: number,
  pan: number,
  gain: number,
  at = ctx.currentTime,
): number {
  const source = ctx.createBufferSource()
  source.buffer = buffer
  source.playbackRate.value = rate
  const level = ctx.createGain()
  level.gain.value = gain
  const panner = ctx.createStereoPanner()
  panner.pan.value = pan
  source.connect(level).connect(panner).connect(bus)
  source.onended = () => disconnect([source, level, panner])
  source.start(at)
  return at + buffer.duration / rate
}

function disconnect(nodes: readonly AudioNode[]): void {
  for (const node of nodes) node.disconnect()
}
