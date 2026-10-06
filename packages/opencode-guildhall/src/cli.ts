import { relative } from "node:path"
import { eject } from "./eject.ts"

/** `npx opencode-guildhall <command>`. Plain Node: it only writes files. */

const USAGE = `opencode-guildhall eject [--force]

  Writes the guild's nine agents to .opencode/agents/guild-*.md in this directory, where you can
  read and edit them. OpenCode then uses your files over the plugin's built-in copies.
  Existing files are left alone unless --force is given.`

const [command, ...flags] = process.argv.slice(2)
if (command !== "eject" || flags.some((flag) => flag !== "--force")) {
  console.log(USAGE)
  process.exit(command === undefined || command === "--help" || command === "-h" ? 0 : 1)
}

const project = process.cwd()
const { written, skipped } = eject(project, { force: flags.includes("--force") })
for (const file of written) console.log(`wrote   ${relative(project, file)}`)
for (const file of skipped) console.log(`kept    ${relative(project, file)} (exists; --force overwrites)`)
process.exit(skipped.length > 0 ? 1 : 0)
