/**
 * Whether a deed failed — the one rule every view of failure reads (weather, the dragon, minions,
 * captions).
 *
 * A shell call whose command exits non-zero is not a failed *tool call* on either OpenCode: the tool
 * ran, the command answered, and the call arrives `completed` with the exit code beside it (v1:
 * `part.state.metadata.exit`; v2: `session.tool.success`'s `data.metadata.exit`, copied to `exit` by
 * the translators). So a red `bun test` looked, to anything reading `state`, like a green one.
 *
 * The rule, conservative on purpose:
 *   - a call that errored (`failed`: refused, denied, cancelled, the tool threw) failed;
 *   - a completed call that exited non-zero failed only when the command that decides its exit status
 *     is a **check** — a test runner, linter or typechecker (`isCheck`). There a non-zero exit means
 *     the work is red.
 *   - any other non-zero exit is an answer, not a failure: `grep`/`rg` 1 is "no match", `diff`/`cmp` 1
 *     "they differ", `test`/`[` 1 "false", `git diff --exit-code` 1 "there are changes". A build or
 *     script that crashed is not counted either. The HUD still shows them `exit N`.
 */

/** What `failedDeed` reads off a tool call: an `Entry` of kind `tool` has all of it. */
export interface Deed {
  state: "pending" | "running" | "completed" | "failed"
  input: Record<string, unknown>
  /** The command's exit code, for a shell call the host reported one for. */
  exit?: number
}

export function failedDeed(deed: Deed): boolean {
  if (deed.state === "failed") return true
  return (
    deed.state === "completed" &&
    deed.exit !== undefined &&
    deed.exit !== 0 &&
    typeof deed.input.command === "string" &&
    isCheck(deed.input.command)
  )
}

/** Script names that check: `test`, `lint`, `typecheck`, `test:unit`, `lint-staged` is not one. */
const SCRIPT = /^(test|tests|lint|check|typecheck|type-check|types|tsc|ci|verify)(:[\w:.-]*)?$/
/** Programs that are checks whatever their arguments. */
const PROGRAMS = new Set([
  "tsc",
  "vue-tsc",
  "svelte-check",
  "vitest",
  "jest",
  "mocha",
  "ava",
  "playwright",
  "eslint",
  "stylelint",
  "pytest",
  "py.test",
  "mypy",
  "pyright",
  "flake8",
  "pylint",
  "tox",
  "nox",
  "rspec",
  "phpunit",
  "golangci-lint",
  "shellcheck",
])
/** Programs that are checks with one of these subcommands. */
const SUBCOMMANDS: Record<string, ReadonlySet<string>> = {
  biome: new Set(["check", "lint", "ci"]),
  ruff: new Set(["check"]),
  cargo: new Set(["test", "clippy", "check", "nextest"]),
  go: new Set(["test", "vet"]),
  deno: new Set(["test", "lint", "check"]),
  dotnet: new Set(["test"]),
  mix: new Set(["test"]),
  mvn: new Set(["test", "verify"]),
  gradle: new Set(["test", "check"]),
  gradlew: new Set(["test", "check"]),
}
/** Package managers: `bun test`, `npm run lint`, `pnpm typecheck`. */
const MANAGERS = new Set(["bun", "npm", "pnpm", "yarn"])
/** Runners that run the program named after them: `bunx tsc`, `uv run pytest`, `python -m mypy`. */
const RUNNERS: Record<string, readonly string[]> = {
  bunx: [],
  npx: [],
  pnpx: [],
  bun: ["x"],
  pnpm: ["exec", "dlx"],
  yarn: ["exec", "dlx"],
  uv: ["run"],
  poetry: ["run"],
  python: ["-m"],
  python3: ["-m"],
}

/**
 * Whether a shell command line is a check, judged by the command that decides its exit status: the
 * last stage of the last pipeline. `cd pkg && bun test` is `bun test`'s exit; `bun test | tail` is
 * `tail`'s, and `bun test; echo done` is `echo`'s — neither is a check, since their exit says nothing
 * about the tests. (`cd pkg && bun test` exiting 1 because `cd` failed is still read as the tests':
 * rare, and the line was meant to test.)
 */
export function isCheck(command: string): boolean {
  let words = wordsOf(decider(command))
  // Environment and wrappers before the program: `CI=1 time bun test`.
  while (words[0] && (/^[A-Za-z_]\w*=/.test(words[0]) || words[0] === "time" || words[0] === "env"))
    words = words.slice(1)
  words = unwrap(words)
  const program = basename(words[0] ?? "")
  const args = words.slice(1).filter((word) => !word.startsWith("-"))
  if (PROGRAMS.has(program)) return true
  const sub = SUBCOMMANDS[program]
  if (sub) return sub.has(args[0] ?? "")
  if (program === "make" || program === "just") return args.some((target) => SCRIPT.test(target))
  if (MANAGERS.has(program)) {
    const script = args[0] === "run" || args[0] === "run-script" ? args[1] : args[0]
    return script === "t" || SCRIPT.test(script ?? "")
  }
  return false
}

/** `bunx tsc -b` → `tsc -b`; `uv run pytest` → `pytest`. */
function unwrap(words: string[]): string[] {
  const program = basename(words[0] ?? "")
  const via = RUNNERS[program]
  if (!via) return words
  let rest = words.slice(1)
  if (via.length > 0) {
    if (!via.includes(rest[0] ?? "")) return words
    rest = rest.slice(1)
  }
  while (rest[0]?.startsWith("-")) rest = rest.slice(1)
  return rest
}

/** The part of a command line whose status is the whole line's: the last stage of the last pipeline. */
function decider(command: string): string {
  const pieces: string[] = []
  let current = ""
  let quote: string | undefined
  for (let i = 0; i < command.length; i++) {
    const c = command[i] as string
    if (quote) {
      if (c === quote) quote = undefined
      current += c
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      current += c
      continue
    }
    const pair = command.slice(i, i + 2)
    if (pair === "&&" || pair === "||") {
      pieces.push(current)
      current = ""
      i++
      continue
    }
    // `;`, a newline, `|` and a lone `&` end a command; the `&` of `2>&1` and `&>` is a redirect.
    if (
      c === ";" ||
      c === "\n" ||
      c === "|" ||
      (c === "&" && command[i - 1] !== ">" && command[i + 1] !== ">")
    ) {
      pieces.push(current)
      current = ""
      continue
    }
    current += c
  }
  pieces.push(current)
  return pieces.findLast((piece) => piece.trim() !== "") ?? ""
}

/** Words of one simple command, quotes stripped, redirections dropped. */
function wordsOf(command: string): string[] {
  const out = command.match(/"[^"]*"|'[^']*'|\S+/g) ?? []
  return out
    .filter((word) => !/^\d*[<>]/.test(word) && !/^&>/.test(word))
    .map((word) => word.replace(/^["']|["']$/g, ""))
}

function basename(path: string): string {
  return path.split("/").at(-1) ?? path
}
