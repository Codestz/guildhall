import { describe, expect, test } from "bun:test"
import {
  activityOf,
  apply,
  CRAFTS,
  craftOf,
  declaredCraft,
  deedCraft,
  emptyModel,
  isCraft,
} from "../src/index.ts"

describe("craftOf: one meaning for every host's tool names", () => {
  test("OpenCode 1 and 2 spellings of the same deed are one craft", () => {
    expect(craftOf("shell")).toBe(craftOf("bash"))
    expect(craftOf("subagent")).toBe(craftOf("task"))
    expect(craftOf("list")).toBe(craftOf("glob"))
    expect(craftOf("patch")).toBe(craftOf("edit"))
  })

  test("Claude Code's tool names, in any case", () => {
    const names: [string, string][] = [
      ["Read", "read"],
      ["Grep", "search"],
      ["Glob", "search"],
      ["LS", "search"],
      ["Edit", "edit"],
      ["MultiEdit", "edit"],
      ["NotebookEdit", "edit"],
      ["Write", "write"],
      ["Bash", "run"],
      ["PowerShell", "run"],
      ["WebFetch", "fetch"],
      ["WebSearch", "fetch"],
      ["TodoWrite", "plan"],
      ["ExitPlanMode", "plan"],
      ["Agent", "delegate"],
      ["Task", "delegate"],
    ]
    for (const [tool, craft] of names) expect([tool, craftOf(tool)]).toEqual([tool, craft])
  })

  test("a shell command that runs tests is a test; a lint or typecheck is a lint; else a run", () => {
    expect(craftOf("bash", { command: "bun test users" })).toBe("test")
    expect(craftOf("bash", { command: "bunx biome check ." })).toBe("test")
    expect(craftOf("bash", { command: "git bisect skip && git bisect run bun test src/a.test.ts" })).toBe(
      "test",
    )
    expect(craftOf("shell", { command: "bun run typecheck" })).toBe("lint")
    expect(craftOf("bash", { command: "bun run lint" })).toBe("lint")
    expect(craftOf("bash", { command: "gh pr checks 418" })).toBe("run")
    expect(craftOf("bash", { command: "git status" })).toBe("run")
    expect(craftOf("bash")).toBe("run")
  })

  test("an unknown tool with `_` is an MCP tool; anything else unknown is other", () => {
    expect(craftOf("context7_query-docs")).toBe("consult")
    expect(craftOf("mcp__memory__read_graph")).toBe("consult")
    expect(craftOf("apply_patch")).toBe("edit")
    expect(craftOf("frobnicate")).toBe("other")
    expect(craftOf("")).toBe("other")
  })

  test("every craft it returns is one of the set", () => {
    for (const tool of ["read", "bash", "task", "x_y", "zzz"]) expect(isCraft(craftOf(tool))).toBe(true)
    expect(new Set(CRAFTS).size).toBe(CRAFTS.length)
  })
})

describe("declaredCraft: what an adapter may send", () => {
  test("a shell call says nothing until its command is known", () => {
    expect(declaredCraft("bash")).toBeUndefined()
    expect(declaredCraft("bash", {})).toBeUndefined()
    expect(declaredCraft("bash", { command: "bun test" })).toBe("test")
  })

  test("any other deed is settled by its name", () => {
    expect(declaredCraft("read")).toBe("read")
    expect(declaredCraft("task")).toBe("delegate")
  })
})

describe("deedCraft: a declared craft wins when it is one the hall knows", () => {
  test("declared", () => {
    expect(deedCraft({ name: "deploy_service", craft: "run" })).toBe("run")
  })

  test("unknown or absent: read off the name", () => {
    expect(deedCraft({ name: "read", craft: "a-craft-from-a-newer-hall" })).toBe("read")
    expect(deedCraft({ name: "bash", input: { command: "bun test" } })).toBe("test")
  })

  test("the model keeps a deed's declared craft, and the activity reads it", () => {
    const model = emptyModel()
    apply(model, { type: "session", id: "s", at: 1 })
    apply(model, { type: "tool", id: "s", call: "c", name: "kubectl", craft: "run", state: "running", at: 2 })
    const s = model.sessions.get("s")
    expect(s?.entries[0]).toMatchObject({ kind: "tool", craft: "run" })
    expect(s && activityOf(s)).toMatchObject({ kind: "tool", tool: "kubectl", craft: "run" })
  })
})
