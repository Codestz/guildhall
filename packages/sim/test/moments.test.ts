// V1's "moments: derivation" tests (main:packages/hall/test/moments.test.ts), through the sim's model.
import { describe, expect, test } from "bun:test"
import type { Change, CiState, SeaEvent } from "@guildhall/core"
import {
  apply,
  emptyModel,
  GuildModel,
  glance,
  type Model,
  type Moment,
  momentsOf,
  seaMomentOf,
  sizeOf,
} from "../src/index.ts"

/** Applies `change` to `model` and returns the moments it made, without their time. */
function step(model: Model, change: Change): Omit<Moment, "at">[] {
  const was = glance(model, change)
  apply(model, change)
  return momentsOf(was, model).map(({ at: _at, ...rest }) => rest)
}

describe("moments: derivation", () => {
  test("a join, a quest, a deed and loot, each once, in the order they happened", () => {
    const model = emptyModel()
    const kinds = [
      { type: "session", id: "m", agent: "guild-master", title: "t", at: 0 },
      {
        type: "tool",
        id: "m",
        call: "c1",
        name: "task",
        state: "running",
        input: { description: "Map it" },
        at: 1,
      },
      { type: "session", id: "k", parentID: "m", agent: "guild-explorer", title: "x", at: 2 },
      { type: "status", id: "k", status: "busy", at: 2 },
      { type: "tool", id: "k", call: "c2", name: "grep", state: "running", at: 3 },
      { type: "tool", id: "k", call: "c2", state: "completed", at: 4 },
      { type: "status", id: "k", status: "idle", at: 5 },
    ].flatMap((change) => step(model, change as Change).map((m) => [m.kind, m.id]))
    expect(kinds).toEqual([
      ["quest", "m"],
      ["join", "k"],
      ["deed", "k"],
      ["loot", "k"],
    ])
  })

  test("repeats make no second moment: a re-sent running call, a second session change, idle twice", () => {
    const model = emptyModel()
    step(model, { type: "session", id: "m", agent: "guild-master", title: "t", at: 0 })
    const running: Change = { type: "tool", id: "m", call: "c", name: "task", state: "running", at: 1 }
    expect(step(model, running).map((m) => m.kind)).toEqual(["quest"])
    expect(step(model, { ...running, output: "more", at: 2 })).toEqual([])
    const join: Change = { type: "session", id: "k", parentID: "m", agent: "guild-verifier", at: 3 }
    expect(step(model, join).map((m) => m.kind)).toEqual(["join"])
    expect(step(model, { ...join, title: "renamed", at: 4 })).toEqual([])
    step(model, { type: "status", id: "k", status: "busy", at: 5 })
    step(model, { type: "tool", id: "k", call: "d", name: "bash", state: "running", at: 6 })
    expect(step(model, { type: "status", id: "k", status: "idle", at: 7 }).map((m) => m.kind)).toEqual([
      "loot",
    ])
    expect(step(model, { type: "status", id: "k", status: "idle", at: 8 })).toEqual([])
  })

  test("pleas, failures and recoveries come from status moves, answer before outcome", () => {
    const model = emptyModel()
    step(model, { type: "session", id: "m", agent: "guild-master", title: "t", at: 0 })
    step(model, { type: "session", id: "k", parentID: "m", agent: "guild-implementer", at: 1 })
    step(model, { type: "status", id: "k", status: "busy", at: 1 })
    const kinds = (change: Change) => step(model, change).map((m) => m.kind)
    expect(kinds({ type: "status", id: "k", status: "waiting", at: 2 })).toEqual(["plea"])
    expect(kinds({ type: "status", id: "k", status: "failed", error: "denied", at: 3 })).toEqual([
      "plea-answered",
      "fail",
    ])
    expect(kinds({ type: "status", id: "k", status: "busy", at: 4 })).toEqual(["recover"])
  })

  test("a failure that settles what the session launched makes their fail moments too, after its own", () => {
    const model = emptyModel()
    step(model, { type: "session", id: "m", agent: "guild-master", title: "t", at: 0 })
    step(model, { type: "session", id: "a", parentID: "m", agent: "guild-architect", at: 1 })
    step(model, { type: "status", id: "a", status: "busy", at: 1 })
    step(model, { type: "session", id: "b", parentID: "a", agent: "guild-explorer", at: 2 })
    step(model, { type: "status", id: "b", status: "busy", at: 2 })
    const out = step(model, { type: "status", id: "a", status: "failed", error: "boom", at: 3 })
    expect(out).toEqual([
      { kind: "fail", id: "a", error: "boom" },
      { kind: "fail", id: "b", error: expect.stringContaining("cancelled") },
    ])
  })

  test("a failed deed carries its tool and error; a completed write its size in lines", () => {
    const model = emptyModel()
    step(model, { type: "session", id: "m", agent: "guild-master", title: "t", at: 0 })
    step(model, {
      type: "tool",
      id: "m",
      call: "w",
      name: "write",
      state: "running",
      input: { content: "a\nb\nc" },
      at: 1,
    })
    expect(step(model, { type: "tool", id: "m", call: "w", state: "completed", at: 2 })).toEqual([
      { kind: "deed", id: "m", tool: "write", call: "w", size: 3 },
    ])
    step(model, { type: "tool", id: "m", call: "b", name: "bash", state: "running", at: 3 })
    expect(
      step(model, { type: "tool", id: "m", call: "b", state: "failed", error: "exit 1", at: 4 }),
    ).toEqual([{ kind: "deed-failed", id: "m", tool: "bash", call: "b", error: "exit 1" }])
    expect(sizeOf("edit", { newString: "x\ny" })).toBe(2)
    expect(sizeOf("read", { filePath: "a.ts" })).toBeUndefined()
  })

  test("a red check is a failed deed with its exit, though the call completed", () => {
    const model = emptyModel()
    step(model, {
      type: "tool",
      id: "m",
      call: "t",
      name: "bash",
      state: "running",
      input: { command: "bun test" },
      at: 1,
    })
    expect(step(model, { type: "tool", id: "m", call: "t", state: "completed", exit: 1, at: 2 })).toEqual([
      { kind: "deed-failed", id: "m", tool: "bash", call: "t", exit: 1 },
    ])
  })
})

describe("GuildModel", () => {
  test("apply returns the moments a change made, stamped with its time", () => {
    const guild = new GuildModel()
    expect(guild.apply({ type: "session", id: "m", agent: "guild-master", at: 0 })).toEqual([])
    expect(guild.apply({ type: "session", id: "k", parentID: "m", at: 5 })).toEqual([
      { kind: "join", id: "k", at: 5 },
    ])
    expect(guild.sessions.get("k")?.parentID).toBe("m")
  })

  test("applyAll makes the same moments as glancing and applying change by change", () => {
    const changes: Change[] = [
      { type: "session", id: "m", agent: "guild-master", at: 0 },
      { type: "tool", id: "m", call: "q", name: "task", state: "running", at: 1 },
      { type: "session", id: "k", parentID: "m", at: 2 },
      { type: "status", id: "k", status: "waiting", at: 3 },
      { type: "status", id: "k", status: "idle", at: 4 },
    ]
    const model = emptyModel()
    const stepped = changes.flatMap((change) => {
      const was = glance(model, change)
      apply(model, change)
      return momentsOf(was, model)
    })
    expect(new GuildModel().applyAll(changes)).toEqual(stepped)
    expect(stepped.map((m) => m.kind)).toEqual(["quest", "join", "plea", "plea-answered", "loot"])
  })
})

describe("the sea's moments", () => {
  const base = { at: 0, repo: "acme/shop" }
  const ci = (state: CiState, branch = "main"): SeaEvent => ({
    ...base,
    kind: "ci",
    id: `${state}-${branch}`,
    state,
    name: "CI",
    branch,
    sha: "s",
  })

  test("a push, a merge and a release are each a moment", () => {
    const finished = new Map<string, CiState>()
    const push: SeaEvent = {
      ...base,
      kind: "push",
      id: "p",
      branch: "main",
      commits: 2,
      author: "a",
      sha: "x",
    }
    const pr = { ...base, id: "m", number: 1, title: "t", author: "a", branch: "b" }
    expect(seaMomentOf(push, finished)?.kind).toBe("sea-push")
    expect(seaMomentOf({ ...pr, kind: "pr_merged" }, finished)?.kind).toBe("sea-merged")
    expect(seaMomentOf({ ...pr, kind: "pr_opened" }, finished)).toBeUndefined()
    expect(seaMomentOf({ ...base, kind: "release", id: "r", tag: "v1" }, finished)?.kind).toBe("sea-release")
  })

  test("red is a moment; green only after red on the same branch", () => {
    const finished = new Map<string, CiState>()
    expect(seaMomentOf(ci("running"), finished)).toBeUndefined()
    expect(seaMomentOf(ci("passed"), finished)).toBeUndefined()
    expect(seaMomentOf(ci("failed"), finished)?.kind).toBe("sea-red")
    expect(seaMomentOf(ci("passed", "other"), finished)).toBeUndefined()
    expect(seaMomentOf(ci("passed"), finished)?.kind).toBe("sea-green")
    expect(seaMomentOf(ci("passed"), finished)).toBeUndefined()
  })
})
