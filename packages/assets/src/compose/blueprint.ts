/**
 * Prefab recipes (ADR 005): authored JSON in `data/recipes/<kind>/<id>.json`. An optional parametric
 * house (kit modules) plus free dressing; `compilePrefab` turns `(recipe, seed)` into a flat Recipe
 * and a PrefabMeta. Only the shapes and their validator live here.
 */
import { type Anchor, FACINGS, type Facing } from "../compose.ts"
import type { Palette } from "../palette.ts"
import type { RecipeInstance } from "../recipe.ts"
import { checkAnchors, isCount, isNum, isRecord, isStr, isStrList, oneOf, SLUG, show } from "../validate.ts"

export const PREFAB_KINDS = [
  "house",
  "shop",
  "tavern",
  "forge",
  "chapel",
  "landmark",
  "stall",
  "farmhouse",
  "shed",
  "dock",
  "gatehouse",
  "well",
] as const
export type PrefabKind = (typeof PREFAB_KINDS)[number]

/** KitProfile ids (the profiles themselves live in compose/kits.ts). */
export const KITS = ["kenney-town"] as const
export const FAMILIES = ["stone", "plaster", "wood"] as const
export const OPENINGS = ["shop", "home", "blind"] as const
export const ROOF_STYLES = ["gable", "high-gable", "flat", "point"] as const
export const RIDGES = ["x", "z"] as const
export const DOOR_STYLES = ["round", "square", "wide"] as const
/** Storeys per house, ground first. */
export const MAX_STOREYS = 3

export interface Storey {
  family: (typeof FAMILIES)[number]
  openings: (typeof OPENINGS)[number]
}

export interface HouseBlueprint {
  kit: (typeof KITS)[number]
  /** Modules (3 m): frontage = 3w m, depth = 3d m. */
  size: { w: number; d: number }
  /** Ground first, 1–3. */
  storeys: Storey[]
  roof: { style: (typeof ROOF_STYLES)[number]; ridge: (typeof RIDGES)[number] }
  /** `index` counts front cells from the left. */
  door: { index: number | "centre"; style?: (typeof DOOR_STYLES)[number] }
  /** Probability 0..1. */
  chimney?: number
  /** Explicit panel overrides; `piece: null` leaves the slot empty. */
  edits: { storey: number; side: Facing; index: number; piece: string | null }[]
  /** Per-seed options: ramp → replacement ramps; opening styles. */
  vary: { rampSwaps?: Record<string, string[]>; openings?: string[] }
}

export interface PrefabRecipe {
  version: 1
  id: string
  kind: PrefabKind
  tags: string[]
  /** Strings here; world owns the enums. */
  fits: { districts?: string[]; tiers?: string[] }
  /** The parametric part (houses, shops, taverns…). */
  house?: HouseBlueprint
  /** Free pieces in recipe space (+z = front). */
  dressing: RecipeInstance[]
  /** Extra sockets (station, sign); the door is derived. */
  anchors: Anchor[]
}

export interface PrefabMeta {
  id: string
  kind: PrefabKind
  /** Metres. */
  frontage: number
  depth: number
  height: number
  door: [x: number, z: number]
  stations: Anchor[]
  fits: PrefabRecipe["fits"]
  tags: string[]
}

const isInt = (v: unknown): v is number => Number.isInteger(v)

/** Every ramp name `rampMap`/`rampSwaps` mention must exist when a palette is given. */
function checkRamp(out: string[], at: string, name: unknown, palette?: Palette): void {
  if (!isStr(name)) return void out.push(`${at}: expected a ramp name`)
  if (palette && !palette.ramps.some((r) => r.name === name)) out.push(`${at}: unknown ramp ${show(name)}`)
}

/** One placed piece (RecipeInstance). Exported for NPC and town data that embed instances. */
export function checkInstance(out: string[], at: string, v: unknown, palette?: Palette): void {
  if (!isRecord(v)) return void out.push(`${at}: expected an object`)
  if (!isStr(v.piece)) out.push(`${at}.piece: expected a catalog id`)
  for (const k of ["x", "y", "z", "rot"] as const) if (!isNum(v[k])) out.push(`${at}.${k}: expected a number`)
  if (!isNum(v.scale) || v.scale <= 0) out.push(`${at}.scale: expected a positive number`)
  const map = v.swatchMap
  if (map !== undefined) {
    const ok = isRecord(map) && Object.entries(map).every(([from, to]) => /^\d+$/.test(from) && isCount(to))
    if (!ok) out.push(`${at}.swatchMap: expected swatch id → swatch id`)
    else if (palette)
      for (const [from, to] of Object.entries(map))
        if (Number(from) >= palette.swatches.length || (to as number) >= palette.swatches.length)
          out.push(`${at}.swatchMap: ${from}>${to} is not in the palette`)
  }
  if (v.rampMap !== undefined) {
    if (!isRecord(v.rampMap)) out.push(`${at}.rampMap: expected ramp → ramp`)
    else
      for (const [from, to] of Object.entries(v.rampMap)) {
        checkRamp(out, `${at}.rampMap`, from, palette)
        checkRamp(out, `${at}.rampMap.${from}`, to, palette)
      }
  }
}

function checkHouse(out: string[], h: unknown, palette?: Palette): void {
  if (!isRecord(h)) return void out.push("house: expected an object")
  if (!oneOf(KITS, h.kit)) out.push(`house.kit: unknown ${show(h.kit)}`)
  const size = isRecord(h.size) && isInt(h.size.w) && isInt(h.size.d) && h.size.w >= 1 && h.size.d >= 1
  if (!size) out.push("house.size: expected whole modules { w, d } >= 1")
  // With a bad size, index bounds are not checked (the size problem is already reported).
  const { w, d } = size ? (h.size as HouseBlueprint["size"]) : { w: Infinity, d: Infinity }

  const storeys: unknown[] = Array.isArray(h.storeys) ? h.storeys : []
  if (!Array.isArray(h.storeys) || storeys.length < 1 || storeys.length > MAX_STOREYS)
    out.push(`house.storeys: expected 1–${MAX_STOREYS} storeys`)
  for (const [i, s] of storeys.entries()) {
    if (!isRecord(s)) {
      out.push(`house.storeys[${i}]: expected { family, openings }`)
      continue
    }
    if (!oneOf(FAMILIES, s.family)) out.push(`house.storeys[${i}].family: unknown ${show(s.family)}`)
    if (!oneOf(OPENINGS, s.openings)) out.push(`house.storeys[${i}].openings: unknown ${show(s.openings)}`)
  }

  if (!isRecord(h.roof)) out.push("house.roof: expected { style, ridge }")
  else {
    if (!oneOf(ROOF_STYLES, h.roof.style)) out.push(`house.roof.style: unknown ${show(h.roof.style)}`)
    if (!oneOf(RIDGES, h.roof.ridge)) out.push(`house.roof.ridge: unknown ${show(h.roof.ridge)}`)
    if (h.roof.style === "point" && size && (w !== 1 || d !== 1))
      out.push("house.roof.style: point needs a 1×1 footprint")
  }

  if (!isRecord(h.door)) out.push("house.door: expected { index, style? }")
  else {
    const i = h.door.index
    if (!(i === "centre" || (isInt(i) && i >= 0 && i < w)))
      out.push(`house.door.index: expected "centre" or a front cell 0..${w - 1}`)
    if (h.door.style !== undefined && !oneOf(DOOR_STYLES, h.door.style))
      out.push(`house.door.style: unknown ${show(h.door.style)}`)
  }

  if (h.chimney !== undefined && !(isNum(h.chimney) && h.chimney >= 0 && h.chimney <= 1))
    out.push("house.chimney: expected a probability 0..1")

  if (!Array.isArray(h.edits)) out.push("house.edits: expected an array")
  else {
    const seen = new Set<string>()
    for (const [i, e] of (h.edits as unknown[]).entries()) {
      const at = `house.edits[${i}]`
      if (!isRecord(e)) {
        out.push(`${at}: expected { storey, side, index, piece }`)
        continue
      }
      if (!(isInt(e.storey) && e.storey >= 0 && e.storey < storeys.length))
        out.push(`${at}.storey: expected 0..${storeys.length - 1}`)
      if (!oneOf(FACINGS, e.side)) out.push(`${at}.side: unknown ${show(e.side)}`)
      // ±z sides run along the frontage (w cells), ±x along the depth (d cells).
      const cells = e.side === "+z" || e.side === "-z" ? w : d
      if (!(isInt(e.index) && e.index >= 0 && e.index < cells))
        out.push(`${at}.index: expected 0..${cells - 1}`)
      if (!(e.piece === null || isStr(e.piece))) out.push(`${at}.piece: expected a catalog id or null`)
      const key = `${String(e.storey)}|${String(e.side)}|${String(e.index)}`
      if (seen.has(key)) out.push(`${at}: edits the same panel twice`)
      seen.add(key)
    }
  }

  if (!isRecord(h.vary)) return void out.push("house.vary: expected an object")
  const { rampSwaps, openings } = h.vary
  if (rampSwaps !== undefined) {
    if (!isRecord(rampSwaps)) out.push("house.vary.rampSwaps: expected ramp → ramps")
    else
      for (const [from, options] of Object.entries(rampSwaps)) {
        checkRamp(out, "house.vary.rampSwaps", from, palette)
        if (!Array.isArray(options) || options.length === 0)
          out.push(`house.vary.rampSwaps.${from}: expected a non-empty list of ramps`)
        else
          for (const [i, to] of options.entries())
            checkRamp(out, `house.vary.rampSwaps.${from}[${i}]`, to, palette)
      }
  }
  if (openings !== undefined && !isStrList(openings)) out.push("house.vary.openings: expected strings")
}

/** Problems with a prefab recipe, as "where: what". With a palette, ramp and swatch names are checked too. */
export function validatePrefab(json: unknown, palette?: Palette): string[] {
  if (!isRecord(json)) return ["prefab: expected an object"]
  const r = json
  const out: string[] = []
  if (r.version !== 1) out.push(`version: expected 1, got ${show(r.version)}`)
  if (!isStr(r.id) || !SLUG.test(r.id)) out.push(`id: expected a kebab-case id, got ${show(r.id)}`)
  if (!oneOf(PREFAB_KINDS, r.kind)) out.push(`kind: unknown ${show(r.kind)}`)
  if (!Array.isArray(r.tags) || !r.tags.every(isStr)) out.push("tags: expected strings")
  if (!isRecord(r.fits)) out.push("fits: expected { districts?, tiers? }")
  else
    for (const k of ["districts", "tiers"] as const)
      if (r.fits[k] !== undefined && !isStrList(r.fits[k])) out.push(`fits.${k}: expected strings`)
  if (r.house !== undefined) checkHouse(out, r.house, palette)
  if (!Array.isArray(r.dressing)) out.push("dressing: expected an array")
  else
    for (const [i, d] of (r.dressing as unknown[]).entries()) checkInstance(out, `dressing[${i}]`, d, palette)
  checkAnchors(out, "anchors", r.anchors)
  if (r.house === undefined && Array.isArray(r.dressing) && r.dressing.length === 0)
    out.push("prefab: draws nothing (no house and no dressing)")
  return out
}
