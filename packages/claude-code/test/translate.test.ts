import { describe, expect, test } from "bun:test"
import {
  activityOf,
  applyAll,
  type Change,
  type Entry,
  emptyModel,
  failedDeed,
  runTime,
  type Session,
  subagentsOf,
} from "@guildhall/core"
import { castOf } from "@guildhall/roster"
import { actorOf, agentOf, deedName, MAX_OUTPUT, outputOf, translate } from "../src/translate.ts"
import failures from "./fixtures/failures.json"
import session from "./fixtures/session.json"
import subagents from "./fixtures/subagents.json"

const MAIN = "5c0a7b1e-3f2d-4b8e-9a61-0d2c4e8f7a13"

/** Each fixture event translated in order, one ms apart, as the hook would see them. */
function run(events: unknown[], start = 1_000): Change[][] {
  return events.map((event, i) => translate(event, start + i))
}

const tools = (s: Session | undefined) =>
  (s?.entries ?? []).filter((e): e is Extract<Entry, { kind: "tool" }> => e.kind === "tool")

describe("one conversation", () => {
  const changes = run(session.events)
  const model = applyAll(emptyModel(), changes.flat())
  const main = model.sessions.get(MAIN)

  test("starts a session with its model", () => {
    expect(changes[0]).toEqual([{ type: "session", id: MAIN, model: "claude-opus-5", at: 1000 }])
  })

  test("the prompt is its task, and it gets to work", () => {
    expect(changes[1]).toEqual([
      {
        type: "prompt",
        id: MAIN,
        key: "550e8400-e29b-41d4-a716-446655440000",
        text: "Why does the cart total drop the discount?",
        at: 1001,
      },
      { type: "status", id: MAIN, status: "busy", at: 1001 },
    ])
    expect(main?.task).toBe("Why does the cart total drop the discount?")
  })

  test("tools are deeds in the world's spelling", () => {
    expect(tools(main).map((t) => [t.name, t.state])).toEqual([
      ["read", "completed"],
      ["edit", "completed"],
      ["mcp__context7__query-docs", "completed"],
    ])
    expect(tools(main)[1]?.input).toEqual({
      filePath: "/Users/dev/shop/src/cart/total.ts",
      oldString: "return cart.items",
      newString: "return applyDiscount(cart, cart.items",
      replace_all: false,
    })
  })

  test("a deed's output is the result's text", () => {
    expect(tools(main)[0]?.output).toContain("export function total(cart)")
    expect(tools(main)[2]?.output).toContain("Route handlers live in app/**/route.ts")
  })

  test("a deed's start comes from the reported run time", () => {
    const post = changes[3]?.find((c) => c.type === "tool")
    expect(post).toMatchObject({ started: 1003 - 4, ended: 1003 })
  })

  test("stop is loot: the last answer, then done", () => {
    expect(main?.status).toBe("done")
    expect(main?.entries.at(-1)).toMatchObject({
      kind: "reply",
      text: "total() never applied the discount; it does now.",
      done: true,
    })
  })

  test("compaction has nothing to say; the end is idle", () => {
    expect(changes[9]).toEqual([])
    expect(changes[10]).toEqual([{ type: "status", id: MAIN, status: "idle", at: 1010 }])
  })
})

describe("a subagent tree", () => {
  const T0 = 1_760_000_000_000
  const changes = run(subagents.events, T0)
  const model = applyAll(emptyModel(), changes.flat())
  const children = subagentsOf(model, MAIN).map((node) => node.session)
  const explorer = model.sessions.get("b81f0c2d9e4a6713")
  const implementer = model.sessions.get("a4d2c8f1e0b3a297")

  test("each subagent is a session under the conversation, prefixed id or not", () => {
    expect(children.map((s) => s.id).sort()).toEqual(["a4d2c8f1e0b3a297", "b81f0c2d9e4a6713"])
    expect(children.every((s) => s.parentID === MAIN)).toBe(true)
    expect([...model.sessions.keys()]).toHaveLength(3)
  })

  test("a roster name becomes its role; a built-in keeps its name and is drawn as its archetype", () => {
    expect(implementer?.agent).toBe("guild-implementer")
    expect(castOf(implementer?.agent ?? "").archetype.name).toBe("Artisan")
    expect(explorer?.agent).toBe("Explore")
    expect(explorer?.archetype).toBe("scout")
    expect(castOf(explorer?.agent ?? "", explorer?.archetype).archetype.name).toBe("Scout")
  })

  test("the quest names the child: title from its description, task from its prompt", () => {
    expect(implementer?.title).toBe("Implement cursor pagination")
    expect(implementer?.task).toBe("Add an opaque cursor on (created_at, id) to GET /users.")
    expect(explorer?.title).toBe("Map how GET /users flows")
  })

  test("the Agent call is a quest on the guildmaster", () => {
    const quests = tools(model.sessions.get(MAIN)).filter((t) => t.name === "task")
    expect(quests.map((t) => t.input.description)).toEqual([
      "Map how GET /users flows",
      "Implement cursor pagination",
    ])
  })

  test("a subagent's deeds are its own, and it ends with its answer", () => {
    expect(tools(explorer).map((t) => t.name)).toEqual(["grep"])
    expect(tools(implementer).map((t) => [t.name, t.input.filePath])).toEqual([
      ["write", "/Users/dev/shop/src/users/cursor.ts"],
    ])
    expect(implementer?.status).toBe("done")
    expect(implementer?.entries.find((e) => e.kind === "reply")).toMatchObject({
      text: "DONE: cursor pagination on GET /users, tests green.",
    })
  })

  test("a foreground subagent's run is timed from its quest, though its task is told at the end", () => {
    const result = subagents.events.findIndex(
      (e) => e.hook_event_name === "PostToolUse" && e.tool_use_id === "toolu_02Impl",
    )
    const asked = T0 + result - 48300
    expect(implementer?.started).toBe(asked)
    expect(runTime(implementer!, 0)).toBe((implementer?.ended ?? 0) - asked)
  })

  test("Claude Code's own helpers (an empty agent type) never join the party", () => {
    const helper = subagents.events.findIndex((e) => e.agent_id === "c0ffee00c0ffee00")
    expect(changes[helper]).toEqual([])
    expect(model.sessions.has("c0ffee00c0ffee00")).toBe(false)
  })
})

describe("failures and pleas", () => {
  const changes = run(failures.events)
  const after = (n: number) => applyAll(emptyModel(), changes.slice(0, n + 1).flat()).sessions.get(MAIN)
  const deed = (call: string, n = changes.length - 1) => tools(after(n)).find((t) => t.call === call)

  test("a failing check is a completed call with its exit code, and core reads it as failed", () => {
    expect(deed("toolu_03Test")).toMatchObject({ state: "completed", exit: 1, name: "bash" })
    expect(deed("toolu_03Test")?.output).toContain("1 fail")
    expect(failedDeed(deed("toolu_03Test")!)).toBe(true)
  })

  test("grep finding nothing exits 1 but is an answer, not a failure", () => {
    expect(deed("toolu_03Grep")).toMatchObject({ state: "completed", exit: 1 })
    expect(failedDeed(deed("toolu_03Grep")!)).toBe(false)
  })

  test("a tool that errored fails with the error", () => {
    expect(deed("toolu_03Fetch")).toMatchObject({
      state: "failed",
      name: "webfetch",
      error: "Request failed with status code 404",
    })
  })

  test("a permission request is a plea, and so is the permission notification", () => {
    const request = failures.events.findIndex((e) => e.hook_event_name === "PermissionRequest")
    const notice = failures.events.findIndex((e) => e.hook_event_name === "Notification")
    expect(changes[request]).toEqual([{ type: "status", id: MAIN, status: "waiting", at: 1000 + request }])
    expect(changes[notice]).toEqual([{ type: "status", id: MAIN, status: "waiting", at: 1000 + notice }])
    expect(activityOf(after(notice)!).kind).toBe("waiting")
  })

  test("the plea ends when the tool it held runs", () => {
    const ran = failures.events.findIndex(
      (e) => e.tool_use_id === "toolu_03Rm" && e.hook_event_name === "PostToolUse",
    )
    expect(after(ran)?.status).toBe("running")
  })

  test("auto mode's denial fails the deed with its reason", () => {
    expect(deed("toolu_03Curl")).toMatchObject({ state: "failed", error: "[Remote Code Execution]" })
  })

  test("an API error fails the session", () => {
    expect(after(changes.length - 1)).toMatchObject({
      status: "failed",
      error: "API Error: Rate limit reached",
    })
  })

  test("an interrupted tool fails as interrupted", () => {
    const [, tool] = translate(
      {
        hook_event_name: "PostToolUseFailure",
        session_id: MAIN,
        tool_name: "Bash",
        tool_input: { command: "bun test" },
        tool_use_id: "toolu_x",
        error: "Exit code 130",
        is_interrupt: true,
      },
      5,
    )
    expect(tool).toMatchObject({ state: "failed", error: "interrupted" })
  })

  test("other notifications say nothing", () => {
    const idle = { hook_event_name: "Notification", session_id: MAIN, notification_type: "idle_prompt" }
    expect(translate(idle, 1)).toEqual([])
  })
})

describe("what the hook is handed", () => {
  test("anything that isn't a hook payload is nothing", () => {
    for (const payload of [
      null,
      "x",
      1,
      [],
      {},
      { hook_event_name: "Stop" },
      { hook_event_name: "Stop", session_id: "" },
    ])
      expect(translate(payload, 1)).toEqual([])
  })

  test("an event it doesn't know is nothing", () => {
    expect(translate({ hook_event_name: "FileChanged", session_id: MAIN }, 1)).toEqual([])
  })

  test("a tool event without a call id is nothing", () => {
    expect(translate({ hook_event_name: "PreToolUse", session_id: MAIN, tool_name: "Read" }, 1)).toEqual([])
  })

  test("long output is capped", () => {
    expect(outputOf({ stdout: "x".repeat(MAX_OUTPUT * 2), stderr: "" })).toHaveLength(MAX_OUTPUT + 1)
  })
})

describe("names", () => {
  test("agent types that name a roster role, scoped or not", () => {
    expect(agentOf("implementer")).toBe("guild-implementer")
    expect(agentOf("agentry:product-owner")).toBe("guild-product-owner")
    expect(agentOf("guild-verifier")).toBe("guild-verifier")
    expect(agentOf("Architect")).toBe("guild-architect")
  })

  test("agent types that don't are kept as they are", () => {
    expect(agentOf("general-purpose")).toBe("general-purpose")
    expect(agentOf("my-plugin:reviewer")).toBe("my-plugin:reviewer")
  })

  test("Claude Code's built-in Explore and Plan keep their names and are the Scout and the Architect", () => {
    expect(actorOf("Explore")).toEqual({ agent: "Explore", archetype: "scout" })
    expect(actorOf("Plan")).toEqual({ agent: "Plan", archetype: "architect" })
    expect(actorOf("implementer")).toEqual({ agent: "guild-implementer" })
  })

  test("only the built-ins themselves: a plugin's own plan agent is not the architect", () => {
    expect(actorOf("my-plugin:Plan")).toEqual({ agent: "my-plugin:Plan" })
    expect(actorOf("statusline-setup")).toEqual({ agent: "statusline-setup" })
  })

  test("tool names", () => {
    expect(deedName("Bash")).toBe("bash")
    expect(deedName("Agent")).toBe("task")
    expect(deedName("Task")).toBe("task")
    expect(deedName("PowerShell")).toBe("shell")
    expect(deedName("TodoWrite")).toBe("todowrite")
    expect(deedName("mcp__memory__Read_Graph")).toBe("mcp__memory__Read_Graph")
  })
})
