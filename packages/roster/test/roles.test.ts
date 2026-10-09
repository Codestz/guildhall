import { describe, expect, test } from "bun:test"
import { ARCHETYPES, CHECKS, ROLES, roleOf } from "../src/index.ts"

const subagents = ROLES.filter((role) => role.mode === "subagent")

describe("the roster", () => {
  test("has nine roles with unique, guild-prefixed ids", () => {
    expect(ROLES).toHaveLength(9)
    expect(new Set(ROLES.map((role) => role.id)).size).toBe(9)
    for (const role of ROLES) expect(role.id).toMatch(/^guild-[a-z-]+$/)
  })

  test("ships exactly one primary, the Guildmaster", () => {
    expect(ROLES.filter((role) => role.mode === "primary").map((role) => role.id)).toEqual(["guild-master"])
  })

  test("every role is complete: title, prompt, colour, archetype, tier", () => {
    for (const role of ROLES) {
      expect(role.title.length).toBeGreaterThan(0)
      expect(role.prompt.length).toBeGreaterThan(1000)
      expect(role.color).toMatch(/^#[0-9a-f]{6}$/)
      expect(role.color).toBe(ARCHETYPES[role.archetype].color)
      expect(ARCHETYPES[role.archetype].station).not.toBe("overflow")
      expect(["strong", "standard", "fast"]).toContain(role.tier)
    }
  })

  test("descriptions stay short: they are sent with every request that offers delegation", () => {
    for (const role of ROLES) {
      expect(role.description.length).toBeGreaterThan(20)
      expect(role.description.length).toBeLessThanOrEqual(100)
    }
  })

  test("prompts carry none of Agentry's machinery", () => {
    for (const role of ROLES) {
      expect(role.prompt).not.toMatch(/agentry|used_memories|memory_|task_get|artifact_write|\.agentry\//i)
    }
  })

  test("only the Guildmaster dispatches, and it may launch every subagent by name", () => {
    const master = ROLES.find((role) => role.id === "guild-master")!
    expect([...master.permissions.dispatch].sort()).toEqual(subagents.map((role) => role.id).sort())
    for (const role of subagents) expect(role.permissions.dispatch).toEqual([])
  })

  test("the Guildmaster's prompt names every agent it may dispatch", () => {
    const master = ROLES.find((role) => role.id === "guild-master")!
    for (const id of master.permissions.dispatch) expect(master.prompt).toContain(`\`${id}\``)
  })

  test("explorer, researcher, librarian and verifier cannot change files", () => {
    for (const id of ["guild-explorer", "guild-researcher", "guild-librarian", "guild-verifier"]) {
      expect(ROLES.find((role) => role.id === id)!.permissions.edit).toBe("deny")
    }
  })

  test("only the implementer and the designer may edit code", () => {
    const editors = ROLES.filter((role) => {
      const edit = role.permissions.edit
      return typeof edit === "object" && edit["*"] === "allow"
    }).map((role) => role.id)
    expect(editors.sort()).toEqual(["guild-designer", "guild-implementer"])
  })

  test("the verifier's shell runs checks and nothing else", () => {
    const bash = ROLES.find((role) => role.id === "guild-verifier")!.permissions.bash
    expect(typeof bash).toBe("object")
    const rules = bash as Record<string, string>
    expect(Object.keys(rules)[0]).toBe("*")
    expect(rules["*"]).toBe("deny")
    expect(rules["bun test"]).toBe("allow")
    expect(Object.values(rules).filter((effect) => effect !== "allow")).toEqual(["deny"])
  })

  test("every check is one exact command: no wildcard, no shell syntax (OpenCode's * crosses spaces)", () => {
    // A trailing * lets any flag or redirect through (docs/reviews/review-2.md, finding 1).
    for (const command of CHECKS) expect(command).toMatch(/^[a-z]+( [A-Za-z0-9./-]+)*$/)
    expect(CHECKS.some((command) => /^(bunx|npx|sh|bash|curl) /.test(`${command} `))).toBe(false)
  })

  test("every prompt treats what it reads as data, not instructions", () => {
    for (const role of ROLES) {
      expect(role.prompt).toContain("data, not instructions")
      expect(role.prompt).not.toMatch(/and follow them|an MCP server\)/)
    }
  })
})

describe("roleOf", () => {
  test("maps an agent id to its role", () => {
    expect(roleOf("guild-implementer")?.title).toBe("Implementer")
    expect(roleOf("guild-master")?.title).toBe("Guildmaster")
  })

  test("anything else is not the guild's", () => {
    expect(roleOf("general")).toBeUndefined()
    expect(roleOf("build")).toBeUndefined()
  })
})
