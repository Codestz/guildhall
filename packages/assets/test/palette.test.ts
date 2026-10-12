import { describe, expect, test } from "bun:test"
import data from "../src/palette.json"
import { loadPalette, type PaletteJson, paletteHash, paletteProblems, TONES } from "../src/palette.ts"

const json = (): PaletteJson => structuredClone(data) as PaletteJson
const palette = loadPalette(data)

/**
 * The swatch ABI (ADR 003): id → name as first shipped. Appending new swatches keeps this test green;
 * reordering, renaming or deleting one turns it red. Only ever add lines to the end.
 */
// biome-ignore format: three tones per line
const SHIPPED = [
  "grass-dark", "grass", "grass-light",
  "dry-grass-dark", "dry-grass", "dry-grass-light",
  "dirt-dark", "dirt", "dirt-light",
  "sand-dark", "sand", "sand-light",
  "snow-shadow", "snow", "snow-light",
  "stone-dark", "stone-light", "whitewash",
  "cobble-dark", "cobble", "cobble-light",
  "timber-dark", "timber", "timber-light",
  "thatch-dark", "thatch", "thatch-light",
  "terracotta-dark", "terracotta", "terracotta-light",
  "slate-dark", "slate", "slate-light",
  "pine", "leaf", "moss",
  "autumn-dark", "autumn", "blossom",
  "water-deep", "water-shallow", "water-foam",
  "iron", "gold", "glow",
  "purple", "royal-blue", "banner-red",
]

describe("palette.json", () => {
  test("is marked PLACEHOLDER", () => {
    expect(palette.status).toStartWith("PLACEHOLDER")
  })

  test("is append-only: every shipped swatch keeps its id and name", () => {
    expect(palette.swatches.length).toBeGreaterThanOrEqual(SHIPPED.length)
    expect(palette.swatches.slice(0, SHIPPED.length).map((s) => s.name)).toEqual(SHIPPED)
  })

  test("is 16 ramps of dark/base/light", () => {
    expect(palette.swatches).toHaveLength(48)
    expect(palette.ramps).toHaveLength(16)
  })

  test("each ramp gets lighter from dark to light (OKLab L)", () => {
    for (const ramp of palette.ramps) {
      const [dark, base, light] = TONES.map((t) => palette.swatches[ramp.tones[t]]!.lab[0])
      expect(dark!, ramp.name).toBeLessThan(base!)
      expect(base!, ramp.name).toBeLessThan(light!)
    }
  })

  test("has the four biomes", () => {
    expect(Object.keys(palette.biomes).sort()).toEqual(["autumn", "desert", "snow", "temperate"])
  })
})

describe("loadPalette", () => {
  test("indexes swatches by id and carries sRGB and OKLab", () => {
    const grass = palette.swatches[1]!
    expect(grass.name).toBe("grass")
    expect(grass.srgb[0]).toBeCloseTo(0x6b / 255, 6)
    expect(grass.lab[0]).toBeGreaterThan(0)
  })

  test("builds ramps from the swatches' ramp and tone", () => {
    const leaf = palette.ramps.find((r) => r.name === "leaf")!
    expect(leaf.group).toBe("foliage")
    expect(leaf.tones).toEqual({ dark: 33, base: 34, light: 35 })
  })

  test("rejects a gap in the ids", () => {
    const bad = json()
    bad.swatches[3]!.id = 4
    expect(() => loadPalette(bad)).toThrow("swatches[3]: id 4 breaks the dense order")
  })

  test("rejects a reorder (ids no longer dense in array order)", () => {
    const bad = json()
    const [a, b] = [bad.swatches[0]!, bad.swatches[1]!]
    bad.swatches[0] = b
    bad.swatches[1] = a
    expect(paletteProblems(bad)).toContain("swatches[0]: id 1 breaks the dense order (expected 0)")
  })

  test("rejects a duplicate name", () => {
    const bad = json()
    bad.swatches[2]!.name = "grass"
    expect(paletteProblems(bad)).toContain('swatches[2]: duplicate name "grass"')
  })

  test("rejects an unknown group", () => {
    const bad = json()
    bad.swatches[0]!.group = "lava"
    expect(paletteProblems(bad)).toContain('swatches[0]: unknown group "lava"')
  })

  test("rejects a malformed hex", () => {
    const bad = json()
    bad.swatches[0]!.hex = "#ABC"
    expect(paletteProblems(bad)).toContain('swatches[0]: hex must be "#rrggbb" (lower case)')
  })

  test("rejects a ramp missing a tone", () => {
    const bad = json()
    bad.swatches[2]!.tone = "base"
    const problems = paletteProblems(bad)
    expect(problems).toContain('swatches[2]: ramp "grass" repeats tone "base"')
    expect(problems).toContain('ramps: "grass" needs exactly dark/base/light')
  })

  test("rejects a biome swap to an unknown ramp", () => {
    const bad = json()
    bad.biomes.autumn = { leaf: "lava" }
    expect(paletteProblems(bad)).toContain('biomes.autumn.leaf: unknown ramp "lava"')
  })

  test("rejects a non-object and a wrong version", () => {
    expect(paletteProblems(null)).toEqual(["palette: not an object"])
    expect(paletteProblems({ ...json(), version: 2 })).toContain("version: expected 1, got 2")
  })

  test("the shipped palette has no problems", () => {
    expect(paletteProblems(data)).toEqual([])
  })
})

describe("paletteHash", () => {
  test("is 8 hex digits and stable", () => {
    expect(paletteHash(palette)).toMatch(/^[0-9a-f]{8}$/)
    expect(paletteHash(loadPalette(json()))).toBe(paletteHash(palette))
  })

  test("changes when a colour changes (re-import trigger)", () => {
    const edited = json()
    edited.swatches[0]!.hex = "#000000"
    expect(paletteHash(loadPalette(edited))).not.toBe(paletteHash(palette))
  })

  test("changes when a biome swap changes", () => {
    const edited = json()
    edited.biomes.snow = { grass: "sand" }
    expect(paletteHash(loadPalette(edited))).not.toBe(paletteHash(palette))
  })

  test("ignores the status note", () => {
    const edited = json()
    edited.status = "PLACEHOLDER (edited note)"
    expect(paletteHash(loadPalette(edited))).toBe(paletteHash(palette))
  })
})
