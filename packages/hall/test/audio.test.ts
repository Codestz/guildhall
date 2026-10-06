import { describe, expect, test } from "bun:test"
import { ambienceOf } from "../src/audio/ambience.ts"
import { AudioEngine, type ProbeCue } from "../src/audio/engine.ts"
import { Limiter, PLEA_EVERY, PLEA_REPEATS, PleaCalls } from "../src/audio/limiter.ts"
import {
  DEED_DEGREES,
  degreeOf,
  type Key,
  keyOf,
  motifOf,
  PENTATONIC,
  pitchOfDeed,
  quantize,
} from "../src/audio/music.ts"
import { filesOf, loadSamples, renditionOf, SAMPLES, sampleFor } from "../src/audio/samples.ts"
import { type Listener, placeOf } from "../src/audio/spatial.ts"
import type { Moment } from "../src/guild/moments.ts"
import { GuildStore } from "../src/guild/store.ts"
import { SOUND_DEFAULTS, soundPrefsOf } from "../src/hud/prefs.ts"

// ---- A small fake WebAudio: enough graph for the engine to build and play into ----------------

class FakeParam {
  constructor(public value = 0) {}
  setValueAtTime(v: number) {
    this.value = v
    return this
  }
  linearRampToValueAtTime(v: number) {
    this.value = v
    return this
  }
  exponentialRampToValueAtTime(v: number) {
    this.value = v
    return this
  }
  setTargetAtTime(v: number) {
    this.value = v
    return this
  }
}

class FakeNode {
  connected: unknown[] = []
  onended: (() => void) | null = null
  constructor(readonly kind: string) {}
  connect<T>(to: T): T {
    this.connected.push(to)
    return to
  }
  disconnect() {
    this.connected = []
  }
  start() {}
  stop() {}
}

class FakeContext {
  state: AudioContextState = "suspended"
  currentTime = 0
  sampleRate = 8000
  destination = new FakeNode("destination")
  onstatechange: (() => void) | null = null
  made: FakeNode[] = []
  private node(kind: string, params: Record<string, number>): FakeNode {
    const node = new FakeNode(kind) as FakeNode & Record<string, unknown>
    for (const [name, value] of Object.entries(params)) node[name] = new FakeParam(value)
    this.made.push(node)
    return node
  }
  createGain() {
    return this.node("gain", { gain: 1 })
  }
  createOscillator() {
    return this.node("osc", { frequency: 440 })
  }
  createBiquadFilter() {
    return this.node("filter", { frequency: 350, Q: 1 })
  }
  createStereoPanner() {
    return this.node("pan", { pan: 0 })
  }
  createDynamicsCompressor() {
    return this.node("comp", { threshold: 0, knee: 0, ratio: 1, attack: 0, release: 0 })
  }
  createBufferSource() {
    return this.node("source", { playbackRate: 1 })
  }
  createBuffer(_channels: number, length: number, rate: number) {
    const data = new Float32Array(length)
    return { duration: length / rate, getChannelData: () => data }
  }
  decodeAudioData() {
    return Promise.resolve({ duration: 0.4 })
  }
  resume() {
    this.state = "running"
    this.onstatechange?.()
    return Promise.resolve()
  }
  suspend() {
    this.state = "suspended"
    this.onstatechange?.()
    return Promise.resolve()
  }
}

/** An engine on a fake context and a hand-turned clock, recording every decision. */
function rig() {
  const contexts: FakeContext[] = []
  let now = 0
  const engine = new AudioEngine(
    () => {
      const ctx = new FakeContext()
      contexts.push(ctx)
      return ctx as unknown as AudioContext
    },
    () => now,
    () => Promise.resolve(new Response("<html>", { headers: { "content-type": "text/html" } })),
  )
  const probe: ProbeCue[] = []
  engine.probe = probe
  return {
    engine,
    contexts,
    probe,
    advance: (s: number) => {
      now += s
    },
    on: () => {
      engine.setLevels({ ...SOUND_DEFAULTS, on: true })
      engine.unlock()
    },
  }
}

let seq = 0
function moment(happening: Partial<Moment> & { kind: Moment["kind"] }, live = true): Moment {
  return {
    id: "a",
    agent: "guild-implementer",
    title: "Implementer",
    color: "#fff",
    master: "m",
    seq: ++seq,
    at: 0,
    live,
    ...happening,
  } as Moment
}
const deed = (call: string, size?: number, live = true) =>
  moment({ kind: "deed", tool: "edit", call, ...(size === undefined ? {} : { size }) }, live)

const D_MAJOR: Key = { root: 50, mode: "major" }

// ---- Music ----------------------------------------------------------------------------------

describe("audio: pitch and scale", () => {
  test("a bigger diff plays a lower note", () => {
    const pitches = [0, 1, 5, 20, 100, 1000].map((size) => pitchOfDeed(size, "c", D_MAJOR))
    for (let i = 1; i < pitches.length; i++) expect(pitches[i]).toBeLessThanOrEqual(pitches[i - 1] ?? 0)
    expect(pitches[0]).toBeGreaterThan(pitches.at(-1) ?? 0)
  })

  test("every deed pitch is in the key's pentatonic scale and inside the deed range", () => {
    for (const key of [D_MAJOR, { root: 45, mode: "minor" } as Key])
      for (const size of [undefined, 0, 3, 40, 9999])
        for (const call of ["a", "b", "call-17"]) {
          const midi = pitchOfDeed(size, call, key)
          expect(PENTATONIC[key.mode]).toContain((((midi - key.root) % 12) + 12) % 12)
          expect(midi).toBeGreaterThanOrEqual(key.root)
          expect(midi).toBeLessThanOrEqual(degreeOf(key, DEED_DEGREES - 1))
        }
  })

  test("a deed with no size sounds in the upper half, the same for the same call", () => {
    const midi = pitchOfDeed(undefined, "call-1", D_MAJOR)
    expect(midi).toBe(pitchOfDeed(undefined, "call-1", D_MAJOR))
    expect(midi).toBeGreaterThanOrEqual(degreeOf(D_MAJOR, DEED_DEGREES / 2))
  })

  test("quantize snaps to the nearest scale note, ties going down", () => {
    expect(quantize(50, D_MAJOR)).toBe(50) // D
    expect(quantize(51, D_MAJOR)).toBe(50) // D# → D (tie with E goes down)
    expect(quantize(53, D_MAJOR)).toBe(52) // F → E (F# is not in D major pentatonic)
    expect(quantize(48, D_MAJOR)).toBe(47) // C → B, an octave below
  })

  test("the key follows the mood and turns minor at night", () => {
    expect(keyOf("keep", 1)).toEqual({ root: 50, mode: "major" })
    expect(keyOf("keep", 0)).toEqual({ root: 50, mode: "minor" })
    expect(keyOf("hearth", 1).root).not.toBe(keyOf("keep", 1).root)
  })
})

describe("audio: motifs", () => {
  const score = { key: D_MAJOR }

  test("a deed is one note in its kind's timbre", () => {
    expect(motifOf({ kind: "deed", call: "c", size: 3 }, { key: D_MAJOR, sigil: "read" })).toMatchObject([
      { timbre: "harp" },
    ])
    expect(motifOf({ kind: "deed", call: "c" }, { key: D_MAJOR, sigil: "edit" })[0]?.timbre).toBe("marimba")
    expect(motifOf({ kind: "deed", call: "c" }, { key: D_MAJOR, sigil: "test" })[0]?.timbre).toBe("bell")
    expect(motifOf({ kind: "deed", call: "c" }, { key: D_MAJOR, sigil: "run" })[0]?.timbre).toBe("pluck")
  })

  test("each moment kind has its motif; quests, answers and leaving are silent", () => {
    expect(motifOf({ kind: "deed-failed" }, score)).toMatchObject([{ timbre: "thud" }])
    expect(motifOf({ kind: "join" }, score)[0]?.timbre).toBe("horn")
    expect(motifOf({ kind: "plea" }, score)).toHaveLength(2)
    for (const kind of ["quest", "plea-answered", "leave"] as const)
      expect(motifOf({ kind }, score)).toEqual([])
  })

  test("a fall descends through a minor third; a recovery rises", () => {
    const fall = motifOf({ kind: "fail" }, score).map((n) => n.midi)
    expect(fall).toEqual([...fall].sort((a, b) => b - a))
    expect((fall[1] ?? 0) - (fall[2] ?? 0)).toBe(3)
    const rise = motifOf({ kind: "recover" }, score).map((n) => n.midi)
    expect(rise).toEqual([...rise].sort((a, b) => a - b))
  })

  test("loot resolves on a major triad over the tonic", () => {
    const notes = motifOf({ kind: "loot" }, score)
    const last = notes.filter((n) => n.delay === Math.max(...notes.map((x) => x.delay)))
    const intervals = last.map((n) => (n.midi - D_MAJOR.root) % 12).sort((a, b) => a - b)
    expect(intervals).toEqual([0, 4, 7])
  })
})

// ---- Restraint --------------------------------------------------------------------------------

describe("audio: rate limiting and polyphony", () => {
  test("a bus never sounds more cues than its voices; voices free when cues end", () => {
    const limiter = new Limiter({ notes: 2, sfx: 1 }, {})
    expect(limiter.admit("notes", "a", 0, 1)).toBe("play")
    expect(limiter.admit("notes", "b", 0, 1)).toBe("play")
    expect(limiter.admit("notes", "c", 0, 1)).toBe("polyphony")
    expect(limiter.admit("notes", "c", 1.01, 1)).toBe("play")
  })

  test("one sound waits out its cooldown; another sound does not", () => {
    const limiter = new Limiter({ notes: 9, sfx: 9 }, { thud: 0.5 })
    expect(limiter.admit("notes", "thud", 0, 0.1)).toBe("play")
    expect(limiter.admit("notes", "thud", 0.3, 0.1)).toBe("cooldown")
    expect(limiter.admit("notes", "bell", 0.3, 0.1)).toBe("play")
    expect(limiter.admit("notes", "thud", 0.5, 0.1)).toBe("play")
  })

  test("a refused cue does not take a voice or reset the cooldown", () => {
    const limiter = new Limiter({ notes: 1, sfx: 1 }, { x: 1 })
    limiter.admit("notes", "x", 0, 5)
    expect(limiter.admit("notes", "y", 0.5, 5)).toBe("polyphony")
    expect(limiter.sounding("notes", 0.5)).toBe(1)
    expect(limiter.admit("notes", "x", 0.9, 0)).toBe("cooldown")
  })

  test("a plea calls again softer until its cap, and stops when answered", () => {
    const pleas = new PleaCalls()
    pleas.start("a", 0)
    pleas.start("b", 0)
    const gains: number[] = []
    for (let t = 0; t <= PLEA_EVERY * (PLEA_REPEATS + 3); t += 0.5)
      for (const call of pleas.due(t))
        if (call.id === "a") gains.push(call.gain)
        else pleas.stop("b")
    expect(gains).toHaveLength(PLEA_REPEATS)
    expect(gains).toEqual([...gains].sort((x, y) => y - x))
    expect(pleas.size).toBe(0)
  })
})

// ---- Space and ambience -------------------------------------------------------------------------

describe("audio: placing sounds", () => {
  const listener: Listener = { x: 0, z: 0, rx: 1, rz: 0, radius: 20 }

  test("a sound to the right pans right, to the left pans left, never fully", () => {
    expect(placeOf(15, 0, listener).pan).toBeGreaterThan(0.5)
    expect(placeOf(-15, 0, listener).pan).toBeLessThan(-0.5)
    expect(Math.abs(placeOf(500, 0, listener).pan)).toBeLessThan(1)
  })

  test("near is full level, far falls to the floor", () => {
    expect(placeOf(2, 3, listener).gain).toBe(1)
    expect(placeOf(0, 400, listener, 0.25).gain).toBe(0.25)
  })
})

describe("audio: ambience levels", () => {
  const listener: Listener = { x: 0, z: 0, rx: 1, rz: 0, radius: 12 }
  const env = { weather: "clear" as const, precipitation: 0, daylight: 1, cloudCover: 0.1, temperature: 18 }
  const base = { env, wind: 0.2, listener, sea: 200, fire: 100 }

  test("rain follows precipitation, hushed for snow", () => {
    expect(ambienceOf(base).rain).toBe(0)
    expect(ambienceOf({ ...base, env: { ...env, weather: "rain", precipitation: 0.7 } }).rain).toBe(0.7)
    expect(ambienceOf({ ...base, env: { ...env, weather: "snow", precipitation: 0.7 } }).rain).toBeLessThan(
      0.2,
    )
  })

  test("wind follows the shared wind strength", () => {
    expect(ambienceOf({ ...base, wind: 0.9 }).wind).toBeGreaterThan(ambienceOf(base).wind)
  })

  test("insects only on a clear, dry night", () => {
    expect(ambienceOf(base).insects).toBe(0)
    const night = { ...env, daylight: 0 }
    expect(ambienceOf({ ...base, env: night }).insects).toBe(1)
    expect(ambienceOf({ ...base, env: { ...night, precipitation: 0.5 } }).insects).toBe(0)
    expect(ambienceOf({ ...base, env: { ...night, cloudCover: 0.9 } }).insects).toBe(0)
  })

  test("the fire is heard only close to it with the camera close in", () => {
    expect(ambienceOf({ ...base, fire: 2 }).fire).toBe(1)
    expect(ambienceOf({ ...base, fire: 30 }).fire).toBe(0)
    expect(ambienceOf({ ...base, fire: 2, listener: { ...listener, radius: 80 } }).fire).toBe(0)
  })

  test("the sea is loud at the shore and gone inland", () => {
    expect(ambienceOf({ ...base, sea: 0 }).sea).toBeGreaterThan(0.5)
    expect(ambienceOf({ ...base, sea: 200 }).sea).toBe(0)
  })
})

// ---- Samples ----------------------------------------------------------------------------------

describe("audio: the sample manifest", () => {
  test("a loaded variant plays the file, its rate inside the range", () => {
    const loaded = new Map([["chop.ogg", "BUFFER"]])
    const got = renditionOf("chop", loaded, 0.5)
    expect(got).toMatchObject({ kind: "file", buffer: "BUFFER", file: "chop.ogg", replace: false })
    if (got?.kind === "file") {
      expect(got.rate).toBeGreaterThanOrEqual(SAMPLES.chop.rate[0])
      expect(got.rate).toBeLessThanOrEqual(SAMPLES.chop.rate[1])
    }
  })

  test("with no file loaded a sample falls back to its synth, or to silence", () => {
    expect(renditionOf("forge", new Map(), 0)).toEqual({ kind: "synth", notes: SAMPLES.forge.synth ?? [] })
    expect(renditionOf("chop", new Map(), 0)).toBeNull()
  })

  test("a replace sample only replaces once its file is there", () => {
    const manifest = { ...SAMPLES, coins: { ...SAMPLES.coins, mode: "replace" as const } }
    expect(renditionOf("coins", new Map([["handleCoins.ogg", 1]]), 0, manifest)).toMatchObject({
      replace: true,
    })
    expect(renditionOf("coins", new Map(), 0, manifest)?.kind).toBe("synth")
  })

  test("loading skips a missing file (the dev server's HTML page) and keeps the rest", async () => {
    const loaded = new Map<string, string>()
    await loadSamples(
      async () => "decoded",
      loaded,
      "/audio/",
      async (url) =>
        url.endsWith("chop.ogg")
          ? new Response(new Uint8Array([1]), { headers: { "content-type": "audio/ogg" } })
          : new Response("<html>", { headers: { "content-type": "text/html" } }),
    )
    expect([...loaded.keys()]).toEqual(["chop.ogg"])
  })

  test("every manifest file is on disk in public/audio", async () => {
    for (const file of filesOf())
      expect(await Bun.file(new URL(`../public/audio/${file}`, import.meta.url)).exists()).toBe(true)
  })

  test("spot sounds follow where the work is", () => {
    expect(sampleFor("deed", "edit", { station: "forge" })).toBe("forge")
    expect(sampleFor("deed", "write", { site: "yard" })).toBe("build")
    expect(sampleFor("deed", "read", { site: "yard" })).toBeNull()
    expect(sampleFor("deed", "grep", { site: "forest" })).toBe("chop")
    expect(sampleFor("deed", "read", { station: "library" })).toBe("book")
    expect(sampleFor("deed", "read", {})).toBeNull()
    expect(sampleFor("loot", undefined, {})).toBe("coins")
    expect(sampleFor("quest", "task", {})).toBeNull()
  })
})

// ---- The engine -------------------------------------------------------------------------------

describe("audio: engine", () => {
  test("muted by default: stored prefs start off, and nothing exists until unlocked", () => {
    expect(SOUND_DEFAULTS.on).toBe(false)
    expect(soundPrefsOf(null).on).toBe(false)
    expect(soundPrefsOf("not json")).toEqual(SOUND_DEFAULTS)
    expect(soundPrefsOf('{"on":true,"master":7}')).toEqual({ ...SOUND_DEFAULTS, on: true })
    const { engine, contexts, probe } = rig()
    engine.setLevels({ ...SOUND_DEFAULTS, on: true })
    engine.moment(deed("c1"))
    expect(engine.state).toBe("locked")
    expect(contexts).toHaveLength(0)
    expect(probe).toHaveLength(0)
  })

  test("unlocking creates one context and runs it; muting suspends it", () => {
    const { engine, contexts } = rig()
    engine.setLevels({ ...SOUND_DEFAULTS, on: true })
    engine.unlock()
    engine.unlock()
    expect(contexts).toHaveLength(1)
    expect(engine.state).toBe("running")
    engine.setLevels({ ...SOUND_DEFAULTS, on: false })
    expect(engine.state).toBe("suspended")
  })

  test("a hidden tab suspends the sound and silences new cues", () => {
    const { engine, probe, on } = rig()
    on()
    engine.setHidden(true)
    expect(engine.state).toBe("suspended")
    engine.moment(deed("c1"))
    expect(probe).toHaveLength(0)
    engine.setHidden(false)
    expect(engine.state).toBe("running")
  })

  test("a live deed plays one note on the notes bus", () => {
    const { engine, probe, on } = rig()
    on()
    engine.moment(deed("c1", 4), { sigil: "edit", where: { x: 0, z: 0 } })
    expect(probe).toMatchObject([{ sound: "deed:edit", bus: "notes", verdict: "play", timbres: ["marimba"] }])
  })

  test("a rebuilt moment never plays", () => {
    const { engine, probe, on } = rig()
    on()
    for (let i = 0; i < 20; i++) engine.moment(deed(`c${i}`, i, false))
    engine.moment(moment({ kind: "plea" }, false))
    expect(probe).toHaveLength(0)
  })

  test("a burst of deeds is capped by cooldown and polyphony", () => {
    const { engine, probe, on, advance } = rig()
    on()
    for (let i = 0; i < 40; i++) {
      engine.moment(deed(`c${i}`, i), { sigil: (["edit", "read", "search", "test", "run"] as const)[i % 5] })
      advance(0.02)
    }
    const played = probe.filter((c) => c.verdict === "play")
    expect(played.length).toBeLessThanOrEqual(12)
    expect(played.length).toBeGreaterThan(3)
    // Never more than the bus's voices at once (every note here rings well past 0.8 s).
    const times = played.map((c) => c.t)
    for (const t of times) expect(times.filter((u) => u <= t && u > t - 0.7).length).toBeLessThanOrEqual(6)
  })

  test("a plea calls again until answered", () => {
    const { engine, probe, on, advance } = rig()
    on()
    engine.moment(moment({ kind: "plea" }))
    advance(PLEA_EVERY + 0.1)
    engine.tick(() => undefined)
    engine.moment(moment({ kind: "plea-answered" }))
    advance(PLEA_EVERY + 0.1)
    engine.tick(() => undefined)
    expect(probe.filter((c) => c.sound === "plea" && c.verdict === "play")).toHaveLength(2)
  })

  test("a spot sound with no file falls back to its synth on the sfx bus", () => {
    const { engine, probe, on } = rig()
    on()
    engine.moment(deed("c1", 2), { sigil: "edit", sample: "forge" })
    expect(probe.map((c) => [c.sound, c.bus, c.sample ?? null])).toEqual([
      ["deed:edit", "notes", null],
      ["sample:forge", "sfx", "synth"],
    ])
  })

  test("played through a store: live moments sound, a seek back over them makes no sound", () => {
    const { engine, probe, on } = rig()
    on()
    const store = new GuildStore()
    store.load("party")
    store.moments.on((m) => engine.moment(m))
    store.moments.onRebuild(() => engine.rebuild())
    for (let t = 0; t < 20_000; t += 50) store.tick(50)
    const live = probe.length
    expect(live).toBeGreaterThan(0)
    store.seek(store.duration - 100)
    store.seek(10_000)
    expect(probe).toHaveLength(live)
  })
})
