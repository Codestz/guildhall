import { describe, expect, test } from "bun:test"
import { ROLES } from "@guildhall/roster"
import { injectV1, type V1Rules, type V2Agent, v1Permission, v2Agent } from "../src/agents.ts"
import { type Effect, evaluate, fromV1, type Rule, shell, V1_BASE, V2_BASE } from "./support/opencode.ts"
import { ATTACKS, CHECK_LINES } from "./support/shell-cases.ts"

/**
 * The guild's permissions as OpenCode itself resolves them (docs/reviews/review-2.md, findings 1–4
 * and 7): the herald's real output, merged over each version's own defaults, run through a port of
 * OpenCode's matcher (./support/opencode.ts, 1.18.32 and 2.0.18).
 */

const role = (id: string) => ROLES.find((r) => r.id === id)!

/** OpenCode 1: its defaults, then the agent's `permission` object as the herald writes it. */
function v1Rules(
  id: string,
  permission: Record<string, V1Rules> = v1Permission(role(id).permissions),
): Rule[] {
  return [...V1_BASE, ...fromV1(permission)]
}

/** OpenCode 2: the default agent, edited by the herald's transform. */
function v2Rules(id: string): Rule[] {
  const agent: V2Agent = { mode: "primary", permissions: [...V2_BASE] }
  v2Agent(agent, role(id))
  return agent.permissions
}

const VERSIONS = [
  { name: "OpenCode 1", rules: v1Rules, shell: "bash", dispatch: "task" },
  { name: "OpenCode 2", rules: (id: string) => v2Rules(id), shell: "shell", dispatch: "subagent" },
] as const

const BUILDERS = ["guild-implementer", "guild-designer"]
const NO_SHELL = [
  "guild-architect",
  "guild-product-owner",
  "guild-explorer",
  "guild-librarian",
  "guild-researcher",
]
const WRITERS = ROLES.filter((r) => r.permissions.edit !== "deny").map((r) => r.id)

/** Paths OpenCode (or another agent harness) loads as instructions, agents, commands, skills or config. */
const PROTECTED_PATHS = [
  ".opencode/agents/guild-verifier.md",
  ".opencode/agent/guild-master.md",
  ".opencode/command/ship.md",
  ".opencode/skill/x/SKILL.md",
  ".opencode/plugin/evil.ts",
  ".opencode/opencode.jsonc",
  "packages/hall/.opencode/agents/x.md",
  "../../.opencode/agents/x.md",
  "/Users/v/.config/opencode/agent/x.md",
  "/Users/v/.config/opencode/opencode.json",
  "opencode.json",
  "opencode.jsonc",
  "packages/x/opencode.json",
  "AGENTS.md",
  "packages/hall/AGENTS.md",
  "../../AGENTS.md",
  "CLAUDE.md",
  "docs/CLAUDE.md",
  ".claude/agents/x.md",
  ".claude/settings.json",
  ".agents/skills/x/SKILL.md",
  "agents/reviewer.md",
  "plugin/agents/verifier.md",
  "docs/agents/x.md",
  "commands/ship.md",
  "plugin/commands/ship.md",
  "skills/x/SKILL.md",
  "skills/x/scripts/run.sh",
  "plugin/skills/x/SKILL.md",
  ".git/hooks/pre-commit",
  ".git/config",
]

/** Table rows: `[input, effect]`, so a failure names the line that broke. */
function table(inputs: readonly string[], decide: (input: string) => Effect): [string, Effect][] {
  return inputs.map((input) => [input, decide(input)])
}
const all = (inputs: readonly string[], effect: Effect) =>
  inputs.map((input): [string, Effect] => [input, effect])

for (const version of VERSIONS) {
  const rules = version.rules
  const run = (id: string) => (line: string) => shell(rules(id), line, version.shell)

  describe(`${version.name}: the shell`, () => {
    test("the verifier is denied every attack line", () => {
      expect(table(ATTACKS, run("guild-verifier"))).toEqual(all(ATTACKS, "deny"))
    })

    test("the implementer and the designer are asked before every attack line, never let through", () => {
      for (const id of BUILDERS) expect(table(ATTACKS, run(id))).toEqual(all(ATTACKS, "ask"))
    })

    test("the verifier and the builders run the project's checks without a prompt", () => {
      for (const id of ["guild-verifier", ...BUILDERS])
        expect(table(CHECK_LINES, run(id))).toEqual(all(CHECK_LINES, "allow"))
    })

    test("roles without a shell run nothing, checks included", () => {
      for (const id of NO_SHELL) expect(table(CHECK_LINES, run(id))).toEqual(all(CHECK_LINES, "deny"))
    })

    test("the Guildmaster is asked for every command", () => {
      expect(table(["bun test", "rm -rf ~"], run("guild-master"))).toEqual(
        all(["bun test", "rm -rf ~"], "ask"),
      )
    })

    test("known gap: a redirect after &&, || or | is invisible to OpenCode (docs/harness.md)", () => {
      // tree-sitter hangs it on the list or pipeline, and OpenCode checks only the commands in it.
      expect(run("guild-verifier")("git status && git diff HEAD > src/index.ts")).toBe("allow")
    })
  })

  describe(`${version.name}: files`, () => {
    test("no role that writes may touch agent, command or skill definitions, instructions or config", () => {
      for (const id of WRITERS) {
        const edit = (path: string) => evaluate(rules(id), "edit", path)
        expect([id, table(PROTECTED_PATHS, edit)]).toEqual([id, all(PROTECTED_PATHS, "deny")])
      }
    })

    test("the architect and the product owner write Markdown under docs/ and nothing else", () => {
      const allowed = [
        "docs/adr/0010-x.md",
        "docs/specs/login.md",
        "packages/hall/docs/x.md",
        "../../docs/plan.md",
      ]
      const denied = ["README.md", "src/index.ts", "docs/x.ts", "notes.md", "src/docs.md", "package.json"]
      for (const id of ["guild-architect", "guild-product-owner"]) {
        const edit = (path: string) => evaluate(rules(id), "edit", path)
        expect(table(allowed, edit)).toEqual(all(allowed, "allow"))
        expect(table(denied, edit)).toEqual(all(denied, "deny"))
      }
    })

    test("the builders edit code, including code under a commands/ or agents/ folder", () => {
      const code = [
        "src/index.ts",
        "src/commands/run.ts",
        "packages/x/agents/pool.ts",
        "README.md",
        "docs/x.md",
      ]
      for (const id of BUILDERS)
        expect(table(code, (path) => evaluate(rules(id), "edit", path))).toEqual(all(code, "allow"))
    })

    test("read-only roles edit nothing", () => {
      for (const id of [
        "guild-master",
        "guild-verifier",
        "guild-explorer",
        "guild-librarian",
        "guild-researcher",
      ])
        expect(evaluate(rules(id), "edit", "docs/x.md")).toBe("deny")
    })
  })

  describe(`${version.name}: tools nobody named`, () => {
    const mcp = [
      "github_create_pull_request",
      "filesystem_write_file",
      "chrome-devtools_click",
      "brand_new_tool",
    ]

    test("every role is denied MCP tools and any tool it isn't given", () => {
      for (const r of ROLES)
        expect([r.id, table(mcp, (tool) => evaluate(rules(r.id), tool, "*"))]).toEqual([
          r.id,
          all(mcp, "deny"),
        ])
    })

    test("every role still reads, globs and greps, and .env still asks", () => {
      for (const r of ROLES) {
        const decide = (action: string, resource: string) => evaluate(rules(r.id), action, resource)
        expect([r.id, decide("read", "src/a.ts"), decide("glob", "*"), decide("grep", "*")]).toEqual([
          r.id,
          "allow",
          "allow",
          "allow",
        ])
        expect([r.id, decide("read", ".env"), decide("read", "x/.env.local")]).toEqual([r.id, "ask", "ask"])
        expect([r.id, decide("external_directory", "/tmp/x/*")]).toEqual([r.id, "ask"])
      }
    })

    test("web access only where the role has it", () => {
      for (const r of ROLES) {
        const web = evaluate(rules(r.id), "webfetch", "https://example.com")
        expect([r.id, web]).toEqual([r.id, r.permissions.web])
      }
    })

    test("only the Guildmaster launches, and only guild agents", () => {
      expect(evaluate(rules("guild-master"), version.dispatch, "guild-explorer")).toBe("allow")
      expect(evaluate(rules("guild-master"), version.dispatch, "general")).toBe("deny")
      expect(evaluate(rules("guild-implementer"), version.dispatch, "guild-explorer")).toBe("deny")
    })
  })
}

describe("OpenCode 1: the user's own permission overrides", () => {
  function merged(theirs: Record<string, unknown>): Record<string, V1Rules> {
    const cfg = { agent: { "guild-verifier": theirs } as Record<string, unknown> }
    injectV1(cfg, {})
    return (cfg.agent["guild-verifier"] as { permission: Record<string, V1Rules> }).permission
  }

  test("overriding one key keeps the guild's rules for every other key", () => {
    const permission = merged({ permission: { webfetch: "allow" } })
    const rules = v1Rules("guild-verifier", permission)
    expect(evaluate(rules, "webfetch", "https://example.com")).toBe("allow")
    expect(shell(rules, "sh -c id", "bash")).toBe("deny")
    expect(evaluate(rules, "edit", "src/index.ts")).toBe("deny")
    expect(evaluate(rules, "github_create_pull_request", "*")).toBe("deny")
  })

  test("the user's value wins for the key they set", () => {
    const rules = v1Rules("guild-verifier", merged({ permission: { bash: "ask" } }))
    expect(shell(rules, "sh -c id", "bash")).toBe("ask")
  })

  test("the user may grant one MCP server to one agent", () => {
    const rules = v1Rules("guild-verifier", merged({ permission: { "github_*": "allow" } }))
    expect(evaluate(rules, "github_create_pull_request", "*")).toBe("allow")
    expect(evaluate(rules, "filesystem_write_file", "*")).toBe("deny")
  })
})
