/**
 * Places from a repo's units (zones.ts `hexZones(h, {places})`): every unit gets a zone of its own, named
 * after it; the capital is the town on the reserved square; sizes follow the files; the same specs give
 * the same island; and a unit that grows keeps its heart (and so does every other place).
 */
import { describe, expect, test } from "bun:test"
import {
  type HexZones,
  hexIsland,
  hexZones,
  type PlaceSpec,
  placeSizes,
  settlementKind,
} from "../src/hex/index.ts"

const spec = (id: string, files: number, extra: Partial<PlaceSpec> = {}): PlaceSpec => ({
  id,
  label: id.split("/").pop() ?? id,
  kind: "settlement",
  tier: files >= 1000 ? 3 : files >= 60 ? 2 : 1,
  files,
  ...extra,
})

/** A small monorepo: the capital, the root as the harbour, tests, docs, scripts, and a few packages. */
const REPO: PlaceSpec[] = [
  spec("packages/hall", 2400, { capital: true }),
  spec("/", 20, { kind: "harbour" }),
  spec("test", 300, { kind: "camp" }),
  spec("docs", 120, { kind: "monastery" }),
  spec("scripts", 80, { kind: "mine" }),
  spec("packages/core", 400),
  spec("packages/world", 900),
  spec("packages/sim", 70),
  spec("packages/ui", 30),
  spec("packages/*", 25, { pooled: ["packages/a", "packages/b"] }),
]
const FILES = REPO.reduce((n, s) => n + s.files, 0)

const named = (z: HexZones) => z.zones.filter((zz) => zz.place)
const zoneOf = (z: HexZones, id: string) => z.zones.find((zz) => zz.place?.id === id)

describe("places from a repo's units", () => {
  test("every unit has a zone named after it, the capital on the town's square, in the order given", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const h = hexIsland({ seed, files: FILES })
      const z = hexZones(h, { places: REPO })
      const ids = named(z).map((zz) => zz.place?.id)
      expect(ids).toEqual(REPO.map((s) => s.id))
      expect(z.zones[0]?.kind).toBe("town")
      expect(z.zones[0]?.place?.id).toBe("packages/hall")
      expect(z.zones[0]?.tile).toBe(h.sites.town[0] as number)
      expect(z.zones[1]?.kind).toBe("castle")
      for (const zz of named(z)) {
        expect(zz.tiles.length).toBeGreaterThan(0)
        expect(zz.tiles).toContain(zz.tile)
        // its kind is what the spec asked for: a settlement by its tier
        const s = zz.place as PlaceSpec
        if (!s.capital) expect(zz.kind).toBe(s.kind === "settlement" ? settlementKind(s.tier) : s.kind)
      }
      // no two places share a heart, and no place holds another's heart
      const hearts = new Set(z.zones.map((zz) => zz.tile))
      expect(hearts.size).toBe(z.zones.length)
      for (const zz of z.zones) for (const i of zz.tiles) if (i !== zz.tile) expect(hearts.has(i)).toBe(false)
    }
  })

  test("sizes follow the files: more files, more tiles; nothing outgrows the capital", () => {
    const sizes = placeSizes(REPO, 1500)
    const of = (id: string) => sizes.get(id) as number
    expect(of("packages/hall")).toBeGreaterThan(of("packages/world"))
    // (both big ones are capped at CAPITAL_CAP of the capital)
    expect(of("packages/world")).toBeGreaterThanOrEqual(of("packages/core"))
    expect(of("packages/core")).toBeGreaterThan(of("packages/sim"))
    expect(of("packages/sim")).toBeGreaterThanOrEqual(of("packages/ui"))
    for (const s of REPO) expect(of(s.id)).toBeLessThanOrEqual(of("packages/hall"))
    for (const s of REPO) expect(of(s.id)).toBeGreaterThanOrEqual(4)
    // the island honours them (the heart's surroundings permitting): the capital is the biggest place
    const h = hexIsland({ seed: 2, files: FILES })
    const z = hexZones(h, { places: REPO })
    const tiles = (id: string) => zoneOf(z, id)?.tiles.length ?? 0
    for (const zz of named(z)) expect(zz.tiles.length).toBeLessThanOrEqual(tiles("packages/hall"))
    expect(tiles("packages/world")).toBeGreaterThan(tiles("packages/ui"))
    expect(tiles("packages/core")).toBeGreaterThan(tiles("packages/ui"))
  })

  test("the same units give the same island, down to every tile's use", () => {
    const h = hexIsland({ seed: 3, files: FILES })
    const a = hexZones(h, { places: REPO })
    const b = hexZones(h, { places: REPO.map((s) => ({ ...s })) })
    expect(a.zones.map((zz) => [zz.kind, zz.tile, zz.tiles])).toEqual(
      b.zones.map((zz) => [zz.kind, zz.tile, zz.tiles]),
    )
    expect([...a.use]).toEqual([...b.use])
    expect(a.roads).toEqual(b.roads)
  })

  test("a unit that grows keeps its heart, and so does every other place (same island)", () => {
    for (const seed of [1, 2, 3]) {
      const h = hexIsland({ seed, files: FILES })
      const before = hexZones(h, { places: REPO })
      // packages/sim grows from a hamlet (70 files) to a village (300): a tier up
      const grown = REPO.map((s) => (s.id === "packages/sim" ? spec(s.id, 300) : s))
      const after = hexZones(h, { places: grown })
      for (const s of REPO) {
        expect(zoneOf(after, s.id)?.tile).toBe(zoneOf(before, s.id)?.tile as number)
      }
      expect(zoneOf(after, "packages/sim")?.kind).toBe("farm")
      expect(zoneOf(after, "packages/sim")?.tiles.length ?? 0).toBeGreaterThanOrEqual(
        zoneOf(before, "packages/sim")?.tiles.length ?? 0,
      )
    }
  })

  test("a new unit only adds a place: the earlier hearts stay", () => {
    const h = hexIsland({ seed: 4, files: FILES })
    const before = hexZones(h, { places: REPO })
    const after = hexZones(h, { places: [...REPO, spec("packages/render", 500)] })
    for (const s of REPO) expect(zoneOf(after, s.id)?.tile).toBe(zoneOf(before, s.id)?.tile as number)
    expect(zoneOf(after, "packages/render")).toBeDefined()
  })

  test("a kind the land has no site for still gets a place (a mine with no rock, a harbour with no shore)", () => {
    // hills 0: no rock peaks for a mine; the harbour and two fishing villages all want the shore
    const h = hexIsland({ seed: 5, files: 300, hills: 0 })
    const places = [
      spec("src", 200, { capital: true }),
      spec("/", 5, { kind: "harbour" }),
      spec("build", 40, { kind: "mine" }),
      spec("assets", 30, { kind: "fishing" }),
      spec("data", 30, { kind: "fishing" }),
      spec("vendor", 30, { kind: "lumber" }),
    ]
    const z = hexZones(h, { places })
    expect(named(z).map((zz) => zz.place?.id)).toEqual(places.map((s) => s.id))
    for (const zz of named(z)) expect(zz.tiles.length).toBeGreaterThan(0)
  })

  test("without places, nothing changes: the island's own kinds in their own order", () => {
    const h = hexIsland({ seed: 1, files: 1500 })
    const z = hexZones(h)
    expect(z.zones.every((zz) => zz.place === undefined)).toBe(true)
    expect(z.zones.slice(0, 3).map((zz) => zz.kind)).toEqual(["town", "harbour", "castle"])
  })
})
