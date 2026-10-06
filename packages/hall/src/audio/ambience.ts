import type { Environment } from "../guild/environment.ts"
import { type Listener, placeOf, smoothstep } from "./spatial.ts"

/**
 * The world's bed of sound, under the notes: wind, rain, a distant sea, fire near the hearth and the
 * forge, insects on a clear night. `ambienceOf` says how loud each layer should be (pure, tested);
 * `Ambience` is five looping noise voices built once on unlock and only ever re-levelled (≈10 Hz),
 * so nothing is allocated while it plays.
 */
export interface AmbienceInput {
  env: Pick<Environment, "weather" | "precipitation" | "daylight" | "cloudCover" | "temperature">
  /** The shared, eased wind (scene/atmosphere/wind.ts `wind.strength`), 0–1. */
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

/** Each layer's level at full, inside the ambience bus: a bed, never a wall. */
const MIX: AmbienceLevels = { wind: 0.32, rain: 0.42, sea: 0.3, fire: 0.45, insects: 0.1 }
/** Seconds for a level to settle: weather changes are slow, a camera move a little quicker. */
const GLIDE = 0.7

type Layer = keyof AmbienceLevels

export class Ambience {
  private gains: Record<Layer, GainNode>
  private firePan: StereoPannerNode
  private sources: AudioScheduledSourceNode[] = []

  constructor(
    private readonly ctx: BaseAudioContext,
    out: AudioNode,
  ) {
    const rate = ctx.sampleRate
    const noise = bake(ctx, 3, (data) => {
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    })
    const level = (): GainNode => {
      const gain = ctx.createGain()
      gain.gain.value = 0
      gain.connect(out)
      return gain
    }
    this.gains = { wind: level(), rain: level(), sea: level(), fire: level(), insects: level() }

    // Wind: band-passed noise whose centre wanders, with slow gusts.
    const windBand = filter(ctx, "bandpass", 480, 0.7)
    const gust = ctx.createGain()
    gust.gain.value = 0.7
    this.loop(noise, 0).connect(windBand).connect(gust).connect(this.gains.wind)
    this.lfo(0.11, 220, windBand.frequency)
    this.lfo(0.07, 0.3, gust.gain)

    // Rain: a hiss with baked droplet grains in it.
    const rain = bake(ctx, 4, (data) => {
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.22
      grains(data, rate, 140, 0.002, 0.6)
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
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.05
      grains(data, rate, 22, 0.003, 1)
    })
    this.firePan = ctx.createStereoPanner()
    this.loop(crackle, 0)
      .connect(filter(ctx, "bandpass", 1800, 0.4))
      .connect(this.firePan)
      .connect(this.gains.fire)

    // Insects: two crickets' chirps, baked.
    const crickets = bake(ctx, 5, (data) => chirps(data, rate))
    this.loop(crickets, 0)
      .connect(filter(ctx, "highpass", 2500, 0.5))
      .connect(this.gains.insects)
  }

  /** New target levels; `firePan` places the crackle (−1…1). */
  set(levels: AmbienceLevels, firePan = 0): void {
    const at = this.ctx.currentTime
    for (const layer of Object.keys(MIX) as Layer[])
      this.gains[layer].gain.setTargetAtTime(levels[layer] * MIX[layer], at, GLIDE)
    this.firePan.pan.setTargetAtTime(firePan, at, GLIDE)
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

/** Where an ambience spot sits for the listener: the fire's pan. */
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
function grains(data: Float32Array, rate: number, perSecond: number, decay: number, peak: number): void {
  const count = Math.floor((data.length / rate) * perSecond)
  const length = Math.floor(rate * decay * 5)
  for (let g = 0; g < count; g++) {
    const start = Math.floor(Math.random() * (data.length - length))
    const amp = peak * (0.2 + 0.8 * Math.random() ** 2)
    for (let i = 0; i < length; i++)
      data[start + i] = (data[start + i] ?? 0) + (Math.random() * 2 - 1) * amp * Math.exp(-i / (rate * decay))
  }
}

/** Cricket chirps: bursts of 3 pulses of a ~4.6 kHz tone, two insects at their own pace. */
function chirps(data: Float32Array, rate: number): void {
  for (const [hz, every, phase] of [
    [4600, 0.9, 0.1],
    [4300, 1.3, 0.55],
  ] as const) {
    for (let t = phase; t < data.length / rate - 0.2; t += every * (0.85 + Math.random() * 0.3))
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

const round = (value: number): number => Math.round(value * 1000) / 1000
