import { describe, expect, test } from "bun:test"
import { applyFilters, NO_FILTERS, parseFilters, railCounts, toSearch } from "../src/browser/filters.ts"
import { gridWindow, scrollToShow } from "../src/browser/virtual.ts"
import { libraryUrl, loadCatalog } from "../src/catalog.ts"
import { describe as describeEntry } from "../src/viewer/stats.ts"
import { catalogOf, entry, index } from "./entries.ts"

/** A fetch over an in-memory file table; anything else is a 404. */
function fakeFetch(files: Record<string, unknown>) {
  return async (url: string) => {
    const found = url in files
    return { ok: found, status: found ? 200 : 404, json: async () => files[url] }
  }
}

describe("loadCatalog", () => {
  test("reads the index and every shard into one catalog", async () => {
    const files = {
      "/library/catalog/index.json": index([
        { id: "a", vendor: "kaykit" },
        { id: "b", vendor: "kenney" },
      ]),
      "/library/catalog/a.json": [entry("a/one")],
      "/library/catalog/b.json": [entry("b/two"), entry("b/three")],
    }
    const catalog = await loadCatalog(fakeFetch(files), undefined, true)
    expect(catalog?.all().map((e) => e.id)).toEqual(["a/one", "b/three", "b/two"])
  })

  test("no index is no library (null), not an error", async () => {
    expect(await loadCatalog(fakeFetch({}))).toBeNull()
    expect(await loadCatalog(() => Promise.reject(new Error("offline")))).toBeNull()
  })

  test("an index with no pieces is no library either", async () => {
    expect(await loadCatalog(fakeFetch({ "/library/catalog/index.json": index([]) }))).toBeNull()
  })

  test("a missing shard is left out; the other packs still load", async () => {
    const files = {
      "/library/catalog/index.json": index([
        { id: "a", vendor: "kaykit" },
        { id: "gone", vendor: "kenney" },
      ]),
      "/library/catalog/a.json": [entry("a/one")],
    }
    expect((await loadCatalog(fakeFetch(files), undefined, true))?.all().map((e) => e.id)).toEqual(["a/one"])
  })

  test("only the house style's packs load unless all are asked for", async () => {
    const files = {
      "/library/catalog/index.json": index([
        { id: "kaykit-hexagon", vendor: "kaykit" },
        { id: "quaternius-nature", vendor: "quaternius" },
      ]),
      "/library/catalog/kaykit-hexagon.json": [entry("kaykit-hexagon/one")],
      "/library/catalog/quaternius-nature.json": [entry("quaternius-nature/two")],
    }
    expect((await loadCatalog(fakeFetch(files), undefined, false))?.all().map((e) => e.id)).toEqual([
      "kaykit-hexagon/one",
    ])
  })

  test("library paths are url-encoded segment by segment", () => {
    expect(libraryUrl("pieces/a b/c#d.glb")).toBe("/library/pieces/a%20b/c%23d.glb")
  })
})

describe("filters", () => {
  test("a deep link round-trips and keeps the other parameters", () => {
    const query = new URLSearchParams(
      "screen=pieces&q=oak&pack=k&cat=tree&flag=oversize,sunk&misfit=1&hud=perf",
    )
    const filters = parseFilters(query)
    expect(filters).toEqual({
      text: "oak",
      pack: "k",
      category: "tree",
      flags: ["oversize", "sunk"],
      misfit: true,
    })
    expect(new URLSearchParams(toSearch(query, filters, "k/oak")).toString()).toBe(
      "screen=pieces&q=oak&pack=k&cat=tree&flag=oversize%2Csunk&misfit=1&hud=perf&id=k%2Foak",
    )
  })

  test("unknown categories and flags in a link are ignored", () => {
    const filters = parseFilters(new URLSearchParams("cat=spaceship&flag=wobbly,sunk"))
    expect(filters.category).toBeNull()
    expect(filters.flags).toEqual(["sunk"])
  })

  test("clearing every filter drops them from the link", () => {
    const base = new URLSearchParams("screen=pieces&q=oak&id=x")
    expect(toSearch(base, NO_FILTERS, null)).toBe("?screen=pieces")
  })

  const catalog = catalogOf([
    entry("k/oak", {
      category: "tree",
      scale: { factor: 1, rule: "factor", confidence: "pack", flags: ["oversize"] },
    }),
    entry("k/hut", { category: "building", flags: ["sunk"] }),
    entry("q/elm", { category: "tree" }),
  ])

  test("misfit keeps only pieces with a piece or scale flag", () => {
    expect(applyFilters(catalog, { ...NO_FILTERS, misfit: true }).map((e) => e.id)).toEqual([
      "k/hut",
      "k/oak",
    ])
  })

  test("a facet's counts ignore its own choice but honour the others", () => {
    const counts = railCounts(catalog, { ...NO_FILTERS, pack: "k", category: "tree" })
    // Pack counts are for trees in any pack; category counts are for anything in pack k.
    expect(counts.pack).toEqual({ k: 1, q: 1 })
    expect(counts.category).toEqual({ building: 1, tree: 1 })
    expect(counts.flag).toEqual({ oversize: 1 })
    expect(counts.misfit).toBe(1)
  })
})

describe("gridWindow", () => {
  const spec = { width: 520, height: 400, scrollTop: 0, minTile: 120, tileHeight: 150, gap: 10, overscan: 1 }

  test("fits as many columns as the minimum tile allows and stretches them", () => {
    const view = gridWindow({ ...spec, count: 100 })
    expect(view.columns).toBe(4)
    expect(view.tileWidth).toBe(122.5)
    expect(view.totalHeight).toBe(25 * 160 - 10)
  })

  test("renders only the rows in view plus the overscan", () => {
    const view = gridWindow({ ...spec, count: 100, scrollTop: 1600 })
    // Rows 10..12 are in view (1600..2000 px); one more on each side.
    expect([view.first, view.end]).toEqual([9 * 4, 14 * 4])
  })

  test("clamps to the item count and handles an empty list", () => {
    expect(gridWindow({ ...spec, count: 6 })).toMatchObject({ first: 0, end: 6 })
    expect(gridWindow({ ...spec, count: 0 })).toMatchObject({ first: 0, end: 0, totalHeight: 0 })
  })

  test("scrollToShow moves only when the tile is out of view", () => {
    const view = gridWindow({ ...spec, count: 100 })
    expect(scrollToShow(1, view, 0, 400)).toBeNull()
    expect(scrollToShow(40, view, 0, 400)).toBe(10 * 160 + 160 - 400)
    expect(scrollToShow(0, view, 800, 400)).toBe(0)
  })
})

describe("inspector stats", () => {
  test("names swatches from the palette and marks placeholder compose meta", () => {
    const d = describeEntry(entry("k/hut", { swatches: [0] }))
    expect(d.swatches[0]?.hex).toMatch(/^#[0-9a-f]{6}$/)
    expect(d.compose.find((r) => r.label === "source")).toMatchObject({
      value: "placeholder",
      placeholder: true,
    })
  })

  test("keeps scale flags and piece flags apart", () => {
    const d = describeEntry(
      entry("k/hut", {
        flags: ["sunk"],
        scale: { factor: 8, rule: "ref", confidence: "guess", flags: ["undersize"] },
      }),
    )
    expect([d.scaleFlags, d.pieceFlags]).toEqual([["undersize"], ["sunk"]])
    expect(d.scale.find((r) => r.label === "confidence")?.placeholder).toBe(true)
  })
})
