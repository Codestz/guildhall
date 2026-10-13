import { describe, expect, test } from "bun:test"
import {
  CRAFTS,
  commandGist,
  craftOf,
  declaredCraft,
  deedCraft,
  isCraft,
  plainPattern,
} from "../../src/index.ts"

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

  test("a shell call an older adapter declared a plain run: its command says more", () => {
    expect(deedCraft({ name: "Bash", craft: "run", input: { command: 'grep -rn "x" src' } })).toBe("search")
    expect(deedCraft({ name: "Bash", craft: "run", input: { command: "git status" } })).toBe("run")
  })
})

describe("commandGist: a shell command told as a deed, never as its raw line", () => {
  test("the live hall's caption: a grep with escapes searches the code for its plain term", () => {
    expect(commandGist('grep -rn "yardThemes\\|yards\\.set\\|castleYard" packages/world/src')).toEqual({
      craft: "search",
      target: "yardThemes",
    })
  })

  test("searches, reads, edits, tests, lints and runs", () => {
    const cases: [string, ReturnType<typeof commandGist>][] = [
      ["rg -n 'fetch\\(' apps", { craft: "search", target: "fetch" }],
      ["grep -A 3 -e tokenize src/a.ts", { craft: "search", target: "tokenize" }],
      [
        'cd packages/world && grep -rn "\\b(requireSession|x)\\b" .',
        { craft: "search", target: "requireSession" },
      ],
      ["find . -name '*.test.ts'", { craft: "search", target: ".test.ts" }],
      ["ls packages/sim/src", { craft: "search", target: "src" }],
      ["sed -n 1,80p packages/world/src/hex/life.ts", { craft: "read", target: "life.ts" }],
      ["cat apps/studio/src/hexworld/places.ts | head -40", { craft: "read", target: "places.ts" }],
      ["sed -i '' 's/a/b/' src/x.ts", { craft: "edit", target: "x.ts" }],
      ["bun test packages/sim", { craft: "test" }],
      ["bun run typecheck", { craft: "lint", target: "bun run typecheck" }],
      ["git status --short", { craft: "run", target: "git status" }],
      ['git commit -am "fix(search): emoji"', { craft: "run", target: "git commit" }],
      ["rm -rf .data && bun run db:reset", { craft: "run", target: "bun run db:reset" }],
      ["FOO=1 timeout 30 bun install", { craft: "run", target: "bun install" }],
      ["", { craft: "run" }],
    ]
    for (const [command, gist] of cases)
      expect({ command, gist: commandGist(command) }).toEqual({ command, gist })
  })

  test("a pattern that is all regex has no plain term", () => {
    expect(plainPattern("\\d+\\s*$")).toBeUndefined()
    expect(plainPattern("^import")).toBe("import")
    expect(plainPattern("api\\.put\\(")).toBe("api.put")
  })
})
