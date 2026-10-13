/**
 * A repo's units as places (repo/places.ts): names, kinds and tiers from the chronicle's units; the
 * capital is the biggest; the order is by birth so a growing repo only adds; small units pool when the
 * land has no room; and the binding finds a path's place by its unit, deepest first.
 */
import { describe, expect, test } from "bun:test"
import { hexIsland, hexZones, landTiles } from "@guildhall/world"
import {
  bindPlaces,
  placeCapacity,
  placeKind,
  placeLabel,
  placeSpecs,
  tierOf,
  type UnitAt,
  unitsAt,
} from "../src/index.ts"
import { chronicle } from "./repo-fixtures.ts"

const unit = (name: string, files: number, born = 100, group?: string): UnitAt => ({
  name,
  ...(group ? { group } : {}),
  born,
  language: "TypeScript",
  files,
  bytes: files * 1000,
})

describe("placeSpecs", () => {
  test("the biggest unit is the capital, first; the rest come oldest first", () => {
    const specs = placeSpecs(
      [unit("src", 500, 10), unit("test", 80, 30), unit("docs", 70, 20), unit("/", 5, 10)],
      1000,
    )
    expect(specs.map((s) => s.id)).toEqual(["src", "/", "docs", "test"])
    expect(specs[0]?.capital).toBe(true)
    expect(specs.filter((s) => s.capital)).toHaveLength(1)
  })

  test("names on the plates: the folder's own name, root, and the pools", () => {
    expect(placeLabel("packages/react-dom")).toBe("react-dom")
    expect(placeLabel("src")).toBe("src")
    expect(placeLabel("/")).toBe("root")
    expect(placeLabel("*")).toBe("other folders")
    expect(placeLabel("packages/*")).toBe("other packages")
  })

  test("the root's place is named after the repo", () => {
    expect(placeLabel("/", false, "facebook/react")).toBe("react")
    expect(placeLabel("/", false, "guildhall")).toBe("guildhall")
    expect(placeLabel("src", false, "facebook/react")).toBe("src")
    const specs = placeSpecs([unit("src", 500, 10), unit("/", 5, 10)], 1000, undefined, "Codestz/guildhall")
    expect(specs.find((s) => s.id === "/")?.label).toBe("guildhall")
    // a folder of the repo's own name keeps its path, so the two plates never read the same
    const react = placeSpecs(
      [unit("compiler", 500, 10), unit("packages/react", 80, 20, "packages"), unit("/", 5, 10)],
      1000,
      undefined,
      "facebook/react",
    )
    expect(react.find((s) => s.id === "/")?.label).toBe("react")
    expect(react.find((s) => s.id === "packages/react")?.label).toBe("packages/react")
  })

  test("what a unit is built as: its content from tier 2 up, the root the harbour, the rest settlements", () => {
    expect(placeKind("/", 1)).toBe("harbour")
    expect(placeKind("test", 2)).toBe("camp")
    expect(placeKind("packages/__tests__", 2)).toBe("camp")
    expect(placeKind("fixtures", 2)).toBe("camp")
    expect(placeKind("docs", 2)).toBe("monastery")
    expect(placeKind("website", 3)).toBe("monastery")
    expect(placeKind("build", 2)).toBe("mine")
    expect(placeKind("scripts", 2)).toBe("mine")
    expect(placeKind(".github", 2)).toBe("mine")
    expect(placeKind("resources", 2)).toBe("fishing")
    expect(placeKind("assets", 2)).toBe("fishing")
    expect(placeKind("vendor", 2)).toBe("lumber")
    expect(placeKind("packages/react-dom", 2)).toBe("settlement")
    expect(placeKind("src", 3)).toBe("settlement")
    // a tiny unit is a hamlet whatever it holds; so is a pool
    expect(placeKind("test", 1)).toBe("settlement")
    expect(placeKind("packages/*", 3)).toBe("settlement")
  })

  test("tiers climb with the files, or with the share of a small repo", () => {
    expect(tierOf(10, 20000)).toBe(1)
    expect(tierOf(60, 20000)).toBe(2)
    expect(tierOf(1000, 20000)).toBe(3)
    expect(tierOf(8, 400)).toBe(2)
    expect(tierOf(40, 400)).toBe(3)
  })

  test("beyond the land's room the smallest units pool into one hamlet per group, their files added", () => {
    const land = 330
    expect(placeCapacity(land)).toBe(6)
    const units = [
      unit("src", 900, 1),
      unit("/", 10, 1),
      unit("packages/a", 50, 2, "packages"),
      unit("packages/b", 40, 3, "packages"),
      unit("packages/c", 30, 4, "packages"),
      unit("packages/d", 20, 5, "packages"),
      unit("packages/e", 9, 6, "packages"),
      unit("tools", 8, 7),
      unit("etc", 7, 8),
    ]
    const specs = placeSpecs(units, land)
    // the six biggest keep a place of their own (d, at 20 files, is the sixth); e, tools and etc pool
    expect(specs.map((s) => s.id)).toEqual([
      "src",
      "/",
      "packages/a",
      "packages/b",
      "packages/c",
      "packages/d",
      "packages/*",
      "*",
    ])
    const pool = specs.find((s) => s.id === "packages/*")
    expect(pool?.pooled).toEqual(["packages/e"])
    expect(pool?.files).toBe(9)
    expect(pool?.label).toBe("other packages")
    const rootPool = specs.find((s) => s.id === "*")
    expect(rootPool?.pooled).toEqual(["tools", "etc"])
    expect(rootPool?.files).toBe(15)
    // the chronicle's own pooled unit takes the leftovers of its group
    const withOwn = placeSpecs([...units, unit("packages/*", 12, 2, "packages")], land)
    const own = withOwn.find((s) => s.id === "packages/*")
    expect(own?.files).toBe(12 + 9)
    expect(own?.pooled).toEqual(["packages/e"])
  })

  test("the same units give the same specs", () => {
    const units = [unit("src", 500, 10), unit("test", 80, 30), unit("docs", 70, 20)]
    expect(placeSpecs(units, 800)).toEqual(placeSpecs([...units].reverse(), 800))
  })

  test("no units, no places", () => {
    expect(placeSpecs([], 800)).toEqual([])
  })

  test("with the land at each birth, every place is ranked under it", () => {
    const specs = placeSpecs([unit("src", 500, 10), unit("test", 80, 30)], 800, (born) => born * 10)
    expect(specs.find((s) => s.id === "src")?.rankMax).toBe(100)
    expect(specs.find((s) => s.id === "test")?.rankMax).toBe(300)
    expect(placeSpecs([unit("src", 500, 10)], 800)[0]?.rankMax).toBeUndefined()
  })
})

describe("bindPlaces", () => {
  const units = [
    unit("packages/hall", 300, 1, "packages"),
    unit("/", 10, 1),
    unit("packages/world", 200, 2, "packages"),
    unit("packages/world/legacy", 40, 3, "packages"),
    unit("test", 70, 2),
    unit("packages/*", 9, 4, "packages"),
  ]
  const specs = placeSpecs(units, 800)
  const h = hexIsland({ seed: 1, files: 629 })
  const z = hexZones(h, { places: specs })
  const b = bindPlaces(specs, z)

  test("a unit's zone, the capital's for the biggest", () => {
    expect(b.capital).toBe(0)
    expect(b.zoneOfUnit("packages/hall")).toBe(0)
    expect(b.zoneOfUnit("test")).toBe(z.zones.findIndex((zz) => zz.place?.id === "test"))
    expect(b.zoneOfUnit("nope")).toBeUndefined()
  })

  test("a path binds by its unit's segments, deepest unit first, wherever the repo is", () => {
    const world = b.zoneOfUnit("packages/world") as number
    const legacy = b.zoneOfUnit("packages/world/legacy") as number
    expect(b.placeOf("/Users/me/guildhall/packages/world/src/hex/life.ts")).toBe(world)
    expect(b.placeOf("packages/world/src/hex/life.ts")).toBe(world)
    expect(b.placeOf("C:\\repo\\packages\\world\\src\\a.ts")).toBe(world)
    expect(b.placeOf("/Users/me/guildhall/packages/world/legacy/a.ts")).toBe(legacy)
    expect(b.placeOf("/Users/me/guildhall/test/a.test.ts")).toBe(b.zoneOfUnit("test") as number)
    // a word inside a segment is not the unit; the unit must be whole segments
    expect(b.placeOf("/x/packages/worldly/a.ts")).toBe(b.capital)
    // no unit on the path: the capital
    expect(b.placeOf("/Users/me/guildhall/README.md")).toBe(b.capital)
    expect(b.placeOf("")).toBe(b.capital)
  })

  test("the bundled chronicles bind: every unit at their last day has a place", async () => {
    for (const name of ["guildhall", "react"] as const) {
      const c = await chronicle(name)
      const units = unitsAt(c, c.end)
      const specs = placeSpecs(units, landTiles(c.repo.files))
      const h = hexIsland({ seed: 7, files: c.repo.files })
      const z = hexZones(h, { places: specs })
      const b = bindPlaces(specs, z)
      for (const u of units) expect(b.zoneOfUnit(u.name)).toBeDefined()
      expect(z.zones.filter((zz) => zz.place).length).toBe(specs.length)
    }
  }, 30_000)
})
