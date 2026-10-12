import { describe, expect, test } from "bun:test"
import type { RigEntry } from "@guildhall/assets"
import {
  clipGroup,
  clipNames,
  clipSearch,
  defaultClip,
  groupClips,
  isCharacter,
  parseClipLink,
} from "../src/viewer/clips.ts"
import { entry } from "./entries.ts"

const rig = (names: string[]): RigEntry => ({
  id: "rig-medium",
  file: "rigs/rig-medium.glb",
  clips: names.map((name) => ({ name, seconds: 1 })),
  bones: 20,
})

describe("clipGroup", () => {
  test("reads each family off the name", () => {
    expect(clipGroup("Idle_A")).toBe("idle")
    expect(clipGroup("Walking_A")).toBe("walk/run")
    expect(clipGroup("Running_B")).toBe("walk/run")
    expect(clipGroup("Chopping")).toBe("work")
    expect(clipGroup("Pickaxe")).toBe("work")
    expect(clipGroup("Sit_Floor_Down")).toBe("sit")
    expect(clipGroup("Waving")).toBe("social")
    expect(clipGroup("Cheering")).toBe("social")
    expect(clipGroup("Ranged_Magic_Spellcasting")).toBe("combat")
    expect(clipGroup("T-Pose")).toBe("other")
  })

  test("a compound name goes where it reads, not to idle", () => {
    expect(clipGroup("Fishing_Idle")).toBe("work")
    expect(clipGroup("Sit_Chair_Idle")).toBe("sit")
    expect(clipGroup("Melee_2H_Idle")).toBe("combat")
    expect(clipGroup("Running_HoldingBow")).toBe("walk/run")
  })
})

describe("clipNames", () => {
  test("the body's own clips, then the rig's, each name once", () => {
    const e = entry("a/cow", {
      kind: "character",
      character: { rig: "r", clips: ["Idle", "Walk"], bones: 9 },
    })
    expect(clipNames(e, rig(["Walk", "Eating"]))).toEqual(["Idle", "Walk", "Eating"])
  })

  test("a static piece and a character without a rig", () => {
    expect(clipNames(entry("a/box"), undefined)).toEqual([])
    const e = entry("a/knight", { kind: "character", character: { rig: "gone", clips: [], bones: 9 } })
    expect(clipNames(e, undefined)).toEqual([])
  })
})

test("isCharacter: the character kind, or anything carrying a rig", () => {
  expect(isCharacter(entry("a/box"))).toBe(false)
  expect(isCharacter(entry("a/knight", { kind: "character" }))).toBe(true)
  expect(isCharacter(entry("a/cart", { character: { rig: "r", clips: [], bones: 3 } }))).toBe(true)
})

describe("defaultClip", () => {
  test("Idle_A wins over an earlier idle", () => {
    expect(defaultClip(["Fishing_Idle", "Idle_A", "Idle_B"])).toBe("Idle_A")
  })

  test("else the first with Idle in its name, else the first, else none", () => {
    expect(defaultClip(["Eating", "Idle", "Idle_2"])).toBe("Idle")
    expect(defaultClip(["Walk", "Run"])).toBe("Walk")
    expect(defaultClip([])).toBeNull()
  })
})

describe("groupClips", () => {
  const names = ["Walking_A", "Idle_B", "Chop", "Idle_A", "T-Pose"]

  test("groups in a fixed order, keeping each group's order, with empty groups left out", () => {
    expect(groupClips(names)).toEqual([
      { group: "idle", names: ["Idle_B", "Idle_A"] },
      { group: "walk/run", names: ["Walking_A"] },
      { group: "work", names: ["Chop"] },
      { group: "other", names: ["T-Pose"] },
    ])
  })

  test("search matches every word, case-insensitive, underscores as spaces", () => {
    expect(groupClips(["Ranged_Bow_Idle", "Ranged_Bow_Draw", "Idle_A"], "bow IDLE")).toEqual([
      { group: "combat", names: ["Ranged_Bow_Idle"] },
    ])
    expect(groupClips(names, "idle_a")).toEqual([{ group: "idle", names: ["Idle_A"] }])
    expect(groupClips(names, "nothing")).toEqual([])
  })
})

describe("the clip deep link", () => {
  test("clip while playing; clip and t while paused; neither with nothing shown", () => {
    const base = new URLSearchParams("screen=pieces&id=a/knight&t=0.5")
    expect(clipSearch(base, { clip: "Idle_A", playing: true, t: 0.3 })).toBe(
      "?screen=pieces&id=a%2Fknight&clip=Idle_A",
    )
    expect(clipSearch(base, { clip: "Chopping", playing: false, t: 0.40004 })).toBe(
      "?screen=pieces&id=a%2Fknight&t=0.4&clip=Chopping",
    )
    expect(clipSearch(new URLSearchParams("id=x&clip=Idle_A&t=0.2"), null)).toBe("?id=x")
  })

  test("t is read only as a fraction in [0, 1]", () => {
    expect(parseClipLink(new URLSearchParams("clip=Chopping&t=0.4"))).toEqual({ clip: "Chopping", t: 0.4 })
    expect(parseClipLink(new URLSearchParams("clip=Idle_A"))).toEqual({ clip: "Idle_A" })
    for (const t of ["", "1.5", "-0.1", "half"])
      expect(parseClipLink(new URLSearchParams(`t=${t}`))).toEqual({ clip: null })
  })
})
