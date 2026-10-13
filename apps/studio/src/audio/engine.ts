// From V1 hall (legacy/packages/hall/src/audio/engine.ts); the V2 island adds the bed's crowd, birds and thunder.
import type { EventKind } from "@guildhall/sim"
import { Ambience, type BedLevels } from "./ambience.ts"
import type { CueKind, SigilKind } from "./kinds.ts"
import { type Bus, Limiter, PleaCalls, type Verdict } from "./limiter.ts"
import { type Key, keyOf, motifOf, type Note, renownMotifOf } from "./music.ts"
import { filesOf, loadSamples, type Rendition, renditionOf, SAMPLES, type SampleName } from "./samples.ts"
import { type Listener, NO_LISTENER, placeOf } from "./spatial.ts"
import { play, playBuffer } from "./synth.ts"

/**
 * The guild's sound. One AudioContext, made only by `unlock()` inside a gesture (browsers' autoplay
 * rule); until then nothing of WebAudio exists:
 *
 *   notes (×0.9) ┐
 *   sfx   (×0.7) ┼─► compressor (−20 dB, 3:1) ─► master ─► limiter (−3 dB, 20:1) ─► speakers
 *   amb.  (×0.55)┘
 *
 * Moments become cues (music.ts motifs, samples.ts spot sounds) that pass the limiter (polyphony per
 * bus, cooldown per sound) and are placed by the camera (spatial.ts). Only what the clock plays through
 * sounds (driver.ts): a seek, a loop or a new log calls `rebuild`, which silences pleas still calling.
 * Muted or hidden, the context is suspended (no CPU).
 */

export interface SoundLevels {
  on: boolean
  /** 0–1 each. */
  master: number
  notes: number
  ambience: number
}

/** Where a cue sounds, on the ground. */
export interface Where {
  x: number
  z: number
}

/** A moment as the engine hears it: what happened, to whom, and a deed's size and call. */
export interface MomentCue {
  kind: CueKind
  /** Who: the actor's session id (a plea's call is theirs), or the sea's. */
  id: string
  size?: number | undefined
  call?: string | undefined
}

/** What the island knows about a moment that the moment itself doesn't say. */
export interface MomentInfo {
  where?: Where | undefined
  /** The deed's sigil kind (kinds.ts sigilOfCraft). */
  sigil?: SigilKind | undefined
  /** A spot sound to go with it (samples.ts sampleFor). */
  sample?: SampleName | null | undefined
  /** Where the spot sound comes from when not from the adventurer (the monastery's bell). */
  sampleAt?: Where | undefined
}

/** One decision, for the probe: what would play (or why it didn't). */
export interface ProbeCue {
  /** Seconds on the engine's clock. */
  t: number
  sound: string
  bus: Bus
  verdict: Verdict
  /** MIDI notes, in order. */
  notes: number[]
  timbres: string[]
  sample?: string
  pan: number
  gain: number
  who?: string
  /** The session's clock (epoch ms) the cue was heard at, when the driver says. */
  at?: number
}

export type EngineState = "locked" | "running" | "suspended"

/** What `window.guildhall.ext.audio.stats()` reports. */
export interface AudioStats {
  state: EngineState
  audible: boolean
  /** Cues sounding now, per bus. */
  voices: Record<Bus, number>
  /** Cue decisions by verdict, since the engine was made. */
  cues: Record<Verdict, number>
  /** Plays by sound (`deed:edit`, `loot`, `sample:forge`, `thunder`…). */
  fired: Record<string, number>
  pleas: number
  samples: { loaded: number; listed: number }
  thunder: number
  /** The bed's levels, last set. */
  bed: BedLevels | null
}

/** Distance floor: a far deed is soft, never silent (it is the guild's music); a far spot sound fades out. */
const NOTE_FLOOR = 0.25
const SFX_FLOOR = 0.08
/** A far thunderclap is still heard: a storm fills the sky. */
const THUNDER_FLOOR = 0.3
/** Seconds between two thunderclaps at least (strikes come every 4–11 s). */
const THUNDER_COOLDOWN = 2
const PROBE_KEEP = 2000

/** Level curves: sliders are perceptual, gains are not. */
const curve = (value: number): number => Math.max(0, Math.min(1, value)) ** 2
/** Bus trims: notes on top, spot sounds beneath, ambience a bed. */
const TRIM = { notes: 0.9, sfx: 0.7, ambience: 0.55 }

interface Graph {
  ctx: AudioContext
  buses: Record<Bus | "ambience", GainNode>
  master: GainNode
  ambience: Ambience
}

export class AudioEngine {
  readonly limiter = new Limiter()
  readonly pleas = new PleaCalls()
  /** Set to an array to record every decision (`?probe`, the shots). */
  probe: ProbeCue[] | null = null
  /** The session time of the cue being heard (the driver sets it around `moment`), for the probe. */
  hearing: number | undefined
  private graph: Graph | null = null
  private buffers = new Map<string, AudioBuffer>()
  private levels: SoundLevels = { on: false, master: 0.7, notes: 0.8, ambience: 0.5 }
  private hidden = false
  private listener: Listener = NO_LISTENER
  private key: Key = keyOf("keep", 1)
  private listeners = new Set<() => void>()
  private current: EngineState = "locked"
  private counts: Record<Verdict, number> = { play: 0, cooldown: 0, polyphony: 0 }
  private fired: Record<string, number> = {}
  private thunders = 0
  private lastThunder = Number.NEGATIVE_INFINITY
  private bed: BedLevels | null = null

  constructor(
    private readonly create: () => AudioContext = () => new AudioContext({ latencyHint: "playback" }),
    private readonly clock: () => number = () => performance.now() / 1000,
    private readonly fetcher?: (url: string) => Promise<Response>,
  ) {}

  /** locked: no context yet (waiting for a gesture) · running · suspended (muted or tab hidden). */
  get state(): EngineState {
    return this.current
  }

  /** For useSyncExternalStore. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  snapshot = (): EngineState => this.current

  /**
   * Call from a click or key handler only: creates (once) and resumes the context. Builds the
   * mix and the ambience, and starts fetching the samples in the background.
   */
  unlock(): void {
    if (!this.graph) {
      const ctx = this.create()
      this.graph = build(ctx)
      void loadSamples((data) => ctx.decodeAudioData(data), this.buffers, undefined, this.fetcher)
      ctx.onstatechange = () => this.settle()
    }
    this.apply()
  }

  setLevels(levels: SoundLevels): void {
    this.levels = levels
    this.apply()
  }

  /** The tab is hidden: suspend until it shows again. */
  setHidden(hidden: boolean): void {
    this.hidden = hidden
    this.apply()
  }

  setListener(listener: Listener): void {
    this.listener = listener
  }

  getListener(): Listener {
    return this.listener
  }

  setKey(key: Key): void {
    this.key = key
  }

  setAmbience(levels: BedLevels, firePan = 0, crowdPan = 0): void {
    this.bed = levels
    if (this.audible) this.graph?.ambience.set(levels, firePan, crowdPan)
  }

  /** True when a cue would be heard: unlocked, on, and the tab visible. */
  get audible(): boolean {
    return this.graph !== null && this.levels.on && !this.hidden
  }

  /** A moment the clock played through (driver.ts): its motif, its spot sound. */
  moment(moment: MomentCue, info: MomentInfo = {}): void {
    // Whatever ends a wait ends its call: answered, finished, fallen or gone.
    if (
      moment.kind === "plea-answered" ||
      moment.kind === "loot" ||
      moment.kind === "fail" ||
      moment.kind === "leave"
    )
      this.pleas.stop(moment.id)
    // A plea's call is armed whether or not it can be heard now (V1 review-2 #16): asked while the tab
    // was hidden, it still calls once the hall is heard again, until answered.
    if (moment.kind === "plea") this.pleas.start(moment.id, this.clock())
    if (!this.audible) return
    const sound = moment.kind === "deed" ? `deed:${info.sigil ?? "work"}` : moment.kind
    const size = moment.kind === "deed" ? moment.size : undefined
    const call = moment.kind === "deed" ? moment.call : undefined
    const notes = motifOf({ kind: moment.kind, size, call }, { key: this.key, sigil: info.sigil })
    const sample = info.sample
      ? renditionOf(info.sample, this.buffers, Math.random())
      : (null as Rendition<AudioBuffer>)
    const replaced = sample?.kind === "file" && sample.replace
    if (notes.length > 0 && !replaced) this.cue("notes", sound, notes, info.where, 1, moment.id)
    if (sample && info.sample) this.playSpot(info.sample, sample, info.sampleAt ?? info.where, moment.id)
  }

  /**
   * A spot sound on its own, not carried by a moment. The same gate as every cue: silent when muted,
   * locked or hidden; through the limiter; placed by the camera when `where` is given, centred otherwise.
   */
  spot(name: SampleName, where?: Where): void {
    if (!this.audible) return
    const rendition = renditionOf(name, this.buffers, Math.random())
    if (rendition) this.playSpot(name, rendition, where, `spot:${name}`)
  }

  /**
   * A secret world event begins (sim story/renown.ts): its motif, once, through the same limiter as
   * every cue. Unplaced: an event is the whole island's news. (No V2 surface shows these yet.)
   */
  renown(kind: EventKind): void {
    if (!this.audible) return
    this.cue("notes", `renown:${kind}`, renownMotifOf(kind, this.key), undefined, 1, `renown:${kind}`)
  }

  /** Lightning struck at `where` (the castle's keep): its thunder, as late as it is far. */
  thunder(where: Where | undefined, pick = Math.random()): void {
    if (!this.audible || !this.graph) return
    const now = this.clock()
    // the bed's, not a cue: no bus's voices to take, only its own cooldown
    const verdict: Verdict = now - this.lastThunder < THUNDER_COOLDOWN ? "cooldown" : "play"
    if (verdict === "play") this.lastThunder = now
    const place = where ? placeOf(where.x, where.z, this.listener, THUNDER_FLOOR) : { pan: 0, gain: 1 }
    // sound's speed (343 m/s) from the strike to the focus, a little of it: a near bolt cracks at once
    const distance = where ? Math.hypot(where.x - this.listener.x, where.z - this.listener.z) : 0
    const delay = Math.min(2.5, 0.08 + distance / 343)
    this.record({
      t: now,
      sound: "thunder",
      bus: "sfx",
      verdict,
      notes: [],
      timbres: [],
      pan: place.pan,
      gain: place.gain,
    })
    if (verdict !== "play") return
    this.thunders++
    this.graph.ambience.thunder(delay, place.pan, place.gain, pick)
  }

  /** ≈10 Hz: pleas still unanswered call again, softer. `where` finds the one pleading. */
  tick(where: (id: string) => Where | undefined): void {
    if (!this.audible) return
    for (const call of this.pleas.due(this.clock())) {
      const notes = motifOf({ kind: "plea" }, { key: this.key })
      this.cue("notes", "plea", notes, where(call.id), call.gain, call.id)
    }
  }

  /** History is being rebuilt (seek, restart, a new log): forget what was calling and in flight. */
  rebuild(): void {
    this.pleas.clear()
    this.limiter.clear()
  }

  stats(): AudioStats {
    const now = this.clock()
    return {
      state: this.current,
      audible: this.audible,
      voices: { notes: this.limiter.sounding("notes", now), sfx: this.limiter.sounding("sfx", now) },
      cues: { ...this.counts },
      fired: { ...this.fired },
      pleas: this.pleas.size,
      samples: { loaded: this.buffers.size, listed: filesOf().length },
      thunder: this.thunders,
      bed: this.bed,
    }
  }

  /** Closes the context (the island is gone). */
  dispose(): void {
    const graph = this.graph
    this.graph = null
    this.pleas.clear()
    if (graph) {
      graph.ambience.stop()
      void graph.ctx.close().catch(() => {})
    }
    this.settle()
  }

  private cue(
    bus: Bus,
    sound: string,
    notes: readonly Note[],
    where: Where | undefined,
    gain: number,
    who: string,
  ) {
    const place = where ? placeOf(where.x, where.z, this.listener, NOTE_FLOOR) : { pan: 0, gain: 1 }
    const length = Math.max(...notes.map((n) => n.delay + n.dur))
    const now = this.clock()
    const verdict = this.limiter.admit(bus, sound, now, length)
    this.record({
      t: now,
      sound,
      bus,
      verdict,
      notes: notes.map((n) => n.midi),
      timbres: [...new Set(notes.map((n) => n.timbre))],
      pan: place.pan,
      gain: round(place.gain * gain),
      who,
    })
    if (verdict !== "play" || !this.graph) return
    play(this.graph.ctx, this.graph.buses[bus], notes, place.pan, place.gain * gain)
  }

  private playSpot(
    name: SampleName,
    rendition: NonNullable<Rendition<AudioBuffer>>,
    where: Where | undefined,
    who: string,
  ) {
    const place = where ? placeOf(where.x, where.z, this.listener, SFX_FLOOR) : { pan: 0, gain: 1 }
    const sound = `sample:${name}`
    const now = this.clock()
    const file = rendition.kind === "file"
    const length = file ? rendition.buffer.duration / rendition.rate : 0.5
    const verdict = this.limiter.admit("sfx", sound, now, length)
    this.record({
      t: now,
      sound,
      bus: "sfx",
      verdict,
      notes: file ? [] : rendition.notes.map((n) => n.midi),
      timbres: file ? [] : [...new Set(rendition.notes.map((n) => n.timbre))],
      sample: file ? rendition.file : "synth",
      pan: place.pan,
      gain: round(place.gain),
      who,
    })
    if (verdict !== "play" || !this.graph) return
    const { ctx, buses } = this.graph
    if (rendition.kind === "file")
      playBuffer(ctx, buses.sfx, rendition.buffer, rendition.rate, place.pan, place.gain * SAMPLES[name].gain)
    else play(ctx, buses.sfx, rendition.notes, place.pan, place.gain)
  }

  private record(cue: ProbeCue): void {
    this.counts[cue.verdict]++
    if (cue.verdict === "play") this.fired[cue.sound] = (this.fired[cue.sound] ?? 0) + 1
    if (!this.probe) return
    this.probe.push(this.hearing === undefined ? cue : { ...cue, at: this.hearing })
    if (this.probe.length > PROBE_KEEP) this.probe.splice(0, this.probe.length - PROBE_KEEP)
  }

  /** Levels to the gains; suspend or resume the context. */
  private apply(): void {
    const graph = this.graph
    if (graph) {
      const { ctx, buses, master } = graph
      const at = ctx.currentTime
      master.gain.setTargetAtTime(this.levels.on ? curve(this.levels.master) : 0, at, 0.05)
      buses.notes.gain.setTargetAtTime(TRIM.notes * curve(this.levels.notes), at, 0.05)
      buses.sfx.gain.setTargetAtTime(TRIM.sfx * curve(this.levels.notes), at, 0.05)
      buses.ambience.gain.setTargetAtTime(TRIM.ambience * curve(this.levels.ambience), at, 0.05)
      if (this.audible && ctx.state !== "running") void ctx.resume().catch(() => {})
      else if (!this.audible && ctx.state === "running") {
        this.pleas.clear()
        void ctx.suspend().catch(() => {})
      }
    }
    this.settle()
  }

  private settle(): void {
    const next: EngineState = !this.graph
      ? "locked"
      : this.graph.ctx.state === "running"
        ? "running"
        : "suspended"
    if (next === this.current) return
    this.current = next
    for (const listener of [...this.listeners]) listener()
  }
}

function build(ctx: AudioContext): Graph {
  const compressor = ctx.createDynamicsCompressor()
  compressor.threshold.value = -20
  compressor.knee.value = 12
  compressor.ratio.value = 3
  compressor.attack.value = 0.008
  compressor.release.value = 0.3
  const master = ctx.createGain()
  master.gain.value = 0
  // A brick wall at the end: nothing ever clips, however busy the guild.
  const limiter = ctx.createDynamicsCompressor()
  limiter.threshold.value = -3
  limiter.knee.value = 0
  limiter.ratio.value = 20
  limiter.attack.value = 0.002
  limiter.release.value = 0.1
  compressor.connect(master).connect(limiter).connect(ctx.destination)
  const bus = (): GainNode => {
    const gain = ctx.createGain()
    gain.gain.value = 0
    gain.connect(compressor)
    return gain
  }
  const buses = { notes: bus(), sfx: bus(), ambience: bus() }
  return { ctx, buses, master, ambience: new Ambience(ctx, buses.ambience) }
}

const round = (value: number): number => Math.round(value * 1000) / 1000

/** The site's one engine. Locked (no AudioContext) until a gesture turns the sound on. */
export const audio = new AudioEngine()
