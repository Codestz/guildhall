// V1's model-level deed tests (main:packages/core/test/{craft,exit}.test.ts), through the sim's model.
import { describe, expect, test } from "bun:test"
import { adaptV1, adaptV2, type Change, failedDeed } from "@guildhall/core"
import { RED, SESSION, v1Shell, v2Shell } from "../../core/test/events/shells.ts"
import { activityOf, apply, applyAll, type Entry, emptyModel } from "../src/index.ts"

describe("a deed's declared craft", () => {
  test("the model keeps it, and the activity reads it", () => {
    const model = emptyModel()
    apply(model, { type: "session", id: "s", at: 1 })
    apply(model, { type: "tool", id: "s", call: "c", name: "kubectl", craft: "run", state: "running", at: 2 })
    const s = model.sessions.get("s")
    expect(s?.entries[0]).toMatchObject({ kind: "tool", craft: "run" })
    expect(s && activityOf(s)).toMatchObject({ kind: "tool", tool: "kubectl", craft: "run" })
  })
})

function call(version: 1 | 2, command: string, exit: number, output = ""): Extract<Entry, { kind: "tool" }> {
  const unknown: string[] = []
  const translate = version === 1 ? adaptV1((what) => unknown.push(what)) : adaptV2((w) => unknown.push(w))
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
  describe(`OpenCode ${version}: a shell command's exit code, in the model`, () => {
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

describe("a run that ends settles what it left running", () => {
  test("a call still running when its session goes idle is failed as stopped", () => {
    const model = applyAll(emptyModel(), [
      { type: "status", id: "s", status: "busy", at: 1 },
      { type: "tool", id: "s", call: "c", name: "bash", state: "running", at: 2 },
      { type: "status", id: "s", status: "idle", at: 3 },
    ])
    const entry = model.sessions.get("s")?.entries[0]
    expect(entry).toMatchObject({ kind: "tool", state: "failed", error: "stopped", ended: 3 })
  })
})
