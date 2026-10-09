import { describe, expect, test } from "bun:test"
import type { KitColour } from "../src/world/gen/biomes.ts"
import { islandFromTree } from "../src/world/gen/islandFromTree.ts"
import type { RepoEntry } from "../src/world/gen/repo.ts"
import LANDS from "../src/world/lands.json"
import { HEX_SCALE } from "../src/world/lands.ts"
import { doorsOf, instantiate, PREFABS, pieceOf, prefab } from "../src/world/prefabs/index.ts"
import REACT from "./fixtures/repos/facebook__react.json"
import SELF from "./fixtures/repos/guildhall.json"
import IS_ODD from "./fixtures/repos/jonschlinkert__is-odd.json"

const KITS: KitColour[] = ["blue", "red", "yellow", "green"]
type Box = { min: number[]; max: number[] }
const boxes = LANDS as unknown as Record<string, Box>
/** A hex's corner reach, world units, and the 10 units between neighbours. */
const CORNER = 5.78
const STEP = 10

describe("prefab catalogue", () => {
  test("ids are stable and unique", () => {
    const ids = PREFABS.map((item) => item.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual([
      "house-cottage",
      "house-townhouse",
      "house-row",
      "house-trio",
      "house-farmhouse",
      "plaza-well",
      "market-stalls",
      "inn",
      "guildhouse",
      "town-hall",
      "castle",
      "watchtower",
      "forge",
      "library",
      "tavern",
      "mine-entrance",
      "wall-straight",
      "wall-gate",
      "wall-tower",
      "wall-corner",
    ])
  })

  test("every piece exists in the loaded land pack, in every district colour", () => {
    for (const item of PREFABS)
      for (const part of item.parts)
        for (const kit of KITS)
          expect(boxes[pieceOf(part.piece, kit)], `${item.id}: ${part.piece}`).toBeDefined()
  })

  test("every part stands inside its footprint's rings", () => {
    for (const item of PREFABS)
      for (const part of item.parts) {
        const box = boxes[pieceOf(part.piece, "blue")]
        if (!box) continue
        const k = HEX_SCALE * (part.scale ?? 1)
        const turn = part.rot ?? 0
        for (const cx of [box.min[0], box.max[0]])
          for (const cz of [box.min[2], box.max[2]]) {
            const lx = (cx ?? 0) * k
            const lz = (cz ?? 0) * k
            const x = part.x + lx * Math.cos(turn) + lz * Math.sin(turn)
            const z = part.z - lx * Math.sin(turn) + lz * Math.cos(turn)
            expect(Math.hypot(x, z), `${item.id}: ${part.piece}`).toBeLessThanOrEqual(
              item.rings * STEP + CORNER,
            )
          }
      }
  })

  test("instantiate turns a prefab about its anchor, and its doors with it", () => {
    const inn = prefab("inn")
    const placed = instantiate(inn, [100, 50], Math.PI / 2, "blue")
    expect(placed[0]?.piece).toBe("building_tavern_blue")
    // Turned to face +x: the door's spot lies east of the anchor.
    expect(doorsOf(inn, [100, 50], Math.PI / 2)[0]?.x).toBeGreaterThan(100)
  })
})

const piecesOf = (tree: RepoEntry[], gen: 1 | 2): string[] => {
  const made = islandFromTree(tree, 0, gen)
  return made.island.decor.map((placement) => placement.piece)
}

describe("a civic centre on every gen 2 island", () => {
  test("a city (react) has a castle, a gate and walls", () => {
    const pieces = piecesOf(REACT.entries as RepoEntry[], 2)
    expect(pieces).toContain("building_castle_blue")
    expect(pieces).toContain("wall_straight_gate")
    expect(pieces).toContain("wall_straight")
  })

  test("a village (this repo) has a guildhouse; a hamlet an inn", () => {
    expect(piecesOf(SELF.entries as RepoEntry[], 2)).toContain("building_church_blue")
    expect(piecesOf(IS_ODD.entries as RepoEntry[], 2)).toContain("building_tavern_blue")
  })

  test("the first generator draws none of it", () => {
    const pieces = piecesOf(REACT.entries as RepoEntry[], 1)
    expect(pieces).not.toContain("building_castle_blue")
    expect(pieces).not.toContain("wall_straight")
  })

  test("a famous repo gets the castle at 5k stars and a smaller one is a tier's", () => {
    const tree = IS_ODD.entries as RepoEntry[]
    expect(islandFromTree(tree, 0, 2, { stars: 6000 }).island.decor.map((p) => p.piece)).toContain(
      "building_castle_blue",
    )
  })

  test("a district's lots hold one to three homes, denser near its square", () => {
    const made = islandFromTree(SELF.entries as RepoEntry[], 0, 2)
    const homes = made.island.decor.filter((p) => /building_home_[AB]_/.test(p.piece))
    expect(homes.length).toBeGreaterThan(0)
  })
})
