import { describe, expect, test } from "bun:test"
import { SHORE } from "../src/scene/nature/shore.ts"
import { outreachOf, shoreTilesOf, spanOf } from "../src/scene/nature/shoreTiles.ts"
import { SEA_CELL } from "../src/world/archipelago.ts"
import { islandFromTree } from "../src/world/gen/islandFromTree.ts"
import type { RepoEntry } from "../src/world/gen/repo.ts"
import { handWorld, repoWorld } from "../src/world/world.ts"
import MCPX from "./fixtures/repos/codestz__mcpx.json"
import REACT from "./fixtures/repos/facebook__react.json"

const grown = (entries: RepoEntry[], gen: 1 | 2) =>
  repoWorld(islandFromTree(entries, 0, gen), {
    repo: "x/y",
    source: "fixture",
    ...(gen === 2 ? { gen } : {}),
  })
const react = grown(REACT.entries as RepoEntry[], 2)

describe("shore tiles", () => {
  test("an island the one bake holds keeps it: the hand map, every v1 island, a small v2 island", () => {
    for (const world of [
      handWorld(),
      grown(REACT.entries as RepoEntry[], 1),
      grown(MCPX.entries as RepoEntry[], 2),
    ]) {
      expect(outreachOf(world)).toBe(1)
      expect(shoreTilesOf(world)).toEqual([{ at: [0, 0], half: SHORE.half, size: SHORE.size }])
    }
  })

  test("a big island reaches past the one bake, and is tiled at its size and density", () => {
    expect(outreachOf(react)).toBeGreaterThan(1)
    const tiles = shoreTilesOf(react)
    expect(tiles.length).toBeGreaterThan(1)
    for (const tile of tiles) {
      expect(tile.half).toBe(SHORE.half)
      expect(tile.size).toBe(SHORE.size)
      expect(Math.abs(tile.at[0] % SEA_CELL)).toBe(0)
      expect(Math.abs(tile.at[1] % SEA_CELL)).toBe(0)
    }
  })

  test("tiles never overlap", () => {
    const tiles = shoreTilesOf(react)
    for (const a of tiles)
      for (const b of tiles)
        if (a !== b)
          expect(Math.max(Math.abs(a.at[0] - b.at[0]), Math.abs(a.at[1] - b.at[1]))).toBeGreaterThanOrEqual(
            2 * SHORE.half,
          )
  })

  test("every coast hex lies inside a tile, and every tile holds coast", () => {
    const tiles = shoreTilesOf(react)
    const coast = react.island.tiles.filter((tile) => tile.piece.startsWith("hex_coast"))
    const inside = (x: number, z: number, at: readonly [number, number], margin = 0) =>
      Math.abs(x - at[0]) <= SHORE.half + margin && Math.abs(z - at[1]) <= SHORE.half + margin
    for (const hex of coast) expect(tiles.some((tile) => inside(hex.x, hex.z, tile.at))).toBe(true)
    for (const tile of tiles) expect(coast.some((hex) => inside(hex.x, hex.z, tile.at, 20))).toBe(true)
  })

  test("the land fits the tiles' squares, nearest the keep first", () => {
    const tiles = shoreTilesOf(react)
    const half =
      Math.max(...tiles.map((tile) => Math.max(Math.abs(tile.at[0]), Math.abs(tile.at[1])))) + SHORE.half
    expect(spanOf(react)).toBeLessThanOrEqual(half)
    const distances = tiles.map((tile) => Math.hypot(...tile.at))
    expect(distances).toEqual([...distances].sort((a, b) => a - b))
  })

  test("one tiling per world", () => {
    expect(shoreTilesOf(react)).toBe(shoreTilesOf(react))
  })
})
