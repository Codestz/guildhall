import { describe, expect, test } from "bun:test"
import { CRAFTS } from "@guildhall/core"
import { deedLook } from "../src/deeds.ts"

describe("deedLook", () => {
  test("every craft has a look", () => {
    for (const craft of CRAFTS) expect(deedLook(craft).clip).toBeString()
  })

  test("only quests and web trips walk", () => {
    expect(deedLook("delegate").goTo).toBe("quest-board")
    expect(deedLook("fetch").goTo).toBe("map-table")
    for (const craft of CRAFTS.filter((c) => c !== "delegate" && c !== "fetch"))
      expect(deedLook(craft).goTo).toBeUndefined()
  })

  test("a run, a test and a lint all steam; an edit and a write both spark", () => {
    expect(deedLook("test")).toEqual(deedLook("run"))
    expect(deedLook("lint")).toEqual(deedLook("run"))
    expect(deedLook("write")).toEqual(deedLook("edit"))
  })

  test("MCP tools cast a spell", () => {
    expect(deedLook("consult").clip).toBe("Spellcasting")
  })

  test("other deeds get the generic look", () => {
    expect(deedLook("other")).toEqual({ clip: "Interact", effect: "none" })
  })
})
