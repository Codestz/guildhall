import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { v1Agent } from "@guildhall/herald/agents"
import { ROLES } from "@guildhall/roster"
import { agentFile, eject } from "../src/eject.ts"

const project = () => mkdtempSync(join(tmpdir(), "guildhall-eject-"))

/** An agent file as OpenCode reads it: YAML frontmatter, then the prompt. */
function parse(text: string): { front: Record<string, unknown>; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text)
  if (!match) throw new Error(`not an agent file:\n${text.slice(0, 200)}`)
  return { front: Bun.YAML.parse(match[1] as string) as Record<string, unknown>, body: match[2] as string }
}

describe("eject", () => {
  test("writes the nine agents as .opencode/agents/guild-*.md", () => {
    const dir = project()
    const { written, skipped } = eject(dir)
    expect(skipped).toEqual([])
    expect(written).toHaveLength(9)
    expect(readdirSync(join(dir, ".opencode", "agents")).sort()).toEqual(
      ROLES.map((role) => `${role.id}.md`).sort(),
    )
  })

  test("each file says what the plugin injects: description, mode, colour, permissions, prompt", () => {
    for (const role of ROLES) {
      const { front, body } = parse(agentFile(role))
      const agent = v1Agent(role)
      expect(front).toEqual({
        description: agent.description,
        mode: agent.mode,
        color: agent.color,
        permission: agent.permission,
      })
      expect(body).toBe(`${role.prompt.trim()}\n`)
    }
  })

  test("permission keys keep their order: OpenCode's last matching rule wins", () => {
    const master = ROLES.find((role) => role.id === "guild-master")
    if (!master) throw new Error("no guild-master")
    const { front } = parse(agentFile(master))
    expect(Object.keys(front.permission as object)).toEqual(Object.keys(v1Agent(master).permission))
  })

  test("never sets a model: the agent inherits the one you run", () => {
    for (const role of ROLES) expect(parse(agentFile(role)).front).not.toHaveProperty("model")
  })

  test("leaves an existing file alone, and writes the rest", () => {
    const dir = project()
    const agents = join(dir, ".opencode", "agents")
    mkdirSync(agents, { recursive: true })
    writeFileSync(join(agents, "guild-verifier.md"), "mine")
    const { written, skipped } = eject(dir)
    expect(skipped).toEqual([join(agents, "guild-verifier.md")])
    expect(written).toHaveLength(8)
    expect(readFileSync(join(agents, "guild-verifier.md"), "utf8")).toBe("mine")
  })

  test("--force overwrites", () => {
    const dir = project()
    const agents = join(dir, ".opencode", "agents")
    mkdirSync(agents, { recursive: true })
    writeFileSync(join(agents, "guild-verifier.md"), "mine")
    const { written, skipped } = eject(dir, { force: true })
    expect(skipped).toEqual([])
    expect(written).toHaveLength(9)
    expect(readFileSync(join(agents, "guild-verifier.md"), "utf8")).not.toBe("mine")
  })
})
