import { describe, expect, test } from "bun:test"
import { weightOf } from "../src/world/gen/coupling.ts"
import { archetypeOf, type Traits } from "../src/world/gen/identity/archetype.ts"
import { identityOf } from "../src/world/gen/identity/index.ts"
import { PALETTES, paintedOf, paletteOf } from "../src/world/gen/identity/palette.ts"
import { ISLET_LAND, roleOf, wishOf } from "../src/world/gen/identity/role.ts"
import type { Archetype } from "../src/world/gen/identity/types.ts"
import type { Folder, RepoEntry } from "../src/world/gen/repo.ts"
import { summarize } from "../src/world/gen/repo.ts"
import { splitRepo } from "../src/world/gen/split.ts"
import { COMPOSITES } from "../src/world/prefabs/composite/index.ts"
import { hintsOf } from "../src/world/splitArchipelago.ts"
import { FIXTURES } from "./support/fixtures.ts"

/**
 * An island's identity (world/gen/identity): what its package is for, the shape of its land, its
 * colours: read from its tree and its place in the archipelago, the same every time.
 */

const folder = (name: string, files = 10): Folder =>
  ({
    name,
    biome: "village",
    files,
    bytes: files * 100,
    depth: 1,
    language: { name: "TypeScript", colour: "#fff", kit: "blue" },
  }) as Folder

const hint = (
  name: string,
  over: { core?: boolean; palette?: number; weight?: number; years?: number } = {},
) => ({
  name,
  ...over,
})

describe("a package's role, from its name and then from what is in it", () => {
  const cases: [string, string][] = [
    ["babel-plugin-react-compiler", "forge"],
    ["react_compiler_inference", "forge"],
    ["react-server-dom-webpack", "harbour"],
    ["react-server", "harbour"],
    ["react-devtools-shared", "observatory"],
    ["react-devtools-inline", "observatory"],
    ["devtools-docs", "library"],
    ["website", "library"],
    ["e2e-tests", "watch"],
    ["fixtures", "watch"],
    ["shared", "castle"],
    ["react-dom", "civic"],
    ["react-reconciler", "civic"],
  ]
  for (const [name, role] of cases)
    test(`${name} is a ${role} package`, () => {
      expect(roleOf(hint(name), [folder("src")])).toBe(role as never)
    })

  test("the core island is the core, whatever its name; a lone repo is its own core", () => {
    expect(roleOf(hint("react-compiler", { core: true }), [])).toBe("core")
    expect(roleOf(undefined, [folder("src")])).toBe("core")
  })

  test("a name that says nothing is read from where most of its files are", () => {
    expect(roleOf(hint("zzz"), [folder("docs", 30), folder("src", 10)])).toBe("library")
    expect(roleOf(hint("zzz"), [folder("src", 30), folder("docs", 10)])).toBe("civic")
  })

  test("the first of its wishes is the landmark its role says, an islet's a small one", () => {
    const first = (role: Parameters<typeof wishOf>[0], land: number) => wishOf(role, land, "x", 1)[0]
    expect(first("core", 800)).toBe("castle-grand")
    expect(first("forge", 800)).toBe("forge-works")
    expect(first("harbour", 800)).toBe("harbour-fortress")
    expect(first("library", 800)).toBe("academy")
    expect(["observatory", "academy", "forge-works"]).toContain(first("observatory", 800))
    // (Most observatories are one: of forty names, about half.)
    const names = Array.from({ length: 40 }, (_, n) => wishOf("observatory", 800, `devtools-${n}`, 1)[0])
    expect(names.filter((id) => id === "observatory").length).toBeGreaterThan(12)
    expect(new Set(names).size).toBe(3)
    expect(first("watch", 800)).toBe("castle-keep")
    expect(first("castle", 800)).toBe("castle-keep")
    expect(first("harbour", ISLET_LAND - 1)).toBe("islet-lighthouse")
    expect(first("civic", ISLET_LAND - 1)).toBe("islet-shrine")
    expect(first("forge", ISLET_LAND - 1)).toBe("islet-fort")
    for (const role of [
      "core",
      "castle",
      "forge",
      "library",
      "observatory",
      "watch",
      "harbour",
      "civic",
    ] as const)
      for (const land of [80, 150, 300, 900])
        for (const id of wishOf(role, land, "pkg", 7)) expect(COMPOSITES.some((c) => c.id === id)).toBe(true)
  })

  test("every wish list ends in something every island can carry (one hex): an islet's landmark", () => {
    for (const role of [
      "core",
      "castle",
      "forge",
      "library",
      "observatory",
      "watch",
      "harbour",
      "civic",
    ] as const)
      for (const land of [80, 150, 300, 900]) {
        const last = wishOf(role, land, "pkg", 7).at(-1) as string
        expect(COMPOSITES.find((c) => c.id === last)?.rings).toBe(0)
      }
  })
})

describe("an island's shape, from its traits", () => {
  const traits = (over: Partial<Traits>): Traits => ({
    land: 250,
    depth: 2,
    weight: 0,
    years: 0,
    core: false,
    ...over,
  })
  const SHAPES: Archetype[] = ["atoll", "ridge", "cone", "plateau", "reef"]

  test("the smallest land is a reef and nothing else: a shape needs the room it takes", () => {
    for (let seed = 0; seed < 40; seed++) expect(archetypeOf(traits({ land: 90 }), seed)).toBe("reef")
    for (let seed = 0; seed < 40; seed++)
      expect(archetypeOf(traits({ land: 125, depth: 4, weight: 2 }), seed)).toBe("reef")
  })

  test("an atoll needs 180 hexes, and no giant is one; a ridge no giant either; a reef is for the small", () => {
    for (let seed = 0; seed < 60; seed++) {
      expect(archetypeOf(traits({ land: 150 }), seed)).not.toBe("atoll")
      expect(archetypeOf(traits({ land: 1100 }), seed)).not.toBe("atoll")
      expect(archetypeOf(traits({ land: 1100, depth: 4 }), seed)).not.toBe("ridge")
      expect(archetypeOf(traits({ land: 1100 }), seed)).not.toBe("reef")
      expect(archetypeOf(traits({ land: 190 }), seed)).not.toBe("plateau")
    }
  })

  test("what the others lean on is a cone, the core most of all; deep trees make ridges", () => {
    const count = (t: Traits, shape: Archetype): number =>
      Array.from({ length: 80 }, (_, seed) => archetypeOf(t, seed)).filter((one) => one === shape).length
    expect(count(traits({ land: 400, weight: 2 }), "cone")).toBeGreaterThan(
      count(traits({ land: 400 }), "cone"),
    )
    expect(count(traits({ land: 400, core: true }), "cone")).toBeGreaterThan(
      count(traits({ land: 400 }), "cone"),
    )
    expect(count(traits({ land: 400, depth: 4.2 }), "ridge")).toBeGreaterThan(
      count(traits({ land: 400, depth: 1 }), "ridge"),
    )
  })

  test("the same traits and seed give the same shape; across seeds more than one shape comes up", () => {
    const t = traits({ land: 300 })
    expect(archetypeOf(t, 5)).toBe(archetypeOf(t, 5))
    const seen = new Set(Array.from({ length: 60 }, (_, seed) => archetypeOf(t, seed)))
    expect(seen.size).toBeGreaterThan(1)
    for (const shape of seen) expect(SHAPES).toContain(shape)
  })
})

describe("an island's colours: the pack's team colours, a set to a package", () => {
  test("twelve palettes, none repeated; the next island never has the roof of the last", () => {
    expect(new Set(PALETTES.map((p) => `${p.roof}/${p.accent}`)).size).toBe(12)
    for (const p of PALETTES) expect(p.accent).not.toBe(p.roof)
    for (let i = 0; i + 1 < PALETTES.length; i++) expect(PALETTES[i]?.roof).not.toBe(PALETTES[i + 1]?.roof)
    expect(PALETTES[0]?.roof).toBe("blue")
  })

  test("an island's palette is its slot in its archipelago's, a lone one's follows its seed", () => {
    expect(paletteOf(1, 0)).toEqual(paletteOf(99, 0))
    expect(paletteOf(1, 14)).toEqual(paletteOf(1, 2))
    expect(paletteOf(77)).toEqual(paletteOf(77))
    expect(new Set(Array.from({ length: 40 }, (_, seed) => paletteOf(seed).id)).size).toBeGreaterThan(6)
  })

  test("only the homes and the banners are painted, mostly in the roof colour, the rest as they were", () => {
    const palette = PALETTES[5]
    if (!palette) throw new Error("no palette")
    for (const piece of [
      "building_tower_A_blue",
      "building_castle_blue",
      "building_market_red",
      "wall_straight",
      "tree_single_A",
    ])
      expect(paintedOf(piece, palette, 3, 4)).toBe(piece)
    const homes = Array.from({ length: 400 }, (_, n) =>
      paintedOf("building_home_A_yellow", palette, n * 1.5, n * 0.7),
    )
    const share = (colour: string): number => homes.filter((p) => p.endsWith(colour)).length / homes.length
    expect(share(palette.roof)).toBeGreaterThan(0.5)
    expect(share(palette.accent)).toBeGreaterThan(0.15)
    expect(share("yellow")).toBeLessThan(0.2)
    for (const flag of ["flag_blue", "flag_red", "flag_yellow"])
      expect(paintedOf(flag, palette, 1, 2)).toBe(`flag_${palette.flag}`)
    expect(paintedOf("building_home_B_red", palette, 8, 9)).toBe(
      paintedOf("building_home_B_red", palette, 8, 9),
    )
  })
})

describe("who an island is, from its tree", () => {
  const react = FIXTURES.find((f) => f.repo === "facebook/react") as (typeof FIXTURES)[number]
  const split = splitRepo(react.entries as RepoEntry[], react.repo)
  if (!split) throw new Error("react does not split")
  const hints = hintsOf(split)

  test("the same tree and hint give the same identity; another slot, another palette", () => {
    const [core] = split.slices
    if (!core) throw new Error("a core")
    const shape = summarize(core.entries)
    const a = identityOf(shape, 1, hint(core.label, { core: true, palette: 0 }))
    expect(identityOf(shape, 1, hint(core.label, { core: true, palette: 0 }))).toEqual(a)
    expect(identityOf(shape, 1, hint(core.label, { core: true, palette: 1 })).palette).not.toEqual(a.palette)
    expect(a.role).toBe("core")
    expect(a.wish[0]).toBe("castle-grand")
  })

  test("React's packages are what their names say", () => {
    const by = new Map(
      split.slices.map((slice, i) => [slice.label, identityOf(summarize(slice.entries), 1, hints[i])]),
    )
    expect(by.get("babel-plugin-react-compiler")?.role).toBe("forge")
    expect(by.get("react-server")?.role).toBe("harbour")
    expect(by.get("react-devtools-shared")?.role).toBe("observatory")
    expect(by.get("shared")?.role).toBe("castle")
    expect(by.get("react")?.role).toBe("core")
  })

  test("islands that are bound do not share a roof: the core's is blue and the colours are spread", () => {
    const roof = (i: number): string => PALETTES[hints[i]?.palette ?? 0]?.roof as string
    expect(roof(0)).toBe("blue")
    let bound = 0
    let alike = 0
    for (const [i, a] of split.slices.entries())
      for (const [j, b] of split.slices.entries()) {
        if (j <= i) continue
        const weight = weightOf(split.coupling, a.id, b.id)
        // The tightest bonds (a bridge's) never share a roof; of the looser ones (a ferry's) few do (four colours, a hub bound to many).
        if (weight >= 0.5) expect(roof(i)).not.toBe(roof(j))
        if (weight < 0.3) continue
        bound++
        if (roof(i) === roof(j)) alike++
      }
    expect(bound).toBeGreaterThan(5)
    expect(alike / bound).toBeLessThan(0.25)
    const used = new Map<string, number>()
    for (let i = 0; i < hints.length; i++) used.set(roof(i), (used.get(roof(i)) ?? 0) + 1)
    expect(used.size).toBe(4)
    expect(Math.max(...used.values())).toBeLessThanOrEqual(Math.ceil(hints.length / 4) + 3)
  })

  test("the hints are the same every time", () => {
    expect(hintsOf(split)).toEqual(hints)
  })
})
