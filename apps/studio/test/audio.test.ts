/**
 * The sound (src/audio), ported from V1: the pure parts held to V1's goldens (fixtures/audio-v1.jsonl,
 * written by audio-v1.gen.ts from legacy/packages/hall/src/audio), the engine on a fake WebAudio, the
 * driver and the cues on V2's world events, and the saga played through: its beats sound their cues.
 */
import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { SeaEvent } from "@guildhall/core"
import { EventLog, flush, normalize, normalizer, story, type WorldEvent } from "@guildhall/sim"
import { ambienceOf, bedOf } from "../src/audio/ambience.ts"
import { cueOf, type IslandSpots, infoOf } from "../src/audio/cues.ts"
import { CueDriver, MAX_GAP_MS, type Timeline } from "../src/audio/driver.ts"
import { AudioEngine, type ProbeCue } from "../src/audio/engine.ts"
import { sigilOfCraft } from "../src/audio/kinds.ts"
import { COOLDOWNS, Limiter, PLEA_EVERY, PleaCalls, VOICES } from "../src/audio/limiter.ts"
import {
  degreeOf,
  frequencyOf,
  hash,
  keyOf,
  motifOf,
  pitchOfDeed,
  quantize,
  renownMotifOf,
} from "../src/audio/music.ts"
import { SOUND_DEFAULTS, soundPrefsOf } from "../src/audio/prefs.ts"
import { filesOf, loadSamples, renditionOf, SAMPLES, sampleFor } from "../src/audio/samples.ts"
import { type CameraLike, listenerOf, placeOf } from "../src/audio/spatial.ts"

// biome-ignore lint/suspicious/noExplicitAny: the goldens are V1's JSON, read as it was written
const V1: any = Object.fromEntries(
  readFileSync(join(import.meta.dir, "fixtures/audio-v1.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line)),
)
/** JSON drops `undefined` (a missing key) the same way on both sides. */
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

// ---- V1's goldens ----------------------------------------------------------------------------

describe("audio: V1 goldens", () => {
  test("keys, degrees, quantize, frequency and the hash", () => {
    for (const k of V1.music.keys) expect(keyOf(k.mood, k.daylight)).toEqual(k.key)
    for (const d of V1.music.degrees) expect(degreeOf(d.key, d.d)).toBe(d.out)
    for (const q of V1.music.quantize) expect(quantize(q.midi, q.key)).toBe(q.out)
    for (const f of V1.music.frequency) expect(frequencyOf(f.midi)).toBe(f.out)
    for (const h of V1.music.hash) expect(hash(h.text)).toBe(h.out)
  })

  test("a deed's pitch, every moment's motif and every renown's", () => {
    for (const p of V1.music.pitch) expect(pitchOfDeed(p.size ?? undefined, p.call, p.key)).toBe(p.out)
    expect(V1.music.motifs.length).toBeGreaterThan(400)
    for (const m of V1.music.motifs)
      expect(
        json(motifOf({ kind: m.kind, size: m.size, call: m.call }, { key: m.key, sigil: m.sigil })),
      ).toEqual(m.out)
    for (const r of V1.music.renown) expect(json(renownMotifOf(r.kind, r.key))).toEqual(r.out)
  })

  test("the limiter's voices and cooldowns, a 600-cue script and the pleas' calls", () => {
    expect(VOICES).toEqual(V1.voices)
    expect(COOLDOWNS).toEqual(V1.cooldowns)
    expect(PLEA_EVERY).toBe(V1.pleaEvery)
    const limiter = new Limiter()
    V1.admits.forEach(
      (
        a: { bus: "notes"; sound: string; now: number; length: number; out: string; sounding: number },
        i: number,
      ) => {
        expect(limiter.admit(a.bus, a.sound, a.now, a.length)).toBe(a.out as never)
        expect(limiter.sounding(a.bus, a.now)).toBe(a.sounding)
        if (i === 300) limiter.clear()
      },
    )
    const pleas = new PleaCalls()
    for (const p of V1.pleas) {
      if (p.op === "start") pleas.start(p.id, p.now)
      else if (p.op === "stop") pleas.stop(p.id)
      else if (p.op === "clear") pleas.clear()
      else expect(pleas.due(p.now)).toEqual(p.out)
      expect(pleas.size).toBe(p.size)
    }
  })

  test("pan and gain, and the listener of a camera (perspective and orthographic)", () => {
    for (const p of V1.place) expect(placeOf(p.x, p.z, p.listener, p.floor)).toEqual(p.out)
    for (const c of V1.cams) {
      const got = listenerOf(c.camera as CameraLike, c.aspect)
      for (const k of ["x", "z", "rx", "rz", "radius"] as const) expect(got[k]).toBeCloseTo(c.out[k], 9)
    }
  })

  test("the ambience's levels over 1,700 weathers, lights, winds and views", () => {
    expect(V1.ambience.length).toBeGreaterThan(1000)
    for (const [
      weather,
      precipitation,
      daylight,
      cloudCover,
      temperature,
      wind,
      radius,
      sea,
      fire,
      ...out
    ] of V1.ambience) {
      const got = ambienceOf({
        env: { weather, precipitation, daylight, cloudCover, temperature },
        wind,
        listener: { x: 0, z: 0, rx: 1, rz: 0, radius },
        sea,
        fire,
      })
      expect([got.wind, got.rain, got.sea, got.fire, got.insects]).toEqual(out)
    }
  })

  test("the sample manifest, which spot sound each moment makes, and the fallback rule", () => {
    expect(json(SAMPLES)).toEqual(V1.samples)
    expect(filesOf()).toEqual(V1.files)
    for (const [kind, craft, at, out] of V1.sampleFors)
      expect(sampleFor(kind, craft ?? undefined, V1.ats[at])).toBe(out)
    for (const r of V1.renditions) {
      const loaded = new Map(r.loaded.map((f: string) => [f, f]))
      expect(json(renditionOf(r.name, loaded, r.pick))).toEqual(r.out)
    }
  })

  test("the stored prefs, read as V1 read them (its key too)", () => {
    for (const p of V1.prefs) expect(soundPrefsOf(p.raw)).toEqual(p.out)
    expect(SOUND_DEFAULTS.on).toBe(false)
  })

  test("loading skips a missing file (the dev server's HTML page) and keeps the rest", async () => {
    const into = new Map<string, string>()
    await loadSamples(
      async () => "decoded",
      into,
      "/audio/",
      async (url) =>
        url.endsWith("chop.ogg")
          ? new Response("<html>", { headers: { "content-type": "text/html" } })
          : url.endsWith("creak1.ogg")
            ? new Response("", { status: 404 })
            : new Response(new Uint8Array(4), { headers: { "content-type": "audio/ogg" } }),
    )
    expect(into.size).toBe(filesOf().length - 2)
    expect(into.has("chop.ogg")).toBe(false)
    expect(renditionOf("chop", into, 0.5)).toBeNull()
    expect(renditionOf("creak", into, 0.5)).toMatchObject({ kind: "file", file: "creak3.ogg" })
  })

  test("every manifest file is in public/audio, a real Ogg", () => {
    for (const file of filesOf()) {
      const path = join(import.meta.dir, "../public/audio", file)
      expect(existsSync(path)).toBe(true)
      expect(readFileSync(path).subarray(0, 4).toString("latin1")).toBe("OggS")
    }
  })
})

// ---- The V2 bed -------------------------------------------------------------------------------

describe("audio: the island's bed", () => {
  const base = {
    env: { weather: "clear", precipitation: 0, daylight: 1, cloudCover: 0.1, temperature: 14 },
    wind: 0.25,
    listener: { x: 0, z: 0, rx: 1, rz: 0, radius: 30 },
    sea: 80,
    fire: 50,
    town: { distance: 5, weight: 1 },
  }
  test("a town murmurs near its square, by day louder, faint from far", () => {
    const near = bedOf(base)
    expect(near.crowd).toBeGreaterThan(0.6)
    expect(bedOf({ ...base, town: { distance: 200, weight: 1 } }).crowd).toBe(0)
    expect(bedOf({ ...base, env: { ...base.env, daylight: 0 } }).crowd).toBeLessThan(near.crowd / 2)
    expect(bedOf({ ...base, listener: { ...base.listener, radius: 140 } }).crowd).toBe(0)
  })
  test("birds sing by day over land; not at night, over the water, in rain or a gale", () => {
    expect(bedOf(base).birds).toBeGreaterThan(0.8)
    expect(bedOf({ ...base, env: { ...base.env, daylight: 0 } }).birds).toBe(0)
    expect(bedOf({ ...base, sea: 0 }).birds).toBe(0)
    expect(bedOf({ ...base, env: { ...base.env, precipitation: 0.5 } }).birds).toBe(0)
    expect(bedOf({ ...base, wind: 1 }).birds).toBe(0)
  })
  test("crickets at night, the storm's rain, the V1 layers unchanged under it", () => {
    const night = { ...base, env: { ...base.env, daylight: 0 } }
    expect(bedOf(night).insects).toBeGreaterThan(0.8)
    expect(bedOf({ ...base, env: { ...base.env, precipitation: 0.9, weather: "rain" } }).rain).toBe(0.9)
    const { crowd, birds, ...v1 } = bedOf(base)
    expect(v1).toEqual(ambienceOf(base))
  })
})

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
  close() {
    this.state = "closed"
    return Promise.resolve()
  }
}

/** An engine on a fake context and a hand-turned clock, recording every decision; `files`: the samples load. */
function rig(files = false) {
  const contexts: FakeContext[] = []
  const clock = { now: 0 }
  const engine = new AudioEngine(
    () => {
      const ctx = new FakeContext()
      contexts.push(ctx)
      return ctx as unknown as AudioContext
    },
    () => clock.now,
    () =>
      Promise.resolve(
        files
          ? new Response(new Uint8Array(8), { headers: { "content-type": "audio/ogg" } })
          : new Response("<html>", { headers: { "content-type": "text/html" } }),
      ),
  )
  const probe: ProbeCue[] = []
  engine.probe = probe
  return {
    engine,
    contexts,
    probe,
    clock,
    advance: (s: number) => {
      clock.now += s
    },
    on: () => {
      engine.setLevels({ ...SOUND_DEFAULTS, on: true })
      engine.unlock()
    },
  }
}

const deed = (call: string, size?: number) => ({ kind: "deed" as const, id: "a", call, size })

describe("audio: engine", () => {
  test("muted by default: nothing exists until unlocked, and no context is made", () => {
    const { engine, contexts, probe } = rig()
    engine.setLevels({ ...SOUND_DEFAULTS, on: true })
    engine.moment(deed("c1"))
    engine.thunder({ x: 0, z: 0 })
    engine.setAmbience({ ...bedOf({ ...BED, town: { distance: 1, weight: 1 } }) })
    expect(engine.state).toBe("locked")
    expect(contexts).toHaveLength(0)
    expect(probe).toHaveLength(0)
    expect(engine.stats()).toMatchObject({ state: "locked", audible: false, voices: { notes: 0, sfx: 0 } })
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

  test("a deed plays one note on the notes bus, and its spot sound's synth on the sfx bus", () => {
    const { engine, probe, on } = rig()
    on()
    engine.moment(deed("c1", 2), { sigil: "edit", sample: "forge" })
    expect(probe.map((c) => [c.sound, c.bus, c.sample ?? null, c.timbres])).toEqual([
      ["deed:edit", "notes", null, ["marimba"]],
      ["sample:forge", "sfx", "synth", ["bell"]],
    ])
    expect(engine.stats().fired).toEqual({ "deed:edit": 1, "sample:forge": 1 })
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
    const times = played.map((c) => c.t)
    for (const t of times) expect(times.filter((u) => u <= t && u > t - 0.7).length).toBeLessThanOrEqual(6)
  })

  test("a plea calls again, softer, until answered", () => {
    const { engine, probe, on, advance } = rig()
    on()
    engine.moment({ kind: "plea", id: "a" })
    advance(PLEA_EVERY + 0.1)
    engine.tick(() => undefined)
    engine.moment({ kind: "plea-answered", id: "a" })
    advance(PLEA_EVERY + 0.1)
    engine.tick(() => undefined)
    const calls = probe.filter((c) => c.sound === "plea" && c.verdict === "play")
    expect(calls).toHaveLength(2)
    expect(calls[1]?.gain).toBeLessThan(calls[0]?.gain ?? 0)
  })

  test("thunder: as late as the strike is far, at most every 2 s", () => {
    const { engine, probe, on, advance, contexts } = rig()
    on()
    engine.thunder({ x: 0, z: 0 })
    engine.thunder({ x: 0, z: 0 })
    advance(2.1)
    engine.thunder({ x: 300, z: 0 })
    expect(probe.map((c) => [c.sound, c.verdict])).toEqual([
      ["thunder", "play"],
      ["thunder", "cooldown"],
      ["thunder", "play"],
    ])
    expect(engine.stats().thunder).toBe(2)
    expect(contexts).toHaveLength(1)
  })
})

// ---- Cues and the driver ------------------------------------------------------------------------

const BED = {
  env: { weather: "clear", precipitation: 0, daylight: 1, cloudCover: 0.1, temperature: 14 },
  wind: 0.25,
  listener: { x: 0, z: 0, rx: 1, rz: 0, radius: 30 },
  sea: 80,
  fire: 50,
}

const SPOTS: IslandSpots = {
  zone: (z) =>
    z === 1
      ? { kind: "mine", at: { x: 10, z: 0 } }
      : z === 2
        ? { kind: "monastery", at: { x: -10, z: 0 } }
        : undefined,
  pathKind: (p) => (p.includes("/docs/") ? "monastery" : undefined),
  castle: { x: 0, z: 0 },
  harbour: { x: 0, z: 40 },
  chapel: { x: -10, z: 0 },
  heroAt: (id) => (id === "drawn" ? { x: 3, z: 3 } : null),
}

const ev = (happening: Record<string, unknown>, at = 0, seq = 0): WorldEvent =>
  ({ at, seq, src: "t", ...happening }) as unknown as WorldEvent
const work = { call: "c", tool: "edit", craft: "edit", target: "x", paths: ["/r/a.ts"], places: [1] }

describe("audio: V2 events as V1 moments", () => {
  test("each world event is its moment; a guildmaster's first sight is no join", () => {
    expect(cueOf(ev({ kind: "actor.join", id: "g", agent: "build" }))).toBeNull()
    expect(cueOf(ev({ kind: "actor.join", id: "s", parent: "g", agent: "explore" }))?.kind).toBe("join")
    expect(
      cueOf(ev({ kind: "actor.deed", id: "s", failed: false, stepped: true, size: 4, ...work })),
    ).toEqual({
      kind: "deed",
      id: "s",
      call: "c",
      craft: "edit",
      paths: ["/r/a.ts"],
      size: 4,
      zone: 1,
    })
    expect(cueOf(ev({ kind: "actor.deed", id: "s", failed: true, stepped: true, ...work }))?.kind).toBe(
      "deed-failed",
    )
    const kinds = [
      ["actor.plea", "plea"],
      ["actor.answered", "plea-answered"],
      ["actor.loot", "loot"],
      ["actor.fail", "fail"],
      ["actor.recover", "recover"],
      ["actor.leave", "leave"],
      ["actor.quest", "quest"],
      ["actor.step", null],
      ["actor.rank", null],
      ["actor.resume", null],
    ] as const
    for (const [kind, out] of kinds) expect(cueOf(ev({ kind, id: "s" }))?.kind ?? null).toBe(out)
    expect(cueOf(ev({ kind: "sea.pr", state: "merged" }))).toEqual({ kind: "sea-merged", id: "sea" })
    expect(cueOf(ev({ kind: "sea.pr", state: "opened" }))).toBeNull()
    expect(cueOf(ev({ kind: "sea.ci", moment: "sea-red" }))?.kind).toBe("sea-red")
    expect(cueOf(ev({ kind: "sea.ci" }))).toBeNull()
    expect(cueOf(ev({ kind: "sea.release" }))?.kind).toBe("sea-release")
  })

  test("a deed sounds where its hero is drawn, its instrument by craft, its spot sound by place", () => {
    const quarry = cueOf(ev({ kind: "actor.deed", id: "s", failed: false, stepped: true, ...work }))
    expect(quarry && infoOf(quarry, SPOTS)).toEqual({
      where: { x: 10, z: 0 },
      sigil: "edit",
      sample: "quarry",
    })
    const read = cueOf(
      ev({
        kind: "actor.deed",
        id: "drawn",
        failed: false,
        stepped: true,
        ...work,
        craft: "read",
        places: [],
        paths: ["/demo/x/docs/a.md"],
      }),
    )
    expect(read && infoOf(read, SPOTS)).toEqual({ where: { x: 3, z: 3 }, sigil: "read", sample: "book" })
    const fall = cueOf(ev({ kind: "actor.fail", id: "s" }))
    expect(fall && infoOf(fall, SPOTS)).toMatchObject({ sample: "bell", sampleAt: { x: -10, z: 0 } })
    const merged = cueOf(ev({ kind: "sea.pr", state: "merged" }))
    expect(merged && infoOf(merged, SPOTS)).toEqual({
      where: { x: 0, z: 40 },
      sample: "horn",
      sampleAt: { x: 0, z: 40 },
    })
    expect(sigilOfCraft("delegate")).toBe("dispatch")
  })

  test("the driver hears what the clock plays through, once; a seek, a new log or a leap is silent", () => {
    const events = [10, 20, 30, 40, 5000, 5010].map((at, seq) =>
      ev({ kind: "actor.loot", id: `h${seq}` }, at, seq),
    )
    const heard: number[] = []
    let rebuilds = 0
    const driver = new CueDriver(
      (e) => heard.push(e.at),
      () => rebuilds++,
    )
    const clock = { at: 10, jumps: 0 }
    const tl: Timeline = { events: () => events, clock: () => clock }
    driver.step(tl)
    expect([heard, rebuilds]).toEqual([[], 1])
    clock.at = 25
    driver.step(tl)
    expect(heard).toEqual([10, 20])
    clock.at = 25
    driver.step(tl)
    expect(heard).toEqual([10, 20])
    // back: a seek
    clock.at = 15
    driver.step(tl)
    clock.at = 35
    driver.step(tl)
    expect(heard).toEqual([10, 20, 20, 30])
    // a leap over the gap: nothing heard across it
    clock.at = 35 + MAX_GAP_MS + 2000
    driver.step(tl)
    expect(heard).toEqual([10, 20, 20, 30])
    // a jump (a chapter link) lands silently, then plays on
    clock.at = 4990
    clock.jumps = 1
    driver.step(tl)
    clock.at = 5010
    driver.step(tl)
    expect(heard).toEqual([10, 20, 20, 30, 5000, 5010])
    expect(rebuilds).toBe(4)
  })

  test("a looping clock plays through the end of one round into the start of the next", () => {
    const events = [0, 50, 90].map((at, seq) => ev({ kind: "actor.loot", id: `h${seq}` }, at, seq))
    const heard: number[] = []
    const driver = new CueDriver(
      (e) => heard.push(e.at),
      () => {},
    )
    const clock = { at: 40, jumps: 0 }
    const tl: Timeline = { events: () => events, clock: () => clock, loops: true }
    driver.step(tl)
    clock.at = 95
    driver.step(tl)
    clock.at = 10
    driver.step(tl)
    expect(heard).toEqual([50, 90, 0])
  })
})

// ---- The saga, played through ---------------------------------------------------------------------

/** The saga as the hall's session reads it (hall/feeds StoryFeed + session): guild and sea, merged. */
function sagaLog() {
  const told = story("saga", { seed: 1, start: Date.UTC(2026, 9, 13, 9) })
  const ctx = normalizer()
  const log = new EventLog()
  const sea = [...told.seas].sort((a, b) => a.at - b.at)
  let s = 0
  for (const event of told.events) {
    while (s < sea.length && (sea[s] as SeaEvent).at < event.change.at)
      log.append(...normalize(sea[s++] as SeaEvent, ctx))
    log.append(...normalize(event, ctx))
  }
  while (s < sea.length) log.append(...normalize(sea[s++] as SeaEvent, ctx))
  const last = log.events.at(-1)?.at ?? 0
  log.append(...flush(ctx, last + ctx.goneMs))
  return { told, log }
}

/** Plays the saga at 1× in 60 Hz frames through the driver into the engine (its clock the session's). */
async function playSaga() {
  const { told, log } = sagaLog()
  const { engine, probe, clock, on } = rig(true)
  on()
  // the samples "load" (the fake decodes anything that is not the dev server's HTML)
  for (let k = 0; k < 5; k++) await new Promise((done) => setTimeout(done, 0))
  const start = log.events[0]?.at ?? 0
  const end = log.events.at(-1)?.at ?? start
  const at = { at: start, jumps: 0 }
  const driver = new CueDriver(
    (e) => {
      const cue = cueOf(e)
      if (!cue) return
      engine.hearing = e.at
      engine.moment(cue, infoOf(cue, SPOTS))
      engine.hearing = undefined
    },
    () => engine.rebuild(),
  )
  const timeline: Timeline = { events: () => log.events, clock: () => at }
  let frames = 0
  for (let t = start; t <= end + 1000; t += 1000 / 60) {
    at.at = t
    clock.now = (t - start) / 1000
    driver.step(timeline)
    if (frames++ % 6 === 0) engine.tick(() => undefined)
  }
  return { told, log, probe, engine, start }
}

const saga = await playSaga()

describe("audio: the saga's beats", () => {
  const { told, log, probe, engine, start } = saga
  const near = (beat: string, sound: string, within = 3000) => {
    const b = told.beats.find((x) => x.beat === beat)
    if (!b) throw new Error(`no beat ${beat}`)
    return probe.find((c) => c.sound === sound && c.at !== undefined && c.at >= b.at && c.at <= b.at + within)
  }

  test("every event with a sound was decided once, at its own time (played, or held back by the limiter)", () => {
    const want = new Map<string, number>()
    for (const e of log.events) {
      const cue = cueOf(e)
      if (!cue) continue
      const notes = motifOf({ kind: cue.kind, size: cue.size, call: cue.call }, { key: keyOf("keep", 1) })
      const info = infoOf(cue, SPOTS)
      const sound = cue.kind === "deed" ? `deed:${info.sigil ?? "work"}` : cue.kind
      if (notes.length) want.set(`${e.at}|${sound}`, (want.get(`${e.at}|${sound}`) ?? 0) + 1)
      if (info.sample && (SAMPLES[info.sample].files.length || SAMPLES[info.sample].synth))
        want.set(`${e.at}|sample:${info.sample}`, (want.get(`${e.at}|sample:${info.sample}`) ?? 0) + 1)
    }
    const got = new Map<string, number>()
    for (const c of probe)
      if (c.at !== undefined) got.set(`${c.at}|${c.sound}`, (got.get(`${c.at}|${c.sound}`) ?? 0) + 1)
    expect(want.size).toBeGreaterThan(50)
    expect(got).toEqual(want)
    const stats = engine.stats()
    expect(stats.cues.play).toBeGreaterThan(50)
    expect(stats.samples.loaded).toBe(filesOf().length)
  })

  test("the beats sound their cues", () => {
    expect(near("dispatch", "join")).toBeDefined()
    expect(near("dispatch", "sample:door")).toBeDefined()
    expect(near("ci-red", "sample:toll")).toBeDefined()
    expect(near("plea", "plea")).toBeDefined()
    // answered before its first repeat (every 7 s), the plea called once (repeats are on the engine's
    // clock, which is the session's here)
    const plea = told.beats.find((x) => x.beat === "plea")?.at ?? 0
    const fix = told.beats.find((x) => x.beat === "fix")?.at ?? 0
    const answered = log.events.find((e) => e.kind === "actor.answered" && e.at > plea)?.at ?? fix
    expect(answered - plea).toBeLessThan(PLEA_EVERY * 1000)
    const calls = probe.filter(
      (c) =>
        c.sound === "plea" && c.verdict === "play" && start + c.t * 1000 >= plea && start + c.t * 1000 < fix,
    )
    expect(calls).toHaveLength(1)
    expect(near("fix", "deed:test")).toBeDefined()
    expect(near("merged", "sample:horn")).toBeDefined()
    expect(near("loot", "loot")).toBeDefined()
    expect(near("release", "sample:horn")).toBeDefined()
    expect(near("end", "loot", 5000)).toBeDefined()
    expect(start).toBeGreaterThan(0)
  })
})

/** `SAGA_TABLE=1 bun test apps/studio/test/audio.test.ts -t table`: what sounds between each beat and the next. */
test.skipIf(!process.env.SAGA_TABLE)("print the saga's beat → cue table", () => {
  const { told, probe, start } = saga
  for (const b of told.beats) {
    const next = told.beats.find((x) => x.at > b.at)?.at ?? b.at + 10_000
    // the engine's clock is the session's here: a plea's repeats (no event of their own) are placed too
    const cues = probe.filter((c) => start + c.t * 1000 >= b.at && start + c.t * 1000 < next)
    const tally = new Map<string, { first: number; play: number; held: number }>()
    for (const c of cues) {
      const row = tally.get(c.sound) ?? { first: c.t, play: 0, held: 0 }
      if (c.verdict === "play") row.play++
      else row.held++
      tally.set(c.sound, row)
    }
    const cells = [...tally].map(
      ([k, v]) => `${k} ${v.first.toFixed(1)}s ×${v.play}${v.held ? ` (+${v.held} held)` : ""}`,
    )
    console.log(`| ${b.beat} | ${((b.at - start) / 1000).toFixed(1)} s | ${cells.join(" · ")} |`)
  }
})
