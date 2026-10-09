/**
 * The sea: what happens to a guild's project on GitHub, beside what its adventurers do. The hub polls
 * GitHub for each project with a GitHub remote (packages/hub/src/github.ts) and reads what it finds
 * as these events; the sim tells them too (packages/sim/src/seas.ts). PROTOCOL.md §7.
 *
 * Every event has a stable `id`: the same thing seen twice (a later poll, a hub restart) has the same
 * id, so a hall can drop repeats. `at` is when it happened on GitHub, in ms since the epoch (in the
 * sim, ms from the story's start, like `Change.at`). `repo` is `owner/name`.
 */

/** Where a CI run is: waiting for a runner, running, or finished either way. */
export type CiState = "queued" | "running" | "passed" | "failed"

interface Base {
  id: string
  at: number
  repo: string
  /** The page on github.com it is about, when there is one. */
  url?: string
}

/**
 * Where an open pull request stands, as the list endpoint tells it without another request:
 * `draft`; `open` (no one asked for a review yet); `review` (reviewers are requested); `ready`
 * (auto-merge is armed: it waits only on its checks). Approved and changes-requested need each
 * PR's reviews, one request apiece, so they are not read.
 */
export type PrStatus = "draft" | "open" | "review" | "ready"

interface PullRequest extends Base {
  number: number
  title: string
  author: string
  /** The branch it would merge. */
  branch: string
  /** Where it stands (optional: older records, and a hub that did not read it, have none). */
  status?: PrStatus
  /** Lines added and removed, when the hub read the pull request's own page. */
  size?: number
}

interface Issue extends Base {
  number: number
  title: string
  author: string
  /** Label names, when it has any. */
  labels?: string[]
}

export type SeaEvent =
  /** New commits on a branch the guild works on: `commits` of them, the newest by `author`. */
  | (Base & { kind: "push"; branch: string; commits: number; author: string; sha: string })
  | (PullRequest & { kind: "pr_opened" })
  /** An open pull request's status moved to `status` (a draft marked ready, a review asked for). */
  | (PullRequest & { kind: "pr_updated"; status: PrStatus })
  | (PullRequest & { kind: "pr_merged" })
  /** Closed without merging. */
  | (PullRequest & { kind: "pr_closed" })
  /** A CI workflow run on a branch's head commit moved to `state`. `name` is the workflow's. */
  | (Base & { kind: "ci"; state: CiState; name: string; branch: string; sha: string })
  | (Base & { kind: "release"; tag: string; name?: string })
  /** An issue was opened (or was open when the hub began to watch). */
  | (Issue & { kind: "issue_opened" })
  /** It was closed, however it was resolved. */
  | (Issue & { kind: "issue_closed" })

export type SeaKind = SeaEvent["kind"]

/** A sea event as the hub sends and records it: for one guild (a repo's events go to each of its guilds). */
export interface SeaRecord {
  v: 1
  guild: string
  event: SeaEvent
}

const KINDS: readonly string[] = [
  "push",
  "pr_opened",
  "pr_updated",
  "pr_merged",
  "pr_closed",
  "ci",
  "release",
  "issue_opened",
  "issue_closed",
]

/**
 * A sea record, checked for the fields every kind has: what a hall reads off the socket or a reader
 * off a chronicle line is a trust boundary. Kind-specific fields are the reader's to check as it uses
 * them.
 */
export function isSeaRecord(value: unknown): value is SeaRecord {
  if (typeof value !== "object" || value === null) return false
  const { v, guild, event } = value as Partial<Record<keyof SeaRecord, unknown>>
  if (v !== 1 || typeof guild !== "string" || typeof event !== "object" || event === null) return false
  const { kind, id, at, repo } = event as Partial<Record<keyof Base | "kind", unknown>>
  return (
    typeof kind === "string" &&
    KINDS.includes(kind) &&
    typeof id === "string" &&
    typeof repo === "string" &&
    typeof at === "number" &&
    Number.isFinite(at)
  )
}
