// from opencode-cockpit: packages/subagents/test/model.test.ts (ADR 0001)
import { describe, expect, test } from "bun:test"
import { createV1Translator } from "../src/adapt/v1.ts"
import { createV2Translator } from "../src/adapt/v2.ts"
import type { Change } from "../src/model/changes.ts"
import {
  activityOf,
  applyAll,
  type Entry,
  emptyModel,
  type Model,
  subagentsOf,
  toolTarget,
} from "../src/model/model.ts"
import { recorded } from "./fixtures.ts"

/**
 * The model against what OpenCode really sends: a main agent that launched one `explore` subagent to
 * read two files and grep for a name, recorded on 1.18.32 and 2.0.15. Both versions must come out as
 * the same subagent — that is the whole point of translating them into one vocabulary.
 */

const tools = (entries: readonly Entry[]) =>
  entries.filter((entry): entry is Extract<Entry, { kind: "tool" }> => entry.kind === "tool")

async function live(version: 1 | 2) {
  const { events, history } = await recorded(version)
  const unknown: string[] = []
  const note = (what: string, detail?: Record<string, unknown>) =>
    unknown.push(`${what} ${JSON.stringify(detail)}`)
  const translate = version === 1 ? createV1Translator(note) : createV2Translator(note)
  const changes: Change[] = events.flatMap((line) => translate.event(line.event, line.at))
  return { model: applyAll(emptyModel(), changes), unknown, parent: history.parent as string }
}

function onlySubagent(model: Model, parent: string) {
  const nodes = subagentsOf(model, parent)
  expect(nodes).toHaveLength(1)
  return nodes[0]?.session as NonNullable<(typeof nodes)[number]>["session"]
}

for (const version of [1, 2] as const) {
  describe(`OpenCode ${version}, live events`, () => {
    test("every event it sent is understood", async () => {
      const { unknown } = await live(version)
      expect(unknown).toEqual([])
    })

    test("the subagent hangs under the conversation that launched it, with its agent and task", async () => {
      const { model, parent } = await live(version)
      const sub = onlySubagent(model, parent)
      expect(sub.agent).toBe("explore")
      expect(sub.title.length).toBeGreaterThan(0)
      expect(sub.title).not.toContain("@explore")
      expect(sub.task).toMatch(/session/i)
      expect(sub.task).not.toStartWith("You are a subagent")
    })

    test("its tool calls, each with what it was about, all finished", async () => {
      const { model, parent } = await live(version)
      const calls = tools(onlySubagent(model, parent).entries)
      expect(calls.map((call) => call.name)).toEqual(expect.arrayContaining(["read", "grep"]))
      for (const call of calls) {
        expect(call.state).toBe("completed")
        expect(toolTarget(call.name, call.input).length).toBeGreaterThan(0)
        expect(call.ended).toBeGreaterThanOrEqual(call.at)
      }
      const read = calls.find((call) => call.name === "read")
      expect(toolTarget("read", read?.input ?? {})).toMatch(/src\/(session|middleware)\.ts/)
    })

    test("its thinking and its answer, streamed into whole text", async () => {
      const { model, parent } = await live(version)
      const entries = onlySubagent(model, parent).entries
      const thinking = entries.filter((entry) => entry.kind === "thinking")
      const reply = entries.filter(
        (entry): entry is Extract<Entry, { kind: "reply" }> => entry.kind === "reply",
      )
      expect(thinking.length).toBeGreaterThan(0)
      expect(reply.at(-1)?.text).toMatch(/createSession/)
      expect(reply.at(-1)?.done).toBe(true)
    })

    test("finished, with its usage", async () => {
      const { model, parent } = await live(version)
      const sub = onlySubagent(model, parent)
      expect(sub.status).toBe("done")
      expect(sub.tokens).toBeGreaterThan(0)
      expect(activityOf(sub).kind).toBe("done")
    })
  })
}

describe("a subagent that existed before Cockpit started", () => {
  /** Reopening a conversation: the same subagent, from stored messages instead of events. */
  test("OpenCode 1: children and stored messages give the same run", async () => {
    const { history } = await recorded(1)
    const translate = createV1Translator()
    const children = history.children as unknown[]
    const changes = [
      ...children.flatMap((info) => translate.session(info)),
      ...translate.history(history.messages as { info: unknown; parts: unknown[] }[]),
      { type: "status", id: history.child as string, status: "idle", at: Date.now() } satisfies Change,
    ]
    const model = applyAll(emptyModel(), changes)
    const sub = onlySubagent(model, history.parent as string)
    expect(sub.agent).toBe("explore")
    expect(sub.task).toMatch(/session/i)
    expect(tools(sub.entries).map((call) => call.name)).toEqual(expect.arrayContaining(["read", "grep"]))
    expect(sub.entries.some((entry) => entry.kind === "reply" && /createSession/.test(entry.text))).toBe(true)
    expect(sub.status).toBe("done")
  })

  test("OpenCode 2: the session list and loaded messages give the same run", async () => {
    const { history } = await recorded(2)
    const translate = createV2Translator()
    const child = history.child as string
    const changes = [
      ...(history.sessions as unknown[]).flatMap((info) => translate.session(info)),
      ...translate.history(child, history.messages as unknown[]),
      ...translate.status(child, history.status),
    ]
    const model = applyAll(emptyModel(), changes)
    const sub = onlySubagent(model, history.parent as string)
    expect(sub.agent).toBe("explore")
    expect(sub.task).toMatch(/session/i)
    expect(sub.task).not.toStartWith("You are a subagent")
    const calls = tools(sub.entries)
    expect(calls.map((call) => call.name)).toEqual(expect.arrayContaining(["read"]))
    expect(calls.every((call) => call.state === "completed" && call.ended !== undefined)).toBe(true)
    expect(sub.tokens).toBeGreaterThan(0)
    expect(sub.status).toBe("done")
  })
})

describe("what a subagent is doing now", () => {
  const at = 1_000
  const running = (entries: Change[]) =>
    applyAll(emptyModel(), [
      { type: "session", id: "c", parentID: "p", agent: "explore", at },
      { type: "status", id: "c", status: "busy", at },
      ...entries,
    ]).sessions.get("c")

  test("the call it is in the middle of, and what it is about", () => {
    const sub = running([
      {
        type: "tool",
        id: "c",
        call: "1",
        name: "grep",
        state: "running",
        input: { pattern: "session", include: "src/**" },
        at,
      },
    ])
    const activity = activityOf(sub as NonNullable<typeof sub>)
    expect(activity).toMatchObject({ kind: "tool", tool: "grep", text: '"session" src/**' })
  })

  test("thinking, then writing its answer", () => {
    const thinking = running([{ type: "thinking", id: "c", key: "r", delta: "hmm", at }])
    expect(activityOf(thinking as NonNullable<typeof thinking>).kind).toBe("thinking")
    const writing = running([{ type: "reply", id: "c", key: "t", delta: "The answer", at }])
    expect(activityOf(writing as NonNullable<typeof writing>).kind).toBe("writing")
  })

  test("held on a permission, then working again", () => {
    const waiting = running([{ type: "status", id: "c", status: "waiting", at }])
    expect(activityOf(waiting as NonNullable<typeof waiting>).kind).toBe("waiting")
  })

  test("a nested subagent sits under the one that launched it", () => {
    const model = applyAll(emptyModel(), [
      { type: "session", id: "a", parentID: "root", at: 1 },
      { type: "session", id: "b", parentID: "a", at: 2 },
      { type: "session", id: "c", parentID: "root", at: 3 },
    ])
    expect(subagentsOf(model, "root").map((node) => [node.session.id, node.depth])).toEqual([
      ["a", 0],
      ["b", 1],
      ["c", 0],
    ])
  })
})

describe("v2 pleas (measured on 2.0.18)", () => {
  test("permission.asked holds the session, permission.replied lets it go", () => {
    const translate = createV2Translator()
    const asked = translate.event(
      {
        type: "permission.asked",
        data: { id: "per_1", sessionID: "ses_9", action: "shell", resources: ["ls"] },
      },
      10,
    )
    const replied = translate.event(
      { type: "permission.replied", data: { sessionID: "ses_9", reply: "once" } },
      20,
    )
    expect(asked).toEqual([{ type: "status", id: "ses_9", status: "waiting", at: 10 }])
    expect(replied).toEqual([{ type: "status", id: "ses_9", status: "busy", at: 20 }])
  })
})

describe("a session's archetype", () => {
  test("is kept when the source sends one, and a later session change without it keeps it", () => {
    const model = applyAll(emptyModel(), [
      { type: "session", id: "b", agent: "ci", archetype: "automaton", at: 1 },
      { type: "session", id: "b", title: "Nightly build", at: 2 },
    ])
    expect(model.sessions.get("b")?.archetype).toBe("automaton")
  })

  test("is absent when the source never says", () => {
    const model = applyAll(emptyModel(), [{ type: "session", id: "a", agent: "general", at: 1 }])
    expect(model.sessions.get("a")?.archetype).toBeUndefined()
  })
})
