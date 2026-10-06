import { describe, expect, test } from "bun:test"
import { apply, type Change, emptyModel, type Model } from "@guildhall/core"
import { numbered, ordinalOf, roman, viewsOf } from "../src/guild/store.ts"

const join = (model: Model, id: string, agent: string, at: number, parentID?: string): void => {
  const change: Change = {
    type: "session",
    id,
    agent,
    title: parentID ? `task (@${agent} subagent)` : "task",
    at,
    ...(parentID ? { parentID } : {}),
  }
  apply(model, change)
  apply(model, { type: "status", id, status: "busy", at })
}

const done = (model: Model, id: string, at: number): void => {
  apply(model, { type: "status", id, status: "idle", at })
}

/** A guildmaster who sends three implementers, two explorers and one verifier (out of id order). */
function party(): Model {
  const model = emptyModel()
  join(model, "root", "build", 1000)
  join(model, "imp-c", "guild-implementer", 2000, "root")
  join(model, "exp-b", "guild-explorer", 2100, "root")
  join(model, "imp-a", "guild-implementer", 2200, "root")
  join(model, "ver", "guild-verifier", 2300, "root")
  join(model, "exp-a", "guild-explorer", 2400, "root")
  join(model, "imp-b", "guild-implementer", 2500, "root")
  return model
}

const titles = (model: Model, now: number) =>
  Object.fromEntries(viewsOf(model, now).map((v) => [v.id, v.title]))

describe("duplicate role names", () => {
  test("repeats are numbered in join order; the first keeps the plain name", () => {
    const views = viewsOf(party(), 3000)
    expect(views.map((v) => v.title)).toEqual([
      "Guildmaster",
      "Implementer",
      "Explorer",
      "Implementer II",
      "Verifier",
      "Explorer II",
      "Implementer III",
    ])
  })

  test("the base role and ordinal ride along for sigils", () => {
    const third = viewsOf(party(), 3000).find((v) => v.id === "imp-b")
    expect(third?.role).toBe("Implementer")
    expect(third?.ordinal).toBe(3)
    expect(viewsOf(party(), 3000).find((v) => v.id === "ver")?.ordinal).toBe(1)
  })

  test("numbers stay put after an earlier one leaves the hall", () => {
    const model = party()
    const before = titles(model, 3000)
    // The first implementer finishes; long after, it has walked out by the gate and has no view.
    done(model, "imp-c", 4000)
    const later = titles(model, 4000 + 60_000)
    expect(later["imp-c"]).toBeUndefined()
    expect(later["imp-a"]).toBe(before["imp-a"])
    expect(later["imp-b"]).toBe("Implementer III")
  })

  test("a newcomer takes the next number, never a freed one", () => {
    const model = party()
    done(model, "imp-c", 4000)
    join(model, "imp-d", "guild-implementer", 5000, "root")
    expect(titles(model, 4000 + 60_000)["imp-d"]).toBe("Implementer IV")
  })

  test("events written as they arrive name the same adventurer the views do", () => {
    const model = party()
    const byView = titles(model, 3000)
    for (const id of ["imp-a", "imp-b", "imp-c", "exp-a", "exp-b", "ver"]) {
      const s = model.sessions.get(id)
      if (!s) throw new Error(id)
      const view = viewsOf(model, 3000).find((v) => v.id === id)
      expect(numbered(view?.role ?? "", ordinalOf(model, s))).toBe(byView[id] ?? "")
    }
  })

  test("roman numerals", () => {
    expect([1, 2, 3, 4, 9, 14, 40].map(roman)).toEqual(["I", "II", "III", "IV", "IX", "XIV", "XL"])
  })
})
