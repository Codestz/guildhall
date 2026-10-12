/**
 * The one palette every piece is baked to (ADR 003). Swatch ids are an ABI: appended, never reordered.
 * Swatches come in ramps of three tones; a biome re-tints by swapping whole ramps (tone for tone).
 */
import { hash } from "@guildhall/core"
import { hexToSrgb, type Lab, type Rgb, srgbToOklab } from "./colour.ts"

export const TONES = ["dark", "base", "light"] as const
export type Tone = (typeof TONES)[number]

/** One swatch as `palette.json` spells it. */
export interface SwatchJson {
  id: number
  name: string
  hex: string
  group: string
  ramp: string
  tone: Tone
}

export interface PaletteJson {
  version: 1
  status: string
  groups: string[]
  swatches: SwatchJson[]
  /** biome → { ramp → the ramp that replaces it }. */
  biomes: Record<string, Record<string, string>>
}

export interface Swatch extends Readonly<SwatchJson> {
  /** sRGB-encoded, [0, 1]. */
  srgb: Rgb
  lab: Lab
}

/** Three swatch ids of one material, dark to light. */
export interface Ramp {
  name: string
  group: string
  tones: Readonly<Record<Tone, number>>
}

export interface Palette {
  version: 1
  status: string
  groups: readonly string[]
  /** Indexed by id. */
  swatches: readonly Swatch[]
  /** In order of first appearance. */
  ramps: readonly Ramp[]
  biomes: Readonly<Record<string, Readonly<Record<string, string>>>>
}

const HEX = /^#[0-9a-f]{6}$/
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

/** Every problem with a parsed `palette.json`, as "where: what". Empty when it is valid. */
export function paletteProblems(json: unknown): string[] {
  if (!isRecord(json)) return ["palette: not an object"]
  const out: string[] = []
  if (json.version !== 1) out.push(`version: expected 1, got ${JSON.stringify(json.version)}`)
  if (typeof json.status !== "string") out.push("status: expected a string")

  const groups = Array.isArray(json.groups) ? json.groups : []
  if (!Array.isArray(json.groups) || groups.length === 0) out.push("groups: expected a non-empty array")
  if (groups.some((g) => typeof g !== "string")) out.push("groups: expected strings")
  if (new Set(groups).size !== groups.length) out.push("groups: duplicate group")

  if (!Array.isArray(json.swatches) || json.swatches.length === 0) {
    out.push("swatches: expected a non-empty array")
    return out
  }
  const names = new Set<string>()
  const ramps = new Map<string, { group: unknown; tones: Set<unknown> }>()
  for (const [i, s] of (json.swatches as unknown[]).entries()) {
    const at = `swatches[${i}]`
    if (!isRecord(s)) {
      out.push(`${at}: not an object`)
      continue
    }
    if (s.id !== i) out.push(`${at}: id ${JSON.stringify(s.id)} breaks the dense order (expected ${i})`)
    if (typeof s.name !== "string" || !KEBAB.test(s.name)) out.push(`${at}: name must be kebab-case`)
    else if (names.has(s.name)) out.push(`${at}: duplicate name "${s.name}"`)
    else names.add(s.name)
    if (typeof s.hex !== "string" || !HEX.test(s.hex)) out.push(`${at}: hex must be "#rrggbb" (lower case)`)
    if (!groups.includes(s.group)) out.push(`${at}: unknown group ${JSON.stringify(s.group)}`)
    if (!TONES.includes(s.tone as Tone)) out.push(`${at}: tone must be one of ${TONES.join("/")}`)
    if (typeof s.ramp !== "string" || !KEBAB.test(s.ramp)) {
      out.push(`${at}: ramp must be kebab-case`)
      continue
    }
    const ramp = ramps.get(s.ramp) ?? { group: s.group, tones: new Set() }
    ramps.set(s.ramp, ramp)
    if (ramp.group !== s.group) out.push(`${at}: ramp "${s.ramp}" mixes groups`)
    if (ramp.tones.has(s.tone)) out.push(`${at}: ramp "${s.ramp}" repeats tone "${String(s.tone)}"`)
    ramp.tones.add(s.tone)
  }
  for (const [name, ramp] of ramps)
    if (ramp.tones.size !== TONES.length) out.push(`ramps: "${name}" needs exactly ${TONES.join("/")}`)

  if (!isRecord(json.biomes)) out.push("biomes: expected an object")
  else
    for (const [biome, swaps] of Object.entries(json.biomes)) {
      if (!isRecord(swaps)) {
        out.push(`biomes.${biome}: expected an object`)
        continue
      }
      for (const [from, to] of Object.entries(swaps)) {
        if (!ramps.has(from)) out.push(`biomes.${biome}: unknown ramp "${from}"`)
        if (typeof to !== "string" || !ramps.has(to))
          out.push(`biomes.${biome}.${from}: unknown ramp ${JSON.stringify(to)}`)
      }
    }
  return out
}

/** A parsed `palette.json` → Palette, or a throw listing every problem. */
export function loadPalette(json: unknown): Palette {
  const problems = paletteProblems(json)
  if (problems.length > 0) throw new Error(`invalid palette:\n  ${problems.join("\n  ")}`)
  const data = json as PaletteJson
  const swatches = data.swatches.map((s): Swatch => {
    const srgb = hexToSrgb(s.hex)
    return {
      id: s.id,
      name: s.name,
      hex: s.hex,
      group: s.group,
      ramp: s.ramp,
      tone: s.tone,
      srgb,
      lab: srgbToOklab(srgb),
    }
  })
  const ramps = new Map<string, { name: string; group: string; tones: Partial<Record<Tone, number>> }>()
  for (const s of swatches) {
    const ramp = ramps.get(s.ramp) ?? { name: s.ramp, group: s.group, tones: {} }
    ramp.tones[s.tone] = s.id
    ramps.set(s.ramp, ramp)
  }
  return {
    version: 1,
    status: data.status,
    groups: [...data.groups],
    swatches,
    ramps: [...ramps.values()] as Ramp[],
    biomes: data.biomes,
  }
}

/**
 * Fingerprint of what the palette bakes: swatches (id, name, hex, group, ramp, tone) and biome swaps.
 * The status text is left out, so editing the note does not trigger a re-import.
 */
export function paletteHash(palette: Palette): string {
  const parts = palette.swatches.map((s) => `${s.id},${s.name},${s.hex},${s.group},${s.ramp},${s.tone}`)
  for (const biome of Object.keys(palette.biomes).sort()) {
    const swaps = palette.biomes[biome] ?? {}
    const pairs = Object.keys(swaps)
      .sort()
      .map((from) => `${from}>${swaps[from]}`)
    parts.push(`b:${biome}:${pairs.join(";")}`)
  }
  return hash(palette.version, ...parts)
    .toString(16)
    .padStart(8, "0")
}
