import { describe, expect, test } from "bun:test"
import { type HouseBlueprint, type PrefabRecipe, validatePrefab } from "../src/compose/blueprint.ts"
import data from "../src/palette.json"
import { loadPalette } from "../src/palette.ts"
import { type Recipe, recipeHash } from "../src/recipe.ts"

const palette = loadPalette(data)
const [rampA, rampB] = [palette.ramps[0]!.name, palette.ramps[1]!.name]

const house = (over: Partial<HouseBlueprint> = {}): HouseBlueprint => ({
  kit: "kenney-town",
  size: { w: 3, d: 2 },
  storeys: [
    { family: "stone", openings: "shop" },
    { family: "plaster", openings: "home" },
  ],
  roof: { style: "gable", ridge: "x" },
  door: { index: "centre", style: "round" },
  chimney: 0.5,
  edits: [{ storey: 1, side: "+x", index: 1, piece: null }],
  vary: { rampSwaps: { [rampA]: [rampB] }, openings: ["home"] },
  ...over,
})

const prefab = (over: Partial<PrefabRecipe> = {}): PrefabRecipe => ({
  version: 1,
  id: "demo",
  kind: "house",
  tags: ["timber"],
  fits: { districts: ["market"], tiers: ["town"] },
  house: house(),
  dressing: [
    { piece: "kenney-town/barrel", x: 1, y: 0, z: 4, rot: 0, scale: 1, rampMap: { [rampA]: rampB } },
  ],
  anchors: [{ id: "sign", kind: "sign", at: [0, 3, 3], facing: 0 }],
  ...over,
})
/** A JSON copy with one top-level field replaced. */
const json = (over: Record<string, unknown>): unknown => JSON.parse(JSON.stringify({ ...prefab(), ...over }))
const withHouse = (over: Record<string, unknown>): unknown => json({ house: { ...house(), ...over } })

describe("validatePrefab", () => {
  test("a full house recipe and a dressing-only recipe are valid", () => {
    expect(validatePrefab(prefab(), palette)).toEqual([])
    const stall = prefab({ id: "stall-fish", kind: "stall", house: undefined, fits: {} })
    expect(validatePrefab(JSON.parse(JSON.stringify(stall)), palette)).toEqual([])
  })

  test("rejects unknown kinds, kits, families, openings, roofs and door styles", () => {
    expect(validatePrefab(json({ kind: "castle" }))).toEqual(['kind: unknown "castle"'])
    expect(validatePrefab(withHouse({ kit: "kenney-castle" }))).toEqual([
      'house.kit: unknown "kenney-castle"',
    ])
    const odd = { storeys: [{ family: "brick", openings: "loft" }], edits: [] }
    expect(validatePrefab(withHouse(odd))).toEqual([
      'house.storeys[0].family: unknown "brick"',
      'house.storeys[0].openings: unknown "loft"',
    ])
    expect(validatePrefab(withHouse({ roof: { style: "dome", ridge: "y" } }))).toEqual([
      'house.roof.style: unknown "dome"',
      'house.roof.ridge: unknown "y"',
    ])
    expect(validatePrefab(withHouse({ door: { index: 0, style: "arched" } }))).toEqual([
      'house.door.style: unknown "arched"',
    ])
  })

  test("storeys: 1 to 3", () => {
    expect(validatePrefab(withHouse({ storeys: [] }))).toContain("house.storeys: expected 1–3 storeys")
    const four = Array.from({ length: 4 }, () => ({ family: "wood", openings: "home" }))
    expect(validatePrefab(withHouse({ storeys: four }))).toEqual(["house.storeys: expected 1–3 storeys"])
    const one = [{ family: "wood", openings: "home" }]
    expect(validatePrefab(withHouse({ storeys: one, edits: [] }))).toEqual([])
  })

  test("size is whole modules >= 1", () => {
    for (const size of [{ w: 0, d: 2 }, { w: 1.5, d: 2 }, { w: 2 }])
      expect(validatePrefab(withHouse({ size }))).toEqual([
        "house.size: expected whole modules { w, d } >= 1",
      ])
  })

  test("the door index must be a front cell or centre", () => {
    expect(validatePrefab(withHouse({ door: { index: 2 } }))).toEqual([])
    expect(validatePrefab(withHouse({ door: { index: 3 } }))).toEqual([
      'house.door.index: expected "centre" or a front cell 0..2',
    ])
    expect(validatePrefab(withHouse({ door: { index: "middle" } }))).toHaveLength(1)
  })

  test("a point roof needs a 1×1 footprint", () => {
    expect(validatePrefab(withHouse({ roof: { style: "point", ridge: "x" } }))).toEqual([
      "house.roof.style: point needs a 1×1 footprint",
    ])
    const tower = {
      size: { w: 1, d: 1 },
      roof: { style: "point", ridge: "x" },
      door: { index: 0 },
      edits: [],
    }
    expect(validatePrefab(withHouse(tower))).toEqual([])
  })

  test("chimney is a probability", () => {
    expect(validatePrefab(withHouse({ chimney: 1.2 }))).toEqual([
      "house.chimney: expected a probability 0..1",
    ])
    expect(validatePrefab(withHouse({ chimney: 0 }))).toEqual([])
  })

  test("edits must name a real panel, once", () => {
    const edits = [
      { storey: 2, side: "+z", index: 0, piece: "x" },
      { storey: 0, side: "+y", index: 0, piece: "x" },
      { storey: 0, side: "+z", index: 3, piece: "x" }, // front has w = 3 cells
      { storey: 0, side: "-x", index: 2, piece: "x" }, // sides have d = 2 cells
      { storey: 0, side: "-z", index: 0, piece: 7 },
      { storey: 0, side: "+x", index: 1, piece: "kenney-town/wall-window" },
      { storey: 0, side: "+x", index: 1, piece: null },
    ]
    expect(validatePrefab(withHouse({ edits }))).toEqual([
      "house.edits[0].storey: expected 0..1",
      'house.edits[1].side: unknown "+y"',
      "house.edits[2].index: expected 0..2",
      "house.edits[3].index: expected 0..1",
      "house.edits[4].piece: expected a catalog id or null",
      "house.edits[6]: edits the same panel twice",
    ])
  })

  test("ramp swaps need options, and with a palette must name its ramps", () => {
    expect(validatePrefab(withHouse({ vary: { rampSwaps: { [rampA]: [] } } }))).toEqual([
      `house.vary.rampSwaps.${rampA}: expected a non-empty list of ramps`,
    ])
    const unknown = withHouse({ vary: { rampSwaps: { "no-ramp": ["also-no"] } } })
    expect(validatePrefab(unknown)).toEqual([])
    expect(validatePrefab(unknown, palette)).toEqual([
      'house.vary.rampSwaps: unknown ramp "no-ramp"',
      'house.vary.rampSwaps.no-ramp[0]: unknown ramp "also-no"',
    ])
  })

  test("dressing instances are checked like recipe instances", () => {
    const dressing = [
      { piece: "", x: 0, y: "0", z: 0, rot: 0, scale: 0 },
      { piece: "a/b", x: 0, y: 0, z: 0, rot: 0, scale: 1, swatchMap: { a: 1 } },
      {
        piece: "a/b",
        x: 0,
        y: 0,
        z: 0,
        rot: 0,
        scale: 1,
        swatchMap: { 1: 999 },
        rampMap: { [rampA]: "nope" },
      },
    ]
    expect(validatePrefab(json({ dressing }), palette)).toEqual([
      "dressing[0].piece: expected a catalog id",
      "dressing[0].y: expected a number",
      "dressing[0].scale: expected a positive number",
      "dressing[1].swatchMap: expected swatch id → swatch id",
      "dressing[2].swatchMap: 1>999 is not in the palette",
      `dressing[2].rampMap.${rampA}: unknown ramp "nope"`,
    ])
  })

  test("top-level shape: version, id, tags, fits, anchors, something to draw", () => {
    expect(validatePrefab(json({ version: 2 }))).toEqual(["version: expected 1, got 2"])
    expect(validatePrefab(json({ id: "Houses/Demo" }))).toEqual([
      'id: expected a kebab-case id, got "Houses/Demo"',
    ])
    expect(validatePrefab(json({ tags: [1] }))).toEqual(["tags: expected strings"])
    expect(validatePrefab(json({ fits: { tiers: "town" } }))).toEqual(["fits.tiers: expected strings"])
    expect(validatePrefab(json({ anchors: [{ id: "s", kind: "stool", at: [0, 0, 0], facing: 0 }] }))).toEqual(
      ['anchors[0].kind: unknown "stool"'],
    )
    expect(validatePrefab(json({ house: undefined, dressing: [] }))).toEqual([
      "prefab: draws nothing (no house and no dressing)",
    ])
    expect(validatePrefab([])).toEqual(["prefab: expected an object"])
  })
})

describe("recipeHash with rampMap", () => {
  const recipe = (rampMap?: Record<string, string>): Recipe => ({
    id: "demo",
    seed: 1,
    instances: [
      { piece: "kenney-town/roof", x: 0, y: 3, z: 0, rot: 0, scale: 1, ...(rampMap && { rampMap }) },
    ],
    sockets: [],
  })

  test("a ramp map changes the hash; an empty one does not", () => {
    expect(recipeHash(recipe({ [rampA]: rampB }))).not.toBe(recipeHash(recipe()))
    expect(recipeHash(recipe({}))).toBe(recipeHash(recipe()))
  })

  test("does not depend on ramp map key order", () => {
    const [c, d] = [palette.ramps[2]!.name, palette.ramps[3]!.name]
    expect(recipeHash(recipe({ [rampA]: rampB, [c]: d }))).toBe(
      recipeHash(recipe({ [c]: d, [rampA]: rampB })),
    )
  })
})
