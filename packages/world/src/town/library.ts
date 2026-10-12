/**
 * The town's library, built once from the catalog and the authored prefab recipes: every prefab's
 * PrefabMeta (compiled at seed 0), the edge kits, and the catalog pieces each stage may scatter
 * (trees, crops, farm animals, pier decks, boats, cargo, and the props that dress yards and squares).
 * Each list starts from a short preferred set of ids (cheap, matching pieces that read well together)
 * and falls back to the catalog's categories and tags, so a library without one pack still gets
 * something. Ids not in the catalog are dropped, so nothing here names a piece that cannot be drawn.
 */
import {
  type Catalog,
  type CatalogEntry,
  type CatalogQuery,
  compilePrefab,
  type PrefabMeta,
  type PrefabRecipe,
} from "@guildhall/assets"
import { log } from "@guildhall/core"
import { edgeKits } from "./edges.ts"
import type { FarmLibrary } from "./farms.ts"
import type { HarbourLibrary, SizedPiece } from "./harbour.ts"
import { KEEP_FALLBACK } from "./landmark.ts"
import type { NatureLibrary } from "./nature.ts"
import type { TownLibrary } from "./types.ts"

const logger = log("world:library")

/** The props that dress yards, gardens, squares and quays (dress-time vignettes), each with its footprint. */
export interface PropKit {
  barrels: SizedPiece[]
  crates: SizedPiece[]
  sacks: SizedPiece[]
  firewood: SizedPiece[]
  anvils: SizedPiece[]
  benches: SizedPiece[]
  stalls: SizedPiece[]
  carts: SizedPiece[]
  wells: SizedPiece[]
  fountains: SizedPiece[]
  /** Outbuildings for the larger yards: coops, small barns. */
  sheds: SizedPiece[]
  /** Small trees for gardens and squares. */
  trees: SizedPiece[]
  bushes: SizedPiece[]
  flowers: SizedPiece[]
  /** Low ripe crops for allotments: one piece per plant. */
  crops: SizedPiece[]
  stumps: SizedPiece[]
  buckets: SizedPiece[]
}

/** Everything every stage reads: the pinned library plus each stage's extras, sizes and costs. */
export type PlanLibrary = TownLibrary &
  FarmLibrary &
  NatureLibrary &
  HarbourLibrary & {
    props: PropKit
    /** Footprint `[w, d]` (metres) of every id the library may place: prefabs and catalog pieces. */
    sizes: Record<string, [w: number, d: number]>
    /** Triangles per id (a prefab's are its seed-0 recipe's), for the metrics' estimate. */
    tris: Record<string, number>
  }

/** Words that rule a piece out of a temperate town (snow, deserts, dead woods). */
const OFF_SEASON = /snow|dead|bare|palm|cactus|crystal|fall|autumn|desert|ice/

/**
 * The library from the authored recipes and the catalog. A recipe that does not compile against the
 * catalog (a missing piece) is left out and logged; ids are sorted so the result is stable.
 */
export function prefabLibrary(recipes: readonly PrefabRecipe[], catalog: Catalog): PlanLibrary {
  const sizes: Record<string, [number, number]> = {}
  const tris: Record<string, number> = {}
  const prefabs: PrefabMeta[] = []
  for (const r of [...recipes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    try {
      const { recipe, meta } = compilePrefab(r, 0, catalog)
      prefabs.push(meta)
      sizes[meta.id] = [meta.frontage, meta.depth]
      let sum = 0
      for (const i of recipe.instances) {
        const t = catalog.get(i.piece)?.tris ?? 0
        sum += t
        // Its pieces too, so a draw's pieces can be counted one by one.
        tris[i.piece] = t
      }
      tris[meta.id] = sum
    } catch (err) {
      logger.warn("recipe left out", { id: r.id, error: String(err) })
    }
  }

  const note = (e: CatalogEntry): SizedPiece => {
    sizes[e.id] = [e.size[0], e.size[2]]
    tris[e.id] = e.tris
    return { id: e.id, w: e.size[0], d: e.size[2] }
  }
  /** The preferred ids present, else what the fallback query finds (temperate pieces only), sized. */
  const pick = (prefer: readonly string[], fallback: CatalogQuery | null, max = 8): SizedPiece[] => {
    const found = prefer.flatMap((id) => {
      const e = catalog.get(id)
      return e ? [e] : []
    })
    const list =
      found.length > 0 || !fallback
        ? found
        : catalog
            .query(fallback)
            .filter((e) => !OFF_SEASON.test(e.id))
            .slice(0, max)
    return list.map(note)
  }
  const ids = (list: readonly SizedPiece[]) => list.map((p) => p.id)

  const trees = pick(
    [
      "kaykit-forest/tree-1-b-color1",
      "kaykit-forest/tree-1-c-color1",
      "kaykit-forest/tree-3-b-color1",
      "kaykit-forest/tree-3-c-color1",
      "kaykit-forest/tree-2-c-color1",
      "quaternius-nature/common-tree-1",
      "quaternius-nature/common-tree-2",
    ],
    { category: "tree", minSize: [2, 4, 2], maxSize: [7, 10, 7] },
  )
  const pines = pick(
    ["quaternius-nature/pine-tree-2", "quaternius-nature/pine-tree-3", "kenney-nature/tree-pine-round-a"],
    { category: "tree", text: "pine", minSize: [1, 4, 1] },
  )
  const bushes = pick(
    ["kenney-nature/plant-bush", "kenney-nature/plant-bush-large", "kaykit-forest/bush-2-d-color1"],
    { category: "bush", maxSize: [2.5, 2, 2.5] },
  )
  const rocks = pick(
    ["kenney-nature/rock-small-c", "kenney-nature/rock-small-f", "kaykit-forest/rock-2-d-color1"],
    { category: "rock", maxSize: [4, 3, 4] },
  )
  const flowers = pick(
    ["kenney-nature/flower-red-a", "kenney-nature/flower-yellow-a", "kenney-nature/flower-purple-a"],
    { text: "flower", maxSize: [1, 1, 1] },
  )
  const hay = pick(["kenney-graveyard/hay-bale", "kenney-graveyard/hay-bale-bundled"], { text: "hay" })
  const cropGroups = [
    [
      "kenney-nature/crops-corn-stage-a",
      "kenney-nature/crops-corn-stage-b",
      "kenney-nature/crops-corn-stage-c",
    ],
    ["kenney-nature/crops-wheat-stage-a", "kenney-nature/crops-wheat-stage-b"],
    ["kenney-nature/crops-leafs-stage-a", "kenney-nature/crops-leafs-stage-b"],
    ["kenney-nature/crop-pumpkin"],
    ["kenney-nature/crop-carrot"],
    ["kenney-nature/crop-turnip"],
  ]
    .map((group) => ids(pick(group, null)))
    .filter((g) => g.length > 0)
  const crops =
    cropGroups.length > 0 ? cropGroups : [ids(pick([], { tags: ["crop"], maxSize: [1.5, 2, 1.5] }))]
  const animals = pick(
    ["quaternius-farm-animals/cow", "quaternius-farm-animals/sheep", "quaternius-farm-animals/pig"],
    { category: "animal", tags: ["farm"] },
  )
  const orchard = pick(["quaternius-crops/apple-4", "quaternius-crops/orange-4"], { tags: ["orchard"] })

  const decks = pick(
    ["kenney-pirate/platform-planks", "kenney-nature/bridge-center-wood"],
    { category: "bridge", text: "wood" },
    1,
  )
  const boats = pick(["quaternius-ships/boat", "quaternius-ships/boat-w-sail", "kenney-nature/canoe"], {
    tags: ["boat"],
  })
  const cargo = pick(
    ["kenney-pirate/crate", "kenney-pirate/barrel", "kenney-survival/box", "kaykit-tools/rope-bundle-a"],
    { text: "crate", maxSize: [1.5, 1.5, 1.5] },
  )

  const props: PropKit = {
    barrels: pick(["kenney-pirate/barrel", "kenney-platformer/barrel"], {
      text: "barrel",
      maxSize: [1.5, 1.5, 1.5],
    }),
    crates: pick(["kenney-pirate/crate", "kenney-platformer/crate", "kenney-survival/box"], {
      text: "crate",
      maxSize: [1.6, 1.6, 1.6],
    }),
    sacks: pick(["quaternius-village/bags", "quaternius-village/package-1"], {
      text: "bag",
      maxSize: [1.2, 1, 1.2],
    }),
    firewood: pick(["kenney-nature/log-stack", "kenney-nature/log-stack-large"], { text: "log stack" }),
    anvils: pick(["kenney-survival/workbench-anvil", "quaternius-props/anvil"], { text: "anvil" }),
    benches: pick(["kenney-graveyard/bench", "quaternius-village/bench-2"], {
      text: "bench",
      maxSize: [3.5, 1.5, 1.2],
    }),
    stalls: pick(["kenney-town/stall-red", "kenney-town/stall-green", "quaternius-village/market-stand-2"], {
      tags: ["market"],
      maxSize: [4.5, 5, 4.5],
    }),
    carts: pick(["kenney-town/cart", "kenney-town/cart-high"], { category: "vehicle", text: "cart" }),
    wells: pick(["quaternius-castle/well", "quaternius-village/well"], {
      tags: ["well"],
      maxSize: [4, 6, 4],
    }),
    fountains: pick(["kenney-town/fountain-round", "kenney-town/fountain-square"], {
      tags: ["fountain"],
      minSize: [5, 0, 5],
    }),
    sheds: pick(["quaternius-farm/chicken-coop", "quaternius-farm/open-barn", "quaternius-farm/small-barn"], {
      tags: ["barn"],
    }),
    trees: pick(["kenney-town/tree", "kenney-town/tree-crooked", "kaykit-forest/tree-2-b-color1"], {
      category: "tree",
      minSize: [2, 4, 2],
      maxSize: [3.5, 8, 3.5],
    }),
    crops: pick(
      ["kenney-nature/crop-pumpkin", "kenney-nature/crops-leafs-stage-b", "kenney-nature/crop-carrot"],
      {
        tags: ["crop"],
        maxSize: [1.2, 2, 1.2],
      },
    ),
    bushes,
    flowers,
    stumps: pick(["kenney-nature/stump-round", "kenney-nature/stump-square"], { text: "stump" }),
    buckets: pick(["kenney-survival/bucket"], { text: "bucket", maxSize: [0.8, 1, 0.8] }),
  }

  const kits = edgeKits("town")
  for (const kit of [...Object.values(kits), ...Object.values(edgeKits("city"))])
    for (const id of [kit.segment, kit.tower, kit.gate, kit.post])
      if (id) {
        const e = catalog.get(id)
        if (e) note(e)
      }
  const keep = catalog.get(KEEP_FALLBACK.piece)
  if (keep) note(keep)
  else sizes[KEEP_FALLBACK.piece] = [KEEP_FALLBACK.w, KEEP_FALLBACK.d]

  return {
    prefabs,
    edges: kits,
    nature: { trees: ids(trees), bushes: ids(bushes), crops: crops.flat(), hay: ids(hay), rocks: ids(rocks) },
    farm: { crops, animals: ids(animals), orchard: ids(orchard) },
    wild: {
      pines: ids(pines),
      flowers: ids(flowers),
      birches: ids(pick(["quaternius-nature/birch-tree-1", "quaternius-nature/birch-tree-3"], null)),
      willows: ids(pick(["quaternius-nature/willow-2", "quaternius-nature/willow-4"], null)),
      grass: ids(
        pick(
          ["kenney-nature/grass-large", "kaykit-forest/grass-2-d-color1", "quaternius-nature/grass-2"],
          null,
        ),
      ),
      reeds: ids(pick(["kenney-nature/grass-leafs-large", "quaternius-nature/grass"], null)),
      mushrooms: ids(pick(["kenney-nature/mushroom-red-group", "kenney-nature/mushroom-tan-group"], null)),
      logs: ids(pick(["quaternius-nature/wood-log-moss", "kenney-nature/log"], null)),
      stumps: ids(pick(["kenney-nature/stump-old", "quaternius-nature/tree-stump-moss"], null)),
      boulders: ids(
        pick(
          ["kaykit-forest/rock-3-k-color1", "kenney-nature/rock-large-b", "kaykit-forest/rock-1-j-color1"],
          null,
        ),
      ),
      stones: ids(pick(["kenney-nature/stone-small-flat-a", "kenney-nature/rock-small-flat-b"], null)),
    },
    harbour: {
      ...(decks[0] ? { deck: { id: decks[0].id, w: decks[0].w, d: decks[0].d } } : {}),
      boats,
      cargo: ids(cargo),
    },
    props,
    sizes,
    tris,
  }
}
