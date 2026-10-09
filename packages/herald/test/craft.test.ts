import { describe, expect, test } from "bun:test"
import {
  applyAll,
  type Change,
  craftOf,
  createV1Translator,
  createV2Translator,
  type Entry,
  emptyModel,
} from "@guildhall/core"
import { recorded } from "../../core/test/fixtures.ts"
import { createCrafter } from "../src/craft.ts"

const tool = (change: Partial<Extract<Change, { type: "tool" }>>): Change => ({
  type: "tool",
  id: "ses_1",
  call: "c1",
  at: 1,
  ...change,
})

describe("the herald's crafter", () => {
  test("OpenCode 2 names a call first and sends its command later: the command decides", () => {
    const craft = createCrafter()
    const [named] = craft([tool({ name: "shell", state: "pending" })])
    expect(named).not.toHaveProperty("craft")
    const [called] = craft([tool({ state: "running", input: { command: "bun test users" } })])
    expect(called).toMatchObject({ craft: "test" })
  })

  test("a deed its name settles is stamped at once", () => {
    const [read] = createCrafter()([tool({ name: "read", state: "pending" })])
    expect(read).toMatchObject({ craft: "read" })
  })

  test("a call forgotten once ended: a later change with no name stays unstamped", () => {
    const craft = createCrafter()
    craft([tool({ name: "read", state: "completed" })])
    expect(craft([tool({ output: "late" })])[0]).not.toHaveProperty("craft")
  })

  test("the recorded runs: every deed carries the craft its name and input give", async () => {
    for (const version of [1, 2] as const) {
      const translate = version === 1 ? createV1Translator(() => {}) : createV2Translator(() => {})
      const craft = createCrafter()
      const { events } = await recorded(version)
      const model = applyAll(
        emptyModel(),
        events.flatMap(({ at, event }) => craft(translate.event(event, at))),
      )
      const deeds = [...model.sessions.values()].flatMap((s) =>
        s.entries.filter((e): e is Extract<Entry, { kind: "tool" }> => e.kind === "tool"),
      )
      expect(deeds.length).toBeGreaterThan(0)
      for (const deed of deeds) expect(deed.craft).toBe(craftOf(deed.name, deed.input))
    }
  })
})
