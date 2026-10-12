/**
 * `compilePrefab(recipe, seed, catalog)` (ADR 005): a PrefabRecipe → the flat Recipe every renderer
 * reads, plus the PrefabMeta the town generator fits to lots. Pure: same inputs, same `recipeHash`.
 * Structure sits on the kit's module lattice (built so by `buildHouse`); dressing is snapped here.
 */
import type { Anchor } from "../compose.ts"
import type { Catalog } from "../query.ts"
import type { Recipe, RecipeInstance } from "../recipe.ts"
import { type PrefabMeta, type PrefabRecipe, validatePrefab } from "./blueprint.ts"
import { buildHouse } from "./house.ts"

/**
 * Dressing lattice: the composer snaps to the 1 m grid at quarter turns, or the fine 0.25 m / 15° with
 * alt held. The compiler keeps whatever lies on the fine lattice (it contains the coarse one).
 */
export const SNAP = { grid: 1, turn: Math.PI / 2, fine: 0.25, fineTurn: Math.PI / 12 } as const

const snap = (v: number, step: number): number => {
  const s = Math.round(v / step) * step
  return s === 0 ? 0 : s
}
const r2 = (v: number): number => Math.round(v * 100) / 100

function onLattice(i: RecipeInstance): RecipeInstance {
  return {
    ...i,
    x: snap(i.x, SNAP.fine),
    z: snap(i.z, SNAP.fine),
    y: r2(i.y),
    rot: snap(i.rot, SNAP.fineTurn),
  }
}

/**
 * Compiles a prefab for `seed`. Throws an Error naming the prefab when the recipe is invalid, a piece
 * is not in the catalog, or the kit cannot draw the blueprint.
 */
export function compilePrefab(
  r: PrefabRecipe,
  seed: number,
  cat: Catalog,
): { recipe: Recipe; meta: PrefabMeta } {
  const fail = (message: string): never => {
    throw new Error(`compilePrefab(${r.id}): ${message}`)
  }
  const problems = validatePrefab(r)
  if (problems.length > 0) fail(problems.join("; "))

  let house: ReturnType<typeof buildHouse> | undefined
  try {
    house = r.house ? buildHouse(r.house, seed) : undefined
  } catch (e) {
    fail((e as Error).message)
  }
  const instances = [...(house?.parts.map((p) => p.instance) ?? []), ...r.dressing.map(onLattice)]

  let height = 0
  let reach = { x: 0, z: 0 }
  for (const i of instances) {
    const entry = cat.get(i.piece) ?? fail(`unknown piece "${i.piece}"`)
    const [sw, sh, sd] = entry.size
    height = Math.max(height, i.y + sh * i.scale)
    // Dressing-only prefabs size themselves by a loose bound (pivots may be off-centre).
    const half = (Math.max(sw, sd) * i.scale) / 2
    reach = { x: Math.max(reach.x, Math.abs(i.x) + half), z: Math.max(reach.z, Math.abs(i.z) + half) }
  }

  const frontage = house?.frontage ?? Math.ceil(2 * reach.x)
  const depth = house?.depth ?? Math.ceil(2 * reach.z)
  const authoredDoor = r.anchors.find((a) => a.kind === "door")
  const door: [number, number] =
    house?.door ?? (authoredDoor ? [authoredDoor.at[0], authoredDoor.at[2]] : [0, depth / 2])
  const sockets: Anchor[] = [
    ...(house
      ? [{ id: "door", kind: "door" as const, at: [door[0], 0, door[1]] as Anchor["at"], facing: 0 }]
      : []),
    ...r.anchors,
  ]

  return {
    recipe: { id: r.id, seed, instances, sockets },
    meta: {
      id: r.id,
      kind: r.kind,
      frontage,
      depth,
      height: r2(height),
      door,
      stations: r.anchors.filter((a) => a.kind === "station"),
      fits: r.fits,
      tags: r.tags,
    },
  }
}
