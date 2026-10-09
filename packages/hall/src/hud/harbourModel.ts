import { MAX_ISLANDS } from "../world/archipelago.ts"
import type { CatalogEntry } from "../world/chronicle/catalog.ts"
import { sailLink } from "./chronicleLinks.ts"

/**
 * The Harbour's (/harbour, hud/harbour.ts) words and voyage, pure: what a mooring's card says, and
 * which repos "Sail" takes to sea.
 */

/** 250753 → "251k", 1530 → "1.5k", 812 → "812". */
export function compact(n: number): string {
  if (n < 1000) return String(n)
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`
}

/** Bytes as "812 KB", "40.6 MB", "1.2 GB". */
export function size(bytes: number): string {
  if (bytes < 1e6) return `${Math.max(1, Math.round(bytes / 1e3))} KB`
  if (bytes < 1e9) return `${(bytes / 1e6).toFixed(1)} MB`
  return `${(bytes / 1e9).toFixed(1)} GB`
}

/** "2013–2026", or "2025" for one year. */
export function years([from, to]: readonly [number, number]): string {
  return from === to ? String(from) : `${from}–${to}`
}

/** A card's facts line: "★ 251k · 2013–2026 · 7,252 files · 40.6 MB". */
export function facts(entry: CatalogEntry): string[] {
  return [
    ...(entry.stars !== undefined ? [`★ ${compact(entry.stars)}`] : []),
    years(entry.years),
    `${entry.files.toLocaleString("en")} files`,
    size(entry.bytes),
  ]
}

export interface Voyage {
  /** The repos to sail: the chosen ones, else the first MAX_ISLANDS listed. */
  repos: string[]
  /** The archipelago link (`?repos=`). */
  href: string
  label: string
}

/** What "Sail" does: the chosen repos (in the listing's order), or with none chosen, the first few. */
export function voyageOf(listed: readonly string[], chosen: ReadonlySet<string>): Voyage {
  const picked = listed.filter((repo) => chosen.has(repo))
  const repos = (picked.length > 0 ? picked : listed).slice(0, MAX_ISLANDS)
  const label =
    picked.length > 0
      ? `Sail ${repos.length === 1 ? "this one" : `these ${repos.length}`}`
      : listed.length > MAX_ISLANDS
        ? `Sail the first ${MAX_ISLANDS}`
        : "Sail them all"
  return { repos, href: sailLink(repos), label }
}

/** Whether another repo may be chosen (an archipelago holds MAX_ISLANDS). */
export function canChoose(chosen: ReadonlySet<string>): boolean {
  return chosen.size < MAX_ISLANDS
}
