import { describe, expect, test } from "bun:test"
import { adaptV1, adaptV2, type Change, type Deed, failedDeed, isCheck } from "../../src/index.ts"
import { RED, SESSION, v1Shell, v2Shell } from "./shells.ts"

/**
 * A tool call as its changes leave it: each later change fills in what the earlier ones did not say.
 * The exit code as the translators carry it; the sim's tests take the same calls through the model.
 */
type Call = Deed & { summary?: string }

function folded(changes: readonly Change[]): Call {
  const call: Call = { state: "pending", input: {} }
  for (const change of changes) {
    if (change.type !== "tool") continue
    if (change.state) call.state = change.state
    if (change.input && Object.keys(change.input).length > 0) call.input = change.input
    if (change.exit !== undefined) call.exit = change.exit
    if (change.summary) call.summary = change.summary
  }
  return call
}

function call(version: 1 | 2, command: string, exit: number, output = ""): Call {
  const unknown: string[] = []
  const translate = version === 1 ? adaptV1((what) => unknown.push(what)) : adaptV2((w) => unknown.push(w))
  const events = version === 1 ? v1Shell(command, exit, output) : v2Shell(command, exit, output)
  const changes: Change[] = events.flatMap((event, n) => translate.event(event, 1000 + n * 250))
  expect(unknown).toEqual([])
  return folded(changes)
}

for (const version of [1, 2] as const) {
  describe(`OpenCode ${version}: a shell command's exit code`, () => {
    test("a red `bun test` is a completed call with exit 1, and a failed deed", () => {
      const entry = call(version, "bun test", 1, RED)
      expect(entry.state).toBe("completed")
      expect(entry.exit).toBe(1)
      expect(entry.summary).toBe("exit 1")
      expect(failedDeed(entry)).toBe(true)
    })

    test("`grep` finding nothing (exit 1) is completed and not a failure", () => {
      const entry = call(version, "grep -rn createSession src", 1)
      expect(entry.state).toBe("completed")
      expect(entry.exit).toBe(1)
      expect(failedDeed(entry)).toBe(false)
    })

    test("a green `bun test` (exit 0) is not a failure", () => {
      const entry = call(version, "bun test", 0, "44 pass\n 0 fail\n")
      expect(entry.exit).toBe(0)
      expect(entry.summary).toBeUndefined()
      expect(failedDeed(entry)).toBe(false)
    })
  })
}

describe("OpenCode 2: a stored shell call keeps its exit code", () => {
  test("history reads `state.metadata.exit`", () => {
    const changes = adaptV2().history(SESSION, [
      {
        id: "msg_1",
        type: "assistant",
        time: { created: 1000 },
        content: [
          {
            type: "tool",
            id: "call_1",
            name: "shell",
            time: { created: 1000, ran: 1000, completed: 1500 },
            state: {
              status: "completed",
              input: { command: "bunx tsc -b" },
              content: [{ type: "text", text: "error TS2322" }],
              metadata: { exit: 2 },
            },
          },
        ],
      },
    ])
    const entry = folded(changes)
    expect(entry).toMatchObject({ state: "completed", exit: 2, summary: "exit 2" })
    expect(failedDeed(entry)).toBe(true)
  })
})

describe("failedDeed: which non-zero exits are failures", () => {
  const deed = (command: string, exit: number) => failedDeed({ state: "completed", input: { command }, exit })

  test("a tool error is always a failure, exit or not", () => {
    expect(failedDeed({ state: "failed", input: { command: "ls" } })).toBe(true)
    expect(failedDeed({ state: "failed", input: { filePath: "a.ts" } })).toBe(true)
  })

  test("checks that exit non-zero are failures", () => {
    for (const command of [
      "bun test",
      "bun test packages/hall/test/saga.test.ts",
      "bun run typecheck",
      "bun run lint",
      "bunx tsc -b",
      "bunx biome check .",
      "npm test",
      "npm run test:unit",
      "pnpm lint",
      "yarn typecheck",
      "CI=1 npx --yes vitest run",
      "cd packages/core && bun test",
      "bun test 2>&1",
      "./node_modules/.bin/tsc --noEmit",
      "uv run pytest -q",
      "python -m mypy .",
      "ruff check .",
      "cargo test",
      "go test ./...",
      "make test",
    ])
      expect({ command, failed: deed(command, 1) }).toEqual({ command, failed: true })
  })

  test("other commands' non-zero exits are answers, not failures", () => {
    for (const command of [
      "grep -rn foo src",
      "rg TODO",
      "diff a.txt b.txt",
      "test -f package.json",
      "[ -d dist ]",
      "git diff --exit-code",
      "ls missing",
      "bun run build",
      "bun install",
      "cat test.txt",
      "grep -n test src/app.ts",
    ])
      expect({ command, failed: deed(command, 1) }).toEqual({ command, failed: false })
  })

  test("the command that decides the exit status is the one judged", () => {
    // `tail` decides a pipeline's status; `echo` a list's.
    expect(deed("bun test 2>&1 | tail -20", 1)).toBe(false)
    expect(deed("bun test; echo done", 1)).toBe(false)
    expect(deed("bun test || true", 1)).toBe(false)
    expect(deed("grep -q x a.ts && bun test", 1)).toBe(true)
    expect(deed('echo "a | b; c" && bun run lint', 1)).toBe(true)
  })

  test("exit 0, a missing exit, or a call still running is never a failure", () => {
    expect(deed("bun test", 0)).toBe(false)
    expect(failedDeed({ state: "completed", input: { command: "bun test" } })).toBe(false)
    expect(failedDeed({ state: "running", input: { command: "bun test" }, exit: 1 })).toBe(false)
  })

  test("isCheck reads the program, not words that look like it", () => {
    expect(isCheck("bun test")).toBe(true)
    expect(isCheck("echo test")).toBe(false)
    expect(isCheck("bun run build")).toBe(false)
    expect(isCheck("pnpm run lint-staged")).toBe(false)
  })
})
