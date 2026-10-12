import { describe, expect, test } from "bun:test"
import { farTilesOf, holesOf, patchesOf } from "../src/scene/archipelago/footprint.ts"
import { depthsOf } from "../src/scene/archipelago/view.ts"
import { outreachOf, shoreTilesOf } from "../src/scene/nature/shoreTiles.ts"
import {
  type Footprint,
  HOME_HALF,
  type IslandSeed,
  PATCH_HALF,
  placeIslands,
  SEA_CELL,
  SEA_GAP,
} from "../src/world/archipelago.ts"
import type { Archipelago, FarIsland } from "../src/world/archipelagoSource.ts"
import { islandFromTree } from "../src/world/gen/islandFromTree.ts"
import type { RepoEntry } from "../src/world/gen/repo.ts"
import type { Spot } from "../src/world/layout.ts"
import { handWorld, reachOf, repoWorld, type World } from "../src/world/world.ts"
import HINDSIGHT from "./fixtures/repos/codestz__claude-hindsight.json"
import MCPX from "./fixtures/repos/codestz__mcpx.json"
import MINTROOT from "./fixtures/repos/codestz__mintroot.json"
import COCKPIT from "./fixtures/repos/codestz__opencode-cockpit.json"
import REACT from "./fixtures/repos/facebook__react.json"

/**
 * The archipelago under generator 2 (`?gen=2`): islands up to React's size (±240), placed by how far
 * they reach and by the squares of water they are drawn in, whatever mix of sizes.
 */

type Fixture = { repo: string; entries: RepoEntry[] }
const grow = ({ repo, entries }: Fixture): World =>
  repoWorld(islandFromTree(entries, 0, 2), { repo, source: "fixture", gen: 2 })

const REACT_WORLD = grow(REACT as Fixture)
const FAR = [HINDSIGHT, MCPX, COCKPIT, MINTROOT].map((fixture) => grow(fixture as Fixture))

const footprint = (world: World, far: boolean): Footprint => ({
  reach: reachOf(world),
  patches: patchesOf(world, far),
})
const cheb = (a: Spot, b: Spot): number => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]))
const moved = (at: Spot, [x, z]: Spot): Spot => [at[0] + x, at[1] + z]

/** Every pair of islands keeps its gap of sea and shares no square of water. */
function expectApart(islands: readonly { at: Spot; reach: number; patches: Footprint["patches"] }[]): void {
  for (const [i, a] of islands.entries())
    for (const b of islands.slice(i + 1)) {
      expect(Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1])).toBeGreaterThanOrEqual(
        a.reach + b.reach + SEA_GAP,
      )
      for (const p of a.patches)
        for (const q of b.patches)
          expect(cheb(moved(a.at, p.at), moved(b.at, q.at))).toBeGreaterThanOrEqual(p.half + q.half)
    }
}

describe("a far island's footprint", () => {
  test("a big generator-2 island is drawn as shore tiles, at the far island's coarser bake", () => {
    expect(outreachOf(REACT_WORLD)).toBeGreaterThan(1)
    const tiles = farTilesOf(REACT_WORLD)
    expect(tiles.length).toBeGreaterThan(1)
    expect(tiles.map((tile) => tile.at)).toEqual(shoreTilesOf(REACT_WORLD).map((tile) => tile.at))
    for (const tile of tiles) expect(tile.size).toBeLessThan(shoreTilesOf(REACT_WORLD)[0]?.size ?? 0)
    // Stable per world: a bake is kept by its layout's identity.
    expect(farTilesOf(REACT_WORLD)).toBe(tiles)
  })

  test("a small island keeps its one patch, and the tiles hold all of a big one's coast", () => {
    const small = FAR.find((world) => outreachOf(world) === 1) as World
    expect(patchesOf(small, true)).toEqual([{ at: [0, 0], half: PATCH_HALF }])
    expect(farTilesOf(small)).toEqual([])
    const coast = REACT_WORLD.island.tiles.filter((tile) => tile.piece.startsWith("hex_coast"))
    const squares = patchesOf(REACT_WORLD, true)
    for (const tile of coast)
      expect(squares.some(({ at, half }) => cheb([tile.x, tile.z], at) <= half)).toBe(true)
  })

  test("the home island is its own bake, or its tiles when it is big", () => {
    expect(patchesOf(handWorld(), false)).toEqual([{ at: [0, 0], half: HOME_HALF }])
    expect(patchesOf(REACT_WORLD, false).length).toBe(shoreTilesOf(REACT_WORLD).length)
  })

  test("a far island's holes in the sea are its squares of water, where it lies", () => {
    const island = { at: [600, -40], world: REACT_WORLD } as unknown as FarIsland
    const holes = holesOf(island)
    expect(holes.map((hole) => hole.at)).toEqual(
      patchesOf(REACT_WORLD, true).map(({ at }) => moved(island.at, at)),
    )
    for (const hole of holes) expect(hole.half).toBeGreaterThan(0)
  })
})

describe("placing big islands", () => {
  const home = footprint(handWorld(), false)
  const seeds = (worlds: World[], names: string[]): IslandSeed[] =>
    worlds.map((world, i) => ({ repo: names[i] as string, ...footprint(world, true) }))

  test("React among four others: no shared water, a sea gap, on the sea grid", () => {
    const worlds = [REACT_WORLD, ...FAR]
    const placed = placeIslands(
      seeds(worlds, ["facebook/react", "a/hindsight", "a/mcpx", "a/cockpit", "a/mintroot"]),
      home,
    )
    const all = [
      { at: [0, 0] as Spot, ...home },
      ...worlds.map((world, i) => ({ at: placed[i] as Spot, ...footprint(world, true) })),
    ]
    expectApart(all)
    for (const at of placed) {
      expect(Math.abs(at[0] % SEA_CELL)).toBe(0)
      expect(Math.abs(at[1] % SEA_CELL)).toBe(0)
    }
  })

  test("a big home island (React) keeps every far island clear of it", () => {
    const bigHome = footprint(REACT_WORLD, false)
    const placed = placeIslands(seeds(FAR, ["a/hindsight", "a/mcpx", "a/cockpit", "a/mintroot"]), bigHome)
    expectApart([
      { at: [0, 0], ...bigHome },
      ...FAR.map((world, i) => ({ at: placed[i] as Spot, ...footprint(world, true) })),
    ])
    // Out past the home island's own land: the old ring (300) would sit in it.
    for (const at of placed) expect(Math.hypot(at[0], at[1])).toBeGreaterThan(bigHome.reach)
  })

  test("the same repos land in the same places", () => {
    const names = ["facebook/react", "a/hindsight", "a/mcpx", "a/cockpit", "a/mintroot"]
    const worlds = [REACT_WORLD, ...FAR]
    expect(placeIslands(seeds(worlds, names), home)).toEqual(placeIslands(seeds(worlds, names), home))
  })

  test("a bigger island stands further out than a small one, in the same slot", () => {
    const slot = (world: World) =>
      placeIslands([{ repo: "owner/slot", ...footprint(world, true) }], home)[0] as Spot
    const small = FAR.find((world) => outreachOf(world) === 1) as World
    expect(Math.hypot(...slot(REACT_WORLD))).toBeGreaterThan(Math.hypot(...slot(small)))
  })
})

describe("the cameras over a big archipelago", () => {
  const at = (extent: number) => depthsOf({ extent } as Archipelago)

  test("a default-sized archipelago keeps the depths it always had", () => {
    expect(at(400)).toEqual({ back: 1200, orthoFar: 2600, far: 3600 })
  })

  test("a bigger one stands back and sees further, in proportion", () => {
    const wide = at(900)
    expect(wide.back).toBeGreaterThan(1200)
    expect(wide.orthoFar).toBeGreaterThan(wide.back)
    expect(wide.far).toBeGreaterThan(wide.orthoFar)
  })
})
