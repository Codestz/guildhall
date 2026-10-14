/**
 * Raw pack folder → the pieces to import: include/exclude globs, slugs, and classification by the
 * pack's rules (first match wins), overrides and character entries.
 *
 * Globs: `*` stays inside one path segment, `**` crosses them, `?` is one character, `{a,b}` is
 * either; matching ignores case. A rule, `characters` or `scaleBy` pattern without a `/` matches the
 * piece name (the file stem); with a `/` it matches the path relative to the pack's source folder.
 */
import { readdirSync } from "node:fs"
import { basename, extname, join } from "node:path"
import type { PackConfig } from "@guildhall/assets"
import type { PieceSource } from "./stages/types.ts"

/** The model formats `read` accepts. */
export const MODEL_EXTS = [".glb", ".gltf"]

export function globToRegExp(glob: string): RegExp {
  let re = ""
  let depth = 0
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i] as string
    if (c === "*" && glob[i + 1] === "*") {
      re += glob[i + 2] === "/" ? "(?:.*/)?" : ".*"
      i += glob[i + 2] === "/" ? 2 : 1
    } else if (c === "*") re += "[^/]*"
    else if (c === "?") re += "[^/]"
    else if (c === "{") {
      depth++
      re += "(?:"
    } else if (c === "}" && depth > 0) {
      depth--
      re += ")"
    } else if (c === "," && depth > 0) re += "|"
    else re += c.replace(/[.+^$(){}|[\]\\]/g, "\\$&")
  }
  return new RegExp(`^${re}$`, "i")
}

/** Whether a rule-style pattern matches a piece (see the header for name vs path). */
export const matches = (pattern: string, name: string, source: string): boolean =>
  globToRegExp(pattern).test(pattern.includes("/") ? source : name)

/** "BirchTree_Dead_Snow_4" → "birch-tree-dead-snow-4". */
export function kebab(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

/** Every file under `dir`, relative and `/`-separated, sorted. */
export function listFiles(dir: string): string[] {
  const out: string[] = []
  const walk = (rel: string): void => {
    for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
      const path = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) walk(path)
      else if (e.isFile()) out.push(path)
    }
  }
  walk("")
  return out.sort()
}

export const stem = (file: string): string => basename(file, extname(file))

/** One piece's classification: category and tags from the first matching rule, then its override. */
export function classify(
  pack: PackConfig,
  file: string,
  source: string,
  name: string,
  node?: string,
): PieceSource {
  const slug = kebab(name)
  const rule = pack.rules.find((r) => matches(r.match, name, source))
  const override = pack.overrides?.[slug]
  const rig = pack.characters?.find((c) => matches(c.match, name, source))?.rig
  const piece: PieceSource = {
    pack: pack.id,
    file,
    source,
    name,
    slug,
    category: override?.category ?? rule?.category ?? "other",
    tags: [...new Set([...(rule?.tags ?? []), ...(override?.tags ?? [])])].sort(),
  }
  if (node !== undefined) piece.node = node
  if (rule) piece.rule = rule
  if (override) piece.override = override
  if (rig) piece.rig = rig
  return piece
}

/** Two pieces whose names kebab to the same slug: the config must exclude or rename one. */
export function slugClashes(pieces: readonly PieceSource[]): string[] {
  const seen = new Map<string, string>()
  const out: string[] = []
  for (const p of pieces) {
    const first = seen.get(p.slug)
    if (first !== undefined)
      out.push(`${p.pack}/${p.slug}: ${first} and ${p.source}${p.node ? `#${p.node}` : ""}`)
    else seen.set(p.slug, `${p.source}${p.node ? `#${p.node}` : ""}`)
  }
  return out
}

/**
 * The pack's model files (include minus exclude), classified, sorted by slug. Excluded slugs (an
 * override with `exclude: true`) are dropped. A missing source folder yields no pieces.
 */
export function discover(pack: PackConfig, rawRoot: string): PieceSource[] {
  const dir = join(rawRoot, pack.source)
  let files: string[]
  try {
    files = listFiles(dir)
  } catch {
    return []
  }
  const include = pack.include.map(globToRegExp)
  const exclude = (pack.exclude ?? []).map(globToRegExp)
  return files
    .filter((f) => MODEL_EXTS.includes(extname(f).toLowerCase()))
    .filter((f) => include.some((re) => re.test(f)) && !exclude.some((re) => re.test(f)))
    .map((f) => classify(pack, join(dir, f), f, stem(f)))
    .filter((p) => p.override?.exclude !== true)
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
}
