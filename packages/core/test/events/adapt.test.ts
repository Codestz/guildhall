import { describe, expect, test } from "bun:test"
import {
  adaptV1,
  adaptV2,
  agentOfTitle,
  type Change,
  createdSession,
  endOf,
  type GuildEvent,
  isSeaRecord,
  stripAgentSuffix,
  taskText,
  WIRE_VERSION,
} from "../../src/index.ts"
import { recorded } from "./fixtures.ts"

/**
 * The translators against what OpenCode really sent (V1's model tests, the parts that need no model:
 * the sim's own tests replay the same runs through the model).
 */

async function translated(version: 1 | 2) {
  const { events, history } = await recorded(version)
  const unknown: string[] = []
  const note = (what: string, detail?: Record<string, unknown>) =>
    unknown.push(`${what} ${JSON.stringify(detail)}`)
  const translate = version === 1 ? adaptV1(note) : adaptV2(note)
  const changes: Change[] = events.flatMap((line) => translate.event(line.event, line.at))
  return { changes, unknown, parent: history.parent as string, child: history.child as string }
}

for (const version of [1, 2] as const) {
  describe(`OpenCode ${version}, live events`, () => {
    test("every event it sent is understood", async () => {
      const { unknown } = await translated(version)
      expect(unknown).toEqual([])
    })

    test("the subagent is a session under the conversation that launched it", async () => {
      const { changes, parent, child } = await translated(version)
      const sessions = changes.filter((c): c is Extract<Change, { type: "session" }> => c.type === "session")
      expect(sessions.some((c) => c.id === child && c.parentID === parent)).toBe(true)
      expect(sessions.find((c) => c.id === child && c.agent)?.agent).toBe("explore")
    })

    test("its reads and greps arrive as tool changes that complete", async () => {
      const { changes, child } = await translated(version)
      const tools = changes.filter((c): c is Extract<Change, { type: "tool" }> => c.type === "tool")
      const calls = new Set(tools.filter((c) => c.id === child).map((c) => c.call))
      expect(calls.size).toBeGreaterThan(1)
      for (const call of calls)
        expect(tools.some((c) => c.call === call && c.state === "completed")).toBe(true)
    })
  })
}

describe("v2 pleas (measured on 2.0.18)", () => {
  test("permission.asked holds the session, permission.replied lets it go", () => {
    const translate = adaptV2()
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

describe("the helpers the adapters share", () => {
  test("v1's subagent title suffix names the agent and is stripped from the title", () => {
    expect(agentOfTitle("Map the repo (@general subagent)")).toBe("general")
    expect(stripAgentSuffix("Map the repo (@general subagent)")).toBe("Map the repo")
    expect(agentOfTitle("Plain title")).toBeUndefined()
  })

  test("v2's subagent preamble is not part of the task", () => {
    expect(taskText("You are a subagent spawned by another session.\n\nMap it")).toBe("Map it")
    expect(taskText("  Map it ")).toBe("Map it")
  })

  test("a created session on either OpenCode, and nothing for any other event", () => {
    expect(createdSession({ type: "session.created", properties: { info: { id: "a" } } })).toBe("a")
    expect(createdSession({ name: "session.created", details: { data: { sessionID: "b" } } })).toBe("b")
    expect(createdSession({ type: "session.updated", properties: { info: { id: "a" } } })).toBeUndefined()
  })

  test("a run's end is its latest change or call end", () => {
    const changes: Change[] = [
      { type: "step", id: "s", at: 5 },
      { type: "tool", id: "s", call: "c", ended: 9, at: 7 },
    ]
    expect(endOf(changes, 1)).toBe(9)
    expect(endOf([], 1)).toBe(1)
  })
})

describe("the envelope", () => {
  test("wire v1 carries a change for a guild with its sequence number", () => {
    const event: GuildEvent = {
      v: WIRE_VERSION,
      guild: "guildhall",
      seq: 1,
      change: { type: "step", id: "s", at: 0 },
    }
    expect(event.v).toBe(1)
  })

  test("a sea record is checked for the fields every kind has", () => {
    const event = {
      kind: "push",
      id: "p",
      at: 1,
      repo: "o/r",
      branch: "main",
      commits: 1,
      author: "a",
      sha: "x",
    }
    expect(isSeaRecord({ v: 1, guild: "g", event })).toBe(true)
    expect(isSeaRecord({ v: 1, guild: "g", event: { ...event, kind: "earthquake" } })).toBe(false)
    expect(isSeaRecord({ v: 2, guild: "g", event })).toBe(false)
    expect(isSeaRecord(null)).toBe(false)
  })
})
