import { dominant, type Language, languageOf } from "../gen/biomes.ts"
import type { RepoEntry } from "../gen/repo.ts"

/**
 * Which unit (a district-to-be) a path belongs to, named as summarize (world/gen/repo.ts) names its
 * districts: "/" for the root's own files, the top-level folder, or "container/package" for a file
 * inside a workspace package. Units are always split by package; whether the island splits a
 * container into villages is decided at the end, by summarize (reconstruct.ts maps them back).
 */

/** Mirrors repo.ts' workspace containers (not exported there): keep the two in step. */
const WORKSPACES = new Set(["packages", "apps", "crates", "libs", "services", "modules"])

export interface UnitName {
  name: string
  group?: string
}

export function unitOf(path: string, type: RepoEntry["type"] = "blob"): UnitName {
  const parts = path.split("/")
  const top = parts[0] ?? "/"
  // A submodule at the root is a district of its own, as in summarize.
  if (parts.length === 1) return type === "commit" ? { name: path } : { name: "/" }
  if (WORKSPACES.has(top.toLowerCase()) && parts.length > 2) return { name: `${top}/${parts[1]}`, group: top }
  return { name: top }
}

export interface UnitTally extends UnitName {
  files: number
  bytes: number
  languages: Map<string, { language: Language; bytes: number }>
}

/** A tree's files and bytes per unit (directories are skipped). */
export function tallyUnits(entries: readonly RepoEntry[]): Map<string, UnitTally> {
  const out = new Map<string, UnitTally>()
  for (const entry of entries) {
    if (entry.type === "tree") continue
    const unit = unitOf(entry.path, entry.type)
    let known = out.get(unit.name)
    if (!known) {
      known = { ...unit, files: 0, bytes: 0, languages: new Map() }
      out.set(unit.name, known)
    }
    const bytes = entry.size ?? 0
    known.files++
    known.bytes += bytes
    const language = languageOf(entry.path)
    const sum = known.languages.get(language.name) ?? { language, bytes: 0 }
    // Weighted by bytes; a tree without sizes weighs each file as one.
    sum.bytes += entry.size === undefined ? 1 : bytes
    known.languages.set(language.name, sum)
  }
  return out
}

/** A tally's dominant language name. */
export const languageName = (tally: Pick<UnitTally, "languages">): string => dominant(tally.languages).name

/** [language, percent] biggest first, one decimal, from bytes per language; under 0.1 % dropped. */
export function percentages(bytesByLanguage: ReadonlyMap<string, number>, top = 10): [string, number][] {
  const total = [...bytesByLanguage.values()].reduce((sum, bytes) => sum + bytes, 0)
  if (total <= 0) return []
  return [...bytesByLanguage]
    .map(([name, bytes]): [string, number] => [name, Math.round((bytes / total) * 1000) / 10])
    .filter(([, percent]) => percent >= 0.1)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, top)
}

/** Data and prose (biomes.ts' rule): left out of a repo's languages, as GitHub's linguist does. */
const DATA = new Set(["Other", "JSON", "YAML", "Image", "glTF", "Markdown"])
const isCode = (name: string): boolean => !DATA.has(name) && !name.startsWith(".")

/** A tree's bytes per code language (every language, when it holds no code at all). */
export function treeLanguages(entries: readonly RepoEntry[]): Map<string, number> {
  const all = new Map<string, number>()
  for (const entry of entries)
    if (entry.type === "blob") {
      const name = languageOf(entry.path).name
      all.set(name, (all.get(name) ?? 0) + (entry.size ?? 0))
    }
  const code = new Map([...all].filter(([name]) => isCode(name)))
  return code.size > 0 ? code : all
}
