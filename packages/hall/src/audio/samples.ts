import type { Craft } from "@guildhall/core"
import type { MomentKind } from "../guild/moments.ts"
import type { Note } from "./music.ts"

/**
 * The sample slot: named spot sounds, each with optional recorded files in `public/audio/`
 * (Kenney's CC0 RPG Audio and Impact Sounds; see audio/README.md). The synthesized notes stay the
 * music; samples are foley tied to where a deed happens and to a few moments.
 *
 *   files    variants, one picked per play (and its playback rate jittered, Bruno-style, so a
 *            repeated sound never machine-guns). Fetched lazily after the sound is unlocked,
 *            never on the page's first load.
 *   mode     augment: plays alongside the moment's notes · replace: plays instead of them
 *   synth    what plays when no file loaded (missing, or a decode failure); none → silent
 *
 * Adding one: drop the .ogg in `public/audio/`, list it under a name here, and say when it plays
 * in `sampleFor` (audio/engine.ts).
 */
export type SampleName =
  | "forge"
  | "build"
  | "quarry"
  | "chop"
  | "book"
  | "coins"
  | "door"
  | "creak"
  | "bell"
  | "horn"
  | "toll"

export interface SampleDef {
  files: readonly string[]
  /** 0–1 on the SFX bus. */
  gain: number
  mode: "augment" | "replace"
  /** Playback-rate range: random within it per play. */
  rate: readonly [min: number, max: number]
  synth?: readonly Note[]
}

export const SAMPLES: Record<SampleName, SampleDef> = {
  // The keep's forge (implementer station): a light hammer on metal.
  forge: {
    files: ["impactMetal_light_000.ogg", "impactMetal_light_001.ogg", "impactMetal_light_002.ogg"],
    gain: 0.32,
    mode: "augment",
    rate: [0.92, 1.08],
    synth: [{ timbre: "bell", midi: 88, delay: 0, dur: 0.35, gain: 0.18 }],
  },
  // The construction yard: planks going up.
  build: {
    files: ["impactPlank_medium_000.ogg", "impactPlank_medium_001.ogg"],
    gain: 0.3,
    mode: "augment",
    rate: [0.9, 1.1],
  },
  quarry: {
    files: ["impactMining_000.ogg", "impactMining_001.ogg", "impactMining_002.ogg"],
    gain: 0.26,
    mode: "augment",
    rate: [0.9, 1.06],
  },
  chop: { files: ["chop.ogg"], gain: 0.28, mode: "augment", rate: [0.88, 1.12] },
  // Reading at the library or the tower: a page turns.
  book: {
    files: ["bookFlip1.ogg", "bookFlip2.ogg", "bookFlip3.ogg"],
    gain: 0.3,
    mode: "augment",
    rate: [0.95, 1.08],
  },
  coins: {
    files: ["handleCoins.ogg", "handleCoins2.ogg"],
    gain: 0.3,
    mode: "augment",
    rate: [0.96, 1.06],
    synth: [
      { timbre: "glass", midi: 93, delay: 0, dur: 0.3, gain: 0.12 },
      { timbre: "glass", midi: 98, delay: 0.07, dur: 0.3, gain: 0.1 },
    ],
  },
  // An adventurer comes in by the gate.
  door: { files: ["doorOpen_1.ogg"], gain: 0.18, mode: "augment", rate: [0.95, 1.05] },
  // The crypt: the fallen rise (recover) — sparingly.
  creak: { files: ["creak1.ogg", "creak3.ogg"], gain: 0.2, mode: "augment", rate: [0.85, 1] },
  // The graveyard's bell tolls once for a fallen adventurer — rarely (a long cooldown).
  bell: { files: ["impactBell_heavy_004.ogg"], gain: 0.2, mode: "augment", rate: [0.7, 0.8] },
  // The harbour (the GitHub sea): a ship's horn as a merged pull request or a release comes in.
  // No recording in the packs: a low horn swell from the synth.
  horn: {
    files: [],
    gain: 0.3,
    mode: "augment",
    rate: [1, 1],
    synth: [
      { timbre: "horn", midi: 45, delay: 0, dur: 2.2, gain: 0.34 },
      { timbre: "horn", midi: 52, delay: 0.1, dur: 2, gain: 0.2 },
    ],
  },
  // Red CI: the same heavy bell as the graveyard's, struck brighter, from the lighthouse.
  toll: { files: ["impactBell_heavy_004.ogg"], gain: 0.18, mode: "augment", rate: [0.95, 1.05] },
}

/** Deeds that work the yard and the forest, by craft: building is changing files, chopping searching. */
const BUILDING: ReadonlySet<Craft> = new Set(["edit", "write"])
const READING = new Set(["library", "scroll-desk"])

/**
 * The spot sound a moment makes, from where the adventurer is working (their view's station or
 * site): the forge rings, the yard builds, the quarry and the forest are worked, books are read;
 * coins on loot, the gate's door on a join, the crypt's creak when the fallen rise and the
 * graveyard's bell when one falls; from the harbour, a horn for a merge or a release and a toll for
 * red CI. Null: notes only.
 */
export function sampleFor(
  kind: MomentKind,
  craft: Craft | undefined,
  at: { station?: string | undefined; site?: string | undefined },
): SampleName | null {
  switch (kind) {
    case "deed": {
      if (at.station === "forge") return "forge"
      if (at.site === "yard") return craft && BUILDING.has(craft) ? "build" : null
      if (at.site === "quarry") return "quarry"
      if (at.site === "forest") return craft === "search" ? "chop" : null
      if (craft === "read" && ((at.station && READING.has(at.station)) || at.site === "tower")) return "book"
      return null
    }
    case "loot":
      return "coins"
    case "join":
      return "door"
    case "fail":
      return "bell"
    case "recover":
      return "creak"
    case "sea-merged":
    case "sea-release":
      return "horn"
    case "sea-red":
      return "toll"
    default:
      return null
  }
}

/** Where the files are served from. */
export const SAMPLE_BASE = `${import.meta.env?.BASE_URL ?? "/"}audio/`

/** What a sample name plays now: a decoded file, its synthesized stand-in, or nothing. */
export type Rendition<Buffer> =
  | { kind: "file"; buffer: Buffer; file: string; rate: number; replace: boolean }
  | { kind: "synth"; notes: readonly Note[] }
  | null

/**
 * The fallback rule: a loaded variant if any (picked by `pick` ∈ [0, 1)), else the synthesized
 * stand-in, else silence. A replace-mode sample only replaces when a file actually loaded.
 */
export function renditionOf<Buffer>(
  name: SampleName,
  loaded: ReadonlyMap<string, Buffer>,
  pick: number,
  manifest: Record<SampleName, SampleDef> = SAMPLES,
): Rendition<Buffer> {
  const def = manifest[name]
  const ready = def.files.filter((file) => loaded.has(file))
  const file = ready[Math.min(ready.length - 1, Math.floor(pick * ready.length))]
  const buffer = file === undefined ? undefined : loaded.get(file)
  if (file !== undefined && buffer !== undefined) {
    const [min, max] = def.rate
    return { kind: "file", buffer, file, rate: min + (max - min) * pick, replace: def.mode === "replace" }
  }
  return def.synth ? { kind: "synth", notes: def.synth } : null
}

/** Every file the manifest names, once. */
export function filesOf(manifest: Record<SampleName, SampleDef> = SAMPLES): string[] {
  return [...new Set(Object.values(manifest).flatMap((def) => def.files))]
}

/**
 * Fetches and decodes every file, quietly: a missing file (the dev server answers with its HTML
 * page) or a bad decode just leaves that variant out, and its sample falls back. Call after unlock.
 */
export async function loadSamples<Buffer>(
  decode: (data: ArrayBuffer) => Promise<Buffer>,
  into: Map<string, Buffer>,
  base = SAMPLE_BASE,
  fetcher: (url: string) => Promise<Response> = (url) => fetch(url),
): Promise<void> {
  await Promise.all(
    filesOf().map(async (file) => {
      try {
        const response = await fetcher(`${base}${file}`)
        const type = response.headers.get("content-type") ?? ""
        if (!response.ok || type.includes("text/html")) return
        into.set(file, await decode(await response.arrayBuffer()))
      } catch {
        // Missing or undecodable: the sample falls back to its synth (or silence).
      }
    }),
  )
}
