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
  return commandGist(input.command).craft
}

/** What a shell command is, in the world's words: its craft, and what it is about in a word or two. */
export interface CommandGist {
  craft: Craft
  /** A file's name, a plain search term, `git status`, `bun install`: never a raw command line. */
  target?: string
}

/** Programs that look through the code, that read a file, and that only wrap another. */
const SEARCHERS = new Set(["grep", "egrep", "fgrep", "rg", "ag", "ack", "find", "fd", "ls", "tree", "locate"])
const READERS = new Set([
  "cat",
  "head",
  "tail",
  "less",
  "more",
  "bat",
  "wc",
  "sed",
  "awk",
  "nl",
  "jq",
  "diff",
])
const WRAPPERS = new Set(["sudo", "time", "env", "nice", "nohup", "command", "exec", "xargs"])
/** Steps of a command line that only set the scene (`cd x &&`, `export A=b;`). */
const SCENE = new Set([
  "cd",
  "pushd",
  "popd",
  "export",
  "source",
  ".",
  "set",
  "unset",
  "true",
  "echo",
  "sleep",
])
/** Housekeeping before the real step (`mkdir -p out && …`). */
const CHORES = new Set(["rm", "mkdir", "cp", "mv", "touch", "chmod", "ln", "clear"])
/** Flags of a search whose next word is a value, not the pattern (`-A 3`, `--include '*.ts'`). */
const VALUED = /^-(?:[ABCmgt]|-(?:include|exclude|glob|type|max-count|context|after-context|before-context))$/

/** A command line's words, quotes taken off (a rough shell reading: enough to tell what it is). */
function words(segment: string): string[] {
  const out: string[] = []
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g
  for (let m = re.exec(segment); m; m = re.exec(segment)) out.push(m[1] ?? m[2] ?? m[3] ?? "")
  return out
}

/**
 * A search pattern as a plain term (`yardThemes\|yards\.set` → `yardThemes`), or undefined when it is
 * all regex: the first alternative, escapes and anchors taken off, kept only if words remain.
 */
export function plainPattern(pattern: string): string | undefined {
  const first = pattern.split(/\\\||\|/)[0] ?? ""
  const bare = first
    .replace(/\\[bBwWsSdD<>]/g, "")
    .replace(/\\(.)/g, "$1")
    .replace(/^[\^("'`[*]+/, "")
  // the plain run it starts with: `fetch(` → `fetch`, `api.put(` → `api.put`
  const plain = (/^[\w./ -]+/.exec(bare)?.[0] ?? "").replace(/\s+/g, " ").trim()
  return /^[\w./ -]{1,40}$/.test(plain) && /[a-z]/i.test(plain) ? plain : undefined
}

const baseName = (path: string) => path.split("/").filter(Boolean).at(-1) ?? path

/**
 * A shell command read as a deed (PROTOCOL.md §1.2): `grep -rn "a\|b" src` searches the code for `a`,
 * `sed -n 1,40p life.ts` reads `life.ts`, `sed -i` edits, `bun test` tests, `tsc` lints, `git status`
 * runs `git status`. The step that matters is the first that is not scene-setting (`cd x && …`), and
 * of a pipe its first command. Pure, cheap, total.
 */
export function commandGist(command: string): CommandGist {
  const steps = command.split(/&&|\|\||;|\n/)
  for (const [n, step] of steps.entries()) {
    const all = words(step.split(/\|/)[0] ?? "")
    let k = 0
    while (k < all.length && (/^\w+=/.test(all[k] ?? "") || WRAPPERS.has(all[k] ?? ""))) k++
    // `timeout 30 grep …`
    if (all[k] === "timeout") k += 2
    const program = baseName(all[k] ?? "")
    if (!program || SCENE.has(program)) continue
    // `rm -rf .data && bun run seed` is a seed: a chore says what it is only when nothing follows it
    if (CHORES.has(program) && steps.slice(n + 1).some((s) => s.trim())) continue
    const args = all.slice(k + 1)
    const loose = args.filter((a, i) => !a.startsWith("-") && !VALUED.test(args[i - 1] ?? ""))
    if (program === "git" && args[0] === "grep") return gist("search", plainOf(args.slice(1)))
    if (SEARCHERS.has(program)) {
      if (program === "find" || program === "fd") {
        const at = args.findIndex((a) => a === "-name" || a === "-iname")
        const named = at >= 0 ? args[at + 1] : program === "fd" ? loose[0] : undefined
        return gist("search", named ? plainPattern(named) : undefined)
      }
      if (program === "ls" || program === "tree") return gist("search", loose[0] && baseName(loose[0]))
      return gist("search", plainOf(args))
    }
    if (READERS.has(program)) {
      if (program === "sed" && args.some((a) => a === "-i" || a.startsWith("-i"))) {
        const file = loose.filter((a) => /[./]/.test(a)).at(-1)
        return gist("edit", file && baseName(file))
      }
      const file = loose.filter((a) => /\.\w|\//.test(a) && !/^\d+(,\d+)?p$/.test(a)).at(-1)
      return gist("read", file && baseName(file))
    }
    if (TESTS.test(command)) return { craft: "test" }
    // the program and the plain words after it: `git status`, `bun install`, `bun run typecheck`
    const plain = [program]
    for (const a of args) {
      if (plain.length >= 3 || !/^[a-z][\w:.-]*$/.test(a)) break
      plain.push(a)
    }
    return gist(LINTS.test(command) ? "lint" : "run", plain.join(" "))
  }
  if (TESTS.test(command)) return { craft: "test" }
  return LINTS.test(command) ? { craft: "lint" } : { craft: "run" }
}

/** A search's pattern among its arguments: the first that is not a flag or a flag's value. */
function plainOf(args: readonly string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string
    if (a === "-e" || a === "--regexp") return plainPattern(args[i + 1] ?? "")
    if (a.startsWith("-") || VALUED.test(args[i - 1] ?? "")) continue
    return plainPattern(a)
  }
  return undefined
}

const gist = (craft: Craft, target: string | undefined): CommandGist =>
  target ? { craft, target } : { craft }

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
  if (!isCraft(deed.craft)) return craftOf(deed.name, deed.input)
  // a shell call an older adapter declared a plain run: its command says more (a grep searches)
  if (deed.craft === "run" && typeof deed.input?.command === "string")
    return commandGist(deed.input.command).craft
  return deed.craft
}
