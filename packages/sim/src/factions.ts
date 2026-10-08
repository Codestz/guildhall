import type { Change } from "@guildhall/core"
import { Adventurer, Script } from "./script.ts"

/**
 * Two harnesses in one world: an OpenCode party and a Claude Code party working on the same project
 * at once. Each is told in the changes its adapter makes: the OpenCode guildmaster sends the guild's
 * own roles; the Claude Code conversation (no agent name of its own, so the model's default) sends
 * Claude Code's built-in `Explore`, a Wanderer, and Agentry's `implementer`, which its adapter maps to
 * the roster's `guild-implementer`. Its deeds are spelled as packages/claude-code translates them:
 * `bash`, `read`, `mcp__<server>__<tool>`.
 */
export function factions(seed = 1): Change[] {
  const script = new Script(seed)

  const opencode = script.guildmaster("Add rate limiting to the public API", 0)
  opencode.think("One limiter in front of every route. Map the routes, then build it.", 2200)
  opencode.quest("guild-explorer", "Find every public route", (explorer) => {
    explorer.deed("glob", { pattern: "src/routes/**" }, 1100, { summary: "9 files" })
    explorer.deed("read", { filePath: "src/routes/index.ts" }, 1400)
    explorer.finish("Nine routes, all mounted in src/routes/index.ts.")
  })
  opencode.quest("guild-implementer", "Add a token-bucket limiter middleware", (smith) => {
    smith.deed("write", { filePath: "src/middleware/limit.ts" }, 4200)
    smith.deed("edit", { filePath: "src/routes/index.ts" }, 1800)
    smith.deed("bash", { command: "bun test limit" }, 3600, { summary: "12 pass" })
    smith.finish("Limiter mounted on every public route: 60 requests a minute per key.")
  })
  opencode.finish("Rate limiting is on: 60/min per API key, 429 with Retry-After.")

  const claude = new Adventurer(script, "agent", "Why does the nightly export time out?", 2500)
  claude.think("Find where the export runs, then measure it.", 1800)
  claude.quest("Explore", "Trace the nightly export job", (explore) => {
    explore.deed("grep", { pattern: "exportNightly", path: "src" }, 900, { summary: "2 matches" })
    explore.deed("read", { filePath: "src/jobs/export.ts" }, 1600)
    explore.finish("export.ts loads every order into memory before writing the CSV.")
  })
  claude.deed("mcp__context7__query-docs", { query: "postgres cursor streaming node" }, 2600)
  claude.quest("guild-implementer", "Stream the export instead of loading it whole", (smith) => {
    smith.deed("edit", { filePath: "src/jobs/export.ts" }, 3800)
    smith.deed("bash", { command: "bun test export" }, 4400, { fail: "Exit code 1", summary: "exit 1" })
    smith.deed("edit", { filePath: "src/jobs/export.ts" }, 2000)
    smith.deed("bash", { command: "bun test export" }, 3900, { summary: "8 pass" })
    smith.finish("Export streams rows through a cursor; memory flat at 40 MB.")
  })
  claude.plea(3500)
  claude.deed("bash", { command: "git push origin fix/export-stream" }, 1500)
  claude.finish("The export streams now; it finishes in 3 minutes instead of timing out.")

  return script.done()
}
