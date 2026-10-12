import { describe, expect, test } from "bun:test"
import type { RecipeInstance } from "@guildhall/assets"
import type { BatchCluster } from "@guildhall/render"
import { batchLayout, CELL, DEFAULT_N, parseN } from "../src/batch/layout.ts"

const part = (piece: string, x: number, z: number): RecipeInstance => ({
  piece,
  x,
  y: 0,
  z,
  rot: 0,
  scale: 1,
})
/** A 30-piece house. */
const house = {
  key: "house:1",
  parts: Array.from({ length: 30 }, (_, i) => part(`wall-${i % 3}`, (i % 5) - 2, Math.floor(i / 5) - 3)),
}
const pieces = { houses: [house], trees: ["oak", "pine"], crops: ["wheat"] }
const partsOf = (clusters: BatchCluster[], match: (id: string) => boolean) =>
  clusters.flatMap((cluster) => cluster.parts.filter((p) => match(p.piece)).map((p) => ({ cluster, p })))

describe("batchLayout", () => {
  test("draws the city mix: crops and trees exactly, houses whole to within one house", () => {
    const { clusters } = batchLayout(10000, pieces, 7)
    expect(partsOf(clusters, (id) => id === "wheat").length).toBe(5000)
    expect(partsOf(clusters, (id) => id === "oak" || id === "pine").length).toBe(1000)
    const walls = partsOf(clusters, (id) => id.startsWith("wall")).length
    expect(walls).toBeGreaterThanOrEqual(4000)
    expect(walls).toBeLessThan(4000 + house.parts.length)
  })

  test("every cell is one cluster at its centre: houses keyed by recipe and seed, fields and woods their own", () => {
    const { clusters, cells } = batchLayout(2000, pieces, 3)
    expect(clusters.length).toBe(cells.house + cells.field + cells.wood)
    expect(clusters.every((c) => c.x % CELL === 0 && c.z % CELL === 0)).toBe(true)
    const houses = clusters.filter((c) => c.parts[0]?.piece.startsWith("wall"))
    expect(houses.every((c) => c.key === house.key)).toBe(true)
    const others = clusters.filter((c) => !houses.includes(c)).map((c) => c.key)
    expect(new Set(others).size).toBe(others.length)
  })

  test("is the same for the same seed", () => {
    expect(batchLayout(2000, pieces, 3)).toEqual(batchLayout(2000, pieces, 3))
  })

  test("never puts two cells' pieces on one spot", () => {
    const { clusters } = batchLayout(2000, pieces, 3)
    const wheat = partsOf(clusters, (id) => id === "wheat")
    const spots = new Set(wheat.map(({ cluster, p }) => `${cluster.x + p.x},${cluster.z + p.z}`))
    expect(spots.size).toBe(1000)
  })

  test("a role with nothing to draw from gets nothing", () => {
    const { clusters, cells } = batchLayout(1000, { houses: [], trees: [], crops: ["wheat"] }, 1)
    expect(partsOf(clusters, () => true).length).toBe(500)
    expect([cells.house, cells.wood]).toEqual([0, 0])
  })
})

describe("parseN", () => {
  test("reads a count, defaults when absent or junk, and caps it", () => {
    expect(parseN("2000")).toBe(2000)
    expect(parseN(null)).toBe(DEFAULT_N)
    expect(parseN("lots")).toBe(DEFAULT_N)
    expect(parseN("-3")).toBe(DEFAULT_N)
    expect(parseN("999999")).toBe(50000)
  })
})
