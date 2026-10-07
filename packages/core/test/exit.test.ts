import { describe, expect, test } from "bun:test"
import { createV1Translator } from "../src/adapt/v1.ts"
import { createV2Translator } from "../src/adapt/v2.ts"
import type { Change } from "../src/model/changes.ts"
import { applyAll, type Entry, emptyModel } from "../src/model/model.ts"
import { failedDeed, isCheck } from "../src/model/outcome.ts"

/**
 * A shell command that exits non-zero, as each OpenCode really sends it: a *completed* call with the
 * exit code beside it, never a failed one. Shapes copied from the recorded runs
 * (~/.cache/guildhall/chronicles: v1 1.18 `bash` parts, v2 2.0 `shell` calls), command and code
 * changed. Exit codes live at v1 `part.state.metadata.exit`, v2 `session.tool.success`
 * `data.metadata.exit` (and a stored v2 message's `state.metadata.exit`).
 */

const SESSION = "ses_eec6824d2ffeSjf3oI8DVxBwEj"

/** v1: the bash part as it runs, then as it completes with `metadata.exit`. */
function v1Shell(command: string, exit: number, output: string): unknown[] {
  const part = (state: Record<string, unknown>) => ({
    type: "message.part.updated",
    properties: {
      part: {
        type: "tool",
        tool: "bash",
        callID: "call_01a11397f789729f8d3e0f77",
        state,
        id: "prt_11397f206001JqHOBQBLWJOOfx",
        sessionID: SESSION,
        messageID: "msg_11397db40001GZHJWDx0JsV0Ss",
      },
    },
  })
  return [
    part({ status: "running", input: { command }, metadata: { output: "" }, time: { start: 1000 } }),
    part({
      status: "completed",
      input: { command },
      output,
      metadata: { output, exit, truncated: false },
      title: command,
      time: { start: 1000, end: 1500 },
    }),
  ]
}

/** v2: the shell call named, called with its input, then succeeding with `metadata.exit`. */
function v2Shell(command: string, exit: number, output: string): unknown[] {
  const data = { sessionID: SESSION, assistantMessageID: "msg_10f57f2b8001kb49anVrZKMVps" }
  const id = "call_RrEVPZ9GvujHADYniHnUoOaU"
  return [
    { type: "session.tool.input.started", data: { ...data, id, name: "shell" } },
    { type: "session.tool.called", data: { ...data, id, input: { command }, executed: false } },
    {
      type: "session.tool.success",
      data: {
        ...data,
        id,
        content: [{ type: "text", text: output }],
        metadata: { status: "completed", truncated: false, exit },
        executed: false,
      },
    },
  ]
}

const RED = "bun test v1.3.13\n\n 41 pass\n 3 fail\nRan 44 tests across 6 files.\n"

function call(version: 1 | 2, command: string, exit: number, output = ""): Extract<Entry, { kind: "tool" }> {
  const unknown: string[] = []
  const translate =
    version === 1
      ? createV1Translator((what) => unknown.push(what))
      : createV2Translator((w) => unknown.push(w))
  const events = version === 1 ? v1Shell(command, exit, output) : v2Shell(command, exit, output)
  const changes: Change[] = events.flatMap((event, n) => translate.event(event, 1000 + n * 250))
  expect(unknown).toEqual([])
  const entry = applyAll(emptyModel(), changes)
    .sessions.get(SESSION)
    ?.entries.find((e) => e.kind === "tool")
  if (entry?.kind !== "tool") throw new Error("no tool call")
  return entry
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
    const changes = createV2Translator().history(SESSION, [
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
    const entry = applyAll(emptyModel(), changes)
      .sessions.get(SESSION)
      ?.entries.find((e) => e.kind === "tool")
    expect(entry).toMatchObject({ state: "completed", exit: 2, summary: "exit 2" })
    expect(failedDeed(entry as Extract<Entry, { kind: "tool" }>)).toBe(true)
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
