import type { EventKind } from "../guild/events.ts"
import type { Moment } from "../guild/moments.ts"
import type { SigilKind } from "../scene/sigilBoard.ts"
import { Ambience, type AmbienceLevels } from "./ambience.ts"
import { type Bus, Limiter, PleaCalls, type Verdict } from "./limiter.ts"
import { type Key, keyOf, motifOf, type Note, renownMotifOf } from "./music.ts"
import { loadSamples, type Rendition, renditionOf, SAMPLES, type SampleName } from "./samples.ts"
import { type Listener, NO_LISTENER, placeOf } from "./spatial.ts"
import { play, playBuffer } from "./synth.ts"

/**
 * The guild's sound (docs/research/roadmap.md S1, audio/README.md). One AudioContext, made only by
 * `unlock()` inside a click on the sound toggle (browsers' autoplay rule):
 *
 *   notes ┐
 *   sfx   ┼─► compressor ─► master ─► limiter ─► speakers
 *   amb.  ┘
 *
 * Live moments become cues (audio/music.ts motifs, audio/samples.ts spot sounds) that pass the
 * limiter (polyphony per bus, cooldown per sound) and are placed by the camera (audio/spatial.ts).
 * A rebuilt moment (seek, replay restart) never plays: `moment` ignores anything not `live`, and
 * `rebuild` silences pleas still calling. Muted or hidden, the context is suspended (no CPU).
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

/** What the hall knows about a moment that the moment itself doesn't say. */
export interface MomentInfo {
  where?: Where | undefined
  /** The deed's sigil kind (scene/sigilBoard.ts kindOfTool). */
  sigil?: SigilKind | undefined
  /** A spot sound to go with it (audio/samples.ts sampleFor). */
  sample?: SampleName | null | undefined
  /** Where the spot sound comes from when not from the adventurer (the graveyard's bell). */
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
}

export type EngineState = "locked" | "running" | "suspended"

/** Distance floor: a far deed is soft, never silent (it is the guild's music); a far spot sound fades out. */
const NOTE_FLOOR = 0.25
const SFX_FLOOR = 0.08
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
  /** Set to an array to record every decision (the PROBE hook, scripts/shot.ts). */
  probe: ProbeCue[] | null = null
  private graph: Graph | null = null
  private buffers = new Map<string, AudioBuffer>()
  private levels: SoundLevels = { on: false, master: 0.7, notes: 0.8, ambience: 0.5 }
  private hidden = false
  private listener: Listener = NO_LISTENER
  private key: Key = keyOf("keep", 1)
  private listeners = new Set<() => void>()
  private current: EngineState = "locked"

  constructor(
    private readonly create: () => AudioContext = () => new AudioContext({ latencyHint: "playback" }),
    private readonly clock: () => number = () => performance.now() / 1000,
    private readonly fetcher?: (url: string) => Promise<Response>,
  ) {}

  /** locked: no context yet (waiting for a click) · running · suspended (muted or tab hidden). */
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

  setKey(key: Key): void {
    this.key = key
  }

  setAmbience(levels: AmbienceLevels, firePan = 0): void {
    if (this.audible) this.graph?.ambience.set(levels, firePan)
  }

  /** True when a cue would be heard: unlocked, on, and the tab visible. */
  get audible(): boolean {
    return this.graph !== null && this.levels.on && !this.hidden
  }

  /** A moment from the stream. Rebuilt moments (`live: false`) never sound. */
  moment(moment: Moment, info: MomentInfo = {}): void {
    if (!moment.live) return
    // Whatever ends a wait ends its call: answered, finished, fallen or gone.
    if (
      moment.kind === "plea-answered" ||
      moment.kind === "loot" ||
      moment.kind === "fail" ||
      moment.kind === "leave"
    )
      this.pleas.stop(moment.id)
    if (!this.audible) return
    if (moment.kind === "plea") this.pleas.start(moment.id, this.clock())
    const sound = moment.kind === "deed" ? `deed:${info.sigil ?? "work"}` : moment.kind
    const size = moment.kind === "deed" ? moment.size : undefined
    const call = moment.kind === "deed" ? moment.call : undefined
    const notes = motifOf({ kind: moment.kind, size, call }, { key: this.key, sigil: info.sigil })
    const sample = info.sample
      ? renditionOf(info.sample, this.buffers, Math.random())
      : (null as Rendition<AudioBuffer>)
    const replaced = sample?.kind === "file" && sample.replace
    if (notes.length > 0 && !replaced) this.cue("notes", sound, notes, info.where, 1, moment.id)
    if (sample && info.sample) this.spot(info.sample, sample, info.sampleAt ?? info.where, moment.id)
  }

  /**
   * A secret world event begins (guild/events.ts): its motif, once. Through the same limiter as
   * every cue (its own cooldown, the notes bus's polyphony), silent when muted, locked or hidden.
   * Unplaced: an event is the whole island's news.
   */
  renown(kind: EventKind): void {
    if (!this.audible) return
    this.cue("notes", `renown:${kind}`, renownMotifOf(kind, this.key), undefined, 1, `renown:${kind}`)
  }

  /** ≈10 Hz: pleas still unanswered call again, softer. `where` finds the one pleading. */
  tick(where: (id: string) => Where | undefined): void {
    if (!this.audible) return
    for (const call of this.pleas.due(this.clock())) {
      const notes = motifOf({ kind: "plea" }, { key: this.key })
      this.cue("notes", "plea", notes, where(call.id), call.gain, call.id)
    }
  }

  /** History is being rebuilt (seek, restart): forget what was calling and in flight. */
  rebuild(): void {
    this.pleas.clear()
    this.limiter.clear()
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

  private spot(
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
    if (!this.probe) return
    this.probe.push(cue)
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
    for (const listener of this.listeners) listener()
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

/** The hall's one engine. Locked until the sound toggle is clicked. */
export const audio = new AudioEngine()
