/**
 * Shape checks for catalog JSON (`bun import check`). Each validator returns every problem as
 * "where: what"; an empty list means the value is a valid CatalogEntry / CatalogIndex.
 */
import { CATEGORIES, KINDS, PIECE_FLAGS, SCALE_CONFIDENCES, SCALE_FLAGS, SCALE_RULES } from "./catalog.ts"
import { ANCHOR_KINDS, ATTACH_ROLES, COMPOSE_SOURCES, EDGE_KINDS, FACINGS } from "./compose.ts"
import type { Palette } from "./palette.ts"

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)
const isCount = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0
const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0
const isStrList = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr)
const isVec3 = (v: unknown): v is [number, number, number] =>
  Array.isArray(v) && v.length === 3 && v.every(isNum)
const oneOf = (list: readonly string[], v: unknown): boolean => typeof v === "string" && list.includes(v)
const show = (v: unknown): string => JSON.stringify(v) ?? String(v)

/** A list of distinct values, each from `list`. */
function checkSet(out: string[], at: string, list: readonly string[], v: unknown): void {
  if (!Array.isArray(v)) return void out.push(`${at}: expected an array`)
  for (const x of v) if (!oneOf(list, x)) out.push(`${at}: unknown ${show(x)}`)
  if (new Set(v).size !== v.length) out.push(`${at}: duplicates`)
}

function checkScale(out: string[], s: unknown): void {
  if (!isRecord(s)) return void out.push("scale: expected an object")
  if (!isNum(s.factor) || s.factor <= 0) out.push("scale.factor: expected a positive number")
  if (!oneOf(SCALE_RULES, s.rule)) out.push(`scale.rule: unknown ${show(s.rule)}`)
  if (!oneOf(SCALE_CONFIDENCES, s.confidence)) out.push(`scale.confidence: unknown ${show(s.confidence)}`)
  if (s.target !== undefined) {
    const t = s.target
    const ok =
      Array.isArray(t) && t.length === 2 && isNum(t[0]) && (t[1] === null || (isNum(t[1]) && t[1] >= t[0]))
    if (!ok) out.push("scale.target: expected [min, max | null] with min <= max")
  }
  checkSet(out, "scale.flags", SCALE_FLAGS, s.flags)
}

function checkCompose(out: string[], c: unknown): void {
  if (!isRecord(c)) return void out.push("compose: expected an object")
  if (c.front !== null && !oneOf(FACINGS, c.front)) out.push(`compose.front: unknown ${show(c.front)}`)
  if (c.streetEdge !== null && !oneOf(FACINGS, c.streetEdge))
    out.push(`compose.streetEdge: unknown ${show(c.streetEdge)}`)
  if (!oneOf(ATTACH_ROLES, c.attach)) out.push(`compose.attach: unknown ${show(c.attach)}`)
  if (c.edgeKind !== undefined && !oneOf(EDGE_KINDS, c.edgeKind))
    out.push(`compose.edgeKind: unknown ${show(c.edgeKind)}`)
  if (!oneOf(COMPOSE_SOURCES, c.source)) out.push(`compose.source: unknown ${show(c.source)}`)
  if (!Array.isArray(c.anchors)) return void out.push("compose.anchors: expected an array")
  for (const [i, a] of (c.anchors as unknown[]).entries()) {
    const at = `compose.anchors[${i}]`
    if (!isRecord(a)) {
      out.push(`${at}: expected an object`)
      continue
    }
    if (!isStr(a.id)) out.push(`${at}.id: expected a string`)
    if (!oneOf(ANCHOR_KINDS, a.kind)) out.push(`${at}.kind: unknown ${show(a.kind)}`)
    if (!isVec3(a.at)) out.push(`${at}.at: expected [x, y, z]`)
    if (!isNum(a.facing)) out.push(`${at}.facing: expected a number`)
  }
}

/** Problems with one catalog entry. With a palette, swatch ids must also exist in it. */
export function validateEntry(value: unknown, palette?: Palette): string[] {
  if (!isRecord(value)) return ["entry: expected an object"]
  const e = value
  const out: string[] = []
  const pre = isStr(e.id) ? `${e.id}: ` : ""
  if (!isStr(e.pack) || !SLUG.test(e.pack)) out.push("pack: expected a kebab-case id")
  const slug =
    isStr(e.id) && isStr(e.pack) && e.id.startsWith(`${e.pack}/`) ? e.id.slice(e.pack.length + 1) : ""
  if (!SLUG.test(slug)) out.push(`id: expected "<pack>/<kebab-slug>", got ${show(e.id)}`)
  if (!isStr(e.source)) out.push("source: expected a string")
  if (!isStr(e.name)) out.push("name: expected a string")
  if (!oneOf(KINDS, e.kind)) out.push(`kind: unknown ${show(e.kind)}`)
  if (!oneOf(CATEGORIES, e.category)) out.push(`category: unknown ${show(e.category)}`)
  if (!Array.isArray(e.tags) || !e.tags.every(isStr)) out.push("tags: expected strings")
  if (e.autoTags !== undefined) {
    const a = e.autoTags
    if (!isRecord(a) || !isStrList(a.tags) || !isStr(a.by) || !isStr(a.thumb))
      out.push("autoTags: expected { tags, by, thumb }")
  }
  if (!isVec3(e.size) || e.size.some((v) => v < 0)) out.push("size: expected [w, h, d] metres >= 0")
  if (!isRecord(e.footprint) || !isCount(e.footprint.w) || !isCount(e.footprint.d))
    out.push("footprint: expected whole cells { w, d }")
  for (const k of ["tris", "verts", "bytes"] as const) if (!isCount(e[k])) out.push(`${k}: expected a count`)

  const sw = e.swatches
  if (!Array.isArray(sw) || !sw.every(isCount)) out.push("swatches: expected palette ids")
  else {
    if (sw.some((v, i) => i > 0 && v <= (sw[i - 1] as number)))
      out.push("swatches: expected sorted, distinct ids")
    const missing = palette ? sw.filter((id) => id >= palette.swatches.length) : []
    if (missing.length > 0) out.push(`swatches: not in the palette: ${missing.join(", ")}`)
  }

  checkScale(out, e.scale)
  checkSet(out, "flags", PIECE_FLAGS, e.flags)
  checkCompose(out, e.compose)

  if (e.kind === "character" && e.character === undefined) out.push("character: required for kind character")
  if (e.character !== undefined) {
    const c = e.character
    if (!isRecord(c) || !isStr(c.rig) || !isStrList(c.clips) || !isCount(c.bones))
      out.push("character: expected { rig, clips, bones }")
  }
  if (!isRecord(e.files) || !isStr(e.files.glb) || !(e.files.thumb === null || isStr(e.files.thumb)))
    out.push("files: expected { glb, thumb | null }")
  if (!isStr(e.hash)) out.push("hash: expected a string")
  return out.map((p) => pre + p)
}

/** Problems with `index.json`. */
export function validateIndex(value: unknown): string[] {
  if (!isRecord(value)) return ["index: expected an object"]
  const out: string[] = []
  if (value.version !== 1) out.push(`version: expected 1, got ${show(value.version)}`)
  if (!isStr(value.palette)) out.push("palette: expected the palette hash")
  if (!isStr(value.importer)) out.push("importer: expected a string")
  if (!Array.isArray(value.packs)) out.push("packs: expected an array")
  else
    value.packs.forEach((p: unknown, i: number) => {
      if (!isRecord(p) || !isStr(p.id) || !isStr(p.vendor) || !isCount(p.count) || !isStr(p.hash))
        out.push(`packs[${i}]: expected { id, vendor, count, hash }`)
    })
  if (!Array.isArray(value.rigs)) out.push("rigs: expected an array")
  else
    value.rigs.forEach((r: unknown, i: number) => {
      const clipsOk =
        isRecord(r) &&
        Array.isArray(r.clips) &&
        r.clips.every((c: unknown) => isRecord(c) && isStr(c.name) && isNum(c.seconds) && c.seconds >= 0)
      if (!isRecord(r) || !isStr(r.id) || !isStr(r.file) || !isCount(r.bones) || !clipsOk)
        out.push(`rigs[${i}]: expected { id, file, clips: { name, seconds }[], bones }`)
    })
  return out
}
