/**
 * A sketch hall says so: a repo with no chronicle (or one that could not be read) gets an island grown
 * from its name alone, and the HUD's notice (SketchNotice.tsx) tells the visitor, with the one thing to
 * do about it: ask the chronicles repo to read its history (its issue form, prefilled), or try again.
 * Asked already, a public search finds the open request and the notice says it is on its way.
 * Pure but for the dismissal, kept per repo in the browser (blocked storage: shown each visit).
 */
import { type ChronicleResult, type RequestResult, requestChronicleUrl } from "@guildhall/sim"

/** Why the island is a sketch, and the way to the real one. Null for a chronicled hall. */
export type SketchNotice =
  | { kind: "not-chronicled"; slug: string; request: string }
  | { kind: "unavailable"; slug: string }

/** The notice a hall shows for its chronicle's answer: none when there is a chronicle. */
export function sketchNoticeOf(found: Pick<ChronicleResult, "status">, slug: string): SketchNotice | null {
  if (found.status === "ok") return null
  if (found.status === "unavailable") return { kind: "unavailable", slug }
  const [owner = "", repo = ""] = slug.split("/")
  return { kind: "not-chronicled", slug, request: requestChronicleUrl(owner, repo) }
}

/** What the notice says and does. */
export interface NoticeWords {
  title: string
  body: string
  /** The primary action: a link (the issue form, the open request: a new tab), or a retry. */
  action: { label: string; href: string } | { label: string; retry: true }
  /** The line under the action. */
  foot?: string
}

/** The one line on the link the visitor already has. */
export const SAME_LINK = "Once it's built, the real island appears at this same link."

/** The notice's words: a sketch, a sketch being chronicled (`pending`: an open request), or a read that failed. */
export function noticeWords(notice: SketchNotice, pending: RequestResult | null = null): NoticeWords {
  if (notice.kind === "unavailable")
    return {
      title: "A sketch island",
      body: `${notice.slug}'s chronicle could not be read just now, so this island is drawn from its name alone.`,
      action: { label: "Try again", retry: true },
    }
  if (pending?.status === "open")
    return {
      title: "Being chronicled",
      body: `A request to read ${notice.slug}'s history is open${pending.queued ? ", waiting its turn" : ""}. Check back soon: this is a sketch until then.`,
      action: { label: "See the request", href: pending.url },
      foot: SAME_LINK,
    }
  return {
    title: "A sketch island",
    body: `Drawn from the name alone, not yet grown from ${notice.slug}'s history.`,
    action: { label: "Chronicle this repo", href: notice.request },
    foot: SAME_LINK,
  }
}

/**
 * Who a session's Chronicle card names (under its title, and in its file name): the repo, or on a sketch
 * the repo's sketch island, so a card shared from a sketch hall never passes for the repo's own record.
 * (A sketch hall without a session offers no card at all: there is no history to draw.)
 */
export function cardGuild(slug: string, sketch: boolean): string {
  return sketch ? `${slug}, a sketch island` : slug
}

/** Where the dismissed notices are kept: the repos, lowercase, the newest last. */
const DISMISSED_KEY = "gh.hall.sketch-dismissed"
/** The most repos remembered. */
const DISMISSED_MAX = 50

function readDismissed(): string[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]")
    return Array.isArray(list) ? list.filter((s): s is string => typeof s === "string") : []
  } catch {
    return []
  }
}

/** True when the visitor folded this repo's notice away before. */
export function wasDismissed(slug: string): boolean {
  return readDismissed().includes(slug.toLowerCase())
}

/** Remembers the notice folded away for this repo (a failed read's is not kept: it may read next time). */
export function dismiss(slug: string): void {
  const key = slug.toLowerCase()
  const list = [...readDismissed().filter((s) => s !== key), key].slice(-DISMISSED_MAX)
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(list))
  } catch {}
}
