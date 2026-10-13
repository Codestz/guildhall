/**
 * "Your repo as an island": what the welcome card's field accepts. `owner/repo`, or a GitHub address
 * pasted from the browser or a clone line (`https://github.com/o/r`, `.../r.git`, `.../r/tree/main/src`,
 * `github.com/o/r`, `git@github.com:o/r.git`). Pure, so the rules are tested without a DOM.
 */

export type RepoParse =
  | { ok: true; owner: string; repo: string; slug: string }
  | { ok: false; reason: string }

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/
const REPO = /^[A-Za-z0-9._-]{1,100}$/

export function parseRepo(input: string): RepoParse {
  let text = input.trim()
  if (text === "") return { ok: false, reason: "Type owner/repo, or paste a GitHub address." }
  text = text.replace(/^git@github\.com:/i, "").replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, "")
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text))
    return { ok: false, reason: "Only github.com repositories can grow here." }
  text = text.split(/[?#]/)[0] ?? ""
  const parts = text.split("/").filter((p) => p !== "")
  const [owner, rawRepo] = parts
  if (!owner || !rawRepo) return { ok: false, reason: "A repository is owner/repo, like facebook/react." }
  const repo = rawRepo.replace(/\.git$/i, "")
  if (!OWNER.test(owner)) return { ok: false, reason: `“${owner}” is not a GitHub owner name.` }
  if (!REPO.test(repo) || repo === "." || repo === "..")
    return { ok: false, reason: `“${rawRepo}” is not a repository name.` }
  return { ok: true, owner, repo, slug: `${owner}/${repo}` }
}

/** The welcome card's remembered dismissal (the caller owns persistence; this is the default). */
export const WELCOME_KEY = "guildhall.welcome.dismissed"

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage
  } catch {
    return undefined
  }
}

export function readWelcomeDismissed(storage: Pick<Storage, "getItem"> | undefined = safeStorage()): boolean {
  try {
    return storage?.getItem(WELCOME_KEY) === "1"
  } catch {
    return false
  }
}

export function writeWelcomeDismissed(storage: Pick<Storage, "setItem"> | undefined = safeStorage()): void {
  try {
    storage?.setItem(WELCOME_KEY, "1")
  } catch {
    // private window or blocked storage: the card simply shows again next visit
  }
}
