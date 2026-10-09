import type { PrStatus, SeaEvent } from "@guildhall/core"

/**
 * The repo's open work around the sim's sea (packages/sim/src/seas.ts): what GitHub would show of
 * pull requests and issues other people opened. The hub announces a repo's open work when it begins
 * to watch (PROTOCOL.md §7), so the story opens with it: the pull requests sail in to the anchorage
 * over the first seconds and the issues come down the road to the quay. One of each ends mid-story
 * (a pull request closed unmerged, an issue closed), so the sea shows leavers too.
 *
 * Times are ms from the story's start, fixed (the same story whatever the seed).
 */

const REPO = "acme/shop"

interface Pull {
  number: number
  title: string
  author: string
  status: PrStatus
  /** Lines changed. */
  size: number
  /** ms from the start it is seen at anchor. */
  at: number
  /** ms it is closed without merging, if it is. */
  closed?: number
}

const PULLS: readonly Pull[] = [
  { number: 119, title: "Refactor cart totals", author: "ines", status: "review", size: 420, at: 600 },
  { number: 122, title: "Fix flaky checkout test", author: "bo", status: "ready", size: 38, at: 1900 },
  { number: 124, title: "WIP: i18n pipeline", author: "kenji", status: "draft", size: 3100, at: 3100 },
  { number: 126, title: "Docs: deployment guide", author: "ines", status: "open", size: 150, at: 4400 },
  {
    number: 127,
    title: "Try the new bundler",
    author: "bo",
    status: "draft",
    size: 9800,
    at: 5600,
    closed: 90_000,
  },
]

interface Issue {
  number: number
  title: string
  author: string
  labels?: string[]
  at: number
  closed?: number
}

const ISSUES: readonly Issue[] = [
  { number: 131, title: "Settings page flickers on Safari", author: "lou", labels: ["bug"], at: 1200 },
  { number: 133, title: "Export orders as CSV", author: "ines", labels: ["enhancement"], at: 1700 },
  { number: 134, title: "Typo in the checkout copy", author: "bo", at: 2300, closed: 70_000 },
  {
    number: 135,
    title: "Cart total is off by one cent",
    author: "kenji",
    labels: ["bug", "priority"],
    at: 2900,
  },
  { number: 136, title: "Support Apple Pay", author: "mira", labels: ["feature request"], at: 3400 },
  { number: 137, title: "Search ignores accents", author: "lou", labels: ["bug"], at: 3900 },
  { number: 138, title: "Dark mode for the emails", author: "ines", labels: ["enhancement"], at: 4500 },
  { number: 139, title: "Wishlist sharing link", author: "bo", labels: ["feature"], at: 5000 },
  { number: 140, title: "Order page 500s with no items", author: "kenji", labels: ["bug"], at: 5600 },
  { number: 142, title: "Document the webhook retries", author: "mira", labels: ["docs"], at: 6300 },
  { number: 143, title: "Allow gift messages", author: "lou", labels: ["enhancement"], at: 6900 },
  { number: 144, title: "Why is the build 4 minutes?", author: "bo", at: 7500 },
]

/** The pull requests and issues open when the story begins, and the two that end during it. */
export function backlog(): SeaEvent[] {
  const events: SeaEvent[] = []
  for (const pull of PULLS) {
    const base = {
      repo: REPO,
      number: pull.number,
      title: pull.title,
      author: pull.author,
      branch: `pr-${pull.number}`,
    }
    events.push({
      kind: "pr_opened",
      id: `pr_opened:${REPO}#${pull.number}`,
      at: pull.at,
      ...base,
      status: pull.status,
      size: pull.size,
    })
    if (pull.closed !== undefined)
      events.push({ kind: "pr_closed", id: `pr_closed:${REPO}#${pull.number}`, at: pull.closed, ...base })
  }
  for (const issue of ISSUES) {
    const base = {
      repo: REPO,
      number: issue.number,
      title: issue.title,
      author: issue.author,
      ...(issue.labels ? { labels: issue.labels } : {}),
    }
    events.push({ kind: "issue_opened", id: `issue_opened:${REPO}#${issue.number}`, at: issue.at, ...base })
    if (issue.closed !== undefined)
      events.push({
        kind: "issue_closed",
        id: `issue_closed:${REPO}#${issue.number}`,
        at: issue.closed,
        ...base,
      })
  }
  return events
}
