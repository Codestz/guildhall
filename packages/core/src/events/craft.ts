/**
 * What a deed *means*, whatever the host calls its tool (PROTOCOL.md §1.2, ADR 0011). One closed
 * set, defined once: the hall's surfaces (the story's words, the chip's verb, the sigil, the work
 * look, the spot sound) each keep a table keyed by it, and never read a host's tool name.
 *
 * An adapter that knows its tools sends `craft` on the `tool` change; otherwise `craftOf` reads it off
 * the name, for OpenCode 1 and 2 and Claude Code alike, and old chronicles get it the same way.
 */
export type Craft =
  /** Reads a file. */
  | "read"
  /** Looks through the code: a grep, a glob, a listing. */
  | "search"
  /** Changes a file that exists. */
  | "edit"
  /** Writes a file whole. */
  | "write"
  /** Runs a command. */
  | "run"
  /** Runs the tests: a command that names a test runner (or a `check`). */
  | "test"
  /** Lints or typechecks: a command that is a static check but not a test run. */
  | "lint"
  /** Fetches or searches the web. */
  | "fetch"
  /** Asks a tool outside the host's own: an MCP server's. */
  | "consult"
  /** Keeps the plan: a todo list, leaving plan mode. */
  | "plan"
  /** Hands work to another agent: a quest. */
  | "delegate"
  /** Anything else. */
  | "other"

export const CRAFTS: readonly Craft[] = [
  "read",
  "search",
  "edit",
  "write",
  "run",
  "test",
  "lint",
  "fetch",
  "consult",
  "plan",
  "delegate",
  "other",
]

const KNOWN: ReadonlySet<string> = new Set(CRAFTS)

export function isCraft(value: unknown): value is Craft {
  return typeof value === "string" && KNOWN.has(value)
}

/**
 * Tool names, lower case: OpenCode 1 (`bash`, `task`, `patch`…), OpenCode 2 (`shell`, `subagent`…)
 * and Claude Code's (`Bash`, `MultiEdit`, `NotebookEdit`, `Agent`…, read in lower case).
 */
const BY_NAME: Readonly<Record<string, Craft>> = {
  read: "read",
  grep: "search",
  glob: "search",
  list: "search",
  ls: "search",
  codesearch: "search",
  edit: "edit",
  patch: "edit",
  multiedit: "edit",
  apply_patch: "edit",
  notebookedit: "edit",
  write: "write",
  bash: "run",
  shell: "run",
  powershell: "run",
  bashoutput: "run",
  killshell: "run",
  webfetch: "fetch",
  websearch: "fetch",
  todowrite: "plan",
  todoread: "plan",
  exitplanmode: "plan",
  task: "delegate",
  subagent: "delegate",
  agent: "delegate",
}

/** A command that runs the tests. */
const TESTS = /\b(test|tests|vitest|jest|pytest|spec|check)\b/i
/** A command that checks without running tests: a linter or a typechecker. */
const LINTS = /\b(lint|typecheck|tsc)\b/i

/**
 * A tool call's craft, from its name and (for a shell) its command: `bun test` is a test, `bun run
 * typecheck` a lint, anything else a run. A name with `_` the host doesn't know is an MCP tool
 * (`context7_query-docs`, `mcp__memory__read_graph`): a consultation. Pure, cheap, total.
 */
export function craftOf(tool: string, input: Record<string, unknown> = {}): Craft {
  const name = tool.toLowerCase()
  const craft = BY_NAME[name] ?? (name.includes("_") ? "consult" : "other")
  if (craft !== "run" || typeof input.command !== "string") return craft
  if (TESTS.test(input.command)) return "test"
  return LINTS.test(input.command) ? "lint" : "run"
}

/**
 * The craft an adapter can declare for a call it has seen this much of: undefined for a shell call
 * whose command has not arrived yet, since that command decides between `run`, `test` and `lint`.
 */
export function declaredCraft(tool: string, input?: Record<string, unknown>): Craft | undefined {
  const craft = craftOf(tool, input)
  return craft === "run" && typeof input?.command !== "string" ? undefined : craft
}

/** A deed's craft: the one its source declared when the hall knows it, else read off its name. */
export function deedCraft(deed: { name: string; input?: Record<string, unknown>; craft?: string }): Craft {
  return isCraft(deed.craft) ? deed.craft : craftOf(deed.name, deed.input)
}
