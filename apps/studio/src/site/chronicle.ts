/**
 * The seam between the site and the chronicles backend (packages/sim/src/repo/catalog.ts): a repo's
 * chronicle as the hall asks for it, read once per repo and shared by the world (which builds the island
 * from it: hexworld/hall.ts) and the hall's HUD (hall/hud, which tells it), and the live catalog as
 * extra demo cards.
 */
import { type Catalog, type ChronicleResult, chronicleFor, loadCatalog } from "@guildhall/sim"
import type { Story } from "@guildhall/ui"
import { useEffect, useState } from "react"
import { type HallRepo, repoOf } from "../hexworld/hall.ts"

/** One fetch per repo while the page lives: the world and the note read the same answer. A failed read is forgotten, so a retry asks again. */
const reads = new Map<string, Promise<ChronicleResult>>()

/** A repo's chronicle, fetched once (`chronicleFor`); never rejects. */
export function hallChronicle(slug: string): Promise<ChronicleResult> {
  const key = slug.toLowerCase()
  let read = reads.get(key)
  if (!read) {
    const [owner = "", repo = ""] = slug.split("/")
    read = chronicleFor(owner, repo).then((found) => {
      if (found.status !== "ok") reads.delete(key)
      return found
    })
    reads.set(key, read)
  }
  return read
}

/** The repo as the island builds it (hexworld/hall.ts `HallRepo`): read from its chronicle, else a sketch. */
export async function hallRepo(slug: string): Promise<HallRepo> {
  const found = await hallChronicle(slug)
  if (found.status === "ok") return repoOf(found.chronicle, found.source)
  if (found.status === "not-chronicled") return { kind: "sketch", name: slug, why: "not-chronicled" }
  return { kind: "sketch", name: slug, why: "unavailable", reason: found.reason }
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

const FALLBACK_ART = "/site/demos/island.webp"
/** A repo's picture: its hall island (`bun shots repos`), named by the catalog stem. */
export const repoArt = (repo: string): string => `/site/repos/${repo.replace("/", "__").toLowerCase()}.webp`

/** One card per repo the backend has read. */
export function liveStories(catalog: Catalog): Story[] {
  return catalog.repos.map((r) => ({
    id: `live-${r.repo}`,
    shelf: "Live chronicles",
    title: r.repo,
    kicker: `${r.years[0]} – ${r.years[1]} · ${r.files.toLocaleString("en-US")} files`,
    blurb: r.description ?? `${r.repo}, read from its public history.`,
    shows: r.languages.slice(0, 3),
    chips: true,
    art: repoArt(r.repo),
    fallbackArt: FALLBACK_ART,
    alt: `${r.repo} as an island, as its hall draws it.`,
    link: `/hall/${r.repo}`,
  }))
}
