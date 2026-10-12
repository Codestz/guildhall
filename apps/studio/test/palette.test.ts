import { describe, expect, test } from "bun:test"
import { hexToSrgb, PALETTE, srgbToLinear } from "@guildhall/assets"
import {
  biomeIds,
  decodeShade,
  exportJson,
  normalizeHex,
  SHADE_NEUTRAL,
  shadeTable,
  vertexColour,
} from "../src/palette/colour.ts"
import { palettePicks, SLOTS } from "../src/palette/picks.ts"
import { cellCentre } from "../src/palette/preview.ts"
import { catalogOf, entry } from "./entries.ts"

const hexes = PALETTE.swatches.map((s) => s.hex)
const identity = PALETTE.swatches.map((s) => s.id)
const byName = (name: string) => PALETTE.swatches.find((s) => s.name === name)!

describe("shadeTable / vertexColour", () => {
  test("the neutral shade draws the swatch's own colour", () => {
    const table = shadeTable(hexes, identity)
    const teal = byName("teal")
    const rgb = vertexColour(table, teal.id, SHADE_NEUTRAL, [0, 0, 0])
    const want = hexToSrgb(teal.hex).map(srgbToLinear)
    for (const [i, c] of want.entries()) expect(rgb[i]!).toBeCloseTo(c, 4)
  })

  test("a lower shade byte draws darker, a higher one lighter", () => {
    const table = shadeTable(hexes, identity)
    const id = byName("stone-light").id
    const sum = (byte: number) => vertexColour(table, id, byte, [0, 0, 0]).reduce((s, c) => s + c, 0)
    expect(sum(60)).toBeLessThan(sum(SHADE_NEUTRAL))
    expect(sum(200)).toBeGreaterThan(sum(SHADE_NEUTRAL))
  })

  test("_AO scales the drawn colour by byte / 255; no _AO is unoccluded", () => {
    const table = shadeTable(hexes, identity)
    const id = byName("stone-light").id
    const open = vertexColour(table, id, 100, [0, 0, 0])
    expect(vertexColour(table, id, 100, [0, 0, 0], 255)).toEqual(open)
    const dark = vertexColour(table, id, 100, [0, 0, 0], 102)
    for (const [i, c] of open.entries()) expect(dark[i]!).toBeCloseTo((c * 102) / 255, 6)
  })

  test("an edited hex changes only its own swatch", () => {
    const edited = [...hexes]
    const grass = byName("grass").id
    edited[grass] = "#ff0000"
    const before = shadeTable(hexes, identity)
    const after = shadeTable(edited, identity)
    expect(vertexColour(after, grass, SHADE_NEUTRAL, [0, 0, 0])[0]).toBeCloseTo(1, 4)
    const sand = byName("sand").id
    expect(vertexColour(after, sand, 90, [0, 0, 0])).toEqual(vertexColour(before, sand, 90, [0, 0, 0]))
  })

  test("decodeShade inverts the colour stage's encoding at the ends", () => {
    expect(decodeShade(SHADE_NEUTRAL)).toBe(0)
    expect(decodeShade(SHADE_NEUTRAL + 127)).toBeCloseTo(0.2, 12)
  })
})

describe("biomeIds", () => {
  test("temperate (and an unknown biome) is the identity", () => {
    expect(biomeIds(PALETTE, "temperate")).toEqual(identity)
    expect(biomeIds(PALETTE, "nowhere")).toEqual(identity)
  })

  test("a swapped ramp draws the same tone of its replacement", () => {
    const ids = biomeIds(PALETTE, "snow")
    expect(ids[byName("grass-dark").id]).toBe(byName("snow-shadow").id)
    expect(ids[byName("grass-light").id]).toBe(byName("snow-light").id)
    expect(ids[byName("stone-light").id]).toBe(byName("stone-light").id)
  })
})

describe("normalizeHex", () => {
  test("accepts #rrggbb, rrggbb and #rgb in any case", () => {
    expect(normalizeHex("#A1B2C3")).toBe("#a1b2c3")
    expect(normalizeHex(" a1b2c3 ")).toBe("#a1b2c3")
    expect(normalizeHex("#fa0")).toBe("#ffaa00")
  })

  test("rejects anything else", () => {
    expect(normalizeHex("#12345")).toBeNull()
    expect(normalizeHex("teal")).toBeNull()
  })
})

describe("exportJson", () => {
  test("is the palette with the edited hexes, ids and order kept", () => {
    const edited = [...hexes]
    edited[3] = "#123456"
    const json = JSON.parse(exportJson(PALETTE, edited))
    expect(json.swatches).toHaveLength(PALETTE.swatches.length)
    expect(json.swatches[3]).toMatchObject({ id: 3, name: PALETTE.swatches[3]!.name, hex: "#123456" })
    expect(json.swatches[4].hex).toBe(PALETTE.swatches[4]!.hex)
    expect(json.biomes).toEqual(PALETTE.biomes)
    expect(json.status).toBe(PALETTE.status)
  })
})

describe("palettePicks", () => {
  const slots = [
    { pack: "a", category: "tree", prefer: "Oak" },
    { pack: "a", category: "rock", prefer: "Boulder" },
    { pack: "b", category: "wall", prefer: "x" },
  ] as const

  test("the preferred piece, else the first of its pack and category, else null", () => {
    const catalog = catalogOf([
      entry("a/birch", { name: "Birch", category: "tree" }),
      entry("a/oak", { name: "Oak", category: "tree" }),
      entry("a/pebble", { name: "Pebble", category: "rock" }),
    ])
    expect(palettePicks(catalog, slots).map((e) => e?.id ?? null)).toEqual(["a/oak", "a/pebble", null])
  })

  test("has twelve slots", () => {
    expect(SLOTS).toHaveLength(12)
  })
})

describe("cellCentre", () => {
  test("a 4 × 3 grid centred on the origin", () => {
    expect(cellCentre(0, 12)).toEqual([-13.5, -9])
    expect(cellCentre(11, 12)).toEqual([13.5, 9])
  })
})
