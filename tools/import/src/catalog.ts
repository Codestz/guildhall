/**
 * Catalog output: one shard per pack (`library/catalog/<pack>.json`) plus `index.json`. Output is
 * deterministic: entries sorted by id, sizes to 1e-2, other decimals to 1e-3, sets sorted, no
 * timestamps, so an unchanged import rewrites identical bytes.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type {
  CatalogEntry,
  CatalogIndex,
  DataOverlay,
  PackConfig,
  Palette,
  RigEntry,
  ScaleInfo,
} from "@guildhall/assets"
import { applyOverlay, paletteHash } from "@guildhall/assets"
import { contentHash } from "./cache.ts"
import { IMPORTER } from "./config.ts"
import { loadOverlay } from "./overlay.ts"
import type { PieceReport, PieceSource } from "./stages/types.ts"
import type { Written } from "./write.ts"

const r2 = (v: number): number => Math.round(v * 100) / 100 || 0
const r3 = (v: number): number => Math.round(v * 1000) / 1000 || 0
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** The scale record when no stage has written one: the pack's own factor (or 1 until a ref is measured). */
function packScale(pack: PackConfig): ScaleInfo {
  return "factor" in pack.scale
    ? { factor: pack.scale.factor, rule: "factor", confidence: "pack", flags: [] }
    : { factor: 1, rule: "ref", confidence: "guess", flags: [] }
}

/** A piece's catalog entry, from what discovery classified and what the stages reported. */
export function toEntry(
  pack: PackConfig,
  source: PieceSource,
  report: PieceReport,
  written: Written,
): CatalogEntry {
  const m = report.measures
  const entry: CatalogEntry = {
    id: `${pack.id}/${source.slug}`,
    pack: pack.id,
    source: source.node ? `${source.source}#${source.node}` : source.source,
    name: source.name,
    kind: report.kind,
    category: source.category,
    tags: source.tags,
    size: m?.size ?? [0, 0, 0],
    footprint: m?.footprint ?? { w: 0, d: 0 },
    tris: m?.tris ?? 0,
    verts: m?.verts ?? 0,
    bytes: written.bytes,
    swatches: [...report.swatches],
    scale: report.scale ?? packScale(pack),
    flags: [...report.flags],
    compose: report.compose,
    files: { glb: written.glb, thumb: null },
    hash: written.hash,
  }
  if (report.character) entry.character = report.character
  return normalizeEntry(entry)
}

/** A rounded, sorted copy of an entry, so equal content always serialises the same way. */
export function normalizeEntry(e: CatalogEntry): CatalogEntry {
  const out: CatalogEntry = {
    ...e,
    tags: [...e.tags].sort(byText),
    size: [r2(e.size[0]), r2(e.size[1]), r2(e.size[2])],
    swatches: [...e.swatches].sort((a, b) => a - b),
    scale: {
      ...e.scale,
      factor: r3(e.scale.factor),
      flags: [...e.scale.flags].sort(byText),
      ...(e.scale.target
        ? { target: [r2(e.scale.target[0]), e.scale.target[1] === null ? null : r2(e.scale.target[1])] }
        : {}),
    },
    flags: [...e.flags].sort(byText),
    compose: {
      ...e.compose,
      anchors: e.compose.anchors.map((a) => ({
        ...a,
        at: [r3(a.at[0]), r3(a.at[1]), r3(a.at[2])],
        facing: r3(a.facing),
      })),
    },
  }
  if (e.character) out.character = { ...e.character, clips: [...e.character.clips] }
  return out
}

export const shardFile = (library: string, pack: string): string => join(library, "catalog", `${pack}.json`)

/** The pack's current shard, or an empty list. */
export function readShard(library: string, pack: string): CatalogEntry[] {
  const file = shardFile(library, pack)
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as CatalogEntry[]) : []
}

/**
 * Writes the shard sorted by id, with the authored data overlay (`data/mounts.json`) laid on last;
 * returns the shard's content hash. An invalid overlay throws before anything is written.
 */
export function writeShard(
  library: string,
  pack: string,
  entries: readonly CatalogEntry[],
  overlay: DataOverlay = loadOverlay(),
): string {
  const sorted = applyOverlay(entries, overlay)
    .map(normalizeEntry)
    .sort((a, b) => byText(a.id, b.id))
  const text = `${JSON.stringify(sorted, null, 2)}\n`
  mkdirSync(join(library, "catalog"), { recursive: true })
  writeFileSync(shardFile(library, pack), text)
  return contentHash(text)
}

/** The shard ids present on disk (every `catalog/*.json` except the index). */
export function shardIds(library: string): string[] {
  const dir = join(library, "catalog")
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json") && f !== "index.json")
    .map((f) => f.slice(0, -".json".length))
    .sort(byText)
}

/**
 * Rebuilds `index.json` from every shard on disk, so importing one pack keeps the others listed.
 * `vendors` names the vendor of each configured pack; each given rig replaces the previous index's
 * rig of that id, and the previous index's other rigs are kept.
 */
export function writeIndex(
  library: string,
  palette: Palette,
  vendors: Record<string, string>,
  rigs?: RigEntry[],
): CatalogIndex {
  const file = join(library, "catalog", "index.json")
  const previous = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as CatalogIndex) : undefined
  const index: CatalogIndex = {
    version: 1,
    palette: paletteHash(palette),
    importer: IMPORTER,
    packs: shardIds(library).map((id) => {
      const text = readFileSync(shardFile(library, id), "utf8")
      const vendor = vendors[id] ?? previous?.packs.find((p) => p.id === id)?.vendor ?? "other"
      return { id, vendor, count: (JSON.parse(text) as unknown[]).length, hash: contentHash(text) }
    }),
    rigs: [...(previous?.rigs ?? []).filter((r) => !rigs?.some((x) => x.id === r.id)), ...(rigs ?? [])].sort(
      (a, b) => byText(a.id, b.id),
    ),
  }
  mkdirSync(join(library, "catalog"), { recursive: true })
  writeFileSync(file, `${JSON.stringify(index, null, 2)}\n`)
  return index
}
