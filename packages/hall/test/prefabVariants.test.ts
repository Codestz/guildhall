import { describe, expect, test } from "bun:test"
import { statSync } from "node:fs"
import { islandFromTree } from "../src/world/gen/islandFromTree.ts"
import type { RepoEntry } from "../src/world/gen/repo.ts"
import { HEX_SCALE, PIECES } from "../src/world/lands.ts"
import {
  doorsOf,
  instantiate,
  KITS,
  type PieceInfo,
  PREFABS,
  pieceOf,
  prefab,
  resolve,
  statsOf,
} from "../src/world/prefabs/index.ts"
import REACT from "./fixtures/repos/facebook__react.json"
import SELF from "./fixtures/repos/guildhall.json"

const varying = PREFABS.filter((item) => item.variation)
const SEEDS = Array.from({ length: 60 }, (_, n) => n + 1)
const CORNER = 5.78
const STEP = 10

describe("seeded variants", () => {
  test("seed 0 is the plain prefab the catalogue draws", () => {
    for (const item of varying)
      expect(instantiate(item, [10, 20], 0.7, "red", 0, 0)).toEqual(instantiate(item, [10, 20], 0.7, "red"))
  })

  test("a seed always makes the same structure", () => {
    const cottage = prefab("house-cottage")
    for (const seed of SEEDS.slice(0, 10))
      expect(instantiate(cottage, [0, 0], 0, "blue", 0, seed)).toEqual(
        instantiate(cottage, [0, 0], 0, "blue", 0, seed),
      )
  })

  test("homes show all four team colours across seeds, the district's colour most often", () => {
    const cottage = prefab("house-cottage")
    const kits = SEEDS.map((seed) => resolve(cottage, seed, "red").kit)
    expect(new Set(kits)).toEqual(new Set(KITS))
    expect(kits.filter((kit) => kit === "red").length).toBeGreaterThan(SEEDS.length / 2)
  })

  test("a mirrored variant flips its layout and its doors together", () => {
    const row = prefab("house-row")
    const seed = SEEDS.find((n) => resolve(row, n, "blue").mirrored) ?? 0
    expect(seed).toBeGreaterThan(0)
    const plain = doorsOf(row, [0, 0], 0)
    const flipped = doorsOf(row, [0, 0], 0, seed)
    expect(flipped.map((d) => d.x)).toEqual(plain.map((d) => -d.x))
    const parts = instantiate(row, [0, 0], 0, "blue", 0, seed)
    expect(parts[0]?.x).toBeCloseTo(-(instantiate(row, [0, 0], 0, "blue")[0]?.x ?? 0))
  })

  test("swaps and props change what stands: the market's awning, the inn's flag", () => {
    const awnings = SEEDS.map((seed) => resolve(prefab("market-stalls"), seed, "blue").parts[0]?.piece)
    expect(new Set(awnings)).toEqual(new Set(["building_market_red", "building_market_blue"]))
    const sizes = SEEDS.map((seed) => resolve(prefab("inn"), seed, "blue").parts.length)
    expect(new Set(sizes).size).toBeGreaterThan(2)
  })

  test("a prefab that does not vary ignores the seed", () => {
    const castle = prefab("castle")
    expect(instantiate(castle, [0, 0], 0, "blue", 0, 9)).toEqual(instantiate(castle, [0, 0], 0, "blue"))
  })

  test("only what has no lit windows or chimneys may mirror (the world lights them unflipped)", () => {
    for (const item of varying)
      if (item.variation?.mirror) expect(item.windows ?? item.chimneys, item.id).toBeUndefined()
  })

  test("every variant's pieces exist in every colour and stand inside its footprint", () => {
    for (const item of varying)
      for (const seed of SEEDS)
        for (const kit of KITS)
          for (const part of resolve(item, seed, kit).parts) {
            const box = PIECES[pieceOf(part.piece, kit)]
            expect(box, `${item.id}#${seed}: ${part.piece}`).toBeDefined()
            if (!box) continue
            const k = HEX_SCALE * (part.scale ?? 1)
            for (const cx of [box.min[0], box.max[0]])
              for (const cz of [box.min[2], box.max[2]]) {
                const [lx, lz] = [(cx ?? 0) * k, (cz ?? 0) * k]
                const [sin, cos] = [Math.sin(part.rot ?? 0), Math.cos(part.rot ?? 0)]
                const x = part.x + lx * cos + lz * sin
                const z = part.z - lx * sin + lz * cos
                expect(Math.hypot(x, z), `${item.id}#${seed}: ${part.piece}`).toBeLessThanOrEqual(
                  item.rings * STEP + CORNER,
                )
              }
          }
  })
})

describe("prefab stats", () => {
  const info = (piece: string): PieceInfo | undefined =>
    piece === "barrel"
      ? { tris: 100, bytes: 2000, meshes: 2, material: "a" }
      : piece.startsWith("building_")
        ? { tris: 1000, bytes: 30000, meshes: 1, material: "a" }
        : undefined

  test("counts parts, triangles, draw calls and bytes of the distinct pieces", () => {
    const stats = statsOf(prefab("house-cottage"), 0, "blue", info)
    expect(stats.parts.map((p) => p.piece)).toContain("building_home_A_blue")
    expect(stats.tris).toBe(1100)
    expect(stats.draws).toEqual({ loose: 3, batched: 1 })
    expect(stats.bytes).toBe(32000)
    expect(stats.unknown).toBe(1)
    expect(stats.doors).toBe(1)
  })

  test("a variant's props count in its parts", () => {
    const cottage = prefab("house-cottage")
    const seed = SEEDS.find((n) => resolve(cottage, n, "blue").parts.length > cottage.parts.length) ?? 0
    expect(statsOf(cottage, seed, "blue", info).parts.reduce((sum, p) => sum + p.count, 0)).toBeGreaterThan(
      cottage.parts.length,
    )
  })
})

describe("the second town kit", () => {
  const pieces = (tree: RepoEntry[], gen: 1 | 2): string[] =>
    islandFromTree(tree, 0, gen).island.decor.map((placement) => placement.piece)

  test("gen 2 towns draw homes in more than one team colour; gen 1 uses none of the second kit", () => {
    const two = pieces(REACT.entries as RepoEntry[], 2)
    const colours = new Set(two.flatMap((p) => /^building_home_[AB]_(\w+)$/.exec(p)?.[1] ?? []))
    expect(colours.size).toBeGreaterThan(1)
    expect(pieces(REACT.entries as RepoEntry[], 1).some((p) => p.startsWith("t2_"))).toBe(false)
  })

  test("a city has a chapel, and the second kit's pieces are all in the bundle's bounds", () => {
    const two = pieces(REACT.entries as RepoEntry[], 2)
    expect(two).toContain("t2_roof_high_gable")
    for (const piece of pieces(SELF.entries as RepoEntry[], 2))
      expect(PIECES[piece as keyof typeof PIECES]).toBeDefined()
  })

  test("the bundle stays under the lazy budget (400 KB)", () => {
    expect(statSync(`${import.meta.dir}/../public/assets/town2.glb`).size).toBeLessThan(400 * 1024)
  })
})
