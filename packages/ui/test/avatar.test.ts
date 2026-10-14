import { describe, expect, test } from "bun:test"
import {
  CHARGE,
  DIVISIONS,
  expressionOf,
  FAMILIES,
  faceFeatures,
  rimTone,
  shade,
  shieldOf,
} from "../src/index.ts"

describe("expressionOf", () => {
  test("the face follows the phase", () => {
    expect(expressionOf("working")).toBe("thinking")
    expect(expressionOf("waiting")).toBe("plea")
    expect(expressionOf("failed")).toBe("failed")
    expect(expressionOf("loot")).toBe("loot")
    expect(expressionOf("idle")).toBe("idle")
    expect(expressionOf("resting")).toBe("idle")
    expect(expressionOf("leaving")).toBe("calm")
  })

  test("a phase the sim learns later keeps a calm face", () => {
    expect(expressionOf("dancing")).toBe("calm")
  })
})

describe("faceFeatures", () => {
  test("the same hero always wears the same face", () => {
    expect(faceFeatures("verifier")).toEqual(faceFeatures("verifier"))
  })

  test("heroes differ: a cast of twenty is not one face", () => {
    const faces = new Set(Array.from({ length: 20 }, (_, i) => JSON.stringify(faceFeatures(`hero-${i}`))))
    expect(faces.size).toBeGreaterThan(10)
  })

  test("a rogue's mask leaves no beard under it", () => {
    for (let i = 0; i < 40; i++) expect(faceFeatures(`r${i}`, "rogue").beard).toBe("none")
  })

  test("the first to eighth of one kind and banner each wear their own colour", () => {
    const kin = "rogue:#c0392b"
    const accents = Array.from(
      { length: 8 },
      (_, k) => faceFeatures(`w${k}`, "rogue", { ordinal: k + 1, kin }).accent,
    )
    expect(new Set(accents).size).toBe(8)
  })
})

describe("shieldOf", () => {
  test("a session keeps its arms: same id, same division and mirroring", () => {
    const a = shieldOf("session-7f3a", "knight")
    for (let i = 0; i < 5; i++) expect(shieldOf("session-7f3a", "knight")).toEqual(a)
  })

  test("the division comes from the session alone, the charge from the family alone", () => {
    const divisions = FAMILIES.map((f) => shieldOf("session-7f3a", f).division)
    expect(new Set(divisions).size).toBe(1)
    for (const f of FAMILIES) expect(shieldOf("other", f).charge).toBe(CHARGE[f])
  })

  test("sessions spread over every division", () => {
    const seen = new Set(Array.from({ length: 200 }, (_, i) => shieldOf(`s${i}`, "mage").division))
    expect(seen.size).toBe(DIVISIONS.length)
  })

  test("pinned: these ids give these arms (a change here changes every card ever shared)", () => {
    expect(shieldOf("session-7f3a", "mage")).toEqual({ division: "bend", charge: "star", flip: true })
    expect(shieldOf("pagination", "ranger")).toEqual({ division: "bend", charge: "bow", flip: false })
  })
})

describe("rim and colour", () => {
  test("only a plea, a fall and loot colour the rim", () => {
    expect(rimTone("waiting")).toBe("plea")
    expect(rimTone("failed")).toBe("fail")
    expect(rimTone("loot")).toBe("loot")
    expect(rimTone("working")).toBeNull()
    expect(rimTone("idle")).toBeNull()
  })

  test("shade darkens and lightens hex, leaves other colours alone", () => {
    expect(shade("#808080", 0.5)).toBe("#404040")
    expect(shade("#000000", 2)).toBe("#ffffff")
    expect(shade("#fff", 1)).toBe("#ffffff")
    expect(shade("rebeccapurple", 0.5)).toBe("rebeccapurple")
  })
})
