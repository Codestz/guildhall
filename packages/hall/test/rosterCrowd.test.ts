import { describe, expect, test } from "bun:test"
import type { AdventurerView } from "../src/guild/store.ts"
import { crowdOf, isCrowd, NOTABLE_MAX, plural, ROSTER_CROWD_AT } from "../src/hud/crowd.ts"

const ROLES = ["Implementer", "Explorer", "Verifier"]

/** Just the fields the roster's split reads. */
function view(i: number, over: Partial<AdventurerView> = {}): AdventurerView {
  const role = ROLES[i % ROLES.length] as string
  return {
    id: `s${i}`,
    title: `${role} ${i}`,
    role,
    ordinal: i + 1,
    color: `#${i}`,
    master: false,
    phase: "working",
    party: "",
    ...over,
  } as AdventurerView
}

describe("roster at crowd scale", () => {
  test("the showcase sizes keep the plain list; past the line it is a crowd", () => {
    expect(isCrowd(16)).toBe(false)
    expect(isCrowd(ROSTER_CROWD_AT)).toBe(false)
    expect(isCrowd(ROSTER_CROWD_AT + 1)).toBe(true)
  })

  test("the followed, the pleading, the fallen and the guildmaster are named; the rest grouped by role", () => {
    const views = Array.from({ length: 30 }, (_, i) => view(i))
    views[0] = view(0, { master: true, role: "Guildmaster" })
    views[4] = view(4, { phase: "waiting" })
    views[7] = view(7, { phase: "failed" })
    const crowd = crowdOf(views, "s20")
    expect(crowd.notable.map((v) => v.id)).toEqual(["s0", "s4", "s7", "s20"])
    expect(crowd.roles.map((r) => r.role)).toEqual(["Explorer", "Verifier", "Implementer"])
    const counted = crowd.roles.reduce((n, r) => n + r.views.length, 0)
    expect(counted + crowd.notable.length).toBe(30)
    for (const role of crowd.roles) for (const v of role.views) expect(v.role).toBe(role.role)
  })

  test("named rows are capped; overflowing pleas are counted and marked on their role", () => {
    const views = Array.from({ length: 40 }, (_, i) => view(i, { phase: "waiting" }))
    views[39] = view(39, { phase: "failed" })
    const crowd = crowdOf(views, "s39")
    expect(crowd.notable).toHaveLength(NOTABLE_MAX)
    // The followed one always makes it, even last in the list and outranked by pleas.
    expect(crowd.notable.some((v) => v.id === "s39")).toBe(true)
    const pleas = crowd.roles.reduce((n, r) => n + r.pleas, 0)
    expect(pleas).toBe(40 - NOTABLE_MAX)
  })

  test("plural", () => {
    expect(plural("Explorer", 1)).toBe("Explorer")
    expect(plural("Explorer", 49)).toBe("Explorers")
  })
})
