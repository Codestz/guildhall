import { describe, expect, test } from "bun:test"
import { CRAFTS } from "@guildhall/core"
import { deedLook } from "../src/roster/deeds.ts"

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
    expect(deedLook("test").effect).toBe("steam")
    expect(deedLook("lint")).toEqual(deedLook("test"))
    expect(deedLook("run").effect).toBe("steam")
    expect(deedLook("write")).toEqual(deedLook("edit"))
    // the clips are the heroes' own (life/craft.ts): a hammer and a file at the forge, a volley at the targets
    expect(deedLook("edit").clip).toBe("Hammering")
    expect(deedLook("test").clip).toBe("Ranged_Bow_Draw")
    expect(deedLook("run").clip).toBe("Use_Item")
  })

  test("MCP tools cast a spell", () => {
    expect(deedLook("consult").clip).toBe("Ranged_Magic_Spellcasting_Long")
  })

  test("other deeds get the generic look", () => {
    expect(deedLook("other")).toEqual({ clip: "Idle_A", effect: "none" })
  })
})
