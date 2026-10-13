/**
 * The chronicles backend, read: the public repo Codestz/guildhall-chronicles (served by jsDelivr)
 * holds `index.json`, the catalog of every repo it has read, and `chronicles/<owner>__<name>.json.gz`.
 * V1's fetch logic (hall/world/chronicle/catalog.ts), ported without the DOM: `fetch` and the base
 * URLs are injected, nothing is cached here, and nothing rejects: every answer is a typed result.
 */

import { type Chronicle, readChronicle } from "./chronicle.ts"

/** The public repo that builds and stores deep chronicles. */
export const CHRONICLES_REPO = "Codestz/guildhall-chronicles"
/** jsDelivr's mirror of that repo's main branch. */
export const CHRONICLES_CDN = `https://cdn.jsdelivr.net/gh/${CHRONICLES_REPO}@main/`
/** Where the studio ships its own copies (apps/studio/public/lab/repo). */
export const LOCAL_CHRONICLES = "/lab/repo/"
export const CATALOG_VERSION = 1

export interface CatalogEntry {
  /** "owner/name", as GitHub spells it now. */
  repo: string
  description?: string
  stars?: number
  languages: string[]
  /** First and last year of its history. */
  years: [number, number]
  files: number
  bytes: number
  /** "YYYY-MM-DD" the chronicle was built. */
  built: string
}

export interface Catalog {
  v: typeof CATALOG_VERSION
  /** "YYYY-MM-DD" it was written. */
  updated: string
  /** Most stars first. */
  repos: CatalogEntry[]
}

export interface FetchOptions {
  /** Injectable for tests and workers. */
  fetch?: typeof fetch
  /** The CDN root, with a trailing slash. */
  baseUrl?: string
  /** Where local copies live, with a trailing slash. */
  localBase?: string
  /** Per request; 0 for none. */
  timeoutMs?: number
}

export type CatalogResult =
  | { status: "ok"; catalog: Catalog; source: "cdn" }
  | { status: "unavailable"; reason: string }

export type ChronicleResult =
  | {
      status: "ok"
      chronicle: Chronicle
      /** The CDN's copy, or the studio's own when the CDN could not answer (or has none). */
      source: "cdn" | "local"
      /** When it was built (ISO), for showing freshness. */
      generatedAt: string
    }
  | { status: "not-chronicled"; repo: string }
  | { status: "unavailable"; repo: string; reason: string }

/** Names GitHub now spells otherwise: the chronicle is filed under the new one. */
const ALIASES: Record<string, string> = { "facebook/react": "react/react" }
/** Files the studio ships (apps/studio/public/lab/repo), by chronicle stem. */
const LOCAL: Record<string, string> = { react__react: "react", codestz__guildhall: "guildhall" }

const REPO = /^[\w.-]+\/[\w.-]+$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const count = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0

/** The file stem ("owner__name", lowercase) a chronicle is filed under; undefined for a malformed name. */
export function chronicleStem(owner: string, repo: string): string | undefined {
  const name = `${owner}/${repo}`.toLowerCase()
  if (!REPO.test(name) || owner.includes("/") || repo.includes("/")) return undefined
  return (ALIASES[name] ?? name).replace("/", "__")
}

/** The catalog, read from the CDN. Never rejects. */
export async function loadCatalog(opts: FetchOptions = {}): Promise<CatalogResult> {
  const base = opts.baseUrl ?? CHRONICLES_CDN
  const got = await get(`${base}index.json`, opts)
  if (got.kind === "missing") return { status: "unavailable", reason: "HTTP 404" }
  if (got.kind === "failed") return { status: "unavailable", reason: got.reason }
  try {
    const parsed = parseCatalog(JSON.parse(new TextDecoder().decode(got.bytes)))
    if (typeof parsed === "string") return { status: "unavailable", reason: parsed }
    return { status: "ok", catalog: parsed, source: "cdn" }
  } catch {
    return { status: "unavailable", reason: "index.json is not JSON" }
  }
}

/**
 * A repo's chronicle. The CDN first; when it cannot answer (offline, a server error, a broken file)
 * or has none, the studio's own copy when there is one; else "not-chronicled" (the CDN said 404) or
 * "unavailable" (it could not say).
 */
export async function chronicleFor(
  owner: string,
  repo: string,
  opts: FetchOptions = {},
): Promise<ChronicleResult> {
  const name = `${owner}/${repo}`
  const stem = chronicleStem(owner, repo)
  if (!stem) return { status: "not-chronicled", repo: name }
  const base = opts.baseUrl ?? CHRONICLES_CDN
  const got = await get(`${base}chronicles/${stem}.json.gz`, opts)
  let reason = "unreadable chronicle"
  let missing = got.kind === "missing"
  if (got.kind === "ok") {
    try {
      return done(await readChronicle(got.bytes), "cdn")
    } catch (error) {
      reason = error instanceof Error ? error.message : reason
    }
  } else if (got.kind === "failed") reason = got.reason
  const local = LOCAL[stem]
  if (local) {
    const copy = await get(`${opts.localBase ?? LOCAL_CHRONICLES}${local}.json.gz`, opts)
    if (copy.kind === "ok") {
      try {
        return done(await readChronicle(copy.bytes), "local")
      } catch {
        missing = false
      }
    }
  }
  return missing ? { status: "not-chronicled", repo: name } : { status: "unavailable", repo: name, reason }
}

function done(chronicle: Chronicle, source: "cdn" | "local"): ChronicleResult {
  return { status: "ok", chronicle, source, generatedAt: chronicle.generatedAt }
}

/** The link to ask for a repo's chronicle: the chronicles repo's issue form, with the repo prefilled. */
export function requestChronicleUrl(owner: string, repo: string): string {
  const query = new URLSearchParams({
    template: "chronicle.yml",
    title: `Chronicle: ${owner}/${repo}`,
    repo: `${owner}/${repo}`,
  })
  return `https://github.com/${CHRONICLES_REPO}/issues/new?${query}`
}

/**
 * A catalog from JSON (it comes off a CDN: trusted for nothing). A reason string when it isn't one
 * (including an unknown `v`); a malformed entry is dropped, the rest kept.
 */
export function parseCatalog(value: unknown): Catalog | string {
  const c = value as Partial<Catalog> | null
  if (!c || typeof c !== "object") return "index.json is not a catalog"
  if (c.v !== CATALOG_VERSION) return `unsupported catalog version ${String(c.v)}`
  if (!Array.isArray(c.repos)) return "index.json has no repos"
  const repos = c.repos.flatMap((entry) => {
    const ok = entryOf(entry)
    return ok ? [ok] : []
  })
  return { v: CATALOG_VERSION, updated: typeof c.updated === "string" ? c.updated : "", repos }
}

function entryOf(value: unknown): CatalogEntry | undefined {
  const e = value as Partial<CatalogEntry> | null
  if (!e || typeof e !== "object") return undefined
  if (typeof e.repo !== "string" || !REPO.test(e.repo)) return undefined
  if (!count(e.files) || !count(e.bytes) || typeof e.built !== "string" || !DATE.test(e.built))
    return undefined
  if (!Array.isArray(e.years) || e.years.length !== 2 || !e.years.every(count)) return undefined
  return {
    repo: e.repo,
    ...(typeof e.description === "string" && e.description ? { description: e.description } : {}),
    ...(count(e.stars) ? { stars: e.stars } : {}),
    languages: Array.isArray(e.languages)
      ? e.languages.filter((n): n is string => typeof n === "string")
      : [],
    years: [e.years[0] as number, e.years[1] as number],
    files: e.files,
    bytes: e.bytes,
    built: e.built,
  }
}

type Got = { kind: "ok"; bytes: Uint8Array } | { kind: "missing" } | { kind: "failed"; reason: string }

async function get(url: string, opts: FetchOptions): Promise<Got> {
  const timeout = opts.timeoutMs ?? 10_000
  try {
    const response = await (opts.fetch ?? fetch)(
      url,
      timeout > 0 ? { signal: AbortSignal.timeout(timeout) } : {},
    )
    if (response.status === 404) return { kind: "missing" }
    if (!response.ok) return { kind: "failed", reason: `HTTP ${response.status}` }
    return { kind: "ok", bytes: new Uint8Array(await response.arrayBuffer()) }
  } catch (error) {
    return { kind: "failed", reason: error instanceof Error ? error.message : "network error" }
  }
}
