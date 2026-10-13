// From V1 hall (legacy/packages/hall/src/audio/ambience.ts): `ambienceOf` is held to its goldens
// (test/audio.test.ts); the V2 island adds a town's crowd, birds by day and the storm's thunder.
import { type Listener, placeOf, smoothstep } from "./spatial.ts"

/**
 * The world's bed of sound, under the notes: wind, rain, a distant sea, fire near the hearth, insects
 * on a clear night (V1), and on the V2 island a town's crowd near its square and birds by day; a storm
 * adds thunder after each lightning strike. `ambienceOf` and `bedOf` say how loud each layer should be
 * (pure, tested); `Ambience` is seven looping voices built once on unlock and only ever re-levelled
 * (≈10 Hz), so nothing is allocated while it plays (a thunderclap is one buffer source per strike).
 */

/** What V1's environment said about the weather and the light (legacy guild/environment.ts). */
export interface AmbienceEnv {
  weather: "clear" | "cloudy" | "rain" | "storm" | "snow" | (string & {})
  /** 0–1. */
  precipitation: number
  /** 0 night … 1 day. */
  daylight: number
  /** 0–1. */
  cloudCover: number
  /** °C. */
  temperature: number
}

export interface AmbienceInput {
  env: AmbienceEnv
  /** The wind, eased, 0–1. */
  wind: number
  listener: Listener
  /** World units from the listener's focus to the nearest open water. */
  sea: number
  /** World units from the listener's focus to the nearest fire (hearth, forge). */
  fire: number
}

export interface AmbienceLevels {
  wind: number
  rain: number
  sea: number
  fire: number
  insects: number
}

export const SILENT: AmbienceLevels = { wind: 0, rain: 0, sea: 0, fire: 0, insects: 0 }

export function ambienceOf({ env, wind, listener, sea, fire }: AmbienceInput): AmbienceLevels {
  const r = listener.radius
  const wet = smoothstep(0, 0.08, env.precipitation)
  const snow = env.weather === "snow"
  // The fire is only heard close up: near it, and zoomed in.
  const close = 1 - smoothstep(18, 45, r)
  const night = 1 - smoothstep(0.08, 0.3, env.daylight)
  const clear = 1 - smoothstep(0.35, 0.65, env.cloudCover)
  const calm = 1 - smoothstep(0.45, 0.8, wind)
  const warm = smoothstep(2, 10, env.temperature)
  return {
    wind: round(0.08 + 0.92 * Math.max(0, wind) ** 1.4),
    // Snow falls with a hush, not a patter.
    rain: round(env.precipitation * (snow ? 0.2 : 1)),
    sea: round((1 - smoothstep(0.15 * r, 1.3 * r, sea)) * (0.6 + 0.4 * wind)),
    fire: round((1 - smoothstep(3, 14, fire)) * close),
    insects: round(night * clear * calm * warm * (1 - wet)),
  }
}

/** The whole bed: V1's five layers and the V2 island's two. */
export interface BedLevels extends AmbienceLevels {
  crowd: number
  birds: number
}

export interface BedInput extends AmbienceInput {
  /** World units from the focus to the nearest town's square, and how big a place it is (0–1). */
  town: { distance: number; weight: number }
}

/**
 * The bed's levels: `ambienceOf`, and a crowd that murmurs near a town's square (bigger places louder,
 * hushed at night and in the rain, faint from the map view), and birds by day over land (not over the
 * open water, not in rain or a gale).
 */
export function bedOf(input: BedInput): BedLevels {
  const v1 = ambienceOf(input)
  const { env, wind, listener, sea, town } = input
  const r = listener.radius
  const day = smoothstep(0.15, 0.55, env.daylight)
  const wet = smoothstep(0, 0.08, env.precipitation)
  const near = 1 - smoothstep(0.25 * r, 1.4 * r, town.distance)
  const zoom = 1 - smoothstep(30, 110, r)
  const land = smoothstep(0.05 * r, 0.4 * r, sea)
  const calm = 1 - smoothstep(0.4, 0.85, wind)
  return {
    ...v1,
    crowd: round(near * Math.min(1, Math.max(0, town.weight)) * (0.3 + 0.7 * day) * (1 - 0.6 * wet) * zoom),
    birds: round(day * land * calm * (1 - wet) * (1 - 0.5 * smoothstep(0.5, 0.9, env.cloudCover))),
  }
}

/** Each layer's level at full, inside the ambience bus: a bed, never a wall. */
const MIX: BedLevels = {
  wind: 0.32,
  rain: 0.42,
  sea: 0.3,
  fire: 0.45,
  insects: 0.1,
  crowd: 0.22,
  birds: 0.12,
}
/** A thunderclap's level in the ambience bus, near; far ones are softer (`placeOf`, floor 0.3). */
const THUNDER = 0.9
/** Seconds for a level to settle: weather changes are slow, a camera move a little quicker. */
const GLIDE = 0.7

type Layer = keyof BedLevels

export class Ambience {
  private gains: Record<Layer, GainNode>
  private firePan: StereoPannerNode
  private crowdPan: StereoPannerNode
  private sources: AudioScheduledSourceNode[] = []
  private claps: AudioBuffer[]
  private out: AudioNode

  constructor(
    private readonly ctx: BaseAudioContext,
    out: AudioNode,
    random: () => number = Math.random,
  ) {
    this.out = out
    const rate = ctx.sampleRate
    const noise = bake(ctx, 3, (data) => {
      for (let i = 0; i < data.length; i++) data[i] = random() * 2 - 1
    })
    const level = (): GainNode => {
      const gain = ctx.createGain()
      gain.gain.value = 0
      gain.connect(out)
      return gain
    }
    this.gains = {
      wind: level(),
      rain: level(),
      sea: level(),
      fire: level(),
      insects: level(),
      crowd: level(),
      birds: level(),
    }

    // Wind: band-passed noise whose centre wanders, with slow gusts.
    const windBand = filter(ctx, "bandpass", 480, 0.7)
    const gust = ctx.createGain()
    gust.gain.value = 0.7
    this.loop(noise, 0).connect(windBand).connect(gust).connect(this.gains.wind)
    this.lfo(0.11, 220, windBand.frequency)
    this.lfo(0.07, 0.3, gust.gain)

    // Rain: a hiss with baked droplet grains in it.
    const rain = bake(ctx, 4, (data) => {
      for (let i = 0; i < data.length; i++) data[i] = (random() * 2 - 1) * 0.22
      grains(data, rate, 140, 0.002, 0.6, random)
    })
    this.loop(rain, 0)
      .connect(filter(ctx, "highpass", 800, 0.5))
      .connect(filter(ctx, "lowpass", 6500, 0.5))
      .connect(this.gains.rain)

    // Sea: low noise breathing like waves.
    const swell = ctx.createGain()
    swell.gain.value = 0.65
    this.loop(noise, 1.3)
      .connect(filter(ctx, "lowpass", 380, 0.6))
      .connect(swell)
      .connect(this.gains.sea)
    this.lfo(0.09, 0.35, swell.gain)

    // Fire: baked crackle (sparse sharp grains) over a soft roar, panned to where the fire is.
    const crackle = bake(ctx, 4, (data) => {
      for (let i = 0; i < data.length; i++) data[i] = (random() * 2 - 1) * 0.05
      grains(data, rate, 22, 0.003, 1, random)
    })
    this.firePan = ctx.createStereoPanner()
    this.loop(crackle, 0)
      .connect(filter(ctx, "bandpass", 1800, 0.4))
      .connect(this.firePan)
      .connect(this.gains.fire)

    // Insects: two crickets' chirps, baked.
    const crickets = bake(ctx, 5, (data) => chirps(data, rate, random))
    this.loop(crickets, 0)
      .connect(filter(ctx, "highpass", 2500, 0.5))
      .connect(this.gains.insects)

    // Crowd: a town square's murmur, baked (talkers' syllables of voiced noise), panned to the square.
    const murmur = bake(ctx, 6, (data) => babble(data, rate, random))
    this.crowdPan = ctx.createStereoPanner()
    this.loop(murmur, 0)
      .connect(filter(ctx, "lowpass", 1600, 0.5))
      .connect(this.crowdPan)
      .connect(this.gains.crowd)

    // Birds: a few songbirds' phrases, baked, high up.
    const song = bake(ctx, 9, (data) => birdsong(data, rate, random))
    this.loop(song, 0)
      .connect(filter(ctx, "highpass", 1800, 0.5))
      .connect(this.gains.birds)

    // Thunder: two claps baked once; each strike plays one.
    this.claps = [0, 1].map(() => bake(ctx, 4.5, (data) => clap(data, rate, random)))
  }

  /** New target levels; `firePan` and `crowdPan` place the crackle and the murmur (−1…1). */
  set(levels: BedLevels, firePan = 0, crowdPan = 0): void {
    const at = this.ctx.currentTime
    for (const layer of Object.keys(MIX) as Layer[])
      this.gains[layer].gain.setTargetAtTime(levels[layer] * MIX[layer], at, GLIDE)
    this.firePan.pan.setTargetAtTime(firePan, at, GLIDE)
    this.crowdPan.pan.setTargetAtTime(crowdPan, at, GLIDE)
  }

  /**
   * A thunderclap `delay` s from now (light is quick, sound is not: the farther, the later), at `pan`
   * and `gain` (0–1). Its nodes are disconnected when it ends.
   */
  thunder(delay: number, pan: number, gain: number, pick = 0): void {
    const ctx = this.ctx
    const buffer = this.claps[Math.min(this.claps.length - 1, Math.floor(pick * this.claps.length))]
    if (!buffer) return
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.playbackRate.value = 0.85 + 0.3 * pick
    const low = filter(ctx, "lowpass", 900 + 1400 * gain, 0.5)
    const level = ctx.createGain()
    level.gain.value = THUNDER * gain
    const panner = ctx.createStereoPanner()
    panner.pan.value = pan
    source.connect(low).connect(level).connect(panner).connect(this.out)
    source.onended = () => {
      for (const node of [source, low, level, panner]) node.disconnect()
    }
    source.start(ctx.currentTime + Math.max(0, delay))
  }

  stop(): void {
    for (const source of this.sources) {
      source.stop()
      source.disconnect()
    }
    this.sources = []
  }

  private loop(buffer: AudioBuffer, offset: number): AudioBufferSourceNode {
    const source = this.ctx.createBufferSource()
    source.buffer = buffer
    source.loop = true
    source.start(0, offset % buffer.duration)
    this.sources.push(source)
    return source
  }

  /** A slow sine that adds ±`depth` to `param`. */
  private lfo(hz: number, depth: number, param: AudioParam): void {
    const osc = this.ctx.createOscillator()
    osc.frequency.value = hz
    const amount = this.ctx.createGain()
    amount.gain.value = depth
    osc.connect(amount).connect(param)
    osc.start()
    this.sources.push(osc)
  }
}

/** Where an ambience spot sits for the listener: the fire's (or the crowd's) pan. */
export function firePanOf(x: number, z: number, listener: Listener): number {
  return placeOf(x, z, listener, 0).pan
}

function filter(ctx: BaseAudioContext, type: BiquadFilterType, frequency: number, q: number) {
  const node = ctx.createBiquadFilter()
  node.type = type
  node.frequency.value = frequency
  node.Q.value = q
  return node
}

function bake(ctx: BaseAudioContext, seconds: number, fill: (data: Float32Array) => void): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate)
  fill(buffer.getChannelData(0))
  return buffer
}

/** Simple granular synthesis, baked: `perSecond` random clicks, each a decaying noise burst. */
function grains(
  data: Float32Array,
  rate: number,
  perSecond: number,
  decay: number,
  peak: number,
  random: () => number,
): void {
  const count = Math.floor((data.length / rate) * perSecond)
  const length = Math.floor(rate * decay * 5)
  for (let g = 0; g < count; g++) {
    const start = Math.floor(random() * (data.length - length))
    const amp = peak * (0.2 + 0.8 * random() ** 2)
    for (let i = 0; i < length; i++)
      data[start + i] = (data[start + i] ?? 0) + (random() * 2 - 1) * amp * Math.exp(-i / (rate * decay))
  }
}

/** Cricket chirps: bursts of 3 pulses of a ~4.6 kHz tone, two insects at their own pace. */
function chirps(data: Float32Array, rate: number, random: () => number): void {
  for (const [hz, every, phase] of [
    [4600, 0.9, 0.1],
    [4300, 1.3, 0.55],
  ] as const) {
    for (let t = phase; t < data.length / rate - 0.2; t += every * (0.85 + random() * 0.3))
      for (let p = 0; p < 3; p++) {
        const start = Math.floor((t + p * 0.035) * rate)
        const length = Math.floor(0.022 * rate)
        for (let i = 0; i < length && start + i < data.length; i++) {
          const env = Math.sin((Math.PI * i) / length)
          data[start + i] = (data[start + i] ?? 0) + Math.sin((2 * Math.PI * hz * i) / rate) * env * 0.5
        }
      }
  }
}

/**
 * A crowd's murmur: eight talkers, each a run of syllables (80–260 ms bursts of noise through a
 * resonance at their own voice's pitch region), with pauses; no words, only the hum of a square.
 */
function babble(data: Float32Array, rate: number, random: () => number): void {
  const seconds = data.length / rate
  for (let talker = 0; talker < 8; talker++) {
    // a two-pole resonator per talker: its formant somewhere in 350–1100 Hz
    const f = 350 + random() * 750
    const r = 0.985
    const a1 = 2 * r * Math.cos((2 * Math.PI * f) / rate)
    const a2 = -r * r
    let y1 = 0
    let y2 = 0
    let t = random() * 0.6
    while (t < seconds - 0.3) {
      const len = 0.08 + random() * 0.18
      const start = Math.floor(t * rate)
      const n = Math.floor(len * rate)
      const amp = 0.012 + random() * 0.02
      for (let i = 0; i < n && start + i < data.length; i++) {
        const env = Math.sin((Math.PI * i) / n) ** 2
        const y = (random() * 2 - 1) * env + a1 * y1 + a2 * y2
        y2 = y1
        y1 = y
        data[start + i] = (data[start + i] ?? 0) + y * amp
      }
      // the next syllable soon, now and then a breath
      t += len + (random() < 0.2 ? 0.3 + random() * 0.7 : 0.02 + random() * 0.08)
    }
  }
}

/** Birdsong: three birds, each now and then a phrase of 3–7 quick falling or rising whistles. */
function birdsong(data: Float32Array, rate: number, random: () => number): void {
  const seconds = data.length / rate
  for (let bird = 0; bird < 3; bird++) {
    const base = 2600 + random() * 2200
    let t = 0.2 + random() * 1.5
    while (t < seconds - 1) {
      const notes = 3 + Math.floor(random() * 5)
      const fall = random() < 0.6
      for (let k = 0; k < notes; k++) {
        const len = 0.04 + random() * 0.07
        const start = Math.floor(t * rate)
        const n = Math.floor(len * rate)
        const f0 = base * (1 + 0.25 * random())
        const f1 = f0 * (fall ? 0.7 : 1.35)
        let phase = 0
        for (let i = 0; i < n && start + i < data.length; i++) {
          const u = i / n
          const f = f0 + (f1 - f0) * u
          phase += (2 * Math.PI * f) / rate
          const env = Math.sin(Math.PI * u) ** 1.5
          data[start + i] =
            (data[start + i] ?? 0) + Math.sin(phase + 0.6 * Math.sin(phase * 0.5)) * env * 0.16
        }
        t += len + 0.025 + random() * 0.05
      }
      t += 1.2 + random() * 2.8
    }
  }
}

/** A thunderclap: a short bright crack, then a low rumble (integrated noise) that swells and dies. */
function clap(data: Float32Array, rate: number, random: () => number): void {
  let brown = 0
  const swells = [0.15 + random() * 0.2, 0.7 + random() * 0.6, 1.6 + random() * 0.8]
  for (let i = 0; i < data.length; i++) {
    const t = i / rate
    const white = random() * 2 - 1
    brown = (brown + 0.02 * white) / 1.02
    const crack = t < 0.12 ? white * (1 - t / 0.12) ** 2 * 0.5 : 0
    let rumble = 0
    for (const s of swells) {
      const d = t - s
      if (d > 0) rumble += Math.exp(-d / 0.9) * (1 - Math.exp(-d / 0.05))
    }
    data[i] = crack + brown * 3.2 * rumble * Math.exp(-t / 2.2)
  }
}

const round = (value: number): number => Math.round(value * 1000) / 1000
