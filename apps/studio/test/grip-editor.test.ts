import { describe, expect, test } from "bun:test"
import { type CatalogEntry, type Mount, validateMount, validateMounts } from "@guildhall/assets"
import {
  clipEdit,
  defaultMount,
  edgeChoices,
  mergeMount,
  parseQuery,
  propChoices,
  setAxis,
  setClip,
  setEdge,
  setSlot,
  setUpright,
  slotChoice,
  startMount,
  tilt,
  twist,
} from "../src/grips/editor/state.ts"

const dot = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * (b[i] ?? 0), 0)

const prop = (id: string, attach: string, category = "prop") =>
  ({
    id,
    name: id.split("/")[1],
    pack: id.split("/")[0],
    category,
    tags: [],
    compose: { attach },
  }) as unknown as CatalogEntry

describe("parseQuery", () => {
  test("reads the deep link and clamps t", () => {
    const q = parseQuery(new URLSearchParams("piece=a/b&body=c/d&clip=Waving&t=1.5"))
    expect(q).toEqual({ piece: "a/b", body: "c/d", clip: "Waving", t: 1 })
  })
  test("falls back to the defaults", () => {
    expect(parseQuery(new URLSearchParams("t=nope")).t).toBe(0.5)
  })
})

describe("axis edits", () => {
  test("snapping the axis keeps the edge perpendicular, nearest the old edge", () => {
    const m = setAxis(defaultMount(), "+x")
    expect(m.axis).toEqual([1, 0, 0])
    expect(dot(m.axis, m.edge)).toBe(0)
    expect(validateMount(m)).toEqual([])
  })
  test("an edge parallel to the axis is refused", () => {
    const m = defaultMount()
    expect(setEdge(m, "-y")).toBe(m)
    expect(edgeChoices(m.axis, m.edge)).not.toContain("+y")
  })
  test("twist and tilt stay valid over many steps and come back round", () => {
    let m = defaultMount()
    for (let i = 0; i < 72; i++) m = tilt(twist(m, 5), 5)
    expect(validateMount(m)).toEqual([])
    let spun = defaultMount()
    for (let i = 0; i < 72; i++) spun = twist(spun, 5)
    expect(spun.edge[0]).toBeCloseTo(1, 3)
  })
})

describe("slot, upright, clips", () => {
  test("both is the right hand with two hands", () => {
    const m = setSlot(defaultMount(), "both")
    expect([m.slot, m.hands, slotChoice(m)]).toEqual(["hand.r", 2, "both"])
    expect(setSlot(m, "hand.l").hands).toBe(1)
  })
  test("upright on and off", () => {
    const on = setUpright(defaultMount(), "+y")
    expect(on.upright).toEqual({ up: [0, 1, 0] })
    expect("upright" in setUpright(on, null)).toBe(false)
  })
  test("a clip override round-trips in degrees, and a no-op override is dropped", () => {
    const m = setClip(defaultMount(), "Chopping", { rollDeg: 15, offset: [0, 0.02, 0], hide: false })
    expect(clipEdit(m, "Chopping")).toEqual({ rollDeg: 15, offset: [0, 0.02, 0], hide: false })
    expect(validateMount(m)).toEqual([])
    const cleared = setClip(m, "Chopping", { rollDeg: 0, offset: [0, 0, 0], hide: false })
    expect("clips" in cleared).toBe(false)
  })
})

describe("starting mount and save merge", () => {
  const saved: Record<string, Mount> = { "a/axe": { ...defaultMount(), handle: [0, 0.1, 0] } }
  test("the saved mount wins over the catalog's", () => {
    expect(startMount("a/axe", saved).handle).toEqual([0, 0.1, 0])
    expect(startMount("a/new", saved)).toEqual(defaultMount())
  })
  test("merging replaces one entry and keeps the rest", () => {
    const file = mergeMount(saved, "a/sword", setAxis(defaultMount(), "-y"))
    expect(Object.keys(file.mounts).sort()).toEqual(["a/axe", "a/sword"])
    expect(file.mounts["a/axe"]).toEqual(saved["a/axe"] as Mount)
    expect(validateMounts(file)).toEqual([])
  })
})

describe("propChoices", () => {
  const entries = [
    prop("p/lantern", "free"),
    prop("p/sword", "held"),
    prop("p/hat", "worn"),
    prop("p/house", "free", "building"),
  ]
  test("held and worn only by default; free props too when asked, held first", () => {
    expect(propChoices(entries, "", true).map((e) => e.id)).toEqual(["p/hat", "p/sword"])
    expect(propChoices(entries, "", false).map((e) => e.id)).toEqual(["p/hat", "p/sword", "p/lantern"])
  })
  test("search matches every word", () => {
    expect(propChoices(entries, "lan", false).map((e) => e.id)).toEqual(["p/lantern"])
  })
})
