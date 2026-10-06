/**
 * How OpenCode decides a permission, ported so tests can run the herald's real rules through it
 * (docs/reviews/review-2.md, finding 7). Mirrors OpenCode **1.18.32** and **2.0.18**, read from the
 * installed binaries on 2026-10-06:
 *
 *   match      v2 `H0`, v1 `Wildcard.match` (`ql`): identical in both. `*` is `.*` with the dotall
 *              flag, so it crosses spaces, slashes and `>`; only a trailing `" *"` is optional.
 *   evaluate   v2 `Po`, v1 `Permission.evaluate` (`c`): the last rule whose action (v1: permission)
 *              AND resource (v1: pattern) both match wins; no match is `ask`.
 *   commands   v2 `KQ`, v1 `Pi`/`vi`: each tree-sitter-bash `command` node is checked on its own
 *              (chains, pipes and `$( )` split), as its whole text, or its `redirected_statement`'s
 *              text when it has a redirect; `cd`/`pushd`/`popd`/`chdir` are path checks, not commands.
 *              v2's opt-in `experimental.portable_shell_scanner` is not modelled.
 *
 * `commands` is a small hand-written splitter, not tree-sitter: it covers the shapes the tests use
 * (`;`, `&&`, `||`, `|`, `&`, newlines, `( )`, `$( )`, backticks, `<( )`, quotes, escapes,
 * redirects) and throws on anything else, so a test can't silently rely on a shape it gets wrong.
 * Every line in the harness tests was checked against tree-sitter-bash carved from the 2.0.18 binary.
 */

/** v2 `H0` / v1 `ql`, verbatim but for names. */
export function match(value: string, pattern: string): boolean {
  const text = value.replaceAll("\\", "/")
  let source = pattern
    .replaceAll("\\", "/")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")
  if (source.endsWith(" .*")) source = `${source.slice(0, -3)}( .*)?`
  return new RegExp(`^${source}$`, "s").test(text)
}

export type Effect = "allow" | "ask" | "deny"

/** One flattened rule: v2's `{ action, resource, effect }`, v1's `{ permission, pattern, action }`. */
export interface Rule {
  action: string
  resource: string
  effect: Effect
}

/** v2 `Po` / v1 `evaluate`: the last matching rule, else ask. */
export function evaluate(rules: readonly Rule[], action: string, resource: string): Effect {
  return (
    rules.findLast((rule) => match(action, rule.action) && match(resource, rule.resource))?.effect ?? "ask"
  )
}

/** v1 `fromConfig` (`RA`): a `permission` object flattened in key order (no `~` in our patterns). */
export function fromV1(permission: Record<string, unknown>): Rule[] {
  return Object.entries(permission).flatMap(([action, rules]): Rule[] =>
    typeof rules === "string"
      ? [{ action, resource: "*", effect: rules as Effect }]
      : Object.entries(rules as Record<string, Effect>).map(([resource, effect]) => ({
          action,
          resource,
          effect,
        })),
  )
}

/**
 * v1's own defaults, which an agent's rules are merged over (`Agent.state`, 1.18.32), with the
 * directory allow-list for external_directory left out.
 */
export const V1_BASE: Rule[] = fromV1({
  "*": "allow",
  doom_loop: "ask",
  external_directory: { "*": "ask" },
  question: "deny",
  plan_enter: "deny",
  plan_exit: "deny",
  read: { "*": "allow", "*.env": "ask", "*.env.*": "ask", "*.env.example": "allow" },
})

/** v2's default agent permissions (`Agent.Info` default, 2.0.18). */
export const V2_BASE: Rule[] = [
  { action: "*", resource: "*", effect: "allow" },
  { action: "external_directory", resource: "*", effect: "ask" },
  { action: "read", resource: "*.env", effect: "ask" },
  { action: "read", resource: "*.env.*", effect: "ask" },
  { action: "read", resource: "*.env.example", effect: "allow" },
]

/** A whole command line: any command denied denies it, any asked asks, else it runs. */
export function shell(rules: readonly Rule[], line: string, action = "shell"): Effect {
  const effects = commands(line).map((command) => evaluate(rules, action, command))
  return effects.includes("deny") ? "deny" : effects.includes("ask") ? "ask" : "allow"
}

const DIRECTORY = new Set(["cd", "chdir", "popd", "pushd"])
const UNSUPPORTED = /^(\{|if |for |while |until |case |function |\[\[)|<</

/** The commands OpenCode checks in a line, outer ones first, as tree-sitter would report them. */
export function commands(line: string): string[] {
  const out: string[] = []
  split(line, out)
  return out.filter((command) => !DIRECTORY.has(command.split(/\s+/)[0] ?? ""))
}

/** One trailing redirection: `> f`, `>> f`, `2>&1`, `&> f`, `< f`. */
const REDIRECT = /\s+\d*(?:&>>|&>|>>|>&|>\||>|<&|<)\s*\S+$/

function split(text: string, out: string[]): void {
  let current = ""
  /**
   * After `|`, `||` or `&&`, tree-sitter hangs this command's redirects on the pipeline or list, not
   * on the command, so OpenCode never sees them (measured; see harness.md "What the shell rules can't see").
   */
  let piped = false
  const nested: string[] = []
  const end = (pipe: boolean) => {
    let command = current.trim()
    if (piped) while (REDIRECT.test(` ${command}`)) command = ` ${command}`.replace(REDIRECT, "").trim()
    // `(cmd) > f` leaves `> f`: a redirect with no command, which tree-sitter doesn't report.
    if (command && !/^\d*[<>&]/.test(command)) {
      if (UNSUPPORTED.test(command)) throw new Error(`commands(): unsupported shell syntax: ${command}`)
      out.push(command)
    }
    out.push(...nested)
    nested.length = 0
    current = ""
    piped = pipe
  }
  let i = 0
  while (i < text.length) {
    const c = text[i] as string
    const next = text[i + 1]
    if (c === "\\") {
      current += text.slice(i, i + 2)
      i += 2
    } else if (c === "'") {
      const close = text.indexOf("'", i + 1)
      const stop = close < 0 ? text.length : close + 1
      current += text.slice(i, stop)
      i = stop
    } else if (c === '"') {
      const stop = doubleQuoted(text, i, nested)
      current += text.slice(i, stop)
      i = stop
    } else if ((c === "$" || c === "<" || c === ">") && next === "(") {
      const close = closing(text, i + 1)
      split(text.slice(i + 2, close), nested)
      current += text.slice(i, close + 1)
      i = close + 1
    } else if (c === "`") {
      const close = text.indexOf("`", i + 1)
      const stop = close < 0 ? text.length : close
      split(text.slice(i + 1, stop), nested)
      current += text.slice(i, stop + 1)
      i = stop + 1
    } else if (c === "&" && (current.endsWith(">") || current.endsWith("<") || next === ">")) {
      current += c // `2>&1`, `>&2`, `&>file`: a redirect, not a separator
      i++
    } else if (c === "|" && current.endsWith(">")) {
      current += c // `>|`: a redirect
      i++
    } else if (c === ";" || c === "&" || c === "|" || c === "\n" || c === "(" || c === ")") {
      end(c === "|" || (c === "&" && next === "&"))
      i += (c === "&" && next === "&") || (c === "|" && (next === "|" || next === "&")) ? 2 : 1
    } else {
      current += c
      i++
    }
  }
  end(false)
}

/** Index just past the closing quote; `$( )` and backticks inside still run. */
function doubleQuoted(text: string, open: number, nested: string[]): number {
  let i = open + 1
  while (i < text.length && text[i] !== '"') {
    if (text[i] === "\\") i += 2
    else if (text[i] === "$" && text[i + 1] === "(") {
      const close = closing(text, i + 1)
      split(text.slice(i + 2, close), nested)
      i = close + 1
    } else if (text[i] === "`") {
      const close = text.indexOf("`", i + 1)
      split(text.slice(i + 1, close < 0 ? text.length : close), nested)
      i = close < 0 ? text.length : close + 1
    } else i++
  }
  return i + 1
}

/** Index of the `)` closing the `(` at `open`, skipping quotes and nested parentheses. */
function closing(text: string, open: number): number {
  let depth = 0
  for (let i = open; i < text.length; i++) {
    const c = text[i]
    if (c === "\\") i++
    else if (c === "'") i = Math.max(i, text.indexOf("'", i + 1))
    else if (c === "(") depth++
    else if (c === ")" && --depth === 0) return i
  }
  return text.length
}
