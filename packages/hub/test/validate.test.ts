import { describe, expect, test } from "bun:test"
import { createV1Translator, createV2Translator } from "@guildhall/core"
import { recorded } from "../../core/test/fixtures.ts"
import { MAX_INPUT, MAX_NAME, MAX_TEXT, validChange } from "../src/validate.ts"

const tool = { type: "tool", id: "ses_1", call: "c1", name: "read", state: "running", at: 1 }

describe("validChange", () => {
  test("every change the translators make from the recorded runs passes", async () => {
    for (const version of [1, 2] as const) {
      const translate = version === 1 ? createV1Translator(() => {}) : createV2Translator(() => {})
      const { events } = await recorded(version)
      const changes = events.flatMap(({ at, event }) => translate.event(event, at))
      expect(changes.length).toBeGreaterThan(0)
      expect(changes.filter((change) => !validChange(change))).toEqual([])
    }
  })

  test("refuses a type outside the union, and things that aren't changes", () => {
    for (const bad of [null, 1, "x", [], { ...tool, type: "explode" }, { ...tool, type: "__proto__" }])
      expect(validChange(bad)).toBe(false)
  })

  test("refuses missing or mistyped required fields", () => {
    expect(validChange({ ...tool, id: undefined })).toBe(false)
    expect(validChange({ ...tool, id: 7 })).toBe(false)
    expect(validChange({ ...tool, call: undefined })).toBe(false)
    expect(validChange({ type: "status", id: "s", status: "sleeping", at: 1 })).toBe(false)
    expect(validChange({ type: "prompt", id: "s", key: "k", at: 1 })).toBe(false)
  })

  test("refuses mistyped optional fields", () => {
    expect(validChange({ ...tool, state: "exploded" })).toBe(false)
    expect(validChange({ ...tool, input: "rm -rf" })).toBe(false)
    expect(validChange({ type: "usage", id: "s", tokens: -1, at: 1 })).toBe(false)
    expect(validChange({ type: "session", id: "s", background: "yes", at: 1 })).toBe(false)
  })

  test("`at` must be a finite, non-negative time, not far in the future", () => {
    const now = 1_000_000_000_000
    expect(validChange({ ...tool, at: now }, now)).toBe(true)
    for (const at of [-1, Number.NaN, Number.POSITIVE_INFINITY, "1", now + 2 * 86_400_000])
      expect(validChange({ ...tool, at }, now)).toBe(false)
  })

  test("strings and inputs are capped", () => {
    expect(validChange({ ...tool, call: "c".repeat(MAX_NAME) })).toBe(true)
    expect(validChange({ ...tool, call: "c".repeat(MAX_NAME + 1) })).toBe(false)
    expect(validChange({ ...tool, output: "o".repeat(MAX_TEXT + 1) })).toBe(false)
    expect(validChange({ ...tool, input: { content: "i".repeat(MAX_INPUT) } })).toBe(false)
    expect(validChange({ ...tool, input: { filePath: "/a.ts" } })).toBe(true)
  })
})
