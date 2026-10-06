import { PROTECTED, ROLES, type Role } from "@guildhall/roster"
import { match } from "./match.ts"
import { commands, lines, parse, type Redirect, type Token, type Word } from "./shell.ts"

/**
 * The shell guard: a check on every shell call a guild agent makes, before it runs, on top of
 * OpenCode's permission rules. OpenCode checks each command of a line on its own, as its text; a
 * redirect that tree-sitter hangs on a list, a pipeline or a group (`git status && git diff > f`,
 * `(git show) > f`) is in no command's text, so no rule can see it. The guard reads the whole line
 * (src/shell.ts) and holds each role to what its rules mean:
 *
 *   checks only (the Verifier)  the line is exact checks joined by `&&`, `||`, `;` or newlines,
 *                               each optionally ending in `2>&1`, plus plain `cd <dir>`. No other
 *                               redirect, no substitution, no here-document, no group, no pipe, no
 *                               quoting; anything it can't read is denied.
 *   asks (builders, Guildmaster) no redirect may write a protected path, wherever it sits.
 *   no shell                     denied outright.
 *
 * Agents that aren't the guild's (the user's `build`, `plan`, their own) are never looked at.
 *
 *   v1 (1.18)  `tool.execute.before` on `bash`; the agent comes from `chat.params`, which OpenCode
 *              calls with the session and agent before every model step. A throw fails the call.
 *   v2 (2.0)   `ctx.tool.hook("execute.before")` on `shell`, whose input names the agent.
 */

type Policy = { kind: "none" } | { kind: "checks"; allowed: ReadonlySet<string> } | { kind: "asks" }

/** What a role's shell rules mean for the guard. */
function policyOf(role: Role): Policy {
  const bash = role.permissions.bash
  if (bash === "deny") return { kind: "none" }
  if (typeof bash === "object" && bash["*"] === "deny") {
    const allowed = Object.entries(bash).flatMap(([line, access]) => (access === "allow" ? [line] : []))
    return { kind: "checks", allowed: new Set(allowed) }
  }
  return { kind: "asks" }
}

const POLICIES = new Map<string, { role: Role; policy: Policy }>(
  ROLES.map((role) => [role.id, { role, policy: policyOf(role) }]),
)

/** Commands OpenCode treats as a directory change (a path check), not as a command. */
const DIRECTORY = new Set(["cd", "chdir", "pushd", "popd"])

/**
 * Why `agent` may not run `command`, or undefined to leave it to OpenCode's own rules.
 * `workdir` is the shell tool's working-directory argument, when given.
 */
export function inspect(agent: string, command: unknown, workdir?: unknown): string | undefined {
  const entry = POLICIES.get(agent)
  if (!entry) return undefined
  const { role, policy } = entry
  if (policy.kind === "none") return `Guildhall: the ${role.title} has no shell`
  if (typeof command !== "string") return `Guildhall: the ${role.title}'s shell call has no command to check`
  if (policy.kind === "checks") return checksOnly(role.title, policy.allowed, command)
  return protectedWrites(role.title, command, typeof workdir === "string" ? workdir : undefined)
}

function checksOnly(title: string, allowed: ReadonlySet<string>, command: string): string | undefined {
  const deny = (why: string) => `Guildhall: the ${title} may only run project checks; ${why}`
  let line: ReturnType<typeof parse>
  try {
    line = parse(command)
  } catch (error) {
    return deny(`the command could not be read safely (${(error as Error).message})`)
  }
  if (line.substitution) return deny("command substitution ($( ) or backticks) is not allowed")
  if (line.process) return deny("process substitution is not allowed")
  if (line.heredoc) return deny("here-documents and here-strings are not allowed")
  if (line.comment) return deny("comments are not allowed")

  const segments: Token[][] = [[]]
  for (const token of line.tokens) {
    if (token.kind !== "operator") segments.at(-1)?.push(token)
    else if (["&&", "||", ";", "\n"].includes(token.op)) segments.push([])
    else if (token.op === "(" || token.op === ")") return deny("grouping with ( ) is not allowed")
    else if (token.op === "|" || token.op === "|&") return deny("pipes are not allowed")
    else if (token.op === "&") return deny("background jobs are not allowed")
    else return deny(`\`${token.op}\` is not allowed`)
  }

  let checks = 0
  for (const segment of segments) {
    if (segment.length === 0) continue
    const words: string[] = []
    let folded = false
    for (const [index, token] of segment.entries()) {
      if (token.kind === "redirect") {
        // `2>&1` at the very end only duplicates a stream; it opens no file.
        const fold = token.fd === "2" && token.op === ">&" && token.target.raw === "1"
        if (!fold || index !== segment.length - 1 || index === 0) return deny("redirects are not allowed")
        folded = true
      } else if (token.kind === "word") {
        if (token.word.raw === "{" || token.word.raw === "}") return deny("grouping with { } is not allowed")
        if (token.word.value !== token.word.raw)
          return deny("quotes, escapes, variables and globs are not allowed")
        words.push(token.word.raw)
      }
    }
    if (DIRECTORY.has(words[0] ?? "") && words.length <= 2 && !folded) continue
    const text = folded ? `${words.join(" ")} 2>&1` : words.join(" ")
    if (!allowed.has(text)) return deny(`\`${text}\` is not one of the exact checks`)
    checks++
  }
  return checks === 0 ? deny("there is no check in this command") : undefined
}

function protectedWrites(title: string, command: string, workdir: string | undefined): string | undefined {
  let line: ReturnType<typeof parse>
  try {
    line = parse(command)
  } catch {
    // Unreadable to us; OpenCode still asks before any command that isn't an exact check.
    return undefined
  }
  const all = [...lines(line)]
  const writes = all.flatMap((inner) => inner.tokens.filter(isWrite))
  if (writes.length === 0) return undefined

  // Where the redirects land: the tool's workdir and any `cd` in the line, in order.
  const dirs: Word[] = workdir ? [{ raw: workdir, value: workdir }] : []
  for (const inner of all)
    for (const simple of commands(inner)) {
      const [first, second] = simple
      if (first?.kind !== "word" || !DIRECTORY.has(first.word.value ?? "")) continue
      dirs.push(second?.kind === "word" ? second.word : { raw: "~", value: "~" })
    }
  const unknown = dirs.find((dir) => dir.value === undefined)
  if (unknown)
    return `Guildhall: the ${title} may not combine a redirect with \`cd ${unknown.raw}\`: the shell would expand the directory, so the target can't be checked against the protected paths`

  for (const write of writes) {
    const target = write.target.value
    if (target === undefined)
      return `Guildhall: the ${title} may not redirect to \`${write.target.raw}\`: the shell would expand it, so it can't be checked against the protected paths`
    const where = dirs.map((dir) => dir.value as string)
    const candidates = /^[/~]/.test(target)
      ? [target]
      : [target, ...where.map((dir) => `${dir}/${target}`), [...where, target].join("/")]
    const hit = candidates.find(isProtected)
    if (hit)
      return `Guildhall: the ${title} may not write \`${hit}\`: it is a protected path (agent, command and skill definitions, OpenCode's config, AGENTS.md, CLAUDE.md, .claude, .git)`
  }
  return undefined
}

/** A redirect that opens a file for writing; `>&2`, `2>&1` and `>&-` only duplicate or close. */
function isWrite(token: Token): token is Redirect {
  if (token.kind !== "redirect" || !token.op.includes(">")) return false
  if (token.op === ">&" && /^(\d+|-)$/.test(token.target.raw)) return false
  return true
}

/** Matched without case: macOS reads `agents.md` as `AGENTS.md`. */
function isProtected(path: string): boolean {
  const lower = path.toLowerCase()
  return PROTECTED.some((pattern) => match(lower, pattern.toLowerCase()))
}

// ---- the hooks -------------------------------------------------------------------------------

/** OpenCode 1's own hidden agents, which also call `chat.params` on a session (its title, …). */
const HIDDEN = new Set(["title", "summary", "compaction"])

export interface V1Guard {
  "chat.params": (input: { sessionID: string; agent: string }) => Promise<void>
  "tool.execute.before": (
    input: { tool: string; sessionID: string; callID?: string },
    output: { args: unknown },
  ) => Promise<void>
}

/** v1's hooks: remember each session's agent, then check its `bash` calls. */
export function v1Guard(log: (message: string) => void): V1Guard {
  const agents = new Map<string, string>()
  return {
    "chat.params": async ({ sessionID, agent }) => {
      if (!HIDDEN.has(agent)) agents.set(sessionID, agent)
    },
    "tool.execute.before": async ({ tool, sessionID }, { args }) => {
      if (tool !== "bash") return
      const agent = agents.get(sessionID)
      if (!agent) return
      const { command, workdir } = (args ?? {}) as { command?: unknown; workdir?: unknown }
      const reason = inspect(agent, command, workdir)
      if (!reason) return
      log(`v1 guard denied ${agent}: ${JSON.stringify(command)}`)
      throw new Error(reason)
    },
  }
}

export interface V2ToolCall {
  tool: string
  agent: string
  input: unknown
}

/** v2's `execute.before` callback: checks `shell` calls. */
export function v2Guard(log: (message: string) => void): (call: V2ToolCall) => void {
  return ({ tool, agent, input }) => {
    if (tool !== "shell") return
    const { command, workdir } = (input ?? {}) as { command?: unknown; workdir?: unknown }
    const reason = inspect(agent, command, workdir)
    if (!reason) return
    log(`v2 guard denied ${agent}: ${JSON.stringify(command)}`)
    throw new Error(reason)
  }
}
