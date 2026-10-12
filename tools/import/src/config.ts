/**
 * Where things live and which packs exist. Every location can be moved by an environment variable,
 * so tests and worktrees point the importer at fixtures or a temporary library:
 *   GUILDHALL_ASSETS   raw packs           (default <repo>/assets/src)
 *   GUILDHALL_LIBRARY  generated library   (default <repo>/library)
 *   GUILDHALL_PACKS    pack configs        (default tools/import/packs)
 */
import { existsSync, readdirSync } from "node:fs"
import { join, resolve } from "node:path"
import type { PackConfig } from "@guildhall/assets"

export const REPO = resolve(import.meta.dir, "../../..")
/** Written into the catalog index and every cache key: bump it when the output format changes. */
export const IMPORTER = "guildhall-import@0.1.0"

export interface Paths {
  raw: string
  library: string
  packs: string
}

export function paths(env: Record<string, string | undefined> = process.env): Paths {
  return {
    raw: resolve(env.GUILDHALL_ASSETS ?? join(REPO, "assets/src")),
    library: resolve(env.GUILDHALL_LIBRARY ?? join(REPO, "library")),
    packs: resolve(env.GUILDHALL_PACKS ?? join(REPO, "tools/import/packs")),
  }
}

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/
const COLOUR_MODES = ["atlas", "colormap", "material", "vertex", "texture-average", "keep-texture"]
const PIVOTS = ["bottom-centre", "trunk", "keep"]

/** Shape problems the type checker cannot see once a config is loaded at runtime. */
export function packProblems(p: PackConfig): string[] {
  const out: string[] = []
  if (!KEBAB.test(p.id)) out.push(`id: expected kebab-case, got "${p.id}"`)
  if (!p.source) out.push("source: expected a folder name")
  if (!Array.isArray(p.include) || p.include.length === 0) out.push("include: expected at least one glob")
  if (!COLOUR_MODES.includes(p.colour?.mode)) out.push(`colour.mode: unknown "${p.colour?.mode}"`)
  if (!PIVOTS.includes(p.pivot)) out.push(`pivot: unknown "${p.pivot}"`)
  if (!p.scale || !("factor" in p.scale || "ref" in p.scale))
    out.push("scale: expected { factor } or { ref }")
  if (!Array.isArray(p.rules)) out.push("rules: expected an array")
  return out.map((m) => `${p.id}: ${m}`)
}

/** Every pack config in `dir` (`<id>.ts`, default export), sorted by id. Throws on a bad config. */
export async function loadPacks(dir: string): Promise<PackConfig[]> {
  if (!existsSync(dir)) return []
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".ts"))
    .sort()
  const packs: PackConfig[] = []
  for (const f of files) {
    const mod = (await import(join(dir, f))) as { default?: PackConfig }
    const pack = mod.default
    if (!pack) throw new Error(`${f}: no default export`)
    if (`${pack.id}.ts` !== f) throw new Error(`${f}: id "${pack.id}" must match the file name`)
    const problems = packProblems(pack)
    if (problems.length > 0) throw new Error(problems.join("\n"))
    packs.push(pack)
  }
  return packs
}

/** The packs named on the command line; `all` (or nothing) selects every pack. */
export function selectPacks(packs: PackConfig[], names: string[]): PackConfig[] {
  if (names.length === 0 || names.includes("all")) return packs
  const unknown = names.filter((n) => !packs.some((p) => p.id === n))
  if (unknown.length > 0) throw new Error(`unknown pack: ${unknown.join(", ")}`)
  return packs.filter((p) => names.includes(p.id))
}
