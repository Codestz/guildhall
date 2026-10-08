import { accessSync, constants } from "node:fs"
import { delimiter, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { settings } from "@guildhall/claude-code"
import { eject } from "./eject.ts"

/** `npx opencode-guildhall <command>`. Plain Node: it only writes files, or prints. */

const USAGE = `opencode-guildhall eject [--force]

  Writes the guild's nine agents to .opencode/agents/guild-*.md in this directory, where you can
  read and edit them. OpenCode then uses your files over the plugin's built-in copies.
  Existing files are left alone unless --force is given.

opencode-guildhall claude-code --print

  Prints the hooks block to merge into ~/.claude/settings.json (every project) or a project's
  .claude/settings.local.json, so Claude Code's sessions show up in the hall. Nothing is written.`

/** Whether `name` is an executable on PATH, looked up without running anything. */
function onPath(name: string): boolean {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    for (const file of [name, `${name}.exe`]) {
      try {
        accessSync(join(dir, file), constants.X_OK)
        return true
      } catch {
        // Not here.
      }
    }
  }
  return false
}

const [command, ...flags] = process.argv.slice(2)

if (command === "claude-code" && flags.length === 1 && flags[0] === "--print") {
  const hook = fileURLToPath(new URL("./claude-code.js", import.meta.url))
  const bun = onPath("bun")
  // Claude Code waits for the hook on every event: Bun starts it in ~40 ms, Node in ~60 ms (measured).
  console.log(JSON.stringify(settings(hook, bun ? "bun" : "node"), null, 2))
  if (!bun)
    console.error("\nnote: the hub runs on Bun (https://bun.sh); without it the hook has no hall to tell.")
  // npx and bunx run the package from a cache that gets cleared; the hook needs a path that stays.
  if (/[\\/](_npx|bunx-)/.test(hook)) {
    console.error(
      "\nnote: this copy runs from a temporary cache, so the path above may vanish. For a stable\n" +
        "path: npm install -g opencode-guildhall, then run opencode-guildhall claude-code --print.",
    )
  }
  process.exit(0)
}

if (command !== "eject" || flags.some((flag) => flag !== "--force")) {
  console.log(USAGE)
  process.exit(command === undefined || command === "--help" || command === "-h" ? 0 : 1)
}

const project = process.cwd()
const { written, skipped } = eject(project, { force: flags.includes("--force") })
for (const file of written) console.log(`wrote   ${relative(project, file)}`)
for (const file of skipped) console.log(`kept    ${relative(project, file)} (exists; --force overwrites)`)
process.exit(skipped.length > 0 ? 1 : 0)
