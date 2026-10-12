import { describe, expect, test } from "bun:test"
import { type NpcRecipe, validateNpc } from "../src/npc/recipe.ts"
import data from "../src/palette.json"
import { loadPalette } from "../src/palette.ts"
import { validateEntry } from "../src/validate.ts"
import { entry } from "./entry.ts"

const palette = loadPalette(data)
const [rampA, rampB, rampC] = palette.ramps.map((r) => r.name)

const farmer = (): NpcRecipe => ({
  version: 1,
  id: "farmer",
  role: "farmer",
  body: ["kaykit-adventurers/barbarian", "kaykit-adventurers/rogue"],
  hide: ["Barbarian_Cape"],
  outfit: { [rampA!]: [rampB!, rampC!] },
  head: { pieces: ["kaykit-adventurers/hat-straw"], chance: 0.6 },
  hands: { r: ["kaykit-rpg-tools/pitchfork", ""], l: [""] },
  activity: { work: "Pickaxing", idle: ["Idle", "Idle_B"], walk: "Walking_A", station: "field" },
  vary: { height: [0.96, 1.04], speed: [0.9, 1.1] },
})
const json = (over: Record<string, unknown>): unknown => JSON.parse(JSON.stringify({ ...farmer(), ...over }))

describe("validateNpc", () => {
  test("a full and a minimal recipe are valid", () => {
    expect(validateNpc(farmer(), palette)).toEqual([])
    const minimal = json({ hide: undefined, head: undefined, hands: undefined, outfit: {} })
    expect(validateNpc(minimal, palette)).toEqual([])
  })

  test("the body list needs at least one id", () => {
    expect(validateNpc(json({ body: [] }))).toEqual(["body: expected at least one character id"])
    expect(validateNpc(json({ body: [""] }))).toEqual(["body: expected at least one character id"])
  })

  test("outfit: options per ramp, and with a palette the ramps must exist", () => {
    expect(validateNpc(json({ outfit: { [rampA!]: [] } }))).toEqual([
      `outfit.${rampA}: expected a non-empty list of ramps`,
    ])
    const unknown = json({ outfit: { "no-ramp": ["nor-this"] } })
    expect(validateNpc(unknown)).toEqual([])
    expect(validateNpc(unknown, palette)).toEqual([
      'outfit: unknown ramp "no-ramp"',
      'outfit.no-ramp[0]: unknown ramp "nor-this"',
    ])
  })

  test("head chance is a probability and needs pieces", () => {
    expect(validateNpc(json({ head: { pieces: [], chance: 1.5 } }))).toEqual([
      "head.pieces: expected at least one catalog id",
      "head.chance: expected a probability 0..1",
    ])
  })

  test('hands allow "" as the empty hand but not an empty list', () => {
    expect(validateNpc(json({ hands: { r: [""] } }))).toEqual([])
    expect(validateNpc(json({ hands: { r: [], l: [3] } }))).toEqual([
      'hands.r: expected a non-empty list of ids or ""',
      'hands.l: expected a non-empty list of ids or ""',
    ])
  })

  test("activity needs work, idle options and walk", () => {
    expect(validateNpc(json({ activity: { work: "", idle: [], station: 2 } }))).toEqual([
      "activity.work: expected a clip name",
      "activity.idle: expected at least one clip name",
      "activity.walk: expected a clip name",
      "activity.station: expected a string",
    ])
  })

  test("vary ranges are positive and ordered", () => {
    expect(validateNpc(json({ vary: { height: [1.04, 0.96], speed: [0, 1] } }))).toEqual([
      "vary.height: expected [min, max] with 0 < min <= max",
      "vary.speed: expected [min, max] with 0 < min <= max",
    ])
    expect(validateNpc(json({ vary: { height: [1, 1], speed: [1, 1] } }))).toEqual([])
  })

  test("top-level shape", () => {
    expect(validateNpc(json({ version: 0, id: "Farmer One", role: "" }))).toEqual([
      "version: expected 1, got 0",
      'id: expected a kebab-case id, got "Farmer One"',
      "role: expected a string",
    ])
    expect(validateNpc("farmer")).toEqual(["npc: expected an object"])
  })
})

describe("character.parts on catalog entries", () => {
  const body = (parts?: unknown) =>
    entry({
      id: "kaykit-adventurers/knight",
      kind: "character",
      category: "character",
      character: {
        rig: "rig-medium",
        clips: ["Idle"],
        bones: 40,
        ...(parts !== undefined && { parts }),
      } as never,
    })

  test("is optional, and a list of names when present", () => {
    expect(validateEntry(body(), palette)).toEqual([])
    expect(validateEntry(body(["Knight_Helmet", "Knight_Cape"]), palette)).toEqual([])
    expect(validateEntry(body("Knight_Helmet"), palette)).toEqual([
      "kaykit-adventurers/knight: character.parts: expected strings",
    ])
  })
})
