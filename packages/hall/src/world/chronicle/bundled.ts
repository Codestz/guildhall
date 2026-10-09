import { type Chronicle, readChronicle } from "./format.ts"

/**
 * The deep chronicles shipped with the hall (scripts/chronicle.ts writes them): public/chronicles/
 * owner__name.json.gz, fetched only when an island asks. A repo without one answers undefined (a 404,
 * or a dev server's HTML fallback, are both "none").
 */

/** Names the hall asks for that GitHub now spells otherwise (the chronicle is filed under the new one). */
const ALIASES: Record<string, string> = {
  sample: "codestz/guildhall",
  "facebook/react": "react/react",
}

/** The asset's file name for `repo` ("owner/name", or "sample" for this repo). */
export function chronicleFile(repo: string): string {
  const name = repo.toLowerCase()
  return `${(ALIASES[name] ?? name).replace("/", "__")}.json.gz`
}

export async function bundledChronicle(
  repo: string,
  fetcher: typeof fetch = fetch,
  base = import.meta.env.BASE_URL ?? "/",
): Promise<Chronicle | undefined> {
  try {
    const response = await fetcher(`${base}chronicles/${chronicleFile(repo)}`)
    if (!response.ok) return undefined
    return await readChronicle(new Uint8Array(await response.arrayBuffer()))
  } catch {
    return undefined
  }
}
