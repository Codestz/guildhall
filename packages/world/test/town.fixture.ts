/** The town tests' fixture: a catalog of measured pieces, the authored houses, and the presets. */
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import {
  type CatalogEntry,
  type Category,
  compilePrefab,
  createCatalog,
  KIT_PROFILES,
  type PrefabRecipe,
  type Recipe,
} from "@guildhall/assets"
import {
  EDGE_KITS,
  generateTown,
  KEEP_FALLBACK,
  prefabLibrary,
  type TownLayout,
  type TownSpecInput,
} from "../src/index.ts"

/** A valid static catalog entry with the fields a test cares about. */
export function entry(
  id: string,
  category: Category,
  size: [number, number, number],
  tags: string[] = [],
): CatalogEntry {
  const [pack, slug] = id.split("/") as [string, string]
  return {
    id,
    pack,
    source: `${slug}.glb`,
    name: slug,
    kind: "static",
    category,
    tags,
    size,
    footprint: { w: Math.ceil(size[0]), d: Math.ceil(size[2]) },
    tris: 100,
    verts: 80,
    bytes: 2048,
    swatches: [1],
    scale: { factor: 1, rule: "factor", confidence: "pack", flags: [] },
    flags: [],
    compose: { front: null, streetEdge: null, attach: "free", anchors: [], source: "placeholder" },
    files: { glb: `pieces/${pack}/${slug}.glb`, thumb: null },
    hash: "0badc0de",
  }
}

const recipesIn = (folder: string): PrefabRecipe[] => {
  const dir = join(import.meta.dir, "../../../data/recipes", folder)
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as PrefabRecipe)
}
/** The authored houses and the civic and landmark buildings (data/recipes/houses, landmarks). */
export const RECIPES: PrefabRecipe[] = [...recipesIn("houses"), ...recipesIn("landmarks")].sort((a, b) =>
  a.id < b.id ? -1 : 1,
)
/** The measured sizes of the pieces the landmark recipes use (from library/ after import). */
const CIVIC_PIECES = (
  JSON.parse(readFileSync(join(import.meta.dir, "civic-pieces.json"), "utf8")) as {
    id: string
    category: Category
    size: [number, number, number]
  }[]
).map((p) => entry(p.id, p.category, p.size))

/** Every catalog id in the kit profile and the recipes' dressing: what compiling the houses needs. */
function housePieces(): string[] {
  const ids = new Set<string>()
  const walk = (v: unknown): void => {
    if (typeof v === "string" && v.includes("/")) ids.add(v)
    else if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === "object") Object.values(v).forEach(walk)
  }
  walk(KIT_PROFILES["kenney-town"])
  for (const r of RECIPES) for (const i of r.dressing) ids.add(i.piece)
  return [...ids].sort()
}

/** The pieces the library prefers, at their measured sizes (library/ after import). */
const PIECES: CatalogEntry[] = [
  entry("kaykit-forest/tree-2-b-color1", "tree", [3.7, 6.04, 2.1]),
  entry("kenney-town/tree", "tree", [2.86, 6.76, 2.86]),
  entry("kenney-nature/tree-pine-tall-a", "tree", [1.54, 6.12, 1.57]),
  entry("kenney-nature/plant-bush", "bush", [1.58, 0.98, 1.58]),
  entry("kenney-nature/rock-small-c", "rock", [1.44, 0.49, 1.44]),
  entry("kenney-nature/flower-red-a", "ground", [0.4, 0.73, 0.45]),
  entry("kenney-graveyard/hay-bale", "prop", [1.33, 0.78, 0.88]),
  entry("kenney-nature/crops-corn-stage-a", "ground", [0.76, 1.25, 0.76], ["crop"]),
  entry("kenney-nature/crops-corn-stage-b", "ground", [0.76, 2.5, 0.76], ["crop"]),
  entry("kenney-nature/crop-pumpkin", "ground", [1.1, 0.83, 1.13], ["crop"]),
  entry("quaternius-farm-animals/cow", "animal", [0.67, 1.54, 2.75], ["farm"]),
  entry("quaternius-crops/apple-4", "tree", [2.98, 4.42, 2.53], ["orchard"]),
  entry("kenney-pirate/platform-planks", "floor", [3.08, 0.7, 4.39]),
  entry("quaternius-ships/boat", "prop", [2.19, 0.94, 4.01], ["boat"]),
  entry("kenney-pirate/crate", "prop", [1.08, 0.77, 1.31]),
  entry("kenney-pirate/barrel", "prop", [1.34, 1.23, 1.34]),
  entry("quaternius-village/bags", "prop", [0.97, 0.39, 0.86]),
  entry("kenney-nature/log-stack", "prop", [1.7, 1.39, 2.84]),
  entry("kenney-survival/workbench-anvil", "prop", [0.9, 0.94, 0.83]),
  entry("kenney-graveyard/bench", "prop", [1.78, 1.16, 1]),
  entry("kenney-town/stall-red", "prop", [3.47, 4.29, 3.47]),
  entry("kenney-town/cart", "vehicle", [3.1, 1.86, 4.65]),
  entry("quaternius-castle/well", "prop", [1.5, 1.87, 1.63], ["well"]),
  entry("kenney-town/fountain-round", "prop", [6.93, 0.97, 6.93], ["fountain"]),
  entry("quaternius-farm/chicken-coop", "prop", [2.41, 1.85, 2.15], ["farm"]),
  entry("kenney-nature/stump-round", "prop", [1.29, 0.83, 1.48]),
  entry("kenney-survival/bucket", "prop", [0.4, 0.54, 0.4]),
  entry(KEEP_FALLBACK.piece, "building", [KEEP_FALLBACK.w, 12, KEEP_FALLBACK.d]),
  ...Object.values(EDGE_KITS).flatMap((k) => {
    const kit: {
      segment: string
      length: number
      thickness: number
      tower?: string
      towerSize?: number
      gate?: string
    } = k
    return [
      entry(kit.segment, "wall", [kit.length, 2, kit.thickness]),
      ...(kit.tower ? [entry(kit.tower, "tower", [kit.towerSize ?? 3, 8, kit.towerSize ?? 3])] : []),
      ...(kit.gate ? [entry(kit.gate, "wall", [kit.length, 4, kit.thickness])] : []),
    ]
  }),
]

export const INDEX = { version: 1 as const, palette: "test", importer: "test", packs: [], rigs: [] }
// A piece both lists hold keeps its tags here and takes the measured size (the keep's stand-in castle
// above is only footprint-true).
const measured = new Map(CIVIC_PIECES.map((e) => [e.id, e]))
const pieces = PIECES.map((e) => {
  const m = measured.get(e.id)
  return m ? { ...e, size: m.size, footprint: m.footprint } : e
})
const known = new Set(pieces.map((e) => e.id))
const civic = CIVIC_PIECES.filter((e) => !known.has(e.id))
for (const e of civic) known.add(e.id)
export const CATALOG = createCatalog(INDEX, [
  pieces,
  civic,
  housePieces()
    .filter((id) => !known.has(id))
    .map((id) => entry(id, "wall", [0.35, 3.47, 3.47])),
])
export const LIB = prefabLibrary(RECIPES, CATALOG)
/** Each recipe compiled once (seed 0), keyed by prefab id: what the town screen hands dressTown. */
export const COMPILED = new Map<string, Recipe>(
  RECIPES.map((r) => [r.id, compilePrefab(r, 0, CATALOG).recipe]),
)

export const PRESETS: TownSpecInput[] = [
  { seed: 3, tier: "hamlet", harbour: null },
  { seed: 13, tier: "village" },
  { seed: 2, tier: "town" },
  { seed: 1, tier: "city" },
]
export const label = (s: TownSpecInput) => `${s.tier}#${s.seed}`
export const built = new Map<string, { plan: TownLayout; ms: Record<string, number> }>()
export function town(spec: TownSpecInput): TownLayout {
  const key = label(spec)
  let got = built.get(key)
  if (!got) {
    const ms: Record<string, number> = {}
    got = { plan: generateTown(spec, LIB, ms), ms }
    built.set(key, got)
  }
  return got.plan
}
