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
 * object and as v2's ordered `permissions` rules, after a deny-all: reading and searching (read,
 * glob, grep, list) are always allowed and so not listed; every other tool, MCP tools included, is
 * denied unless named here (docs/harness.md, "What every role gets").
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
 * Commands that check work without changing it: test runners, linters, typecheckers across the
 * usual stacks, and read-only git. The verifier may run these and nothing else; the builders run
 * them without asking.
 *
 * Each is an **exact** command line. OpenCode matches a whole command's text, redirects included,
 * and its `*` is `.*`: it crosses spaces, so `git diff*` also allows `git difftool -x …`,
 * `git diff --output=~/.zshrc` and `git diff > src/index.ts` (docs/harness.md, "The shell rules").
 * No wildcard here can be made safe, so there is none: arguments, flags and other forms ask the
 * builders and are denied to the verifier. `bunx` and `npx` are left out on purpose (they fetch and
 * run any package); the project's own scripts (`bun run lint`) run what package.json says.
 */
export const CHECKS: readonly string[] = [
  "bun test",
  "bun run test",
  "bun run lint",
  "bun run check",
  "bun run typecheck",
  "npm test",
  "npm run test",
  "npm run lint",
  "npm run typecheck",
  "pnpm test",
  "pnpm run test",
  "pnpm lint",
  "pnpm run lint",
  "yarn test",
  "yarn lint",
  "pytest",
  "ruff check",
  "ruff check .",
  "mypy",
  "mypy .",
  "cargo test",
  "cargo clippy",
  "go test ./...",
  "go vet ./...",
  "make test",
  "make lint",
  "make check",
  "git status",
  "git status --short",
  "git status --porcelain",
  "git diff",
  "git diff --stat",
  "git diff --cached",
  "git diff --cached --stat",
  "git diff --staged",
  "git diff HEAD",
  "git log --oneline",
  "git log --oneline -20",
  "git show",
  "git show --stat",
]

/**
 * `"*"` answered `fallback`, then every check allowed, as written and with stderr folded into
 * stdout (`2>&1` only duplicates a stream; it opens no file).
 */
export function checksAnd(fallback: Access): Readonly<Record<string, Access>> {
  return Object.fromEntries([
    ["*", fallback],
    ...CHECKS.flatMap((command) => [
      [command, "allow"],
      [`${command} 2>&1`, "allow"],
    ]),
  ])
}

/** Reads and reports; changes nothing, runs nothing, launches no one. */
export const READ_ONLY: Permissions = { edit: "deny", bash: "deny", web: "deny", dispatch: [] }

/**
 * Paths no guild role may write, whatever else it may: what OpenCode (or another agent harness)
 * loads as agents, commands, skills, plugins, instructions or config, and git's config and hooks,
 * which run code on the next git command. Writing one would change what the guild itself may do.
 *
 * A file path reaches the matcher relative to the session's directory (`../../AGENTS.md` from a
 * subfolder) or absolute outside it, and `*` crosses `/`: each is listed bare and with a leading
 * `*` and `/`, which also catches nested copies.
 * Agent and command folders are denied for Markdown only (OpenCode loads `*.md` there; code in a
 * `commands/` folder is ordinary code); skill folders entirely, scripts included.
 */
export const PROTECTED: readonly string[] = [
  ".opencode/*",
  "opencode.json*",
  "AGENTS.md",
  "CLAUDE.md",
  ".claude/*",
  ".agents/*",
  ".config/opencode/*",
  "agent/*.md",
  "agents/*.md",
  "command/*.md",
  "commands/*.md",
  "skill/*",
  "skills/*",
  ".git/*",
].flatMap((path) => [path, `*/${path}`])

/** `"*"` answered `fallback`, then each `allow` pattern, then every protected path denied. */
function writes(fallback: Access, allow: readonly string[]): Readonly<Record<string, Access>> {
  return Object.fromEntries([
    ["*", fallback],
    ...allow.map((path) => [path, "allow"]),
    ...PROTECTED.map((path) => [path, "deny"]),
  ])
}

/** May change any file but the protected ones: the builders. */
export const CODE: Readonly<Record<string, Access>> = writes("allow", [])

/**
 * May write Markdown under a `docs/` folder (specs, plans, ADRs), and no other file. Not `*.md`
 * anywhere: README, AGENTS.md and agent definitions are Markdown too, and any of them can steer
 * every later session.
 */
export const DOCS_ONLY: Readonly<Record<string, Access>> = writes("deny", ["docs/*.md", "*/docs/*.md"])
