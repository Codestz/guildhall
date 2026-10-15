import { describe, expect, test } from "bun:test"
import {
  AGENT_RANK,
  ARCHETYPE_IDS,
  ARCHETYPES,
  castOf,
  gearAt,
  isArchetype,
  pipsOf,
  ROLES,
} from "../src/index.ts"

describe("the archetype registry", () => {
  test("every entry is keyed by its own id, with a name, a plural and a colour", () => {
    for (const id of ARCHETYPE_IDS) {
      const archetype = ARCHETYPES[id]
      expect(archetype.id).toBe(id)
      expect(archetype.plural.startsWith(archetype.name)).toBe(true)
      expect(archetype.color).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  test("sigils tell every archetype apart: no two share their two letters", () => {
    const glyphs = ARCHETYPE_IDS.map((id) => ARCHETYPES[id].glyph)
    for (const glyph of glyphs) expect(glyph).toMatch(/^[A-Z][a-z]$/)
    expect(new Set(glyphs).size).toBe(glyphs.length)
  })

  test("the roster's nine roles map onto nine distinct archetypes, keeping their colours", () => {
    const of = Object.fromEntries(ROLES.map((role) => [role.id, role.archetype]))
    expect(of).toEqual({
      "guild-master": "guildmaster",
      "guild-architect": "architect",
      "guild-implementer": "artisan",
      "guild-verifier": "warden",
      "guild-librarian": "archivist",
      "guild-explorer": "scout",
      "guild-researcher": "scholar",
      "guild-designer": "illuminator",
      "guild-product-owner": "herald",
    })
  })

  test("isArchetype accepts ids only", () => {
    expect(isArchetype("warden")).toBe(true)
    expect(isArchetype("Warden")).toBe(false)
    expect(isArchetype("toString")).toBe(false)
    expect(isArchetype(undefined)).toBe(false)
  })
})

describe("castOf: a source's actor in the world", () => {
  test("a roster role is its archetype, subtitled with the role's own name", () => {
    const cast = castOf("guild-verifier")
    expect(cast.archetype.name).toBe("Warden")
    expect(cast.source).toBe("verifier")
    expect(cast.sourceTitle).toBe("Verifier")
    expect(castOf("guild-product-owner").source).toBe("product owner")
  })

  test("an agent the roster doesn't know is a Wanderer under its own name", () => {
    const cast = castOf("general")
    expect(cast.archetype.id).toBe("wanderer")
    expect(cast.source).toBe("general")
    expect(cast.sourceTitle).toBe("general")
  })

  test("a bot account is an Automaton", () => {
    expect(castOf("dependabot[bot]").archetype.id).toBe("automaton")
    expect(castOf("github-actions[BOT]").archetype.id).toBe("automaton")
  })

  test("an archetype the source declares wins over the name", () => {
    expect(castOf("Explore", "scout").archetype.id).toBe("scout")
    expect(castOf("ci-runner", "automaton").archetype.id).toBe("automaton")
    expect(castOf("guild-verifier", "herald").archetype.id).toBe("herald")
    expect(castOf("general", "nonsense").archetype.id).toBe("wanderer")
  })
})

describe("ranks", () => {
  test("agents rank by deeds, at 20 and 60", () => {
    expect(AGENT_RANK({ deeds: 0, tokens: 0 })).toBe("apprentice")
    expect(AGENT_RANK({ deeds: 19, tokens: 0 })).toBe("apprentice")
    expect(AGENT_RANK({ deeds: 20, tokens: 0 })).toBe("journeyman")
    expect(AGENT_RANK({ deeds: 59, tokens: 0 })).toBe("journeyman")
    expect(AGENT_RANK({ deeds: 60, tokens: 0 })).toBe("master")
  })

  test("or by tokens, at one and four million", () => {
    expect(AGENT_RANK({ deeds: 0, tokens: 999_999 })).toBe("apprentice")
    expect(AGENT_RANK({ deeds: 0, tokens: 1_000_000 })).toBe("journeyman")
    expect(AGENT_RANK({ deeds: 0, tokens: 4_000_000 })).toBe("master")
  })

  test("a pip a rank past apprentice", () => {
    expect([pipsOf("apprentice"), pipsOf("journeyman"), pipsOf("master")]).toEqual([0, 1, 2])
  })

  test("a master's finer tools replace only the hands they name", () => {
    expect(gearAt("artisan", "apprentice")).toEqual({ right: "hammer_A" })
    expect(gearAt("artisan", "journeyman")).toEqual({ right: "hammer_A" })
    expect(gearAt("artisan", "master")).toEqual({ right: "hammer" })
    expect(gearAt("scholar", "master")).toEqual({ right: "wand", left: "magnifying_glass" })
    expect(gearAt("wanderer", "master")).toEqual({})
  })
})
