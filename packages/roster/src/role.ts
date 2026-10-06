/**
 * What a role is (CONTEXT.md: Role). One record drives both sides: the herald injects it into
 * OpenCode as an agent (ADR 0002), the hall uses it to pick a character, a station and a site.
 * Each role lives in its own module under `roles/`, prompt included.
 */

/** OpenCode's three answers to a permission request. */
export type Access = "allow" | "ask" | "deny"

/**
 * One answer for everything, or ordered `pattern → answer` rules. The last matching rule wins
 * (OpenCode's rule on both versions, docs/opencode/permissions.md), so put `"*"` first.
 */
export type Rules = Access | Readonly<Record<string, Access>>

/**
 * A role's permissions in OpenCode-neutral words. The herald writes them as v1's `permission`
 * object and as v2's ordered `permissions` rules. Reading (read, glob, grep, list) is always
 * allowed and so not listed.
 */
export interface Permissions {
  /** Changing files (edit, write, patch). Patterns match the file's path. */
  edit: Rules
  /** Shell commands (v1 `bash`, v2 `shell`). Patterns match the command line. */
  bash: Rules
  /** `webfetch` and `websearch`. */
  web: Access
  /** The subagents this role may launch (v1 `task`, v2 `subagent`). Every other one is denied. */
  dispatch: readonly `guild-${string}`[]
}

/**
 * Which model a role wants, as a weight class. By default every role inherits the model the user
 * runs (OpenCode's own fallback); the user maps classes to models in the plugin options (docs/harness.md).
 */
export type Tier = "strong" | "standard" | "fast"

export interface Role {
  /** OpenCode agent id. Prefixed so it never collides with a user's agents (docs/opencode/shipping-agents.md). */
  id: `guild-${string}`
  title: string
  /**
   * What OpenCode shows, and the model reads when choosing a subagent. Short: subagent
   * descriptions are sent with every request that offers delegation (ADR 0002).
   */
  description: string
  mode: "primary" | "subagent"
  /** The system prompt. */
  prompt: string
  permissions: Permissions
  tier: Tier
  /** Hex color, shared by the OpenCode TUI and the hall. */
  color: string
  station:
    | "quest-board"
    | "drafting-table"
    | "forge"
    | "inspection-bench"
    | "library"
    | "map-table"
    | "easel"
    | "scroll-desk"
    | "overflow"
  /** Character model key in the hall's asset manifest. */
  character: string
  /**
   * The island job site the role works out at (ADR 0006); none for the keep's roles. The hall's
   * site registry (`packages/hall/src/world/sites.ts`) says what each site looks like and does.
   */
  site?: "yard" | "forest" | "river" | "proving" | "quarry" | "tower"
}

/**
 * Commands that check work without changing it: test runners, linters, typecheckers, across the
 * usual stacks. The verifier may run these and nothing else; the builders run them without asking.
 */
export const CHECKS: readonly string[] = [
  "bun test*",
  "bun run test*",
  "bun run lint*",
  "bun run check*",
  "bun run typecheck*",
  "bunx tsc*",
  "bunx biome*",
  "npm test*",
  "npm run test*",
  "npm run lint*",
  "npm run typecheck*",
  "npx tsc*",
  "npx eslint*",
  "npx vitest*",
  "pnpm test*",
  "pnpm run test*",
  "pnpm lint*",
  "pnpm run lint*",
  "yarn test*",
  "yarn lint*",
  "pytest*",
  "ruff check*",
  "mypy*",
  "cargo test*",
  "cargo clippy*",
  "go test*",
  "go vet*",
  "make test*",
  "make lint*",
  "make check*",
  "git status*",
  "git diff*",
  "git log*",
  "git show*",
]

/** `"*"` answered `fallback`, then every check allowed. */
export function checksAnd(fallback: Access): Readonly<Record<string, Access>> {
  return Object.fromEntries([["*", fallback], ...CHECKS.map((command) => [command, "allow"])])
}

/** Reads and reports; changes nothing, runs nothing, launches no one. */
export const READ_ONLY: Permissions = { edit: "deny", bash: "deny", web: "deny", dispatch: [] }

/** May write Markdown documents (specs, plans, ADRs), and no other file. */
export const DOCS_ONLY: Readonly<Record<string, Access>> = { "*": "deny", "*.md": "allow" }
