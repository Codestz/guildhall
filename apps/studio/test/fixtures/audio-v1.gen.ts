/**
 * The V1 sound's goldens (docs/journey/learnings.md, "port with a golden"): runs V1's pure audio code
 * (legacy/packages/hall/src/audio) on fixed inputs and writes what it answered to audio-v1.jsonl (a line per part: `[name, value]`), which
 * test/audio.test.ts holds the V2 port (src/audio) to, exactly. Re-run only to widen the inputs:
 *
 *   bun apps/studio/test/fixtures/audio-v1.gen.ts
 */
import { writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

// V1 with its own node_modules (three): this checkout's legacy/, or another's (`LEGACY=/path/to/legacy`)
const LEGACY = resolve(process.env.LEGACY ?? join(import.meta.dir, "../../../../legacy"))
const v1 = (path: string) => import(join(LEGACY, "packages/hall", path))
const { OrthographicCamera, PerspectiveCamera } = await v1("node_modules/three/build/three.module.js")
const { ambienceOf } = await v1("src/audio/ambience.ts")
const { COOLDOWNS, Limiter, PLEA_EVERY, PleaCalls, VOICES } = await v1("src/audio/limiter.ts")
const { degreeOf, frequencyOf, hash, keyOf, motifOf, pitchOfDeed, quantize, renownMotifOf, TIMBRE_OF } =
  await v1("src/audio/music.ts")
const { filesOf, renditionOf, SAMPLES, sampleFor } = await v1("src/audio/samples.ts")
const { listenerOf, placeOf } = await v1("src/audio/spatial.ts")
const { soundPrefsOf } = await v1("src/hud/prefs.ts")

const MOODS = ["keep", "hearth", "moonstone", "arcane"] as const
const DAYLIGHTS = [0, 0.1, 0.2499, 0.25, 0.5, 1]
const KINDS = [
  "deed",
  "deed-failed",
  "fail",
  "recover",
  "plea",
  "plea-answered",
  "loot",
  "join",
  "quest",
  "leave",
  "sea-merged",
  "sea-release",
  "sea-red",
  "sea-green",
  "sea-push",
] as const
const SIGILS = Object.keys(TIMBRE_OF) as (keyof typeof TIMBRE_OF)[]
const SIZES = [undefined, 0, 1, 2, 3, 5, 8, 13, 40, 100, 1000, 100000]
const CALLS = ["", "a", "read:1", "toolu_01XYZ", "call-42", "grep", "edit app.ts"]
const RENOWN = ["festival", "ghost-ship", "rainbow", "raid", "comet", "dragon"] as const
const CRAFTS = [
  undefined,
  "read",
  "search",
  "edit",
  "write",
  "run",
  "test",
  "lint",
  "fetch",
  "consult",
  "plan",
  "delegate",
  "other",
] as const
const ATS = [
  {},
  { station: "forge" },
  { station: "library" },
  { station: "scroll-desk" },
  { station: "map-table" },
  { site: "yard" },
  { site: "quarry" },
  { site: "forest" },
  { site: "tower" },
  { site: "harbour" },
  { station: "forge", site: "yard" },
]

/** A small seeded random (mulberry32), so the limiter's script is the same every run. */
function rand(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const keys = MOODS.flatMap((m) => DAYLIGHTS.map((d) => ({ mood: m, daylight: d, key: keyOf(m, d) })))
const someKeys = [keyOf("keep", 1), keyOf("keep", 0), keyOf("moonstone", 0.6), keyOf("arcane", 0.1)]

const music = {
  keys,
  degrees: someKeys.flatMap((key) =>
    Array.from({ length: 24 }, (_, i) => i - 3).map((d) => ({ key, d, out: degreeOf(key, d) })),
  ),
  quantize: someKeys.flatMap((key) =>
    Array.from({ length: 70 }, (_, i) => 25 + i).map((midi) => ({ key, midi, out: quantize(midi, key) })),
  ),
  frequency: [0, 21, 45, 57, 60, 69, 81, 108, 127].map((midi) => ({ midi, out: frequencyOf(midi) })),
  hash: [...CALLS, "x".repeat(200), "ünïcødé"].map((text) => ({ text, out: hash(text) })),
  pitch: someKeys.flatMap((key) =>
    SIZES.flatMap((size) => CALLS.map((call) => ({ key, size, call, out: pitchOfDeed(size, call, key) }))),
  ),
  motifs: someKeys.flatMap((key) =>
    KINDS.flatMap((kind) =>
      (kind === "deed" ? SIGILS : [undefined]).flatMap((sigil) =>
        (kind === "deed" ? SIZES : [undefined]).map((size) => ({
          key,
          kind,
          sigil,
          size,
          call: "call-42",
          out: motifOf({ kind: kind as never, size, call: "call-42" }, { key, sigil }),
        })),
      ),
    ),
  ),
  renown: someKeys.flatMap((key) => RENOWN.map((kind) => ({ key, kind, out: renownMotifOf(kind, key) }))),
}

// The limiter: a scripted burst of cues on both buses at random times, lengths and sounds.
const sounds = [...Object.keys(COOLDOWNS), "deed:edit", "deed:read", "deed:work", "renown:raid"]
const next = rand(7)
const limiter = new Limiter()
let now = 0
const admits: { bus: string; sound: string; now: number; length: number; out: string; sounding: number }[] =
  []
for (let i = 0; i < 600; i++) {
  now += next() < 0.7 ? next() * 0.15 : next() * 3
  const bus = next() < 0.65 ? "notes" : "sfx"
  const sound = sounds[Math.floor(next() * sounds.length)] as string
  const length = 0.2 + next() * 2.5
  const out = limiter.admit(bus as "notes", sound, now, length)
  admits.push({ bus, sound, now, length, out, sounding: limiter.sounding(bus as "notes", now) })
  if (i === 300) limiter.clear()
}
const pleas = new PleaCalls()
const pleaLog: { op: string; id?: string; now: number; out?: unknown; size: number }[] = []
let t = 0
for (let i = 0; i < 120; i++) {
  t += next() * 4
  const r = next()
  const id = `hero-${Math.floor(next() * 4)}`
  if (r < 0.2) {
    pleas.start(id, t)
    pleaLog.push({ op: "start", id, now: t, size: pleas.size })
  } else if (r < 0.3) {
    pleas.stop(id)
    pleaLog.push({ op: "stop", id, now: t, size: pleas.size })
  } else if (r < 0.32) {
    pleas.clear()
    pleaLog.push({ op: "clear", now: t, size: pleas.size })
  } else {
    const out = pleas.due(t)
    pleaLog.push({ op: "due", now: t, out, size: pleas.size })
  }
}

// Spatial: pan and gain over a grid of sounds for a few listeners and floors.
const listeners = [
  { x: 0, z: 0, rx: 1, rz: 0, radius: 60 },
  { x: 10, z: -4, rx: 0.6, rz: 0.8, radius: 20 },
  { x: -30, z: 25, rx: 0, rz: -1, radius: 4 },
  { x: 5, z: 5, rx: -0.6, rz: 0.8, radius: 0.5 },
]
const place = listeners.flatMap((listener) =>
  [-80, -35, -12, -3, 0, 2, 9, 30, 75].flatMap((x) =>
    [-60, -9, 0, 4, 33].flatMap((z) =>
      [0, 0.08, 0.25].map((floor) => ({ x, z, listener, floor, out: placeOf(x, z, listener, floor) })),
    ),
  ),
)

/** A camera as V2 reads it (no three there): its position, world matrix, fov / ortho frustum and zoom. */
function cameraOf(camera: PerspectiveCamera | OrthographicCamera) {
  camera.updateMatrixWorld(true)
  const ortho = camera as OrthographicCamera
  return {
    position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
    matrixWorld: { elements: [...camera.matrixWorld.elements] },
    ...(ortho.isOrthographicCamera
      ? { isOrthographicCamera: true, left: ortho.left, right: ortho.right, zoom: ortho.zoom }
      : { fov: (camera as PerspectiveCamera).fov }),
  }
}
const cams: { camera: ReturnType<typeof cameraOf>; aspect: number; out: unknown }[] = []
for (const [pos, look, fov, aspect] of [
  [[30, 40, 50], [0, 0, 0], 40, 1.6],
  [[-12, 8, 3], [4, 0, -2], 55, 0.5],
  [[0, 90, 0.01], [0, 0, 0], 30, 1],
  [[0, 5, 0], [40, 4.8, 3], 40, 2],
  [[100, 20, -40], [60, 2, -10], 35, 1.78],
] as const) {
  const camera = new PerspectiveCamera(fov, aspect, 0.1, 1000)
  camera.position.set(...pos)
  camera.lookAt(...look)
  camera.updateMatrixWorld(true)
  cams.push({ camera: cameraOf(camera), aspect, out: listenerOf(camera, aspect) })
}
{
  const camera = new OrthographicCamera(-30, 30, 20, -20, 0.1, 500)
  camera.zoom = 1.5
  camera.position.set(40, 50, 40)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld(true)
  cams.push({ camera: cameraOf(camera), aspect: 1.5, out: listenerOf(camera, 1.5) })
}

// Ambience: levels over a grid of weathers, light, wind, zoom and distances, as rows (it is a big grid):
// [weather, precipitation, daylight, cloudCover, temperature, wind, radius, sea, fire, ...wind/rain/sea/fire/insects]
const ambience: (string | number)[][] = []
for (const weather of ["clear", "rain", "snow", "storm"] as const)
  for (const precipitation of [0, 0.04, 0.5, 1])
    for (const daylight of [0, 0.15, 0.6])
      for (const cloudCover of [0.1, 0.9])
        for (const temperature of [-2, 18])
          for (const wind of [0, 0.5, 1])
            for (const [radius, sea, fire] of [
              [10, 2, 1],
              [30, 20, 8],
              [60, 100, 40],
            ] as const) {
              const input = {
                env: { weather, precipitation, daylight, cloudCover, temperature },
                wind,
                listener: { x: 0, z: 0, rx: 1, rz: 0, radius },
                sea,
                fire,
              }
              const out = ambienceOf(input as never)
              ambience.push([
                weather,
                precipitation,
                daylight,
                cloudCover,
                temperature,
                wind,
                radius,
                sea,
                fire,
                out.wind,
                out.rain,
                out.sea,
                out.fire,
                out.insects,
              ])
            }

// Samples: which spot sound each moment makes (rows: [kind, craft or null, index in `ats`, out]), and the fallback rule.
const sampleFors = KINDS.flatMap((kind) =>
  CRAFTS.flatMap((craft) => ATS.map((at, k) => [kind, craft ?? null, k, sampleFor(kind, craft, at)])),
)
const names = Object.keys(SAMPLES) as (keyof typeof SAMPLES)[]
const renditions = names.flatMap((name) =>
  [0, 1, 2].flatMap((loadedCount) =>
    [0, 0.3, 0.5, 0.99].map((pick) => {
      const loaded = new Map(SAMPLES[name].files.slice(0, loadedCount).map((f) => [f, f] as const))
      const out = renditionOf(name, loaded, pick)
      return { name, loaded: [...loaded.keys()], pick, out }
    }),
  ),
)

const prefs = [
  null,
  "",
  "{",
  "null",
  "[]",
  '{"on":true}',
  '{"on":"yes","master":2,"notes":-1,"ambience":0.3}',
  '{"on":false,"master":0.2,"notes":0.9,"ambience":1}',
  '{"master":"0.5"}',
].map((raw) => ({ raw, out: soundPrefsOf(raw) }))

const golden = {
  note: "V1 audio goldens: written by audio-v1.gen.ts from legacy/packages/hall/src/audio. Do not edit.",
  voices: VOICES,
  cooldowns: COOLDOWNS,
  pleaEvery: PLEA_EVERY,
  music,
  admits,
  pleas: pleaLog,
  place,
  cams,
  ambience,
  ats: ATS,
  sampleFors,
  renditions,
  samples: SAMPLES,
  files: filesOf(),
  prefs,
}
writeFileSync(
  join(import.meta.dir, "audio-v1.jsonl"),
  Object.entries(golden)
    .map((part) => `${JSON.stringify(part)}\n`)
    .join(""),
)
console.log(
  "audio-v1.jsonl",
  Object.fromEntries(Object.entries(golden).map(([k, v]) => [k, Array.isArray(v) ? v.length : typeof v])),
)
