import { describe, expect, test } from "bun:test"
import { Exits, KEEP_MAX_MS } from "../src/scene/exits.ts"

const v = (id: string, phase = "working") => ({ id, phase })
const ids = (views: { id: string }[]) => views.map((view) => view.id)

describe("leavers stay on stage until they have dissolved", () => {
  test("a leaver the store drops (fast-forward) stays mounted until its dissolve is done", () => {
    const exits = new Exits<{ id: string; phase: string }>()
    expect(ids(exits.stage([v("a"), v("b", "leaving")], 0, 0))).toEqual(["a", "b"])
    // Story time raced ahead: the store has let b go while it is still walking down the avenue.
    expect(ids(exits.stage([v("a")], 0, 100))).toEqual(["a", "b"])
    expect(ids(exits.stage([v("a")], 0, 200))).toEqual(["a", "b"])
    expect(exits.stage([v("a")], 0, 200).at(-1)?.phase).toBe("leaving")
    expect(exits.gone("b")).toBe(true)
    expect(ids(exits.stage([v("a")], 0, 300))).toEqual(["a"])
  })

  test("someone dropped while not leaving is not kept; gone for an unknown id is a no-op", () => {
    const exits = new Exits<{ id: string; phase: string }>()
    exits.stage([v("a"), v("b")], 0, 0)
    expect(ids(exits.stage([v("a")], 0, 1))).toEqual(["a"])
    expect(exits.gone("b")).toBe(false)
  })

  test("a seek or restart forgets every leaver at once", () => {
    const exits = new Exits<{ id: string; phase: string }>()
    exits.stage([v("b", "leaving")], 0, 0)
    expect(ids(exits.stage([], 1, 10))).toEqual([])
  })

  test("a leaver back in the store's views is the store's again (no duplicate)", () => {
    const exits = new Exits<{ id: string; phase: string }>()
    exits.stage([v("b", "leaving")], 0, 0)
    exits.stage([], 0, 1)
    expect(ids(exits.stage([v("b")], 0, 2))).toEqual(["b"])
    expect(exits.keeps("b")).toBe(false)
  })

  test("a safety limit lets a stuck leaver go", () => {
    const exits = new Exits<{ id: string; phase: string }>()
    exits.stage([v("b", "leaving")], 0, 0)
    exits.stage([], 0, 1)
    expect(ids(exits.stage([], 0, 1 + KEEP_MAX_MS + 1))).toEqual([])
  })

  test("staging twice with the same views (a StrictMode double render) changes nothing", () => {
    const exits = new Exits<{ id: string; phase: string }>()
    exits.stage([v("b", "leaving")], 0, 0)
    expect(ids(exits.stage([], 0, 1))).toEqual(["b"])
    expect(ids(exits.stage([], 0, 1))).toEqual(["b"])
  })
})
