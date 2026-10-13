import { describe, expect, test } from "bun:test"
import {
  ARCHETYPE_IDS,
  applyAll,
  archetypeOf,
  BODIES,
  bodyOf,
  castOf,
  emptyModel,
  experienceOf,
  interestOf,
  rankOf,
} from "../src/index.ts"

describe("archetypeOf: castOf's archetype, as an id", () => {
  test("a declared archetype wins, then a roster role's, then a bot's, then the Wanderer", () => {
    expect(archetypeOf("guild-verifier", "automaton")).toBe("automaton")
    expect(archetypeOf("guild-verifier")).toBe(castOf("guild-verifier").archetype.id)
    expect(archetypeOf("dependabot[bot]")).toBe("automaton")
    expect(archetypeOf("Explore")).toBe("wanderer")
    expect(archetypeOf("guild-master")).toBe("guildmaster")
  })
})

describe("rankOf", () => {
  test("ranks an agent session by its deeds and tokens, by default", () => {
    expect(rankOf({ deeds: 0, tokens: 0 })).toBe("apprentice")
    expect(rankOf({ deeds: 20, tokens: 0 })).toBe("journeyman")
    expect(rankOf({ deeds: 0, tokens: 4_000_000 })).toBe("master")
  })

  test("takes another source's rule", () => {
    expect(rankOf({ deeds: 1, tokens: 0 }, () => "master")).toBe("master")
  })

  test("a session's experience is its calls and tokens", () => {
    const model = applyAll(emptyModel(), [
      { type: "tool", id: "s", call: "a", name: "read", state: "completed", at: 1 },
      { type: "tool", id: "s", call: "b", name: "grep", state: "completed", at: 2 },
      { type: "usage", id: "s", tokens: 1_200_000, at: 3 },
    ])
    const s = model.sessions.get("s")
    expect(s && experienceOf(s)).toEqual({ deeds: 2, tokens: 1_200_000 })
    expect(s && rankOf(experienceOf(s))).toBe("journeyman")
  })
})

describe("interestOf: what the camera eases toward", () => {
  test("a plea beats a failure beats a quest beats a fetch or an answer", () => {
    expect(interestOf({ type: "status", id: "s", status: "waiting", at: 0 })).toBe(5)
    expect(interestOf({ type: "status", id: "s", status: "failed", at: 0 })).toBe(4)
    expect(interestOf({ type: "tool", id: "s", call: "c", name: "task", state: "running", at: 0 })).toBe(3)
    expect(interestOf({ type: "tool", id: "s", call: "c", name: "webfetch", state: "running", at: 0 })).toBe(
      2,
    )
    expect(interestOf({ type: "reply", id: "s", key: "k", done: true, at: 0 })).toBe(2)
    expect(interestOf({ type: "step", id: "s", at: 0 })).toBe(0)
  })
})

describe("bodies: five KayKit adventurers for eleven archetypes", () => {
  test("every archetype has one, and the families are the decided ones", () => {
    for (const id of ARCHETYPE_IDS) expect(BODIES[id]).toBeDefined()
    expect(new Set(Object.values(BODIES))).toEqual(
      new Set(["mage", "knight", "ranger", "barbarian", "rogue"]),
    )
    expect((["architect", "scholar", "illuminator"] as const).map(bodyOf)).toEqual(["mage", "mage", "mage"])
    expect(bodyOf("guildmaster")).toBe("knight")
    expect(bodyOf("herald")).toBe("ranger")
    expect(bodyOf("artisan")).toBe("barbarian")
    expect(bodyOf("archivist")).toBe("rogue")
  })
})
