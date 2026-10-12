/**
 * The vignette recipes (ADR 013): one dressing-only recipe per POI kind in `data/recipes/vignettes/`,
 * each valid against the palette, compilable, at most 24 × 24 m, with its stations on its footprint.
 */
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { CatalogEntry } from "../src/catalog.ts"
import { type PrefabRecipe, validatePrefab } from "../src/compose/blueprint.ts"
import { compilePrefab } from "../src/compose/index.ts"
import { PALETTE } from "../src/index.ts"
import { createCatalog } from "../src/query.ts"
import { entry } from "./entry.ts"

const DIR = join(import.meta.dir, "../../../data/recipes/vignettes")

/** `PoiKind` (plan-w8 §3; the world package pins the type): one vignette each, named by it. */
const POI_KINDS = [
  "campsite",
  "fishing-spot",
  "lake-pier",
  "lighthouse",
  "lookout",
  "lumber-camp",
  "mine",
  "old-tower",
  "quarry",
  "ruins",
  "sawmill",
  "shrine",
  "training-ground",
]

/** The largest vignette footprint, metres a side (its pad adds 2 m). */
const MAX_SIDE = 24

/** Sizes measured from library/ for every piece the vignettes place. */
const SIZES: Record<string, CatalogEntry["size"]> = {
  "kaykit-dungeon/candle-lit": [0.33, 1.05, 0.33],
  "kaykit-dungeon/candle-triple": [0.5, 0.87, 0.39],
  "kaykit-dungeon/chest": [1.7, 1.3, 1.45],
  "kaykit-dungeon/column": [0.7, 1.4, 0.7],
  "kaykit-dungeon/pillar": [1.5, 4, 1.5],
  "kaykit-dungeon/rubble-half": [4, 3.5, 3],
  "kaykit-dungeon/rubble-large": [8.13, 3.5, 3.18],
  "kaykit-dungeon/wall": [4, 4, 1],
  "kaykit-forest/bush-2-e-color1": [2.35, 1.33, 2.01],
  "kaykit-forest/bush-3-c-color1": [2.49, 1.15, 2.49],
  "kaykit-forest/bush-4-c-color1": [1.58, 1.3, 1.58],
  "kaykit-forest/bush-4-e-color1": [2.7, 1.3, 2.28],
  "kaykit-forest/rock-1-j-color1": [3.39, 3.36, 3.76],
  "kaykit-forest/rock-1-l-color1": [3.29, 3.4, 2.62],
  "kaykit-forest/rock-1-m-color1": [3.91, 3.52, 2.71],
  "kaykit-forest/rock-1-n-color1": [2.31, 4.5, 2.24],
  "kaykit-forest/rock-1-o-color1": [2.11, 4.58, 2.11],
  "kaykit-forest/rock-2-c-color1": [1.3, 1.33, 1.3],
  "kaykit-forest/rock-3-e-color1": [1.15, 1.29, 1.18],
  "kaykit-forest/rock-3-k-color1": [2.61, 2.22, 2.59],
  "kaykit-forest/rock-3-q-color1": [4.65, 3.72, 4.48],
  "kaykit-forest/tree-1-c-color1": [6.69, 7.81, 5.75],
  "kaykit-forest/tree-2-c-color1": [4.6, 6.92, 3.4],
  "kaykit-forest/tree-2-e-color1": [6.05, 8.79, 5.68],
  "kaykit-forest/tree-3-c-color1": [5.63, 5.79, 4.62],
  "kaykit-forest/tree-4-c-color1": [3.74, 10.77, 2.87],
  "kaykit-halloween/lantern-standing": [0.64, 0.93, 0.64],
  "kaykit-halloween/post-lantern": [0.64, 3.3, 1.57],
  "kaykit-resources/copper-nuggets": [0.93, 0.47, 0.85],
  "kaykit-resources/iron-nuggets": [0.93, 0.47, 0.85],
  "kaykit-resources/stone-bricks-stack-large": [1.51, 1.23, 1.63],
  "kaykit-resources/stone-bricks-stack-medium": [1.51, 0.63, 1.59],
  "kaykit-resources/stone-bricks-stack-small": [1.04, 0.63, 0.82],
  "kaykit-resources/stone-chunks-large": [1.5, 1.08, 1.35],
  "kaykit-resources/stone-chunks-small": [1.12, 0.58, 0.79],
  "kaykit-resources/wood-log-a": [0.72, 0.73, 1.35],
  "kaykit-resources/wood-log-b": [0.55, 0.55, 1.35],
  "kaykit-resources/wood-log-stack": [1.68, 1.5, 1.5],
  "kaykit-resources/wood-planks-stack-large": [1.67, 1.22, 1.62],
  "kaykit-resources/wood-planks-stack-medium": [1.67, 0.62, 1.62],
  "kaykit-resources/wood-planks-stack-small": [0.85, 0.32, 1.6],
  "kaykit-tools/axe": [0.62, 1.05, 0.22],
  "kaykit-tools/bucket-metal": [0.91, 1.16, 0.8],
  "kaykit-tools/mallet": [0.64, 0.98, 0.43],
  "kaykit-tools/pickaxe": [1.45, 1.39, 0.21],
  "kaykit-tools/rope-bundle-a": [1.39, 0.25, 0.53],
  "kaykit-tools/rope-bundle-b": [1.06, 0.23, 0.95],
  "kaykit-tools/saw": [1.35, 0.57, 0.13],
  "kenney-castle/flag-pennant": [0.46, 3.72, 2.47],
  "kenney-castle/tower-square-mid-door": [4, 4.34, 4],
  "kenney-castle/tower-square-mid-open": [4, 4.34, 4],
  "kenney-castle/tower-square-mid-windows": [4, 4.34, 4],
  "kenney-castle/wall-half": [4.3, 5.63, 4.3],
  "kenney-graveyard/altar-stone": [2.29, 1.07, 1.44],
  "kenney-graveyard/bench": [1.78, 1.16, 1],
  "kenney-graveyard/debris": [1.18, 0.35, 1.2],
  "kenney-graveyard/gravestone-debris": [1.09, 0.59, 1.41],
  "kenney-graveyard/hay-bale": [1.33, 0.78, 0.88],
  "kenney-graveyard/lantern-candle": [0.53, 0.85, 0.53],
  "kenney-mini-forest/flag": [1.3, 2.25, 0.47],
  "kenney-mini-forest/ladder": [1.51, 3, 0.41],
  "kenney-mini-forest/target": [1.65, 1.74, 1.41],
  "kenney-nature/canoe": [1.2, 0.73, 4.6],
  "kenney-nature/fence-simple": [4, 1.38, 0.28],
  "kenney-nature/flower-purple-a": [0.4, 0.61, 0.45],
  "kenney-nature/flower-purple-b": [0.52, 0.52, 0.6],
  "kenney-nature/flower-red-a": [0.4, 0.73, 0.45],
  "kenney-nature/flower-red-c": [0.45, 0.58, 0.45],
  "kenney-nature/flower-yellow-a": [0.4, 0.48, 0.45],
  "kenney-nature/flower-yellow-b": [0.52, 0.4, 0.6],
  "kenney-nature/log": [0.94, 0.69, 2.84],
  "kenney-nature/log-stack-large": [2.54, 1.39, 2.84],
  "kenney-nature/path-stone-circle": [3.73, 0.2, 3.51],
  "kenney-nature/statue-obelisk": [1.23, 3.5, 1.23],
  "kenney-nature/statue-ring": [2.4, 3.19, 1.6],
  "kenney-nature/stump-old": [1.43, 1.07, 1.48],
  "kenney-nature/stump-round": [1.29, 0.83, 1.48],
  "kenney-nature/stump-round-detailed": [1.43, 0.83, 1.48],
  "kenney-nature/tent-detailed-open": [3.5, 2.24, 2.67],
  "kenney-nature/tent-small-closed": [2.19, 2.24, 2.55],
  "kenney-pirate/barrel": [1.34, 1.23, 1.34],
  "kenney-pirate/boat-row-small": [4.47, 1.38, 3.85],
  "kenney-pirate/crate": [1.08, 0.77, 1.31],
  "kenney-pirate/platform": [4.06, 0.37, 4.08],
  "kenney-pirate/tool-paddle": [0.46, 1.64, 0.15],
  "kenney-pirate/tower-complete-large": [5.89, 16.62, 5.89],
  "kenney-survival/bedroll": [0.87, 0.35, 1.7],
  "kenney-survival/box": [0.7, 0.7, 0.7],
  "kenney-survival/bucket": [0.4, 0.54, 0.4],
  "kenney-survival/campfire-fishing-stand": [1.1, 0.77, 0.71],
  "kenney-survival/campfire-pit": [0.78, 0.31, 0.75],
  "kenney-survival/campfire-stand": [1.15, 0.79, 0.35],
  "kenney-survival/fish": [0.57, 0.3, 0.18],
  "kenney-survival/fish-large": [0.86, 0.45, 0.27],
  "kenney-survival/tent-canvas": [2.8, 2.46, 2.81],
  "kenney-survival/tree-log": [1.25, 1.39, 5],
  "kenney-survival/workbench": [0.91, 0.8, 0.83],
  "kenney-town/pillar-wood": [0.55, 3.47, 0.55],
  "quaternius-nature/birch-tree-2": [2.53, 6.93, 2.91],
  "quaternius-nature/birch-tree-dead-3": [1.45, 6.36, 1.62],
  "quaternius-nature/rock-moss-2": [1.05, 1.19, 1.12],
  "quaternius-nature/rock-moss-5": [1.14, 0.99, 1.57],
  "quaternius-props/banner-1": [1.85, 2.75, 0.22],
  "quaternius-props/barrel": [0.8, 1.03, 0.8],
  "quaternius-props/dummy": [0.93, 2.14, 0.67],
  "quaternius-props/stool": [0.55, 0.68, 0.55],
  "quaternius-props/weapon-stand": [1.59, 1.28, 1.13],
  "quaternius-rts/houses-first-age-1-level1": [9.34, 8.21, 8.18],
  "quaternius-rts/houses-first-age-3-level1": [7.27, 6.17, 7],
  "quaternius-rts/houses-second-age-3-level1": [7.27, 6.35, 7.27],
  "quaternius-rts/logs": [8.13, 1.72, 5.85],
  "quaternius-rts/mine": [13.8, 12.56, 14.62],
  "quaternius-rts/watch-tower-first-age-level2": [5.43, 15.71, 5.58],
  "quaternius-ships/boat": [2.19, 0.94, 4.01],
  "quaternius-village-kit/prop-vine2": [1.59, 2.99, 0.25],
  "quaternius-village-kit/prop-vine5": [2.65, 3.43, 1.29],
  "quaternius-village-kit/prop-vine6": [4.76, 2.84, 1.69],
  "quaternius-village-kit/prop-wagon": [2.24, 1.76, 4.63],
  "quaternius-village/bags": [0.97, 0.39, 0.86],
  "quaternius-village/bonfire-lit": [1.46, 1.27, 1.3],
  "quaternius-village/sawmill": [15.84, 10.31, 11.82],
  "quaternius-village/sawmill-saw": [2.54, 1.95, 6.14],
}

const catalog = createCatalog({ version: 1, palette: "test", importer: "test", packs: [], rigs: [] }, [
  Object.entries(SIZES).map(([id, size]) => entry({ id, size })),
])

const files = readdirSync(DIR)
  .filter((f) => f.endsWith(".json"))
  .sort()
const recipes = files.map((f) => JSON.parse(readFileSync(join(DIR, f), "utf8")) as PrefabRecipe)

describe("vignette recipes", () => {
  test("one per POI kind, named by it", () => {
    expect(files.map((f) => f.slice(0, -".json".length))).toEqual(POI_KINDS)
    expect(recipes.map((r) => r.id)).toEqual(POI_KINDS)
  })

  for (const recipe of recipes)
    describe(recipe.id, () => {
      test("is a valid dressing-only vignette", () => {
        expect(validatePrefab(recipe, PALETTE)).toEqual([])
        expect(recipe.kind).toBe("vignette")
        expect(recipe.house).toBeUndefined()
      })

      test("compiles within 24 × 24 m, its stations on the footprint", () => {
        const { meta } = compilePrefab(recipe, 1, catalog)
        expect(meta.frontage).toBeLessThanOrEqual(MAX_SIDE)
        expect(meta.depth).toBeLessThanOrEqual(MAX_SIDE)
        expect(meta.stations.length).toBeGreaterThanOrEqual(1)
        for (const s of meta.stations) {
          expect(Math.abs(s.at[0])).toBeLessThanOrEqual(meta.frontage / 2)
          expect(Math.abs(s.at[2])).toBeLessThanOrEqual(meta.depth / 2)
        }
      })
    })
})
