import { describe, expect, test } from "bun:test"
import type { CatalogEntry } from "../src/catalog.ts"
import type { HouseBlueprint, PrefabRecipe } from "../src/compose/blueprint.ts"
import { compilePrefab, KIT_PROFILES } from "../src/compose/index.ts"
import { createCatalog } from "../src/query.ts"
import { type Recipe, type RecipeInstance, recipeHash } from "../src/recipe.ts"
import { entry } from "./entry.ts"

const PI = Math.PI
const kit = KIT_PROFILES["kenney-town"]
/** One kit unit (a cell, a storey), metres. */
const U = kit.module

/** Sizes measured from library/ (x3.47 import); unlisted kit pieces are wall panels. */
const SIZES: Record<string, CatalogEntry["size"]> = {
  "wall-corner-detail": [0.55, 3.47, 0.55],
  roof: [3.7, 2.25, 3.47],
  "roof-gable": [3.81, 1.98, 3.71],
  "roof-gable-end": [3.76, 1.98, 3.71],
  "roof-high": [3.71, 4.08, 3.47],
  "roof-high-gable": [3.81, 4.01, 3.93],
  "roof-high-gable-end": [3.87, 4.01, 3.93],
  "roof-flat": [3.47, 0.44, 3.47],
  "roof-point": [3.81, 1.73, 3.81],
  chimney: [0.73, 3.47, 1.18],
  "chimney-top": [0.87, 2.17, 1.18],
  lantern: [0.75, 5.39, 0.78],
}
const kitPieces = (): string[] => {
  const out = new Set<string>([kit.corner, kit.chimney.shaft, kit.chimney.top, "kenney-town/lantern"])
  for (const set of Object.values(kit.walls)) {
    for (const p of [set.blind, set.shop, ...Object.values(set.windows), ...Object.values(set.doors)])
      out.add(p)
  }
  for (const set of Object.values(kit.roofs))
    for (const p of Object.values(set)) if (typeof p === "string") out.add(p)
  return [...out]
}
const catalog = createCatalog({ version: 1, palette: "test", importer: "test", packs: [], rigs: [] }, [
  kitPieces().map((id) => entry({ id, size: SIZES[id.slice("kenney-town/".length)] ?? [0.35, 3.47, 3.47] })),
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
const isRoof = (i: RecipeInstance): boolean => short(i.piece).startsWith("roof")
const r2 = (v: number): number => Math.round(v * 100) / 100

describe("compilePrefab golden hashes", () => {
  // A change here moves every saved town: re-pin only for a deliberate compiler or kit change.
  const GOLDEN: Record<string, [string, string, string]> = {
    cottage: ["881ad5ee", "d46f81ff", "06d47916"],
    townhouse: ["f6ccf7c1", "9ac766f8", "fecfe747"],
    corner: ["02cdffc4", "f9cfc227", "5a55cfc6"],
    varied: ["11c4b724", "54d8b4f2", "4b0e7ee5"],
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
      .filter((i) => i.piece !== kit.corner && !isRoof(i))
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
    expect(at(recipe, "roof-gable")).toMatchObject([
      { piece: "kenney-town/roof-gable", x: 0, y: U, z: 0, rot: 0, scale: 1 },
    ])
    expect(recipe.instances).toHaveLength(9)
  })

  test("storeys stack one panel height apart, so panels and posts neither overlap nor gap", () => {
    const { recipe } = compile(FIXTURES.townhouse!)
    const panelHeight = SIZES["wall-corner-detail"]![1]
    const levels = [...new Set(recipe.instances.filter((i) => !isRoof(i)).map((i) => i.y))]
    expect(levels).toHaveLength(2)
    expect(levels[0]).toBe(0)
    expect(levels[1]).toBeCloseTo(panelHeight, 2)
    expect(at(recipe, "roof-gable-end")[0]!.y).toBeCloseTo(2 * panelHeight, 1)
  })

  test("a 2×1 two-storey house: door on the ground front only, windows, a blind back, hipped caps", () => {
    const { recipe } = compile(FIXTURES.townhouse!)
    const front = (y: number) =>
      recipe.instances
        .filter((i) => i.y === y && i.rot === -PI / 2 && i.piece !== kit.corner)
        .map((i) => [short(i.piece), r2(i.x)])
    expect(front(0)).toEqual([
      ["wall-door", r2(-U / 2)],
      ["wall-window-stone", r2(U / 2)],
    ])
    expect(front(U)).toEqual([
      ["wall-wood-window-shutters", r2(-U / 2)],
      ["wall-wood-window-shutters", r2(U / 2)],
    ])
    const back = recipe.instances.filter(
      (i) => i.rot === PI / 2 && i.z === 0 && short(i.piece).startsWith("wall-w"),
    )
    expect(back.map((i) => short(i.piece))).toEqual(["wall-wood", "wall-wood"])
    // Ridge along x over one cell across: hips at both ends, ridges running inward.
    expect(at(recipe, "roof-gable-end").map((i) => [r2(i.x), r2(i.y), r2(i.rot)])).toEqual([
      [r2(-U / 2), r2(2 * U), 0],
      [r2(U / 2), r2(2 * U), r2(PI)],
    ])
  })

  test("two cells across the ridge: slopes run the whole ridge, each facing it (gabled ends)", () => {
    const { recipe } = compile(FIXTURES.corner!)
    // Ridge along z at x = 0: the left column of slopes faces +x, the right one -x.
    expect(at(recipe, "roof").map((i) => [r2(i.x), r2(i.z), r2(i.rot)])).toEqual([
      [r2(-U / 2), r2(-U / 2), 0],
      [r2(U / 2), r2(-U / 2), r2(PI)],
      [r2(-U / 2), r2(U / 2), 0],
      [r2(U / 2), r2(U / 2), r2(PI)],
    ])
    const x = compile(prefab("ridge-x", house({ size: { w: 3, d: 2 } }))).recipe
    expect(x.instances.filter(isRoof).map((i) => [short(i.piece), r2(i.z), r2(i.rot)])).toEqual(
      [-U, 0, U].flatMap(() => [
        ["roof", r2(-U / 2), r2(-PI / 2)],
        ["roof", r2(U / 2), r2(PI / 2)],
      ]),
    )
    expect(x.instances.filter(isRoof).map((i) => r2(i.x))).toEqual([-U, -U, 0, 0, U, U].map(r2))
  })

  test("flat roofs cover every top cell; a point roof crowns a 1×1", () => {
    const flat = compile(
      prefab("flat", house({ size: { w: 3, d: 2 }, roof: { style: "flat", ridge: "x" } })),
    ).recipe
    expect(at(flat, "roof-flat")).toHaveLength(6)
    const point = compile(prefab("point", house({ roof: { style: "point", ridge: "x" } }))).recipe
    expect(at(point, "roof-point").map((i) => [i.x, i.y, i.z])).toEqual([[0, U, 0]])
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

  test("the footprint is one unit per module and every module stands inside it", () => {
    for (const r of Object.values(FIXTURES)) {
      const { w, d } = r.house!.size
      const { recipe, meta } = compile(r)
      expect([meta.frontage, meta.depth]).toEqual([U * w, U * d])
      for (const i of recipe.instances.filter((i) => i.piece !== "kenney-town/lantern")) {
        expect(Math.abs(i.x)).toBeLessThanOrEqual((U * w) / 2)
        expect(Math.abs(i.z)).toBeLessThanOrEqual((U * d) / 2)
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

  test("a wide door needs a front cell on its open (left) side, else it is square", () => {
    const door = (index: number | "centre", w: number) =>
      compile(prefab("door", house({ size: { w, d: 1 }, door: { index, style: "wide" } })))
        .recipe.instances.filter((i) => i.y === 0 && i.rot === -PI / 2 && short(i.piece).includes("door"))
        .map((i) => short(i.piece))
    expect(door(0, 1)).toEqual(["wall-doorway-square"])
    expect(door("centre", 2)).toEqual(["wall-doorway-square"])
    expect(door(1, 2)).toEqual(["wall-doorway-square-wide"])
    expect(door("centre", 3)).toEqual(["wall-doorway-square-wide"])
  })

  test("posts sit flush on plain stone and stand proud among timbers", () => {
    const { recipe } = compile(FIXTURES.townhouse!)
    const post = (y: number) => at(recipe, "wall-corner-detail").find((i) => i.y === y && i.rot === 0)!
    // The post's local (+x, +z) corner is on the outer corner: an inset pulls it back in on both axes.
    expect([r2(post(0).x), r2(post(0).z)]).toEqual([r2(U / 2 - 0.09), r2(-0.09)])
    expect([r2(post(U).x), r2(post(U).z)]).toEqual([r2(U / 2), 0])
  })

  test("meta: height to the highest top, stations from anchors", () => {
    const station = {
      id: "work",
      kind: "station" as const,
      at: [1, 0, 2] as [number, number, number],
      facing: 0,
    }
    const { meta } = compile({ ...FIXTURES.cottage!, anchors: [station] })
    expect(meta.height).toBe(r2(U + 1.98))
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

describe("compilePrefab chimney", () => {
  /**
   * Roof top surfaces measured from the GLBs, metres above the wall top at `t` metres in from a sloped
   * wall line: an oracle apart from the compiler's own bound.
   */
  const SURFACE: Record<string, { blueprint: Partial<HouseBlueprint>; at: (t: number) => number }> = {
    "gable, one across": { blueprint: { size: { w: 2, d: 1 } }, at: (t) => 0.25 + 1.0 * t },
    "high gable, one across": {
      blueprint: { size: { w: 2, d: 1 }, roof: { style: "high-gable", ridge: "x" } },
      at: (t) => 0.39 + 1.99 * t,
    },
    "gable, two across": { blueprint: { size: { w: 2, d: 2 } }, at: (t) => 0.21 + 0.565 * t },
    "high gable, two across": {
      blueprint: { size: { w: 3, d: 2 }, roof: { style: "high-gable", ridge: "x" } },
      at: (t) => 0.26 + 1.065 * t,
    },
    flat: { blueprint: { size: { w: 2, d: 2 }, roof: { style: "flat", ridge: "x" } }, at: () => 0.44 },
  }
  for (const [name, { blueprint, at: surface }] of Object.entries(SURFACE))
    test(`${name}: the pot clears the roof by 0.6 m, the stack has no gap, and it stands inside`, () => {
      const h = house({ storeys: [{ family: "stone", openings: "home" }], chimney: 1, ...blueprint })
      const { recipe, meta } = compile(prefab("chimney", h))
      const top = U
      const back = -meta.depth / 2
      const pot = at(recipe, "chimney-top")
      expect(pot).toHaveLength(1)
      const { y, z } = pot[0]!
      // The shaft spans 0.74..1.47 m toward the back wall: t (in from the back wall line) 0.6..1.33 m.
      const [near, far] = [z - 1.47 - back, z - 0.74 - back]
      expect(r2(near)).toBe(0.6)
      expect(y + kit.chimney.topHeight - top).toBeGreaterThanOrEqual(surface(far) + 0.6)
      const foot = Math.min(...[...pot, ...at(recipe, "chimney")].map((i) => i.y))
      expect(foot - top).toBeLessThanOrEqual(surface(near))
    })
})

describe("compilePrefab variants", () => {
  test("the same seed compiles the same recipe", () => {
    expect(compile(FIXTURES.varied!, 7)).toEqual(compile(structuredClone(FIXTURES.varied!), 7))
  })

  test("seeds vary windows, ramps and the chimney", () => {
    const looks = [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => compile(FIXTURES.varied!, seed).recipe.instances)
    const windows = new Set(looks.map((l) => l.find((i) => i.piece.includes("window-") && i.y === U)?.piece))
    expect([...windows].sort()).toEqual(["kenney-town/wall-window-glass", "kenney-town/wall-window-small"])
    const chimneys = new Set(looks.map((l) => l.some((i) => i.piece === kit.chimney.top)))
    expect(chimneys).toEqual(new Set([true, false]))
    const ramps = new Set(looks.map((l) => JSON.stringify(l[0]?.rampMap ?? null)))
    expect(ramps.size).toBeGreaterThan(1)
  })

  test("one seed's ramp swap reaches every structural piece and never the dressing", () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const { instances } = compile(FIXTURES.varied!, seed).recipe
      const lantern = instances.find((i) => i.piece === "kenney-town/lantern")
      expect(lantern?.rampMap).toBeUndefined()
      const swaps = new Set(instances.filter((i) => i !== lantern).map((i) => i.rampMap?.["stone-grey"]))
      expect(swaps.size).toBe(1)
      // An identity swap is no swap.
      expect([...swaps][0]).not.toBe("stone-grey")
    }
  })

  test("each family has its look on its own storey, under the house's swaps", () => {
    const { instances } = compile(FIXTURES.townhouse!).recipe
    const ground = instances.find((i) => i.y === 0)!
    const upper = instances.find((i) => i.y === U)!
    expect(ground.rampMap).toEqual(kit.walls.stone.look)
    expect(upper.rampMap).toEqual(kit.walls.wood.look)
    const own = house({ vary: { rampSwaps: { slate: ["stone"] } } })
    const wall = compile(prefab("own", own)).recipe.instances[0]!
    expect(wall.rampMap).toEqual({ ...kit.walls.plaster.look, slate: "stone" })
  })

  test("roofs are roofed by seed (never the bake's teal) unless the recipe swaps a roof ramp", () => {
    const roofings = new Set<string>()
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
      const roofs = compile(FIXTURES.cottage!, seed).recipe.instances.filter(isRoof)
      const teal = new Set(roofs.map((i) => i.rampMap?.teal))
      expect(teal.size).toBe(1)
      expect([...teal][0]).toBeDefined()
      roofings.add([...teal][0]!)
    }
    expect([...roofings].sort()).toEqual(kit.roofings.map((r) => r.teal!).sort())
    const asked = house({ vary: { rampSwaps: { teal: ["teal"] } } })
    for (const seed of [1, 2, 3, 4]) {
      const roofs = compile(prefab("teal", asked), seed).recipe.instances.filter(isRoof)
      expect(roofs.every((i) => i.rampMap?.teal === undefined)).toBe(true)
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
