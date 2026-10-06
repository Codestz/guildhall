import { describe, expect, test } from "bun:test"
import { deedLook } from "../src/deeds.ts"

describe("deedLook", () => {
  test("v1 and v2 names for the same deed look the same", () => {
    expect(deedLook("shell")).toEqual(deedLook("bash"))
    expect(deedLook("subagent")).toEqual(deedLook("task"))
  })

  test("only quests and web trips walk", () => {
    expect(deedLook("task").goTo).toBe("quest-board")
    expect(deedLook("webfetch").goTo).toBe("map-table")
    for (const tool of ["read", "grep", "glob", "edit", "write", "bash"]) {
      expect(deedLook(tool).goTo).toBeUndefined()
    }
  })

  test("MCP tools cast a spell", () => {
    expect(deedLook("context7_query-docs").clip).toBe("Spellcasting")
  })

  test("unknown tools get the generic look", () => {
    expect(deedLook("frobnicate")).toEqual({ clip: "Interact", effect: "none" })
  })
})
