import { describe, expect, test } from "bun:test"
import type { CatalogEntry } from "../src/catalog.ts"
import type { HouseBlueprint, PrefabRecipe } from "../src/compose/blueprint.ts"
import { compilePrefab, KIT_PROFILES } from "../src/compose/index.ts"
import { createCatalog } from "../src/query.ts"
import { type Recipe, recipeHash } from "../src/recipe.ts"
import { entry } from "./entry.ts"

const PI = Math.PI
const kit = KIT_PROFILES["kenney-town"]

/** Sizes measured from library/ (x3 import); unlisted kit pieces are wall panels. */
const SIZES: Record<string, CatalogEntry["size"]> = {
  "wall-corner-detail": [0.48, 3, 0.48],
  roof: [3.2, 1.94, 3],
  "roof-corner": [3.2, 1.94, 3.2],
  "roof-gable": [3.3, 1.71, 3.21],
  "roof-gable-end": [3.26, 1.71, 3.21],
  "roof-flat": [3, 0.38, 3],
  "roof-point": [3.3, 1.5, 3.3],
  chimney: [0.64, 3, 1.02],
  lantern: [0.65, 4.67, 0.67],
}
const kitPieces = (): string[] => {
  const out = new Set<string>([kit.corner, kit.chimney, "kenney-town/lantern"])
  for (const set of Object.values(kit.walls)) {
    for (const p of [set.blind, set.shop, ...Object.values(set.windows), ...Object.values(set.doors)])
      out.add(p)
  }
  for (const set of Object.values(kit.roofs)) for (const p of Object.values(set)) out.add(p as string)
  return [...out]
}
const catalog = createCatalog({ version: 1, palette: "test", importer: "test", packs: [], rigs: [] }, [
  kitPieces().map((id) => entry({ id, size: SIZES[id.slice("kenney-town/".length)] ?? [0.3, 3, 3] })),
])

const house = (over: Partial<HouseBlueprint> = {}): HouseBlueprint => ({
  kit: "kenney-town",
  size: { w: 1, d: 1 },
  storeys: [{ family: "plaster", openings: "home" }],
  roof: { style: "gable", ridge: "x" },
  door: { index: "centre" },
  edits: [],
  vary: {},
  ...over,
})
const prefab = (id: string, h?: HouseBlueprint, over: Partial<PrefabRecipe> = {}): PrefabRecipe => ({
  version: 1,
  id,
  kind: "house",
  tags: [],
  fits: {},
  ...(h ? { house: h } : {}),
  dressing: [],
  anchors: [],
  ...over,
})

const FIXTURES: Record<string, PrefabRecipe> = {
  cottage: prefab("cottage", house()),
  townhouse: prefab(
    "townhouse",
    house({
      size: { w: 2, d: 1 },
      storeys: [
        { family: "stone", openings: "home" },
        { family: "wood", openings: "home" },
      ],
      door: { index: 0, style: "round" },
    }),
  ),
  corner: prefab("corner", house({ size: { w: 2, d: 2 }, roof: { style: "gable", ridge: "z" } })),
  varied: prefab(
    "varied",
    house({
      size: { w: 3, d: 2 },
      storeys: [
        { family: "wood", openings: "shop" },
        { family: "plaster", openings: "home" },
      ],
      roof: { style: "high-gable", ridge: "x" },
      chimney: 0.5,
      vary: {
        rampSwaps: { "stone-grey": ["stone-grey", "wood-dark", "plaster-warm"] },
        openings: ["glass", "small"],
      },
    }),
    { dressing: [{ piece: "kenney-town/lantern", x: 2.1, y: 0, z: 3.6, rot: 0.1, scale: 1 }] },
  ),
}

const compile = (r: PrefabRecipe, seed = 1) => compilePrefab(r, seed, catalog)
const short = (piece: string): string => piece.slice("kenney-town/".length)
const at = (recipe: Recipe, piece: string) => recipe.instances.filter((i) => short(i.piece) === piece)
const r2 = (v: number): number => Math.round(v * 100) / 100

describe("compilePrefab golden hashes", () => {
  // A change here moves every saved town: re-pin only for a deliberate compiler or kit change.
  const GOLDEN: Record<string, [string, string, string]> = {
    cottage: ["f97457d9", "ea3013ee", "13437c37"],
    townhouse: ["ada0588b", "d5ce2f7e", "07d3923d"],
    corner: ["b83c9afb", "5b9e4022", "5f3a86ed"],
    varied: ["6979e5ea", "57418202", "fae06dbe"],
  }
  for (const [name, hashes] of Object.entries(GOLDEN))
    test(`${name} for seeds 1, 2, 3`, () => {
      const got = [1, 2, 3].map((seed) => recipeHash(compile(FIXTURES[name]!, seed).recipe))
      expect(got).toEqual(hashes)
    })
})

describe("compilePrefab structure", () => {
  test("a 1×1 one-storey cottage: four walls, door front, four posts, one gable", () => {
    const { recipe } = compile(FIXTURES.cottage!)
    const panels = recipe.instances
      .filter((i) => i.piece !== kit.corner && !short(i.piece).startsWith("roof"))
      .map((i) => [short(i.piece), i.x, i.z, r2(i.rot)])
    expect(panels).toEqual([
      ["wall-door", 0, 0, r2(-PI / 2)],
      ["wall-detail-cross", 0, 0, r2(PI / 2)],
      ["wall-window-shutters", 0, 0, 0],
      ["wall-window-shutters", 0, 0, r2(PI)],
    ])
    expect(at(recipe, "wall-corner-detail").map((i) => r2(i.rot))).toEqual([
      0,
      r2(-PI / 2),
      r2(PI),
      r2(PI / 2),
    ])
    expect(at(recipe, "roof-gable")).toEqual([
      { piece: "kenney-town/roof-gable", x: 0, y: 3, z: 0, rot: 0, scale: 1 },
    ])
    expect(recipe.instances).toHaveLength(9)
  })

  test("a 2×1 two-storey house: door on the ground front only, windows, a blind back, hipped caps", () => {
    const { recipe } = compile(FIXTURES.townhouse!)
    const front = (y: number) =>
      recipe.instances
        .filter((i) => i.y === y && i.rot === -PI / 2 && i.piece !== kit.corner)
        .map((i) => [short(i.piece), i.x])
    expect(front(0)).toEqual([
      ["wall-door", -1.5],
      ["wall-window-stone", 1.5],
    ])
    expect(front(3)).toEqual([
      ["wall-wood-window-shutters", -1.5],
      ["wall-wood-window-shutters", 1.5],
    ])
    const back = recipe.instances.filter(
      (i) => i.rot === PI / 2 && i.z === 0 && short(i.piece).startsWith("wall-w"),
    )
    expect(back.map((i) => short(i.piece))).toEqual(["wall-wood", "wall-wood"])
    // Ridge along x over one cell across: hips at both ends, ridges running inward.
    expect(at(recipe, "roof-gable-end").map((i) => [i.x, i.y, r2(i.rot)])).toEqual([
      [-1.5, 6, 0],
      [1.5, 6, r2(PI)],
    ])
  })

  test("a 2×2 gable roof turns hip corners so each peak meets the ridge", () => {
    const { recipe } = compile(FIXTURES.corner!)
    // Ridge along z at x = 0: the peak of every corner is toward x = 0 and toward z = 0.
    const corners = at(recipe, "roof-corner").map((i) => [i.x, i.z, r2(i.rot)])
    expect(corners).toEqual([
      [-1.5, -1.5, r2(-PI / 2)],
      [1.5, -1.5, r2(PI)],
      [-1.5, 1.5, 0],
      [1.5, 1.5, r2(PI / 2)],
    ])
    const x = compile(prefab("ridge-x", house({ size: { w: 3, d: 2 } }))).recipe
    expect(at(x, "roof").map((i) => [i.x, i.z, r2(i.rot)])).toEqual([
      [0, -1.5, r2(-PI / 2)],
      [0, 1.5, r2(PI / 2)],
    ])
    expect(at(x, "roof-corner")).toHaveLength(4)
  })

  test("flat roofs cover every top cell; a point roof crowns a 1×1", () => {
    const flat = compile(
      prefab("flat", house({ size: { w: 3, d: 2 }, roof: { style: "flat", ridge: "x" } })),
    ).recipe
    expect(at(flat, "roof-flat")).toHaveLength(6)
    const point = compile(prefab("point", house({ roof: { style: "point", ridge: "x" } }))).recipe
    expect(at(point, "roof-point").map((i) => [i.x, i.y, i.z])).toEqual([[0, 3, 0]])
  })

  test("no two instances share a slot", () => {
    for (const r of Object.values(FIXTURES))
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        const keys = compile(r, seed).recipe.instances.map((i) => {
          const kind = i.piece === kit.corner ? "post" : short(i.piece).split("-")[0]
          return `${kind}|${r2(i.x)}|${r2(i.y)}|${r2(i.z)}|${r2(i.rot)}`
        })
        expect(new Set(keys).size).toBe(keys.length)
      }
  })

  test("the footprint is 3·size m and every module stands inside it", () => {
    for (const r of Object.values(FIXTURES)) {
      const { w, d } = r.house!.size
      const { recipe, meta } = compile(r)
      expect([meta.frontage, meta.depth]).toEqual([3 * w, 3 * d])
      for (const i of recipe.instances.filter((i) => i.piece !== "kenney-town/lantern")) {
        expect(Math.abs(i.x)).toBeLessThanOrEqual(1.5 * w - 1.5)
        expect(Math.abs(i.z)).toBeLessThanOrEqual(1.5 * d - 1.5)
      }
    }
  })

  test("the door anchor lies on the front edge, in front of the door panel", () => {
    for (const r of Object.values(FIXTURES)) {
      const { recipe, meta } = compile(r)
      const [x, z] = meta.door
      expect(z).toBe(meta.depth / 2)
      expect(recipe.sockets[0]).toEqual({ id: "door", kind: "door", at: [x, 0, z], facing: 0 })
      const door = recipe.instances.find((i) => i.y === 0 && i.x === x && i.rot === -PI / 2)
      expect(door?.piece).toMatch(/door/)
    }
  })

  test("meta: height to the highest top, stations from anchors", () => {
    const station = {
      id: "work",
      kind: "station" as const,
      at: [1, 0, 2] as [number, number, number],
      facing: 0,
    }
    const { meta } = compile({ ...FIXTURES.cottage!, anchors: [station] })
    expect(meta.height).toBe(4.71)
    expect(meta.stations).toEqual([station])
  })

  test("edits replace a panel or leave the slot empty", () => {
    const edits: HouseBlueprint["edits"] = [
      { storey: 0, side: "-z", index: 0, piece: "kenney-town/wall-window-round" },
      { storey: 0, side: "+x", index: 0, piece: null },
    ]
    const { recipe } = compile(prefab("edited", house({ edits })))
    expect(recipe.instances.filter((i) => i.rot === PI / 2 && i.y === 0)[0]?.piece).toBe(
      "kenney-town/wall-window-round",
    )
    expect(recipe.instances.filter((i) => i.rot === 0 && i.y === 0 && i.piece !== kit.corner)).toEqual([])
  })
})

describe("compilePrefab variants", () => {
  test("the same seed compiles the same recipe", () => {
    expect(compile(FIXTURES.varied!, 7)).toEqual(compile(structuredClone(FIXTURES.varied!), 7))
  })

  test("seeds vary windows, ramps and the chimney", () => {
    const looks = [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => compile(FIXTURES.varied!, seed).recipe.instances)
    const windows = new Set(looks.map((l) => l.find((i) => i.piece.includes("window-") && i.y === 3)?.piece))
    expect([...windows].sort()).toEqual(["kenney-town/wall-window-glass", "kenney-town/wall-window-small"])
    const chimneys = new Set(looks.map((l) => l.some((i) => i.piece === kit.chimney)))
    expect(chimneys).toEqual(new Set([true, false]))
    const ramps = new Set(looks.map((l) => JSON.stringify(l[0]?.rampMap ?? null)))
    expect(ramps.size).toBeGreaterThan(1)
  })

  test("one seed's ramp swap re-tints the whole structure and never the dressing", () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const { instances } = compile(FIXTURES.varied!, seed).recipe
      const lantern = instances.find((i) => i.piece === "kenney-town/lantern")
      expect(lantern?.rampMap).toBeUndefined()
      const maps = new Set(
        instances.filter((i) => i !== lantern).map((i) => JSON.stringify(i.rampMap ?? null)),
      )
      expect(maps.size).toBe(1)
      // An identity swap is no swap.
      expect([...maps][0]).not.toBe(JSON.stringify({ "stone-grey": "stone-grey" }))
    }
  })

  test("dressing is snapped to the fine lattice (0.25 m, 15°)", () => {
    const lantern = compile(FIXTURES.varied!).recipe.instances.find((i) => i.piece === "kenney-town/lantern")
    expect(lantern).toEqual({ piece: "kenney-town/lantern", x: 2, y: 0, z: 3.5, rot: 0, scale: 1 })
  })

  test("a dressing-only prefab sizes itself from its pieces and takes an authored door", () => {
    const stall = prefab("stall", undefined, {
      kind: "stall",
      dressing: [{ piece: "kenney-town/lantern", x: 1, y: 0, z: -1, rot: 0, scale: 1 }],
      anchors: [{ id: "front", kind: "door", at: [0, 0, 2], facing: 0 }],
    })
    const { recipe, meta } = compile(stall)
    expect([meta.frontage, meta.depth, meta.door]).toEqual([3, 3, [0, 2]])
    expect(recipe.sockets).toEqual(stall.anchors)
  })
})

describe("compilePrefab errors", () => {
  test("an unknown piece is named", () => {
    const r = prefab(
      "bad",
      house({ edits: [{ storey: 0, side: "+z", index: 0, piece: "kenney-town/nope" }] }),
    )
    expect(() => compile(r)).toThrow('compilePrefab(bad): unknown piece "kenney-town/nope"')
  })

  test("an invalid recipe is rejected with its problems", () => {
    const r = prefab("bad", house({ size: { w: 0, d: 1 } }))
    expect(() => compile(r)).toThrow(/compilePrefab\(bad\): .*house\.size/)
  })

  test("a gable wider than two cells across its ridge is refused", () => {
    const r = prefab("wide", house({ size: { w: 3, d: 3 } }))
    expect(() => compile(r)).toThrow(
      /compilePrefab\(wide\): house: .*at most 2 cells across its ridge, got 3/,
    )
  })

  test("an unknown window style is named", () => {
    const r = prefab("odd", house({ vary: { openings: ["stained"] } }))
    expect(() => compile(r)).toThrow(/compilePrefab\(odd\): house: unknown window style "stained"/)
  })
})
