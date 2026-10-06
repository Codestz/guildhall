import { describe, expect, test } from "bun:test"
import { ROLES } from "@guildhall/roster"
import {
  injectV1,
  injectV2,
  readOptions,
  type V2Agent,
  type V2AgentEditor,
  v1Permission,
  v2Permissions,
} from "../src/agents.ts"
import { evaluate } from "./support/opencode.ts"

const role = (id: string) => ROLES.find((r) => r.id === id)!

/** v2's default agent, as `Agent.Info.default` builds it (`@opencode/schema` 2.0.15). */
function v2Default(): V2Agent {
  return {
    mode: "primary",
    permissions: [
      { action: "*", resource: "*", effect: "allow" },
      { action: "external_directory", resource: "*", effect: "ask" },
    ],
  }
}

/** A stand-in for v2's agent editor: `update` on an unknown id starts from the default (measured). */
function v2Host() {
  const agents = new Map<string, V2Agent>()
  const editor: V2AgentEditor = {
    update(id, update) {
      const agent = agents.get(id) ?? v2Default()
      update(agent)
      agents.set(id, agent)
    },
  }
  return { agents, domain: { transform: (fn: (e: V2AgentEditor) => void) => fn(editor) } }
}

/** OpenCode's own decision (./support/opencode.ts); no match there means ask. */
const decide = (rules: V2Agent["permissions"], action: string, resource: string) =>
  evaluate(rules, action, resource)

describe("v1 permission", () => {
  test("names v1's permissions after a leading deny-all, and keeps pattern order", () => {
    const permission = v1Permission(role("guild-verifier").permissions)
    expect(Object.keys(permission)[0]).toBe("*")
    expect(permission["*"]).toBe("deny")
    for (const key of ["read", "glob", "grep", "bash", "edit", "task", "webfetch", "websearch"])
      expect(Object.keys(permission)).toContain(key)
    expect(permission.edit).toBe("deny")
    expect(Object.keys(permission.bash as object)[0]).toBe("*")
    expect(permission.task).toBe("deny")
  })

  test("the Guildmaster may launch each guild subagent and nothing else", () => {
    const task = v1Permission(role("guild-master").permissions).task as Record<string, string>
    expect(Object.keys(task)[0]).toBe("*")
    expect(task["*"]).toBe("deny")
    expect(task["guild-implementer"]).toBe("allow")
    expect(task.general).toBeUndefined()
    expect(Object.keys(task)).toHaveLength(9)
  })

  test("documents-only edit becomes a pattern map: deny first, docs allowed, protected paths last", () => {
    const edit = v1Permission(role("guild-architect").permissions).edit as Record<string, string>
    expect(Object.entries(edit).slice(0, 3)).toEqual([
      ["*", "deny"],
      ["docs/*.md", "allow"],
      ["*/docs/*.md", "allow"],
    ])
    expect(
      Object.values(edit)
        .slice(3)
        .every((effect) => effect === "deny"),
    ).toBe(true)
  })
})

describe("v2 permissions", () => {
  test("renames bash to shell and task to subagent, after a leading deny-all", () => {
    const rules = v2Permissions(role("guild-implementer").permissions)
    expect(rules[0]).toEqual({ action: "*", resource: "*", effect: "deny" })
    const actions = new Set(rules.map((rule) => rule.action))
    for (const action of ["edit", "shell", "webfetch", "websearch", "subagent"])
      expect(actions.has(action)).toBe(true)
    expect(actions.has("bash")).toBe(false)
    expect(actions.has("task")).toBe(false)
  })

  test("the verifier runs tests but no other command, and edits nothing", () => {
    const rules = v2Permissions(role("guild-verifier").permissions)
    expect(decide(rules, "shell", "bun test")).toBe("allow")
    expect(decide(rules, "shell", "bun test --preload ./x.ts")).toBe("deny")
    expect(decide(rules, "shell", "rm -rf src")).toBe("deny")
    expect(decide(rules, "edit", "src/index.ts")).toBe("deny")
  })

  test("the Guildmaster launches guild subagents, not OpenCode's own", () => {
    const rules = v2Permissions(role("guild-master").permissions)
    expect(decide(rules, "subagent", "guild-explorer")).toBe("allow")
    expect(decide(rules, "subagent", "general")).toBe("deny")
  })

  test("a subagent launches no one", () => {
    expect(decide(v2Permissions(role("guild-explorer").permissions), "subagent", "guild-implementer")).toBe(
      "deny",
    )
  })

  test("the architect writes Markdown, not code", () => {
    const rules = v2Permissions(role("guild-architect").permissions)
    expect(decide(rules, "edit", "docs/adr/0010-x.md")).toBe("allow")
    expect(decide(rules, "edit", "src/index.ts")).toBe("deny")
  })
})

describe("injectV1", () => {
  test("adds all nine agents, one primary, and never a default agent", () => {
    const cfg: Record<string, unknown> & { agent?: Record<string, unknown> } = {}
    injectV1(cfg, {})
    expect(Object.keys(cfg.agent!).sort()).toEqual(ROLES.map((r) => r.id).sort())
    const primaries = Object.entries(cfg.agent!).filter(([, a]) => (a as { mode: string }).mode === "primary")
    expect(primaries.map(([id]) => id)).toEqual(["guild-master"])
    expect(cfg.default_agent).toBeUndefined()
    expect(Object.keys(cfg)).toEqual(["agent"])
  })

  test("carries the prompt and leaves the model unset, so the user's model is inherited", () => {
    const cfg: { agent?: Record<string, Record<string, unknown>> } = {}
    injectV1(cfg, {})
    const explorer = cfg.agent!["guild-explorer"]!
    expect(explorer.prompt).toBe(role("guild-explorer").prompt)
    expect("model" in explorer).toBe(false)
  })

  test("the user's own entry wins, field by field, and their other agents are untouched", () => {
    const mine = { description: "MINE", model: "a/b" }
    const cfg = { agent: { "guild-explorer": mine, build: { model: "x/y" } } as Record<string, unknown> }
    injectV1(cfg, {})
    const explorer = cfg.agent["guild-explorer"] as Record<string, unknown>
    expect(explorer.description).toBe("MINE")
    expect(explorer.model).toBe("a/b")
    expect(explorer.prompt).toBe(role("guild-explorer").prompt)
    expect(cfg.agent.build).toEqual({ model: "x/y" })
  })

  test("the user's disable stays", () => {
    const cfg = { agent: { "guild-designer": { disable: true } } as Record<string, unknown> }
    injectV1(cfg, {})
    expect((cfg.agent["guild-designer"] as { disable: boolean }).disable).toBe(true)
  })

  test("agents: false adds nothing", () => {
    const cfg: { agent?: Record<string, unknown> } = {}
    injectV1(cfg, { agents: false })
    expect(cfg.agent).toBeUndefined()
  })

  test("models map tiers and ids; an id beats its tier", () => {
    const cfg: { agent?: Record<string, Record<string, unknown>> } = {}
    injectV1(cfg, { models: { fast: "p/fast", strong: "p/strong", "guild-librarian": "q/lib" } })
    expect(cfg.agent!["guild-explorer"]!.model).toBe("p/fast")
    expect(cfg.agent!["guild-librarian"]!.model).toBe("q/lib")
    expect(cfg.agent!["guild-master"]!.model).toBe("p/strong")
    expect("model" in cfg.agent!["guild-implementer"]!).toBe(false)
  })
})

describe("injectV2", () => {
  test("creates all nine agents with their prompt as system", () => {
    const host = v2Host()
    injectV2(host.domain, {})
    expect([...host.agents.keys()].sort()).toEqual(ROLES.map((r) => r.id).sort())
    const master = host.agents.get("guild-master")!
    expect(master.system).toBe(role("guild-master").prompt)
    expect(master.mode).toBe("primary")
    expect(host.agents.get("guild-verifier")!.mode).toBe("subagent")
    expect(master.model).toBeUndefined()
  })

  test("ours go after v2's defaults and shut them with a deny-all; a second run does not stack rules", () => {
    const host = v2Host()
    injectV2(host.domain, {})
    const once = host.agents.get("guild-explorer")!.permissions.length
    injectV2(host.domain, {})
    const rules = host.agents.get("guild-explorer")!.permissions
    expect(rules).toHaveLength(once)
    expect(rules[0]).toEqual({ action: "*", resource: "*", effect: "allow" })
    expect(rules.findIndex((rule) => rule.action === "*" && rule.effect === "deny")).toBe(1)
    expect(decide(rules, "edit", "a.ts")).toBe("deny")
    expect(decide(rules, "external_directory", "/tmp/*")).toBe("ask")
  })

  test("models split into provider and model id at the first slash", () => {
    const host = v2Host()
    injectV2(host.domain, { models: { "guild-explorer": "openrouter/deepseek/deepseek-v4" } })
    expect(host.agents.get("guild-explorer")!.model).toEqual({
      providerID: "openrouter",
      id: "deepseek/deepseek-v4",
    })
  })

  test("agents: false registers no transform", () => {
    let called = false
    injectV2({ transform: () => (called = true) }, { agents: false })
    expect(called).toBe(false)
  })
})

describe("readOptions", () => {
  test("no options, or not an object, means defaults", () => {
    expect(readOptions(undefined, () => {})).toEqual({})
    expect(readOptions("x", () => {})).toEqual({})
  })

  test("keeps valid models, logs and drops the rest", () => {
    const logged: string[] = []
    const options = readOptions(
      { agents: true, models: { fast: "a/b", "guild-nobody": "a/b", strong: "no-slash" } },
      (line) => logged.push(line),
    )
    expect(options).toEqual({ models: { fast: "a/b" } })
    expect(logged).toHaveLength(2)
  })

  test("agents: false is read", () => {
    expect(readOptions({ agents: false }, () => {}).agents).toBe(false)
  })
})
