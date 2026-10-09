import { useEffect, useState } from "react"
import { type Catalog, inCatalog, loadCatalog } from "../world/chronicle/catalog.ts"

/**
 * The chronicles catalog (world/chronicle/catalog.ts) for the HUD: fetched once a page, and only
 * when a HUD part asks (the door, the repo legend), so a visit that opens neither costs nothing.
 */

let asked: Promise<Catalog | undefined> | undefined

/**
 * Whether `repo`'s island has a deep chronicle: true or false once the catalog has answered,
 * undefined while it hasn't (or couldn't), so a "Deepen" offer never flashes on a deep island.
 */
export function useDeepChronicle(repo: string | undefined): boolean | undefined {
  const [known, setKnown] = useState<{ repo: string; deep: boolean | undefined }>()
  useEffect(() => {
    if (!repo) return
    let live = true
    asked ??= loadCatalog().then((found) => found?.catalog)
    void asked.then((catalog) => {
      if (live) setKnown({ repo, deep: catalog ? inCatalog(catalog, repo) : undefined })
    })
    return () => {
      live = false
    }
  }, [repo])
  return repo && known?.repo === repo ? known.deep : undefined
}
