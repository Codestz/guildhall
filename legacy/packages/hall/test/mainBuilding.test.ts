import { describe, expect, test } from "bun:test"
import { onDryLand } from "../src/world/clearance.ts"
import { crowds, footprintsOf } from "../src/world/gen/dress/footprints.ts"
import { cellAt, key, step } from "../src/world/gen/hex.ts"
import { PALETTES } from "../src/world/gen/identity/palette.ts"
import { islandFromTree } from "../src/world/gen/islandFromTree.ts"
import { openSea } from "../src/world/gen/plan/heart.ts"
import type { RepoEntry } from "../src/world/gen/repo.ts"
import { covers, LOOSE } from "../src/world/hall/site.ts"
import { cellToWorld, type LandPlacement } from "../src/world/lands.ts"
import { COMPOSITES, composed } from "../src/world/prefabs/composite/index.ts"
import { instantiate } from "../src/world/prefabs/index.ts"
import { repoWorld, type World } from "../src/world/world.ts"
import { FIXTURES, gen2Worlds } from "./support/fixtures.ts"
import { SLOW } from "./support/slow.ts"
import { reactSplit } from "./support/splitFixture.ts"

/**
 * Every generator-2 island has one main building, its heart (plan/heart.ts, dress/main.ts): a
 * composite landmark that fits the land it stands on, clear of roads, lots, venues and water, with a
 * focal point for the camera and doors for whoever goes in.
 */

const COASTAL = new Set(["harbour-fortress", "islet-lighthouse"])
const ids = new Set(COMPOSITES.map((item) => item.id))

/** The main building's own pieces as it stands in the world. */
function piecesOf(world: World): LandPlacement[] {
  const { main, identity, hall } = world
  if (!main) return []
  const kit = identity?.palette.roof ?? "blue"
  // The loose things a landmark scatters before its door make way for its hall (world/hall/site.ts).
  return instantiate(composed(main.id, main.seed, kit), main.at, main.rot, kit).filter(
    (part) => !(hall && LOOSE.test(part.piece) && covers(hall, part.x, part.z, 1)),
  )
}

function expectMainBuilding(world: World, label: string): void {
  const { main } = world
  expect(main, `${label}: a main building`).toBeDefined()
  if (!main) return
  expect(ids.has(main.id), `${label}: ${main.id} is in the catalogue`).toBe(true)
  const pieces = piecesOf(world)
  expect(composed(main.id, main.seed).parts.length).toBeGreaterThan(8)
  // Exactly one: its parts stand in the world once each (each at its place, whatever colour the palette made it).
  const near = world.island.decor.filter(
    (d) => Math.hypot(d.x - main.at[0], d.z - main.at[1]) <= main.reach + 0.5,
  )
  for (const part of pieces) {
    const found = near.filter((d) => Math.abs(d.x - part.x) < 0.01 && Math.abs(d.z - part.z) < 0.01)
    expect(found.length, `${label}: ${part.piece} at ${part.x},${part.z}`).toBeGreaterThanOrEqual(1)
  }
  // Fits: every corner of every building or wall piece is on land, dry and level where it stands.
  const coastal = COASTAL.has(main.id)
  const shapes = footprintsOf(pieces)
  for (const shape of shapes)
    for (const [x, z] of shape) {
      const cell = cellAt([x, z])
      const char = world.terrain.at(cell)
      expect(char, `${label}: a corner at ${x.toFixed(1)},${z.toFixed(1)} is on land`).not.toBe("~")
      // Clear of the roads, the rivers and the lakes.
      expect("=ro").not.toContain(char)
      expect(world.terrain.level(cell)).toBe(0)
      if (!coastal)
        expect(onDryLand([x, z], world), `${label}: dry at ${x.toFixed(1)},${z.toFixed(1)}`).toBe(true)
    }
  // Clear of the lots and venues (buildings of the town that are not its own parts).
  const mine = new Set(pieces.map((p) => `${p.x}|${p.z}`))
  const others = world.island.decor.filter(
    (d) =>
      /^building_/.test(d.piece) &&
      !mine.has(`${d.x}|${d.z}`) &&
      Math.hypot(d.x - main.at[0], d.z - main.at[1]) < main.reach + 12,
  )
  for (const other of footprintsOf(others))
    for (const shape of shapes)
      expect(crowds(shape, other, 0), `${label}: a building stands against the main one`).toBe(false)
  // A point for the camera, above the ground and over the building; a door someone can reach.
  expect(main.focal.y).toBeGreaterThan(4)
  expect(Math.hypot(main.focal.x - main.at[0], main.focal.z - main.at[1])).toBeLessThanOrEqual(main.reach)
  expect(main.doors.length).toBeGreaterThan(0)
  for (const door of main.doors)
    expect(Math.hypot(door.x - main.at[0], door.z - main.at[1])).toBeLessThanOrEqual(main.reach + 12)
  // A coastal landmark has its back to the open sea, a dock's hex beyond its rings.
  if (coastal) {
    const land = new Set(
      world.terrain.cells().filter((id) => world.terrain.at(id.split(",").map(Number) as never) !== "~"),
    )
    const open = openSea(land)
    const back = [Math.sin(main.rot) * -1, Math.cos(main.rot) * -1]
    const spot: [number, number] = [
      main.at[0] + (back[0] as number) * (main.rings + 1) * 10,
      main.at[1] + (back[1] as number) * (main.rings + 1) * 10,
    ]
    expect(open.has(key(cellAt(spot))), `${label}: its back is open sea`).toBe(true)
  }
}

describe("a main building on every island of a repo", () => {
  for (const [name, world] of gen2Worlds())
    test(`${name}: one main building, fitted and clear`, () => {
      expectMainBuilding(world, name)
      expect(world.identity?.palette.roof).toBeDefined()
    })

  test("the wish of the first ranks: a core island's heart is the grand castle when its land is the room for one", () => {
    const react = gen2Worlds().find(([name]) => name === "facebook/react")?.[1]
    expect(react?.main?.id).toBe("castle-grand")
    // A hamlet cannot hold it: a small landmark stands in its place.
    const hamlet = gen2Worlds().find(([name]) => name === "jonschlinkert/is-odd")?.[1]
    expect(composed(hamlet?.main?.id ?? "").rings).toBe(0)
  })

  test("the same tree grows the same island: the same main building, shape and colours", () => {
    const fixture = FIXTURES.find((f) => f.repo === "Codestz/guildhall") as (typeof FIXTURES)[number]
    const a = islandFromTree(fixture.entries as RepoEntry[], 0, 2)
    const b = islandFromTree([...(fixture.entries as RepoEntry[])].reverse(), 0, 2)
    expect(b.main).toEqual(a.main)
    expect(b.plan.shape).toEqual(a.plan.shape)
    expect(b.plan.identity).toEqual(a.plan.identity)
    expect(a.plan.heart?.id).toBe(a.main?.id)
  })

  test("the plan's heart ground is its own: roads, sites and lots keep off the hexes it reserved", () => {
    for (const [name, world] of gen2Worlds()) {
      const fixture = FIXTURES.find((f) => f.repo === name) as (typeof FIXTURES)[number]
      const made = islandFromTree(fixture.entries as RepoEntry[], 0, 2)
      const heart = made.plan.heart
      expect(heart, name).toBeDefined()
      for (const id of heart?.cells ?? []) {
        const hex = made.plan.land.get(id)
        expect(hex, `${name}: ${id} is land`).toBeDefined()
        expect("=sv").not.toContain(hex?.char ?? "=")
        expect(hex?.level).toBeUndefined()
      }
      for (const district of made.plan.districts)
        expect(heart?.cells.has(key(district.square)), name).toBe(false)
      expect(world.main?.id).toBe(heart?.id)
    }
  })

  test("a coastal wish is stood on the coast, facing the keep, where the coast has room", () => {
    // The harbour fortress of a big enough harbour-like island: React's server packages (below).
    const hex = cellToWorld([0, 0])
    expect(hex).toEqual([0, 0])
    expect(step([0, 0], 4)).toEqual([0, -2])
  })
})

/** A synthetic repo of `n` files: source in `groups` folders `depth` deep, tests and docs beside it. */
function treeOf(n: number, groups: number, depth: number): RepoEntry[] {
  const out: RepoEntry[] = []
  for (let i = 0; i < n; i++) {
    const top = i % 7 === 0 ? "test" : i % 11 === 0 ? "docs" : "src"
    const nest = Array.from({ length: depth }, (_, d) => `g${(i + d) % groups}`).join("/")
    out.push({ path: `${top}/${nest}/f${i}.ts`, type: "blob", size: 400 + (i % 13) * 90 })
  }
  return out
}

describe("a main building on an island of any size or shape", () => {
  const sizes = [1, 5, 12, 25, 40, 60, 100, 160, 250, 400, 700, 1500]
  for (const n of sizes)
    test(`${n} files: the main building is fitted and clear, in every seed and depth`, () => {
      for (const [seed, depth, groups] of [
        [0, 1, 3],
        [1, 3, 6],
        [2, 5, 9],
      ] as const) {
        const made = islandFromTree(treeOf(n, groups, depth), seed, 2)
        const world = repoWorld(made, { repo: `x/n${n}`, source: "fixture", gen: 2 })
        expectMainBuilding(world, `${n} files, seed ${seed}`)
      }
    })
})

describe("a main building for every role", () => {
  const names = [
    "react-server",
    "babel-compiler",
    "devtools-docs",
    "react-devtools",
    "e2e-tests",
    "shared",
    "react-dom",
  ]
  for (const name of names)
    test(`${name}: fitted and clear at every size, on the coast where the role wants it`, () => {
      for (const n of [12, 60, 160, 400, 1500])
        for (const seed of [0, 1]) {
          const made = islandFromTree(treeOf(n, 5, 2), seed, 2, undefined, { name, palette: n % 12 })
          const world = repoWorld(made, { repo: `x/${name}`, source: "fixture", gen: 2 })
          expectMainBuilding(world, `${name} ${n} files, seed ${seed}`)
        }
    })
})

describe("React as an archipelago of its packages: every island has its heart", () => {
  test(
    "each of them has one main building, fitted and clear, in a palette; the core's is the grand castle",
    async () => {
      const { home, archipelago } = await reactSplit()
      const worlds = [home, ...archipelago.islands.map((island) => island.world)]
      expect(worlds.length).toBeGreaterThan(15)
      for (const [i, world] of worlds.entries()) expectMainBuilding(world, `island ${i}`)
      expect(home.main?.id).toBe("castle-grand")
      // The kinds of building follow the packages: more than a few landmarks, several shapes of land.
      expect(new Set(worlds.map((w) => w.main?.id)).size).toBeGreaterThan(5)
      expect(new Set(worlds.map((w) => w.identity?.shape)).size).toBeGreaterThan(3)
      for (const world of worlds) expect(PALETTES.some((p) => p.id === world.identity?.palette.id)).toBe(true)
    },
    60_000 * SLOW,
  )

  test(
    "a harbour package has its fortress on the coast, a forge's compiler its works, the observatories theirs",
    async () => {
      const { archipelago } = await reactSplit()
      const by = (needle: string) =>
        archipelago.islands.find((island) => island.name === needle)?.world.main?.id
      expect(by("react-server")).toBe("harbour-fortress")
      expect(by("babel-plugin-react-compiler")).toBe("forge-works")
      expect(by("react-devtools-shared")).toBe("observatory")
    },
    60_000 * SLOW,
  )

  test(
    "bound islands wear different roofs: a bridge's two ends never share one",
    async () => {
      const { archipelago } = await reactSplit()
      const roofs = new Map(
        archipelago.islands.map((island) => [island.id, island.world.identity?.palette.roof]),
      )
      roofs.set(archipelago.home.id, PALETTES[0]?.roof)
      for (const link of archipelago.links)
        if (link.kind === "bridge") expect(roofs.get(link.a)).not.toBe(roofs.get(link.b))
    },
    60_000 * SLOW,
  )
})
