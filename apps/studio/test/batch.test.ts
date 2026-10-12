import { describe, expect, test } from "bun:test"
import type { RecipeInstance } from "@guildhall/assets"
import { batchLayout, DEFAULT_N, parseN } from "../src/batch/layout.ts"

const part = (piece: string, x: number, z: number): RecipeInstance => ({
  piece,
  x,
  y: 0,
  z,
  rot: 0,
  scale: 1,
})
/** A 30-piece house. */
const house = Array.from({ length: 30 }, (_, i) => part(`wall-${i % 3}`, (i % 5) - 2, Math.floor(i / 5) - 3))
const pieces = { houses: [house], trees: ["oak", "pine"], crops: ["wheat"] }
const countOf = (list: { piece: string }[], match: (id: string) => boolean) =>
  list.filter((i) => match(i.piece)).length

describe("batchLayout", () => {
  test("draws the city mix: crops and trees exactly, houses whole to within one house", () => {
    const { instances } = batchLayout(10000, pieces, 7)
    expect(countOf(instances, (id) => id === "wheat")).toBe(5000)
    expect(countOf(instances, (id) => id === "oak" || id === "pine")).toBe(1000)
    const walls = countOf(instances, (id) => id.startsWith("wall"))
    expect(walls).toBeGreaterThanOrEqual(4000)
    expect(walls).toBeLessThan(4000 + house.length)
  })

  test("is the same for the same seed", () => {
    expect(batchLayout(2000, pieces, 3)).toEqual(batchLayout(2000, pieces, 3))
  })

  test("never puts two cells' pieces on one spot: houses turn whole within their cell", () => {
    const { instances } = batchLayout(2000, pieces, 3)
    const spots = new Set(instances.filter((i) => i.piece === "wheat").map((i) => `${i.x},${i.z}`))
    expect(spots.size).toBe(1000)
  })

  test("a role with nothing to draw from gets nothing", () => {
    const { instances, cells } = batchLayout(1000, { houses: [], trees: [], crops: ["wheat"] }, 1)
    expect(instances.length).toBe(500)
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
