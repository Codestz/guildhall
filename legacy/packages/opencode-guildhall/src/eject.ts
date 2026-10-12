import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { v1Agent } from "@guildhall/herald/agents"
import { ROLES, type Role } from "@guildhall/roster"

/**
 * `npx opencode-guildhall eject`: the guild's agents as OpenCode agent files
 * (`.opencode/agents/<id>.md`, YAML frontmatter and the prompt as the body), so they can be read
 * and edited. OpenCode reads the files as the user's own agents, which win over the plugin's
 * in-memory copy field by field (ADR 0002). The permissions are written in OpenCode 1's form, which
 * OpenCode 2 also reads from agent files.
 */

export interface Ejected {
  /** Files written. */
  written: string[]
  /** Files that already existed and were left alone (no `force`). */
  skipped: string[]
}

export function eject(project: string, options: { force?: boolean } = {}): Ejected {
  const dir = join(project, ".opencode", "agents")
  mkdirSync(dir, { recursive: true })
  const result: Ejected = { written: [], skipped: [] }
  for (const role of ROLES) {
    const file = join(dir, `${role.id}.md`)
    if (existsSync(file) && !options.force) {
      result.skipped.push(file)
      continue
    }
    writeFileSync(file, agentFile(role))
    result.written.push(file)
  }
  return result
}

/** One role as an agent file. No model: the agent inherits the one you run, as the plugin's does. */
export function agentFile(role: Role): string {
  const agent = v1Agent(role)
  const lines = [
    "---",
    "# From opencode-guildhall (npx opencode-guildhall eject). Edit freely: this file wins over the",
    "# plugin's built-in copy, field by field; a permission key you delete falls back to the plugin's.",
    `description: ${JSON.stringify(agent.description)}`,
    `mode: ${agent.mode}`,
    `color: ${JSON.stringify(agent.color)}`,
    "permission:",
    ...Object.entries(agent.permission).flatMap(([tool, rules]) =>
      typeof rules === "string"
        ? [`  ${JSON.stringify(tool)}: ${rules}`]
        : [
            `  ${JSON.stringify(tool)}:`,
            ...Object.entries(rules).map(([pattern, access]) => `    ${JSON.stringify(pattern)}: ${access}`),
          ],
    ),
    "---",
    "",
  ]
  return `${lines.join("\n")}${agent.prompt.trim()}\n`
}
