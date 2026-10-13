import { describe, expect, test } from "bun:test"
import { CROWD_AT, crowdOf, isCrowd, NOTABLE_MAX, pleasIn, rosterGroups } from "../src/hud/group.ts"
import type { Family, HeroView, Phase } from "../src/hud/types.ts"

const hero = (id: string, family: Family, extra: Partial<HeroView> = {}): HeroView => ({
  id,
  name: id,
  family,
  banner: "#888",
  phase: "working",
  ...extra,
})

const PARTIES = [
  { id: "p1", name: "Pagination", colour: "#d4ad3a" },
  { id: "p2", name: "Redis", colour: "#4f8fd6" },
]

describe("rosterGroups by party", () => {
  test("one party: a single unnamed group, the guildmaster first", () => {
    const heroes = [hero("scout", "ranger"), hero("gm", "mage", { master: true }), hero("warden", "knight")]
    const groups = rosterGroups(heroes, [PARTIES[0]!])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.party).toBeUndefined()
    expect(groups[0]!.heroes.map((h) => h.id)).toEqual(["gm", "scout", "warden"])
  })

  test("several parties: a group each, in party order; heroes of no known party come last", () => {
    const heroes = [
      hero("a", "rogue", { party: "p2" }),
      hero("b", "knight", { party: "p1" }),
      hero("gm2", "mage", { party: "p2", master: true }),
      hero("lost", "ranger"),
    ]
    const groups = rosterGroups(heroes, PARTIES)
    expect(groups.map((g) => g.key)).toEqual(["p1", "p2", "others"])
    expect(groups[1]!.heroes.map((h) => h.id)).toEqual(["gm2", "a"])
  })

  test("following a party keeps only its heroes", () => {
    const heroes = [hero("a", "rogue", { party: "p2" }), hero("b", "knight", { party: "p1" })]
    const groups = rosterGroups(heroes, PARTIES, { following: "p1" })
    expect(groups.map((g) => g.key)).toEqual(["p1"])
    expect(groups[0]!.heroes.map((h) => h.id)).toEqual(["b"])
  })

  test("nobody on the island: no groups", () => {
    expect(rosterGroups([], PARTIES)).toEqual([])
    expect(rosterGroups([])).toEqual([])
  })
})

describe("rosterGroups by family", () => {
  test("families in the fixed order (mage, knight, ranger, barbarian, rogue), empty ones left out", () => {
    const heroes = [
      hero("r1", "rogue"),
      hero("k1", "knight"),
      hero("m1", "mage"),
      hero("k2", "knight", { master: true }),
    ]
    const groups = rosterGroups(heroes, PARTIES, { by: "family" })
    expect(groups.map((g) => g.family)).toEqual(["mage", "knight", "rogue"])
    expect(groups[1]!.heroes.map((h) => h.id)).toEqual(["k2", "k1"])
  })
})

describe("crowd scale", () => {
  test("a crowd starts past CROWD_AT", () => {
    expect(isCrowd(CROWD_AT)).toBe(false)
    expect(isCrowd(CROWD_AT + 1)).toBe(true)
  })

  test("the picked, the pleading, the fallen and the guildmaster keep their rows; the rest count by family", () => {
    const families: Family[] = ["knight", "ranger", "rogue"]
    const phases: Phase[] = ["working", "idle", "resting"]
    const heroes: HeroView[] = [
      hero("gm", "mage", { master: true }),
      ...Array.from({ length: 30 }, (_, i) =>
        hero(`h${i}`, families[i % 3]!, { phase: i === 4 ? "waiting" : i === 7 ? "failed" : phases[i % 3]! }),
      ),
    ]
    const crowd = crowdOf(heroes, "h20")
    expect(crowd.notable.map((h) => h.id)).toEqual(["gm", "h4", "h7", "h20"])
    expect(crowd.families.map((f) => f.family)).toEqual(["knight", "ranger", "rogue"])
    const total = crowd.families.reduce((n, f) => n + f.heroes.length, 0)
    expect(total + crowd.notable.length).toBe(heroes.length)
  })

  test("past NOTABLE_MAX the overflow is counted, and marked, in its family", () => {
    const heroes = Array.from({ length: 30 }, (_, i) =>
      hero(`h${i}`, i < 15 ? "knight" : "rogue", { phase: i < 12 ? "waiting" : "working" }),
    )
    const crowd = crowdOf(heroes)
    expect(crowd.notable).toHaveLength(NOTABLE_MAX)
    const knights = crowd.families.find((f) => f.family === "knight")!
    expect(knights.pleas).toBe(12 - NOTABLE_MAX)
    expect(pleasIn(heroes)).toBe(12)
  })
})
