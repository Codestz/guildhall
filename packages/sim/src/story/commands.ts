/**
 * A deed in the narrator's words (decisions.md: captions, pleas and toasts never say raw tool text): a
 * shell command read by its gist (core `commandGist`) and told as what it does for the work, `gh pr create
 * --fill` as "opens a pull request", `bun test packages/world` as "runs the tests"; any other deed by its
 * craft. Every phrase comes in three forms, for the three places that tell it:
 *
 *   does    a caption or a toast: "The Guildmaster opens a pull request, #42."
 *   doing   a plea's caption: "… awaits your word before opening a pull request"
 *   to      a plea's card: "wants to open a pull request"
 *
 * A command the map does not know is "a command": its raw line stays in a title attribute, never in a line.
 */
import { type Craft, commandGist, deedCraft } from "@guildhall/core"

/** One deed told three ways. */
export interface DeedWords {
  does: string
  doing: string
  to: string
}

/** `["open", "a pull request"]` → its three forms (a regular verb's `-s` and `-ing` unless given). */
function told(base: string, rest = "", does?: string, doing?: string): DeedWords {
  const s = does ?? (/(s|sh|ch|x|z)$/.test(base) ? `${base}es` : `${base}s`)
  const ing = doing ?? (base.endsWith("e") && !base.endsWith("ee") ? `${base.slice(0, -1)}ing` : `${base}ing`)
  const tail = rest ? ` ${rest}` : ""
  return { does: `${s}${tail}`, doing: `${ing}${tail}`, to: `${base}${tail}` }
}

/** A command's gist ("gh pr create", "git push", "bun run build") → what it does, first match wins. */
const COMMANDS: readonly [RegExp, DeedWords][] = [
  [/^gh pr (create|new)\b/, told("open", "a pull request")],
  [/^gh pr merge\b/, told("merge", "the pull request")],
  [/^gh pr (checks|status)\b/, told("check on", "the pull request", "checks on", "checking on")],
  [/^gh pr (review|comment)\b/, told("review", "the pull request")],
  [/^gh pr\b/, told("look over", "the pull requests", "looks over", "looking over")],
  [/^gh issue (create|new)\b/, told("open", "an issue")],
  [/^gh issue (close)\b/, told("close", "an issue")],
  [/^gh issue\b/, told("look over", "the issues", "looks over", "looking over")],
  [/^gh release\b/, told("cut", "a release", "cuts", "cutting")],
  [/^gh (run|workflow)\b/, told("read", "the CI's log")],
  [/^gh\b/, told("send", "word to GitHub")],
  [/^git commit\b/, told("commit", "the work", "commits", "committing")],
  [/^git push\b/, told("push", "the work upstream")],
  [/^git (pull|fetch)\b/, told("fetch", "the latest work")],
  [/^git (merge|cherry-pick)\b/, told("merge", "the branches")],
  [/^git rebase\b/, told("rebase", "the branch")],
  [/^git (checkout|switch|branch)\b/, told("switch", "branches")],
  [/^git (add|stage)\b/, told("stage", "the changes")],
  [/^git stash\b/, told("set", "the changes aside", "sets", "setting")],
  [/^git tag\b/, told("tag", "a release", "tags", "tagging")],
  [/^git (reset|restore|revert)\b/, told("roll", "changes back", "rolls", "rolling")],
  [/^git clone\b/, told("clone", "a repository")],
  [/^git (status|diff|show)\b/, told("look over", "the changes", "looks over", "looking over")],
  [/^git (log|blame|shortlog)\b/, told("read", "the history")],
  [/^git\b/, told("tend", "the repository")],
  [
    /^(bun|npm|pnpm|yarn|deno) (install|i|add|ci|update|upgrade)\b|^pip3? install\b/,
    told("fetch", "the dependencies"),
  ],
  [/\b(typecheck|tsc)\b/, told("check", "the types")],
  [/\b(lint|biome|eslint|clippy)\b/, told("check", "the code")],
  [/\b(format|fmt|prettier)\b/, told("tidy", "the code", "tidies", "tidying")],
  [
    /\b(build|compile|bundle)\b|^(make|cargo build|go build|tsup|webpack|esbuild|rollup)\b/,
    told("build", "the project"),
  ],
  [/\b(dev|serve|start|preview)\b/, told("start", "the dev server")],
  [
    /\b(deploy|publish|release)\b|^(vercel|netlify|fly|wrangler)\b/,
    told("ship", "the work", "ships", "shipping"),
  ],
  [/^(docker|podman|docker-compose|kubectl)\b/, told("tend", "the containers")],
  [/^(curl|wget|http|xh)\b/, told("fetch", "word from afar")],
  [/^(rm|mkdir|cp|mv|touch|chmod|ln|tar|unzip|zip)\b/, told("tidy", "the files", "tidies", "tidying")],
  [/^(node|bun|deno|python3?|ruby|tsx|ts-node|npx|bunx)\b/, told("run", "a script", "runs", "running")],
]

/** A command no line of the map knows. */
const A_COMMAND = told("run", "a command", "runs", "running")

/** A shell command (its raw line or its gist) in the narrator's words. */
export function commandWords(command: string | undefined): DeedWords {
  if (!command) return A_COMMAND
  const gist = commandGist(command)
  if (gist.craft === "test") return told("run", "the tests", "runs", "running")
  const plain = (gist.target ?? command).trim().toLowerCase()
  for (const [rule, words] of COMMANDS) if (rule.test(plain)) return words
  return A_COMMAND
}

/** `…/packages/world/src/hex/life.ts` → `life.ts`. */
const fileOf = (path: string) =>
  path
    .split(/[\\/]+/)
    .filter(Boolean)
    .at(-1) ?? path

const SHELLS = new Set(["bash", "shell", "sh", "zsh", "powershell", "terminal", "exec", "run_command"])

/**
 * Any deed in the narrator's words, by its craft and what it is about (a world event's `craft` and
 * `target`, or a tool's name and input): a file by its name, a search by its plain term, a command by
 * the map above, never the raw line.
 */
export function deedWords(deed: { craft?: Craft; tool?: string; target?: string }): DeedWords {
  const raw = deed.target?.replace(/\s+/g, " ").trim() ?? ""
  const shell = deed.tool !== undefined && SHELLS.has(deed.tool.toLowerCase())
  const craft: Craft =
    deed.craft ?? deedCraft({ name: deed.tool ?? "tool", ...(shell ? { input: { command: raw } } : {}) })
  if (craft === "test") return told("run", "the tests", "runs", "running")
  if (craft === "run" || craft === "lint") return commandWords(raw)
  // a shell line's file or term (`sed -n 1,40p life.ts` reads `life.ts`), else the tool's own target
  const target = shell ? (commandGist(raw).target ?? "") : raw
  switch (craft) {
    case "read":
      return told("read", target ? fileOf(target) : "a file")
    case "search": {
      const term = /^"([^"]*)"/.exec(target)?.[1] ?? target
      return /^[\w./ -]{1,32}$/.test(term)
        ? told("search", `the code for ${term}`)
        : told("search", "the code")
    }
    case "edit":
    case "write":
      return told("change", target ? fileOf(target) : "the code")
    case "fetch":
    case "consult":
      return told("reach", "beyond the hall")
    case "plan":
      return told("rewrite", "the plan")
    case "delegate":
      return told("send", "a quest")
    default:
      return told("go", "on", "goes", "going")
  }
}
