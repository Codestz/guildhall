import { describe, expect, test } from "bun:test"
import type { CatalogIndex } from "../src/catalog.ts"
import { createCatalog } from "../src/query.ts"
import { entry } from "./entry.ts"

const index: CatalogIndex = {
  version: 1,
  palette: "deadbeef",
  importer: "test",
  packs: [
    { id: "town", vendor: "kenney", count: 3, hash: "a" },
    { id: "forest", vendor: "kaykit", count: 2, hash: "b" },
  ],
  rigs: [{ id: "rig-medium", file: "rigs/rig-medium.glb", clips: [{ name: "Idle", seconds: 2 }], bones: 40 }],
}

const town = [
  entry({
    id: "town/wall-door",
    name: "Wall door",
    category: "wall",
    tags: ["door", "brick"],
    size: [1, 3, 0.2],
    compose: { front: "+z", streetEdge: "+z", attach: "wall-segment", anchors: [], source: "rule" },
  }),
  entry({
    id: "town/house-a",
    name: "House A",
    category: "building",
    tags: ["brick"],
    size: [6, 7, 5],
    autoTags: { tags: ["tudor"], by: "vision", thumb: "t" },
  }),
  entry({
    id: "town/hut",
    name: "Hut",
    category: "building",
    size: [2, 1, 2],
    flags: ["off-centre"],
    scale: { factor: 2.6, rule: "ref", confidence: "ref", target: [5.5, null], flags: ["undersize"] },
  }),
]
const forest = [
  entry({ id: "forest/pine-tall", name: "Tall pine", category: "tree", tags: ["pine"], size: [3, 8, 3] }),
  entry({
    id: "forest/barrel",
    name: "Barrel",
    tags: ["brick"],
    flags: ["off-centre", "colour-miss"],
    kind: "character",
    character: { rig: "rig-medium", clips: [], bones: 0 },
  }),
]

const catalog = createCatalog(index, [town, forest])
const ids = (list: readonly { id: string }[]) => list.map((e) => e.id)

describe("createCatalog", () => {
  test("all() merges the shards, sorted by id", () => {
    expect(ids(catalog.all())).toEqual([
      "forest/barrel",
      "forest/pine-tall",
      "town/house-a",
      "town/hut",
      "town/wall-door",
    ])
  })

  test("get() and rig() look up by id, undefined when missing", () => {
    expect(catalog.get("town/hut")?.name).toBe("Hut")
    expect(catalog.get("town/nope")).toBeUndefined()
    expect(catalog.rig("rig-medium")?.bones).toBe(40)
    expect(catalog.rig("rig-huge")).toBeUndefined()
  })

  test("throws on a duplicate id across shards", () => {
    expect(() => createCatalog(index, [town, [entry({ id: "town/hut" })]])).toThrow('duplicate id "town/hut"')
  })

  test("an empty catalog is fine", () => {
    const empty = createCatalog({ ...index, rigs: [] }, [])
    expect(empty.all()).toEqual([])
    expect(empty.facets()).toEqual({ pack: {}, category: {}, tag: {}, flag: {} })
  })
})

describe("query", () => {
  test("an empty query returns everything", () => {
    expect(catalog.query({})).toHaveLength(5)
  })

  test("text: every word must match id, name, category or a tag, case-insensitive", () => {
    expect(ids(catalog.query({ text: "PINE" }))).toEqual(["forest/pine-tall"])
    expect(ids(catalog.query({ text: "brick door" }))).toEqual(["town/wall-door"])
    expect(ids(catalog.query({ text: "tudor" }))).toEqual(["town/house-a"])
    expect(ids(catalog.query({ text: "  building  " }))).toEqual(["town/house-a", "town/hut"])
    expect(catalog.query({ text: "castle" })).toEqual([])
  })

  test("pack, category, kind and attach are exact", () => {
    expect(ids(catalog.query({ pack: "forest" }))).toEqual(["forest/barrel", "forest/pine-tall"])
    expect(ids(catalog.query({ category: "building" }))).toEqual(["town/house-a", "town/hut"])
    expect(ids(catalog.query({ kind: "character" }))).toEqual(["forest/barrel"])
    expect(ids(catalog.query({ attach: "wall-segment" }))).toEqual(["town/wall-door"])
  })

  test("tags must all be present, auto tags included", () => {
    expect(ids(catalog.query({ tags: ["brick"] }))).toEqual([
      "forest/barrel",
      "town/house-a",
      "town/wall-door",
    ])
    expect(ids(catalog.query({ tags: ["brick", "door"] }))).toEqual(["town/wall-door"])
    expect(ids(catalog.query({ tags: ["brick", "tudor"] }))).toEqual(["town/house-a"])
  })

  test("flags must all be raised, piece and scale flags alike", () => {
    expect(ids(catalog.query({ flags: ["off-centre"] }))).toEqual(["forest/barrel", "town/hut"])
    expect(ids(catalog.query({ flags: ["off-centre", "undersize"] }))).toEqual(["town/hut"])
  })

  test("min/max size bound each axis, inclusive", () => {
    expect(ids(catalog.query({ minSize: [0, 5, 0] }))).toEqual(["forest/pine-tall", "town/house-a"])
    expect(ids(catalog.query({ minSize: [0, 7, 0], maxSize: [6, 7, 5] }))).toEqual(["town/house-a"])
    expect(ids(catalog.query({ maxSize: [1, 3, 1] }))).toEqual(["forest/barrel", "town/wall-door"])
  })

  test("filters combine", () => {
    expect(ids(catalog.query({ pack: "town", tags: ["brick"], category: "building" }))).toEqual([
      "town/house-a",
    ])
  })
})

describe("facets", () => {
  test("counts packs, categories, tags (auto tags too) and flags (scale flags too)", () => {
    expect(catalog.facets()).toEqual({
      pack: { forest: 2, town: 3 },
      category: { prop: 1, tree: 1, building: 2, wall: 1 },
      tag: { brick: 3, pine: 1, tudor: 1, door: 1 },
      flag: { "off-centre": 2, "colour-miss": 1, undersize: 1 },
    })
  })

  test("over a query result", () => {
    expect(catalog.facets(catalog.query({ pack: "forest" })).category).toEqual({ prop: 1, tree: 1 })
  })
})
