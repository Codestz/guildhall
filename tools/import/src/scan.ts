/**
 * `bun import scan <pack|all>`: a raw report on pack files before any config exists, so the configs
 * can be written from evidence. Per piece: bounding box, minY, pivot offset, tris, where the colour
 * comes from, textures, skin and animations. Nothing is written to the library.
 *
 * Colour source kinds, per primitive (a piece reports the kind covering most triangles):
 *   vertex    COLOR_0 present
 *   material  no texture: material base colours
 *   colormap  texture whose faces nearly all read a point or a line of it (flat swatch cells)
 *   atlas     texture whose faces read small regions (gradient swatches)
 *   texture   faces span real image area (painted or tiling textures)
 */
import { existsSync, readdirSync, statSync } from "node:fs"
import { extname, join } from "node:path"
import { type Document, getBounds, type Primitive } from "@gltf-transform/core"
import type { PackConfig } from "@guildhall/assets"
import { discover, listFiles, MODEL_EXTS, stem } from "./discover.ts"
import { readModel, topNodes } from "./read.ts"

export const COLOUR_KINDS = ["vertex", "material", "colormap", "atlas", "texture"] as const
export type ColourKind = (typeof COLOUR_KINDS)[number]

/*
 * Thresholds measured on the downloaded packs: flat-colour colormaps put ~100% of faces on zero-area
 * UVs; gradient atlases put 10-60% there with a median of 0-40 texels; painted textures have medians
 * in the thousands.
 */
/** Median triangle area (texels) above which faces read real image regions. */
const IMAGE_TEXELS = 256
/** A triangle under this many texels reads a point or a line. */
const DEGENERATE_TEXELS = 0.01
/** Share of such triangles at which a texture is a colormap. */
const COLORMAP_SHARE = 0.9

export interface ScanRow {
  source: string
  name: string
  format: string
  error?: string
  /** Piece-level nodes (wrapper roots looked through); > 1 hints at `split: "top-nodes"`. */
  nodes?: number
  tris?: number
  verts?: number
  size?: [number, number, number]
  minY?: number
  /** Bounding-box centre on x and z: how far the pivot sits from the footprint's middle. */
  pivot?: [number, number]
  colour?: ColourKind
  /** Triangles per colour kind when a piece mixes them. */
  colours?: Partial<Record<ColourKind, number>>
  textures?: number
  images?: { name: string; width: number; height: number }[]
  materials?: { name: string; rgb: [number, number, number]; textured: boolean }[]
  skinned?: boolean
  joints?: number
  animations?: { name: string; seconds: number }[]
}

export interface PackScan {
  folder: string
  /** Formats read, and how many files of another format were skipped as duplicates. */
  formats: string[]
  skipped: number
  rows: ScanRow[]
}

const r3 = (v: number): number => Math.round(v * 1000) / 1000 || 0
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length === 0 ? 0 : (s[Math.floor(s.length / 2)] as number)
}

/**
 * The files worth scanning in a raw folder: every glTF/GLB, or the FBX files when the folder has no
 * glTF at all (packs ship the same models in several formats).
 */
export function pickModelFiles(dir: string): { files: string[]; skipped: number } {
  const models = listFiles(dir).filter((f) => MODEL_EXTS.includes(extname(f).toLowerCase()))
  const gltf = models.filter((f) => extname(f).toLowerCase() !== ".fbx")
  const files = gltf.length > 0 ? gltf : models
  return { files, skipped: models.length - files.length }
}

function triangleCount(prim: Primitive): number {
  const n = prim.getIndices()?.getCount() ?? prim.getAttribute("POSITION")?.getCount() ?? 0
  return Math.floor(n / 3)
}

/**
 * How a primitive's triangles sit in texture space: the median triangle area in texels, and the share
 * of triangles with (near) zero area, i.e. faces that read a point or a line of the image.
 */
export function uvFootprint(
  prim: Primitive,
  texCoord: number,
  width: number,
  height: number,
): { median: number; degenerate: number } {
  const uv = prim.getAttribute(`TEXCOORD_${texCoord}`)
  const tris = triangleCount(prim)
  if (!uv || tris === 0) return { median: 0, degenerate: 1 }
  const idx = prim.getIndices()
  const areas: number[] = []
  const step = Math.max(1, Math.floor(tris / 2000))
  const a: [number, number] = [0, 0]
  const b: [number, number] = [0, 0]
  const c: [number, number] = [0, 0]
  for (let t = 0; t < tris; t += step) {
    const at = (k: number): number => (idx ? idx.getScalar(t * 3 + k) : t * 3 + k)
    uv.getElement(at(0), a)
    uv.getElement(at(1), b)
    uv.getElement(at(2), c)
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])
    areas.push((Math.abs(cross) / 2) * width * height)
  }
  const degenerate = areas.filter((x) => x < DEGENERATE_TEXELS).length / areas.length
  return { median: median(areas), degenerate }
}

export function colourKind(prim: Primitive): ColourKind {
  if (prim.getAttribute("COLOR_0")) return "vertex"
  const mat = prim.getMaterial()
  const tex = mat?.getBaseColorTexture()
  if (!mat || !tex) return "material"
  const [w, h] = tex.getSize() ?? [1024, 1024]
  const uv = uvFootprint(prim, mat.getBaseColorTextureInfo()?.getTexCoord() ?? 0, w, h)
  if (uv.median > IMAGE_TEXELS) return "texture"
  return uv.degenerate >= COLORMAP_SHARE ? "colormap" : "atlas"
}

/** The scan row for an already-read document. */
export function scanDocument(doc: Document, source: string, name: string, format: string): ScanRow {
  const root = doc.getRoot()
  const scene = root.getDefaultScene() ?? root.listScenes()[0]
  const colours: Partial<Record<ColourKind, number>> = {}
  let tris = 0
  let verts = 0
  for (const mesh of root.listMeshes())
    for (const prim of mesh.listPrimitives()) {
      const t = triangleCount(prim)
      tris += t
      verts += prim.getAttribute("POSITION")?.getCount() ?? 0
      const kind = colourKind(prim)
      colours[kind] = (colours[kind] ?? 0) + t
    }
  const kinds = Object.entries(colours) as [ColourKind, number][]
  const dominant = kinds.sort((x, y) => y[1] - x[1])[0]?.[0]
  const b = scene ? getBounds(scene) : { min: [0, 0, 0], max: [0, 0, 0] }
  const skin = root.listSkins()[0]
  const row: ScanRow = {
    source,
    name,
    format,
    nodes: topNodes(doc).length,
    tris,
    verts,
    size: [0, 1, 2].map((i) => r3((b.max[i] ?? 0) - (b.min[i] ?? 0))) as [number, number, number],
    minY: r3(b.min[1] ?? 0),
    pivot: [r3(((b.max[0] ?? 0) + (b.min[0] ?? 0)) / 2), r3(((b.max[2] ?? 0) + (b.min[2] ?? 0)) / 2)],
    textures: root.listTextures().length,
    images: root.listTextures().map((t) => {
      const [width, height] = t.getSize() ?? [0, 0]
      return { name: t.getURI() || t.getName() || "(embedded)", width, height }
    }),
    materials: root.listMaterials().map((m) => ({
      name: m.getName(),
      rgb: m.getBaseColorFactor().slice(0, 3).map(r3) as [number, number, number],
      textured: !!m.getBaseColorTexture(),
    })),
    skinned: !!skin,
    animations: root.listAnimations().map((a) => ({
      name: a.getName(),
      seconds: r3(Math.max(0, ...a.listSamplers().map((s) => s.getInput()?.getMax([0])[0] ?? 0))),
    })),
  }
  if (dominant) row.colour = dominant
  if (kinds.length > 1) row.colours = colours
  if (skin) row.joints = skin.listJoints().length
  return row
}

export async function scanFile(file: string, source: string, cacheDir: string): Promise<ScanRow> {
  const format = extname(file).slice(1).toLowerCase()
  try {
    return scanDocument(await readModel(file, cacheDir), source, stem(file), format)
  } catch (err) {
    return {
      source,
      name: stem(file),
      format,
      error: (err instanceof Error ? err.message : String(err)).slice(0, 300),
    }
  }
}

/** The raw folders under the assets root (every directory, models or not). */
export function rawFolders(raw: string): string[] {
  if (!existsSync(raw)) return []
  return readdirSync(raw)
    .filter((n) => !n.startsWith(".") && statSync(join(raw, n)).isDirectory())
    .sort()
}

/** Scans one raw folder; with a pack config, only the files it includes. */
export async function scanPack(
  raw: string,
  folder: string,
  cacheDir: string,
  pack?: PackConfig,
): Promise<PackScan> {
  const dir = join(raw, folder)
  const picked = pack ? { files: discover(pack, raw).map((p) => p.source), skipped: 0 } : pickModelFiles(dir)
  const rows: ScanRow[] = []
  for (const f of picked.files) rows.push(await scanFile(join(dir, f), f, cacheDir))
  const formats = [...new Set(rows.map((r) => r.format))].sort()
  return { folder, formats, skipped: picked.skipped, rows }
}

const SCALE_HINTS: [label: string, pattern: RegExp][] = [
  ["door", /door/i],
  ["wall", /wall/i],
  ["house/building", /house|home|building|cottage|tavern|inn|barn/i],
  ["tree", /tree/i],
  ["character", /character|knight|mage|rogue|barbarian|man|woman|villager|skeleton/i],
]
const MODE_FOR: Record<ColourKind, string> = {
  atlas: "atlas",
  colormap: "colormap",
  material: "material",
  vertex: "vertex",
  texture: "texture-average",
}

/** A short human summary per pack: colour mode, scale hints, pivots and problems. */
export function scanMarkdown(scans: readonly PackScan[]): string {
  const lines = [
    "# Import scan",
    "",
    "Generated by `bun import scan all`. Sizes in source units (metres if the pack is metric).",
    "",
  ]
  for (const s of scans) {
    const ok = s.rows.filter((r) => !r.error)
    const bad = s.rows.filter((r) => r.error)
    lines.push(`## ${s.folder}`, "")
    if (s.rows.length === 0) {
      lines.push("No model files.", "")
      continue
    }
    const kinds = new Map<ColourKind, number>()
    for (const r of ok) if (r.colour) kinds.set(r.colour, (kinds.get(r.colour) ?? 0) + 1)
    const ranked = [...kinds].sort((a, b) => b[1] - a[1])
    const top = ranked[0]?.[0]
    const images = new Map<string, string>()
    for (const r of ok) for (const i of r.images ?? []) images.set(i.name, `${i.width}x${i.height}`)
    const heights = ok.map((r) => r.size?.[1] ?? 0)
    const atZero = ok.filter((r) => Math.abs(r.minY ?? 0) <= 0.01).length
    const below = ok.filter((r) => (r.minY ?? 0) < -0.01).length
    const centred = ok.filter((r) => {
      const [w = 0, , d = 0] = r.size ?? []
      const [cx = 0, cz = 0] = r.pivot ?? []
      return Math.abs(cx) <= 0.05 * w + 0.02 && Math.abs(cz) <= 0.05 * d + 0.02
    }).length
    const skinned = ok.filter((r) => r.skinned)
    const clips = ok.reduce((n, r) => n + (r.animations?.length ?? 0), 0)
    // A skinned file's mesh and armature are siblings: that is one character, not a split candidate.
    const multi = ok.filter((r) => !r.skinned && (r.nodes ?? 0) > 1).length
    lines.push(
      `- files: ${s.rows.length} (${s.formats.join(", ")})${s.skipped ? `, ${s.skipped} in other formats skipped` : ""}${bad.length ? `, **${bad.length} failed**` : ""}`,
      `- colour: ${ranked.map(([k, n]) => `${k} ${n}`).join(", ") || "none"}${top ? ` → mode \`${MODE_FOR[top]}\`` : ""}`,
      `- textures: ${
        images.size === 0
          ? "none"
          : [...images]
              .slice(0, 6)
              .map(([n, d]) => `${n} (${d})`)
              .join("; ")
      }${images.size > 6 ? ` … ${images.size} total` : ""}`,
      `- tris: median ${median(ok.map((r) => r.tris ?? 0))}, max ${Math.max(0, ...ok.map((r) => r.tris ?? 0))}`,
      `- size (median w/h/d): ${[0, 1, 2].map((i) => r3(median(ok.map((r) => r.size?.[i] ?? 0)))).join(" / ")}; tallest ${r3(Math.max(0, ...heights))}`,
      `- minY: ${atZero} on 0, ${below} below, ${ok.length - atZero - below} above; xz-centred ${centred}/${ok.length}`,
    )
    const hints = SCALE_HINTS.map(([label, re]) => {
      const hs = ok.filter((r) => re.test(r.name)).map((r) => r.size?.[1] ?? 0)
      return hs.length ? `${label} h≈${r3(median(hs))} (${hs.length})` : ""
    }).filter(Boolean)
    if (hints.length) lines.push(`- scale hints: ${hints.join(", ")}`)
    if (skinned.length || clips)
      lines.push(
        `- skinned: ${skinned.length}, clips: ${clips} (${[...new Set(ok.flatMap((r) => r.animations?.map((a) => a.name) ?? []))].slice(0, 8).join(", ")})`,
      )
    if (multi) lines.push(`- ${multi} files hold several piece-level nodes (consider \`split: "top-nodes"\`)`)
    const problems: string[] = []
    const mixed = ok.filter((r) => r.colours).length
    if (mixed) problems.push(`${mixed} pieces mix colour kinds`)
    if (Math.max(0, ...heights) > 100) problems.push("sizes over 100: probably centimetres")
    for (const r of bad.slice(0, 5)) problems.push(`${r.source}: ${r.error}`)
    if (problems.length) lines.push(`- problems: ${problems.join("; ")}`)
    lines.push("")
  }
  return lines.join("\n")
}
