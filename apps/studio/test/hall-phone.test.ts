/**
 * The phone's HUD rules (decisions.md "Phone GUI (user, 10-13)"): the one menu's tabs, the face bar's
 * room, which faces it keeps, and the chips' rules on a phone (names alone, the followed speaks, 44 px taps).
 */
import { describe, expect, test } from "bun:test"
import { pickFaces } from "@guildhall/ui"
import { FACE_GAP, FACE_PX, FACES_MAX, faceCap, faceSlots, menuOpens, menuTab, menuTabs } from "../src/hall/hud/phone.ts"
import { speaks, TAP_PX, tapSlop } from "../src/hexworld/chips.ts"

describe("the phone's menu", () => {
  test("a hall with a session has every tab; the home no Places; a history hall no Guild", () => {
    expect(menuTabs({ guild: true, places: true })).toEqual(["roster", "places", "chronicle", "settings"])
    expect(menuTabs({ guild: true, places: false })).toEqual(["roster", "chronicle", "settings"])
    expect(menuTabs({ guild: false, places: true })).toEqual(["places", "chronicle", "settings"])
  })

  test("an open tab shows; a dossier opened from a tab stays under it; anything else folds the menu", () => {
    const tabs = menuTabs({ guild: true, places: true })
    expect(menuTab("places", null, tabs)).toBe("places")
    expect(menuTab("dossier", "places", tabs)).toBe("places")
    expect(menuTab("hero", "roster", tabs)).toBe("roster")
    // a hero opened from a plea's card, the Legends, nothing open: no tab bar
    expect(menuTab("hero", null, tabs)).toBeNull()
    expect(menuTab("legends", null, tabs)).toBeNull()
    expect(menuTab(null, null, tabs)).toBeNull()
    // a tab the screen does not offer is not one
    expect(menuTab("places", null, menuTabs({ guild: true, places: false }))).toBeNull()
  })

  test("☰ opens the tab seen last, else the first offered", () => {
    const home = menuTabs({ guild: true, places: false })
    expect(menuOpens(null, home)).toBe("roster")
    expect(menuOpens("chronicle", home)).toBe("chronicle")
    expect(menuOpens("places", home)).toBe("roster")
  })
})

describe("the phone's face bar", () => {
  test("as many 44 px faces as fit beside the act chip, at least one", () => {
    // 390 px, 12 px gutters, no act chip: 390 - 24 - 10 - 42 = 314 → 6 faces
    expect(faceSlots(390, 12)).toBe(6)
    // with a 52 px act chip and its gap: 254 → 5
    expect(faceSlots(390, 12, 52)).toBe(5)
    expect(faceSlots(360, 12, 52)).toBe(4)
    expect(faceSlots(120, 12, 52)).toBe(1)
    // what is counted fits: the faces, the gaps, the bar's padding and its +N
    for (const w of [320, 360, 390, 430]) {
      const n = faceSlots(w, 12, 52)
      expect(n * FACE_PX + (n - 1) * FACE_GAP + 10 + 42 + 52 + 8).toBeLessThanOrEqual(w - 24)
    }
  })

  test("the followed keep their face first, then a plea or a fall, then the roster's order", () => {
    const heroes = ["a", "b", "c", "d", "e", "f"].map((id) => ({ id, urgent: id === "e" }))
    const all = pickFaces(heroes, 6, null, (h) => h.urgent)
    expect([...all]).toEqual(["a", "b", "c", "d", "e", "f"])
    const three = pickFaces(heroes, 3, "f", (h) => h.urgent)
    expect([...three]).toEqual(["f", "e", "a"])
  })
})

describe("chips on a phone", () => {
  test("only the followed hero speaks (never in Hidden); a wide screen keeps V1's rule", () => {
    expect(speaks("minimal", true, false, true)).toBe(true)
    expect(speaks("minimal", false, true, true)).toBe(false)
    expect(speaks("detailed", false, true, true)).toBe(false)
    expect(speaks("hidden", true, true, true)).toBe(false)
    expect(speaks("minimal", false, true, false)).toBe(true)
    expect(speaks("detailed", false, false, false)).toBe(true)
  })

  test("a small chip's tap box grows to 44 px a side on a phone; a large one keeps its slop", () => {
    const small = tapSlop(60, 18, true)
    expect(60 + 2 * small.x).toBeGreaterThanOrEqual(TAP_PX)
    expect(18 + 2 * small.y).toBeGreaterThanOrEqual(TAP_PX)
    expect(tapSlop(120, 50, true)).toEqual({ x: 4, y: 4 })
    expect(tapSlop(60, 18, false)).toEqual({ x: 4, y: 4 })
  })
})

describe("the face bar's cap (user 10-14)", () => {
  test("a desktop shows ten, a phone five, however wide the room", () => {
    expect(faceCap(false, 1440, 12)).toBe(FACES_MAX.desktop)
    expect(faceCap(true, 390, 12)).toBe(FACES_MAX.phone)
    expect(faceCap(true, 900, 12)).toBe(FACES_MAX.phone)
  })
  test("a narrow screen shows what fits, and the cap alone before it is measured (the loading bar)", () => {
    expect(faceCap(true, 320, 12, 52)).toBe(faceSlots(320, 12, 52))
    expect(faceCap(true, 0, 12)).toBe(FACES_MAX.phone)
    expect(faceCap(false, 0, 12)).toBe(FACES_MAX.desktop)
  })
})
