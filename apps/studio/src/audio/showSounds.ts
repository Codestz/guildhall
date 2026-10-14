/**
 * The world events' own sounds, synthesized and baked once on unlock (no files to fetch): a rocket's
 * whoosh as it climbs from the keep, a shell's burst (a thump and a crack) and its crackle, and the
 * dragon's roar as it banks in over the peaks. Each play is one buffer source through a low-pass, a
 * level and a pan into the spot-sound bus; its nodes are let go when it ends. The bakes are pure
 * functions of a random stream (tested), like the ambience's thunder.
 */

export type ShowSoundName = "launch" | "burst" | "crackle" | "roar"

/** Each sound's length, seconds, and its level on the bus (0–1). */
export const SHOW_SOUNDS: Readonly<Record<ShowSoundName, { seconds: number; gain: number }>> = {
  launch: { seconds: 1.1, gain: 0.22 },
  burst: { seconds: 1.6, gain: 0.55 },
  crackle: { seconds: 1.4, gain: 0.3 },
  roar: { seconds: 2.6, gain: 0.7 },
}

/** Scales `data` so its loudest sample is `peak` (a bake's level is then its `SHOW_SOUNDS` gain's alone). */
function peakAt(data: Float32Array, peak: number): void {
  let max = 0
  for (const v of data) max = Math.max(max, Math.abs(v))
  if (max > 0) for (let i = 0; i < data.length; i++) data[i] = ((data[i] as number) / max) * peak
}

/** A rocket climbing: band-limited noise rising in pitch, swelling then thinning out. */
export function bakeLaunch(data: Float32Array, rate: number, random: () => number): void {
  let lo = 0
  let phase = 0
  const n = data.length
  for (let i = 0; i < n; i++) {
    const t = i / rate
    const k = i / n
    const white = random() * 2 - 1
    // a one-pole low-pass whose corner rises with the climb: the hiss goes up
    const a = 0.04 + 0.4 * k
    lo += a * (white - lo)
    phase += (2 * Math.PI * (900 + 1600 * k)) / rate
    const whistle = Math.sin(phase) * 0.12 * k
    const env = Math.min(1, t / 0.08) * (1 - k) ** 1.5
    data[i] = (lo * 1.6 + whistle) * env
  }
}

/** A shell bursting: a low thump, a sharp crack on top of it, and a short echo off the hills. */
export function bakeBurst(data: Float32Array, rate: number, random: () => number): void {
  let brown = 0
  const n = data.length
  for (let i = 0; i < n; i++) {
    const t = i / rate
    const white = random() * 2 - 1
    brown = (brown + 0.05 * white) / 1.05
    const thump = Math.sin(2 * Math.PI * 55 * t * (1 - 0.35 * Math.min(1, t / 0.4))) * Math.exp(-t / 0.18)
    const crack = white * Math.exp(-t / 0.035)
    const body = brown * 4 * Math.exp(-t / 0.35)
    const echo = t > 0.42 ? brown * 2.2 * Math.exp(-(t - 0.42) / 0.3) : 0
    data[i] = 0.9 * thump + 0.45 * crack + body + echo
  }
  peakAt(data, 0.95)
}

/** A crackle shell burning out: sparse sharp pops, thickening, then dying away. */
export function bakeCrackle(data: Float32Array, rate: number, random: () => number): void {
  data.fill(0)
  const n = data.length
  const seconds = n / rate
  const pops = Math.round(70 * seconds)
  for (let p = 0; p < pops; p++) {
    // more of them early on
    const at = Math.floor(random() ** 1.6 * n)
    const peak = (0.4 + 0.6 * random()) * (1 - at / n)
    const len = Math.floor(rate * (0.002 + 0.004 * random()))
    for (let j = 0; j < len && at + j < n; j++)
      data[at + j] = (data[at + j] as number) + (random() * 2 - 1) * peak * (1 - j / len) ** 2
  }
}

/**
 * The dragon's roar: a growl at a falling pitch (stacked harmonics, a ragged tremolo), a breathy
 * rasp over it, swelling and dying away.
 */
export function bakeRoar(data: Float32Array, rate: number, random: () => number): void {
  let phase = 0
  let rasp = 0
  const n = data.length
  for (let i = 0; i < n; i++) {
    const t = i / rate
    const k = i / n
    const pitch = 118 - 52 * k + 7 * Math.sin(t * 5.3)
    phase += (2 * Math.PI * pitch) / rate
    let growl = 0
    for (let h = 1; h <= 7; h++) growl += Math.sin(phase * h + h * 0.7) / h ** 0.9
    // the throat's flutter
    const flutter = 0.65 + 0.35 * Math.sin(t * 2 * Math.PI * 23 + Math.sin(t * 7) * 2)
    const white = random() * 2 - 1
    rasp += 0.25 * (white - rasp)
    const env = Math.min(1, t / 0.25) ** 1.5 * (1 - k) ** 1.2
    data[i] = (0.22 * growl * flutter + 0.7 * rasp) * env
  }
}

const BAKES: Record<ShowSoundName, (data: Float32Array, rate: number, random: () => number) => void> = {
  launch: bakeLaunch,
  burst: bakeBurst,
  crackle: bakeCrackle,
  roar: bakeRoar,
}

/** The show sounds of one audio context: baked once, played on demand. */
export class ShowSounds {
  private buffers: Record<ShowSoundName, AudioBuffer>

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly out: AudioNode,
    random: () => number = Math.random,
  ) {
    const bake = (name: ShowSoundName) => {
      const buffer = ctx.createBuffer(
        1,
        Math.floor(ctx.sampleRate * SHOW_SOUNDS[name].seconds),
        ctx.sampleRate,
      )
      BAKES[name](buffer.getChannelData(0), ctx.sampleRate, random)
      return buffer
    }
    this.buffers = {
      launch: bake("launch"),
      burst: bake("burst"),
      crackle: bake("crackle"),
      roar: bake("roar"),
    }
  }

  /** `name` `delay` s from now, at `pan` and `gain` (0–1); far ones duller (`gain` closes the low-pass). */
  play(name: ShowSoundName, delay: number, pan: number, gain: number, rate = 1): void {
    const ctx = this.ctx
    const source = ctx.createBufferSource()
    source.buffer = this.buffers[name]
    source.playbackRate.value = rate
    const low = ctx.createBiquadFilter()
    low.type = "lowpass"
    low.frequency.value = 1200 + 9000 * gain
    low.Q.value = 0.5
    const level = ctx.createGain()
    level.gain.value = SHOW_SOUNDS[name].gain * gain
    const panner = ctx.createStereoPanner()
    panner.pan.value = pan
    source.connect(low).connect(level).connect(panner).connect(this.out)
    source.onended = () => {
      for (const node of [source, low, level, panner]) node.disconnect()
    }
    source.start(ctx.currentTime + Math.max(0, delay))
  }
}
