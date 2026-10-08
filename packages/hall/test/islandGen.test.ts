import { describe, expect, test } from "bun:test"
import { biomeOf, languageOf } from "../src/world/gen/biomes.ts"
import type { RepoIsland } from "../src/world/gen/dress.ts"
import { cellAt, key, neighbours, rng, unkey } from "../src/world/gen/hex.ts"
import { islandFromTree } from "../src/world/gen/islandFromTree.ts"
import { extentOf, KEEP, LAND_HALF, quotaOf } from "../src/world/gen/plan.ts"
import { MAX_DISTRICTS, MAX_PACKAGES, type RepoEntry, summarize } from "../src/world/gen/repo.ts"
import { fit, PATH_TILES, turn } from "../src/world/gen/tiles.ts"
import { cellToWorld, island, MAP_FOR_TESTS } from "../src/world/lands.ts"
import type { Spot } from "../src/world/layout.ts"
import REACT from "./fixtures/repos/facebook__react.json"
import SELF from "./fixtures/repos/guildhall.json"
import IS_ODD from "./fixtures/repos/jonschlinkert__is-odd.json"

const FIXTURES = {
  guildhall: SELF.entries as RepoEntry[],
  "is-odd": IS_ODD.entries as RepoEntry[],
  react: REACT.entries as RepoEntry[],
}

/** A made-up tree: folder → [files, bytes per file, depth]. */
function treeOf(folders: Record<string, readonly [number, number, number?]>): RepoEntry[] {
  const entries: RepoEntry[] = [{ path: "README.md", type: "blob", size: 2000 }]
  for (const [folder, [files, bytes, depth = 1]] of Object.entries(folders)) {
    entries.push({ path: folder, type: "tree" })
    const dir = [folder, ...Array.from({ length: depth - 1 }, (_, i) => `d${i}`)].join("/")
    for (let i = 0; i < files; i++) entries.push({ path: `${dir}/f${i}.ts`, type: "blob", size: bytes })
  }
  return entries
}

/** Random trees for the invariants: 1–16 folders of any size, depth and name. */
const RANDOM: RepoEntry[][] = Array.from({ length: 24 }, (_, n) => {
  const random = rng(n + 1)
  const folders: Record<string, [number, number, number]> = {}
  const count = 1 + Math.floor(random() * 16)
  for (let i = 0; i < count; i++)
    folders[`dir${Math.floor(random() * 1000)}`] = [
      1 + Math.floor(random() * 300),
      Math.floor(random() * 40_000),
      1 + Math.floor(random() * 6),
    ]
  return treeOf(folders)
})

const ALL: [string, RepoIsland][] = [
  ...Object.entries(FIXTURES).map(([name, tree]) => [name, islandFromTree(tree)] as [string, RepoIsland]),
  ...RANDOM.map((tree, i) => [`random ${i}`, islandFromTree(tree)] as [string, RepoIsland]),
]

const landAt = (made: RepoIsland, spot: Spot) => made.plan.land.get(key(cellAt(spot)))

describe("islandFromTree", () => {
  test("the same tree grows the same island, whatever order its entries come in", () => {
    const tree = FIXTURES.guildhall
    const shuffled = [...tree].reverse()
    expect(islandFromTree(shuffled)).toEqual(islandFromTree(tree))
  })

  test("a different seed re-rolls it; a different tree grows a different one", () => {
    const tree = FIXTURES.guildhall
    expect(islandFromTree(tree, 1).island.tiles).not.toEqual(islandFromTree(tree).island.tiles)
    const edited = [...tree, { path: "packages/new.ts", type: "blob", size: 10 } as RepoEntry]
    expect(islandFromTree(edited).plan.hash).not.toBe(islandFromTree(tree).plan.hash)
  })

  test("every district's road is reached from the harbour", () => {
    for (const [name, made] of ALL) {
      const seen = new Set(["HARBOUR"])
      for (let grew = true; grew; ) {
        grew = false
        for (const [a, b] of made.roads.edges)
          if (seen.has(a) !== seen.has(b)) {
            seen.add(a)
            seen.add(b)
            grew = true
          }
      }
      expect({ name, unreached: made.districts.filter((d) => !seen.has(d.node)).map((d) => d.id) }).toEqual({
        name,
        unreached: [],
      })
    }
  })

  test("road edges join neighbouring hexes, every road node on a road hex", () => {
    for (const [, made] of ALL) {
      for (const [a, b] of made.roads.edges) {
        const pa = made.roads.nodes[a] ?? [0, 0]
        const pb = made.roads.nodes[b] ?? [0, 0]
        expect(Math.hypot(pa[0] - pb[0], pa[1] - pb[1])).toBeCloseTo(10, 3)
      }
      for (const spot of Object.values(made.roads.nodes)) expect(landAt(made, spot)?.char).toBe("=")
    }
  })

  test("nothing stands on water: roads, posts, landmarks, buildings and trees are on land", () => {
    for (const [name, made] of ALL) {
      const spots: [string, Spot][] = [
        ...Object.entries(made.roads.nodes),
        ...made.districts.flatMap((d) =>
          d.posts.map((p) => [`post ${d.id}`, [p[0], p[1]]] as [string, Spot]),
        ),
        ...made.districts.map((d) => [`site ${d.id}`, d.at] as [string, Spot]),
        // The quay's planks, cargo and dock sit low over the bay, on purpose.
        ...made.island.decor
          .filter((d) => (d.y ?? 0) >= 0)
          .map((d) => [d.piece, [d.x, d.z]] as [string, Spot]),
      ]
      const wet = spots.filter(([, spot]) => !landAt(made, spot)).map(([what, spot]) => `${what} @ ${spot}`)
      expect({ name, wet }).toEqual({ name, wet: [] })
      for (const spot of made.island.water) expect(landAt(made, spot)).toBeUndefined()
    }
  })

  test("posts stand on level ground, clear of buildings", () => {
    for (const [, made] of ALL) {
      const buildings = made.island.decor.filter(
        (d) => d.piece.startsWith("building_") && !/dirt|bridge/.test(d.piece),
      )
      for (const district of made.districts)
        for (const post of district.posts) {
          expect(["=", "s", ".", "f", "v"]).toContain(landAt(made, [post[0], post[1]])?.char ?? "~")
          for (const house of buildings)
            expect(Math.hypot(house.x - post[0], house.z - post[1])).toBeGreaterThan(3)
        }
    }
  })

  test("no tree grows through a building", () => {
    for (const [, made] of ALL) {
      const { decor } = made.island
      const buildings = decor.filter((d) => d.piece.startsWith("building_") && d.piece !== "building_dirt")
      for (const tree of decor.filter((d) => /^trees?_/.test(d.piece) && !/_cut$/.test(d.piece)))
        for (const house of buildings)
          expect(Math.hypot(tree.x - house.x, tree.z - house.z)).toBeGreaterThan(3)
    }
  })

  test("every island fits inside the shore's bake, ±LAND_HALF along x and z", () => {
    for (const [name, made] of ALL)
      expect({ name, fits: extentOf(made.plan) <= LAND_HALF }).toEqual({ name, fits: true })
    // A big monorepo shrinks to fit rather than spilling past it.
    const big = islandFromTree(
      treeOf(
        Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`pkg${i}`, [300, 40_000, 3] as const])),
      ),
    )
    expect(extentOf(big.plan)).toBeLessThanOrEqual(LAND_HALF)
  })

  test("the keep stands at the origin, its gate opening down the avenue onto the harbour's hub", () => {
    for (const [name, made] of ALL) {
      for (const [id, char] of KEEP)
        expect({ name, id, char: made.plan.land.get(id)?.char }).toEqual({ name, id, char })
      expect(made.roads.nodes.HARBOUR).toEqual(cellToWorld(made.plan.hub))
      expect(made.plan.land.get("0,2")?.char).toBe("=")
      expect(made.roads.edges).toContainEqual(["HARBOUR", "R0_4"])
    }
  })

  test("land scales with code size, log-scaled", () => {
    const made = islandFromTree(treeOf({ big: [100, 10_000], small: [10, 1000] }))
    const hexes = (id: string) => made.districts.find((d) => d.id === id)?.hexes ?? 0
    expect(hexes("big")).toBeGreaterThan(hexes("small") * 2)
    // A thousand times the code is nowhere near a thousand times the land.
    expect(quotaOf(10 << 20)).toBeLessThan(quotaOf(10 << 10) * 4)
    expect(quotaOf(2048)).toBeGreaterThan(quotaOf(1024))
    expect(islandFromTree(FIXTURES.react).plan.land.size).toBeGreaterThan(
      islandFromTree(FIXTURES["is-odd"]).plan.land.size * 5,
    )
  })

  test("deep folders rise into hills; flat ones stay level", () => {
    const made = islandFromTree(treeOf({ deep: [60, 4000, 5], flat: [60, 4000, 1] }))
    const level = (id: string) => made.plan.districts.find((d) => d.folder.name === id)?.level
    expect(level("deep")).toBe(2)
    expect(level("flat")).toBe(0)
    const raised = (i: number) =>
      [...made.plan.land.values()].filter((hex) => hex.district === i && /[HmM]/.test(hex.char)).length
    const deep = made.plan.districts.findIndex((d) => d.folder.name === "deep")
    const flat = made.plan.districts.findIndex((d) => d.folder.name === "flat")
    expect(raised(deep)).toBeGreaterThan(0)
    expect(raised(flat)).toBe(0)
  })

  test("this repo's sample island holds still", () => {
    const made = islandFromTree(FIXTURES.guildhall)
    expect({
      hash: made.plan.hash,
      land: made.plan.land.size,
      tiles: made.island.tiles.length,
      decor: made.island.decor.length,
      districts: made.districts.map((d) => `${d.id} ${d.biome} ${d.language.name} ${d.hexes}`),
    }).toEqual(SAMPLE)
  })
})

/**
 * Regenerate when the generator changes on purpose (and look at the lab shot). Last: packages/
 * split into a town of villages north of the keep, one per package (hall the biggest at its heart).
 */
const SAMPLE = {
  hash: 1887736964,
  land: 241,
  tiles: 721,
  decor: 141,
  districts: [
    "/ harbour Markdown 65",
    "packages/hall village TypeScript 27",
    "packages/core village TypeScript 17",
    "packages/herald village TypeScript 13",
    "packages/sim village TypeScript 13",
    "packages/hub village TypeScript 12",
    "packages/roster village TypeScript 12",
    "packages/opencode-guildhall village TypeScript 9",
    ".github farms Image 47",
    "scripts farms TypeScript 26",
  ],
}

describe("the repo summary", () => {
  test("folders get the biome their name suggests, unknown names a stable one", () => {
    expect(biomeOf("src")).toBe("village")
    expect(biomeOf("Tests")).toBe("proving")
    expect(biomeOf("docs")).toBe("library")
    expect(biomeOf("assets")).toBe("quarry")
    expect(biomeOf("vendor")).toBe("forest")
    expect(biomeOf("scripts")).toBe("farms")
    expect(biomeOf("zorblax")).toBe(biomeOf("zorblax"))
    expect(summarize([{ path: "a.md", type: "blob", size: 1 }]).root.biome).toBe("harbour")
  })

  test("code colours a folder before data does", () => {
    const shape = summarize([
      { path: "src/big.json", type: "blob", size: 90_000 },
      { path: "src/a.ts", type: "blob", size: 100 },
      { path: "data/x.json", type: "blob", size: 100 },
    ])
    expect(shape.folders.find((f) => f.name === "src")?.language.name).toBe("TypeScript")
    expect(shape.folders.find((f) => f.name === "data")?.language.name).toBe("JSON")
    expect(languageOf("x.rs").kit).toBe("red")
    expect(languageOf("x.weird").colour).toBe(languageOf("y.weird").colour)
  })

  test(`past ${MAX_DISTRICTS} folders the smallest pool into the wilds`, () => {
    const folders = Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => [`f${i}`, [1, (i + 1) * 100] as const]),
    )
    const shape = summarize(treeOf(folders))
    expect(shape.folders).toHaveLength(MAX_DISTRICTS)
    expect(shape.folders.at(-1)).toMatchObject({ name: "+9 more", biome: "wilds", files: 9 })
    expect(shape.folders[0]?.name).toBe("f19")
  })
})

describe("a monorepo's workspace", () => {
  /** A workspace of `count` packages, the i-th (i + 1) × 10 KB, under `container`. */
  const workspace = (container: string, count: number, extra: RepoEntry[] = []): RepoEntry[] => [
    { path: "README.md", type: "blob", size: 2000 },
    { path: "docs/a.md", type: "blob", size: 5000 },
    ...Array.from({ length: count }, (_, i) => ({
      path: `${container}/pkg${i}/src/index.rs`,
      type: "blob" as const,
      size: (i + 1) * 10_000,
    })),
    ...extra,
  ]

  test("splits into a village per package, named after it, coloured by its own language", () => {
    const shape = summarize([
      ...workspace("packages", 3),
      { path: "packages/web/src/app.ts", type: "blob", size: 1000 },
    ])
    expect(shape.folders.map((f) => [f.name, f.biome, f.group, f.language.name])).toEqual([
      ["packages/pkg2", "village", "packages", "Rust"],
      ["packages/pkg1", "village", "packages", "Rust"],
      ["packages/pkg0", "village", "packages", "Rust"],
      ["packages/web", "village", "packages", "TypeScript"],
      ["docs", "library", undefined, "Markdown"],
    ])
    // Depth counts from the container (pkg2/src/index.rs is 2), as a top-level folder's does from the root.
    expect(shape.folders[0]?.depth).toBe(2)
    const made = islandFromTree(workspace("packages", 3))
    expect(made.districts.find((d) => d.id === "packages/pkg2")?.label).toBe("pkg2")
  })

  test(`past ${MAX_PACKAGES} packages the smallest pool into one village, loose files with them`, () => {
    const loose: RepoEntry = { path: "packages/README.md", type: "blob", size: 7 }
    const shape = summarize(workspace("crates", 12, [{ ...loose, path: "crates/README.md" }]))
    const villages = shape.folders.filter((f) => f.group === "crates")
    expect(villages).toHaveLength(MAX_PACKAGES)
    expect(villages[0]?.name).toBe("crates/pkg11")
    expect(villages.at(-1)).toMatchObject({
      name: "crates/+4 crates",
      biome: "village",
      pooled: true,
      files: 5,
    })
    // Every file is still counted once.
    expect(villages.reduce((sum, f) => sum + f.files, 0)).toBe(13)
  })

  test("a container with one package, or a folder that isn't a workspace, stays one district", () => {
    expect(summarize(workspace("packages", 1)).folders.map((f) => f.name)).toEqual(["packages", "docs"])
    expect(summarize(workspace("things", 3)).folders.map((f) => f.name)).toEqual(["things", "docs"])
  })

  test("its villages stand together, their roads branching from the biggest's square", () => {
    for (const made of [islandFromTree(FIXTURES.react), islandFromTree(FIXTURES.guildhall)]) {
      const villages = made.plan.districts
        .map((district, i) => ({ district, i }))
        .filter(({ district }) => district.folder.group === "packages")
      const [head, ...rest] = villages
      expect(rest.length).toBeGreaterThan(1)
      // Each package's road starts at the biggest package's square, not the hub.
      for (const { district } of rest) {
        const road = made.plan.roads.find((r) => key(r.at(-1) ?? [0, 0]) === key(district.square))
        expect(key(road?.[0] ?? [0, 0])).toBe(key(head?.district.square ?? [0, 0]))
      }
      // One town: every village borders another of its workspace.
      const ids = new Set(villages.map(({ i }) => i))
      for (const { i } of villages) {
        const borders = [...made.plan.land].some(
          ([id, hex]) =>
            hex.district === i &&
            neighbours(unkey(id)).some((next) => {
              const other = made.plan.land.get(key(next))?.district
              return other !== undefined && other !== i && ids.has(other)
            }),
        )
        expect({ i, borders }).toEqual({ i, borders: true })
      }
    }
  })
})

describe("the generator's tile table", () => {
  test("fits every road hex of the hand-drawn map exactly as lands.ts does", () => {
    const tiles = new Map(island().tiles.map((t) => [`${t.x},${t.z}`, t]))
    let checked = 0
    for (const [id, edges] of MAP_FOR_TESTS.roadLinks) {
      const cell = id.split(",").map(Number) as [number, number]
      if (MAP_FOR_TESTS.at(cell) !== "=") continue
      const [x, z] = cellToWorld(cell)
      const drawn = tiles.get(`${x},${z}`)
      const fitted = fit(PATH_TILES, edges)
      expect({ piece: `hex_road_${fitted?.tile}`, rot: turn(fitted?.m ?? 0) }).toEqual({
        piece: drawn?.piece ?? "",
        rot: drawn?.rot ?? 0,
      })
      checked++
    }
    expect(checked).toBeGreaterThan(30)
  })
})
