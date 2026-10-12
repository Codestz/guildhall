/**
 * What the generator may place, built on the main thread from the authored recipes and the catalog:
 * the `TownLibrary` (prefab metas plus the nature, farm, wild and harbour id lists) and the sizes the
 * map draws pieces at. When the world package exports `prefabLibrary(recipes, catalog)` (plan W6) that
 * is used as is; until then the lists are the ones the world tests stand on.
 */
import {
  buildHouse,
  type Catalog,
  compilePrefab,
  type PrefabMeta,
  type PrefabRecipe,
} from "@guildhall/assets"
import { edgeKits, type TownLibrary } from "@guildhall/world"
import type { DeriveLib, PieceInfo } from "./derive.ts"
import { stageFn } from "./generate.ts"
import type { JobLib } from "./job.ts"

interface Sized {
  id: string
  w: number
  d: number
}

/** The stand-in lists (packages/world/test/farms.test.ts), until the town library is authored. */
const STAND_IN = {
  nature: {
    trees: [
      "kaykit-forest/tree-1-c-color1",
      "kaykit-forest/tree-2-d-color1",
      "quaternius-nature/common-tree-1",
      "quaternius-nature/birch-tree-2",
      "quaternius-nature/pine-tree-2",
      "quaternius-nature/pine-tree-3",
    ],
    bushes: ["kaykit-forest/bush-2-e-color1", "quaternius-nature/bush-1", "quaternius-nature/bush-berries-2"],
    crops: ["quaternius-crops/wheat-4"],
    hay: ["kenney-graveyard/hay-bale", "kenney-graveyard/hay-bale-bundled"],
    rocks: ["kaykit-forest/rock-2-c-color1", "kaykit-forest/rock-3-g-color1", "quaternius-nature/rock-3"],
  },
  farm: {
    crops: ["wheat", "corn", "carrot", "pumpkin", "lettuce", "tomato"].map((c) =>
      [2, 3, 4].map((k) => `quaternius-crops/${c}-${k}`),
    ),
    animals: ["quaternius-farm-animals/cow", "quaternius-farm-animals/sheep", "quaternius-farm-animals/pig"],
    orchard: ["quaternius-crops/apple-4", "quaternius-crops/orange-4"],
  },
  wild: {
    pines: ["quaternius-nature/pine-tree-2", "quaternius-nature/pine-tree-3"],
    flowers: ["quaternius-nature/flowers", "kenney-platformer/flowers"],
  },
  harbour: {
    deck: { id: "kenney-town/planks", w: 3.5, d: 3.5 } as Sized,
    boats: [
      { id: "quaternius-ships/boat", w: 2.2, d: 4 },
      { id: "quaternius-ships/boat-w-sail", w: 2.4, d: 5.9 },
    ] as Sized[],
    cargo: ["kenney-pirate/crate", "kenney-pirate/barrel", "quaternius-props/crate-wooden"],
  },
}

/** A recipe's meta: compiled against the catalog when there is one, else from its house blueprint. */
export function metaOf(recipe: PrefabRecipe, catalog: Catalog | null): PrefabMeta | null {
  if (catalog)
    try {
      return compilePrefab(recipe, 1, catalog).meta
    } catch {
      // A dressing piece missing from this library: fall back to the blueprint's footprint.
    }
  if (!recipe.house) return null
  try {
    const h = buildHouse(recipe.house, 1)
    return {
      id: recipe.id,
      kind: recipe.kind,
      frontage: h.frontage,
      depth: h.depth,
      height: 3 * (recipe.house.storeys.length + 1),
      door: h.door,
      stations: recipe.anchors.filter((a) => a.kind === "station"),
      fits: recipe.fits,
      tags: recipe.tags,
    }
  } catch {
    return null
  }
}

/** Builds the job library: the town library the stages read and what the map needs to draw it. */
export function buildLibrary(recipes: readonly PrefabRecipe[], catalog: Catalog | null): JobLib {
  const prefabs = recipes.map((r) => metaOf(r, catalog)).filter((m): m is PrefabMeta => m !== null)
  const official = stageFn("prefabLibrary")
  let town: TownLibrary | null = null
  if (official && catalog)
    try {
      town = official(recipes, catalog) as TownLibrary
    } catch {
      town = null
    }
  town ??= { prefabs, edges: edgeKits("town"), ...STAND_IN } as TownLibrary

  const pieces: Record<string, PieceInfo> = {}
  const sized = [STAND_IN.harbour.deck, ...STAND_IN.harbour.boats]
  for (const s of sized) pieces[s.id] = { w: s.w, d: s.d, h: 1, cat: "prop" }
  if (catalog)
    for (const e of catalog.all()) {
      if (e.kind !== "static") continue
      const [w, h, d] = e.size
      pieces[e.id] = { w, d, h, cat: e.category }
    }
  for (const s of sized) pieces[s.id] = { ...(pieces[s.id] as PieceInfo), w: s.w, d: s.d }

  const derive: DeriveLib = { prefabs: town.prefabs, recipes: [...recipes], pieces, nature: town.nature }
  return { town, derive }
}
