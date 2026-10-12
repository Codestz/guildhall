import { describe, expect, test } from "bun:test"
import { buildHouse, validatePrefab } from "@guildhall/assets"
import {
  blank,
  cyclePanel,
  panelChoices,
  parseRef,
  parseSeed,
  setSize,
  setStoreyCount,
  TEMPLATES,
} from "../src/composer/model.ts"
import { inConvex, panelFaces, pickDressing, pickPanel, type Vec3 } from "../src/composer/pick.ts"

describe("composer document", () => {
  test("every template is a valid prefab", () => {
    for (const r of Object.values(TEMPLATES)) expect(validatePrefab(r)).toEqual([])
  })

  test("a recipe ref names a recipe folder and a kebab id, or nothing", () => {
    expect(parseRef("houses/demo")).toEqual({ kind: "recipes/houses", id: "demo" })
    expect(parseRef("farm/hay-set")).toEqual({ kind: "recipes/farm", id: "hay-set" })
    for (const bad of [null, "", "houses", "npcs/x", "houses/../x", "houses/Demo", "houses/a/b"])
      expect(parseRef(bad)).toBeNull()
  })

  test("an unknown id starts from the cottage under that id", () => {
    const r = blank("demo")
    expect(r.id).toBe("demo")
    expect(r.house).toEqual(TEMPLATES.cottage.house)
  })

  test("seeds are whole and non-negative, else 1", () => {
    expect([parseSeed("7"), parseSeed(null), parseSeed("-2"), parseSeed("1.5")]).toEqual([7, 1, 1, 1])
  })

  test("a panel click steps the slot and cycling all the way round leaves no edit", () => {
    const r = TEMPLATES.cottage
    const slot = { storey: 0, side: "-z" as const, index: 0 }
    const once = cyclePanel(r, 1, slot)
    expect(once.house?.edits).toHaveLength(1)
    let back = once
    const n = panelChoices(r.house!, slot).length
    for (let i = 1; i < n; i++) back = cyclePanel(back, 1, slot)
    expect(back.house?.edits).toEqual([])
    expect(cyclePanel(once, 1, slot, -1).house?.edits).toEqual([])
  })

  test("a panel cycled to empty draws nothing in that slot", () => {
    // The back is blind: the first choice, so one step back wraps round to empty.
    const slot = { storey: 0, side: "-z" as const, index: 0 }
    let r = TEMPLATES.cottage
    r = cyclePanel(r, 1, slot, -1)
    expect(r.house?.edits).toEqual([{ ...slot, piece: null }])
    const parts = buildHouse(r.house!, 1).parts
    expect(parts.some((p) => p.slot?.side === "-z")).toBe(false)
  })

  test("shrinking drops edits beyond the new footprint and pulls the door in", () => {
    let r = TEMPLATES.hall
    r = { ...r, house: { ...r.house!, door: { index: 2 } } }
    const smaller = setSize(r, 1, 2)
    expect(smaller.house?.edits).toEqual([])
    expect(smaller.house?.door.index).toBe(0)
    expect(validatePrefab(smaller)).toEqual([])
  })

  test("a new storey copies the one below; fewer storeys drop their edits", () => {
    const three = setStoreyCount(TEMPLATES.hall, 3)
    expect(three.house?.storeys[2]).toEqual(TEMPLATES.hall.house?.storeys[1])
    expect(setStoreyCount(TEMPLATES.hall, 1).house?.edits).toEqual([])
    expect(setStoreyCount(TEMPLATES.hall, 9).house?.storeys).toHaveLength(3)
  })
})

describe("composer picking", () => {
  // A top-down orthographic view: screen x = world x, screen y = world z.
  const topDown = (p: Vec3): [number, number] => [p[0], p[2]]
  // Looking from the front (+z) square on: screen x = x, screen y = -y.
  const front = (p: Vec3): [number, number] => [p[0], -p[1]]

  test("inConvex accepts either winding and refuses outside points", () => {
    const square: [number, number][] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]
    expect(inConvex([0.5, 0.5], square)).toBe(true)
    expect(inConvex([0.5, 0.5], [...square].reverse())).toBe(true)
    expect(inConvex([1.5, 0.5], square)).toBe(false)
  })

  test("a click on the front picks that storey's cell; the back faces never compete", () => {
    const h = TEMPLATES.hall.house!
    const faces = panelFaces(h)
    const eye: Vec3 = [0, 3, 30]
    // Hall: 9 m wide (x -4.5..4.5), two 3 m storeys; the upper right cell is x 1.5..4.5, y 3..6.
    expect(pickPanel(faces, eye, front, [3, -4.5])).toEqual({ storey: 1, side: "+z", index: 2 })
    expect(pickPanel(faces, eye, front, [-3, -1])).toEqual({ storey: 0, side: "+z", index: 0 })
    expect(pickPanel(faces, eye, front, [6, -1])).toBeNull()
  })

  test("a face edge-on or turned away is not picked", () => {
    const faces = panelFaces(TEMPLATES.cottage.house!)
    expect(pickPanel(faces, [0, 30, 0], topDown, [0, 1.5])).toBeNull()
  })

  test("overlapping dressing boxes pick the one nearer the eye", () => {
    const box = (z: number) => ({
      corners: [
        [-1, 0, z],
        [1, 1, z],
      ] as Vec3[],
      at: [0, 0.5, z] as Vec3,
    })
    expect(pickDressing([box(0), box(5)], [0, 0.5, 10], front, [0, -0.5])).toBe(1)
    expect(pickDressing([box(0)], [0, 0.5, 10], front, [3, -0.5])).toBeNull()
  })
})
