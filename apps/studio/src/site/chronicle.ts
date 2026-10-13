/**
 * The seam between the site and the chronicles backend (packages/sim/src/repo/catalog.ts): a repo's
 * chronicle as the hall asks for it, and the live catalog as extra demo cards. Nothing here reads the
 * chronicle's contents yet; the hall note says whether there is one, how fresh, and how to ask for one.
 */
import { type Catalog, chronicleFor, loadCatalog, requestChronicleUrl } from "@guildhall/sim"
import type { Story } from "@guildhall/ui"
import { useCallback, useEffect, useState } from "react"

export type Chronicled =
  | { status: "loading" }
  | { status: "ok"; generatedAt: string; source: "cdn" | "local"; commits?: number }
  | { status: "not-chronicled"; request: string }
  | { status: "unavailable"; reason: string }

/** The one call the hall makes: a repo's chronicle, as a state to draw. Never rejects. */
export async function chronicleOf(owner: string, repo: string): Promise<Chronicled> {
  const found = await chronicleFor(owner, repo)
  if (found.status === "ok")
    return { status: "ok", generatedAt: found.chronicle.generatedAt, source: found.source }
  if (found.status === "not-chronicled")
    return { status: "not-chronicled", request: requestChronicleUrl(owner, repo) }
  return { status: "unavailable", reason: found.reason }
}

/** The chronicle of `slug` (`owner/repo`), loaded when the hall opens; `retry` asks again. */
export function useChronicle(slug: string): { state: Chronicled; retry(): void } {
  const [state, setState] = useState<Chronicled>({ status: "loading" })
  const [attempt, setAttempt] = useState(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is the retry trigger
  useEffect(() => {
    let live = true
    const [owner = "", repo = ""] = slug.split("/")
    setState({ status: "loading" })
    void chronicleOf(owner, repo).then((s) => live && setState(s))
    return () => {
      live = false
    }
  }, [slug, attempt])
  return { state, retry: useCallback(() => setAttempt((n) => n + 1), []) }
}

/** The live catalog's repos as demo cards on their own shelf (none while it cannot be read). */
export function useLiveStories(): readonly Story[] {
  const [stories, setStories] = useState<readonly Story[]>([])
  useEffect(() => {
    let live = true
    void loadCatalog().then((r) => live && r.status === "ok" && setStories(liveStories(r.catalog)))
    return () => {
      live = false
    }
  }, [])
  return stories
}

const ART = "/site/demos/island.webp"

/** One card per repo the backend has read. */
export function liveStories(catalog: Catalog): Story[] {
  return catalog.repos.map((r) => ({
    id: `live-${r.repo}`,
    shelf: "Live chronicles",
    title: r.repo,
    kicker: `${r.years[0]} – ${r.years[1]} · ${r.files.toLocaleString("en-US")} files`,
    blurb: r.description ?? `${r.repo}, read from its public history.`,
    shows: r.languages.slice(0, 3),
    art: ART,
    alt: `${r.repo} as an island.`,
    link: `/hall/${r.repo}`,
  }))
}
