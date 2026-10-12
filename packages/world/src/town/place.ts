/**
 * Stage 5 (plan §4): placement. Every built or corner lot gets one building: a prefab its district
 * builds at the spec's tier, as wide as the lot (the packer cut the lot to a frontage, so an exact
 * fit is preferred) and no deeper than it, picked by the district's mix. Corner lots take a prefab
 * tagged `corner` when there is one, and other lots leave those to the corners. The building stands
 * centred on the lot's width with its front (+z) on the street side, set back 0–1 m by seed, so its
 * footprint stays inside the lot. A lot's neighbour on the same frontage never gets the same prefab
 * when another fits (else another seed of it), and taverns and forges are capped per town. Garden
 * lots stay open. Civic lots (civic.ts claims them first) come with their prefab: that building stands
 * on the lot, centred on its width, its front on the street, with its civic kind's role. Given the
 * town's centre, house heights lean by distance from it: tall narrow houses near the market, low
 * cottages out by the walls.
 */
import type { PrefabMeta } from "@guildhall/assets"
import { DMath } from "@guildhall/core"
import type { Roll } from "../geom/sample.ts"
import { add, at, dist, EPS, scale, snap, type Vec2 } from "../geom/vec.ts"
import { CIVIC_ROLES, civicKind } from "./civic.ts"
import { DISTRICT_MIX, lotPrefabs } from "./lots.ts"
import { normalizeSpec } from "./spec.ts"
import type { DistrictKind, Lot, Placement, Tier, TownLibrary, TownSpecInput } from "./types.ts"

/** The most of a kind one town holds, by tier: one inn and one smithy to a village. */
const CAPS: Readonly<Partial<Record<PrefabMeta["kind"], Readonly<Record<Tier, number>>>>> = {
  tavern: { hamlet: 1, village: 1, town: 2, city: 3, capital: 4 },
  forge: { hamlet: 1, village: 1, town: 2, city: 3, capital: 4 },
}
/** A prefab within this of the lot's width fits it exactly, metres. */
const EXACT = 0.5
/** How much an exact fit outweighs a narrower prefab. */
const EXACT_BONUS = 8
/** The most a building is set back from the lot's front, metres. */
const SETBACK = 1
/** The house height the lean is measured from, metres (two storeys and a roof). */
const MID_HEIGHT = 10
/** How hard heights lean: a house's weight goes with (height / MID_HEIGHT) to this power at the extremes. */
const LEAN = 4
/** The lean is +1 at the centre and -1 this far out, as a share of the radius. */
const LEAN_REACH = 0.8
/** Past this lean either way, corner houses are no longer kept to corners (nor corners to them). */
const LOOSE = 0.3

/** A lot as `lots` gives it; one without a district is read as residential. */
export type PlaceLot = Lot & { district?: DistrictKind }

export function place(
  lots: readonly PlaceLot[],
  lib: TownLibrary,
  spec: TownSpecInput,
  roll: Roll,
  centre?: Vec2,
): Placement[] {
  const { tier, radius } = normalizeSpec(spec)
  const metas = new Map(lib.prefabs.map((m) => [m.id, m]))
  const used = new Map<string, number>()
  const out: Placement[] = []
  type Built = { lot: PlaceLot; prefab: string; seed: number }
  let prev: Built | null = null
  for (const lot of lots) {
    const draw: Roll = (salt) => roll(`${salt}:${lot.id}:place`)
    const next: Built | null = prev && adjacent(prev.lot, lot) ? prev : null
    const neighbour: string | null = next?.prefab ?? null
    if (lot.status === "garden") {
      prev = null
      continue
    }
    const civic = lot.prefab ? metas.get(lot.prefab) : undefined
    if (civic) {
      out.push(onLot(lot, civic, lot.seed ?? 0, 0))
      prev = null
      continue
    }
    const district = lot.district ?? "residential"
    const fits = lotPrefabs(lib, district, tier).filter(
      (p) =>
        p.frontage <= lot.w + EPS &&
        p.depth <= lot.depth + EPS &&
        (used.get(p.kind) ?? 0) < (CAPS[p.kind]?.[tier] ?? Infinity),
    )
    const lean = centre
      ? Math.max(-1, Math.min(1, 1 - (2 * dist(lot.origin, centre)) / (LEAN_REACH * radius)))
      : 0
    const corner = lot.status === "corner"
    const tagged = fits.filter((p) => p.tags.includes("corner") === corner)
    // Near the market the tall corner houses stand mid-row too; out by the walls a corner may be low.
    const free = (corner && lean < -LOOSE) || (!corner && lean > LOOSE)
    const shaped = tagged.length > 0 && !free ? tagged : fits
    const fresh = shaped.filter((p) => p.id !== neighbour)
    const pool = fresh.length > 0 ? fresh : shaped
    const meta = pick(pool, lot, district, draw("prefab"), lean)
    if (!meta) {
      prev = null
      continue
    }
    used.set(meta.kind, (used.get(meta.kind) ?? 0) + 1)
    const setback = Math.min(lot.depth - meta.depth, SETBACK) * draw("setback")
    const drawn = Math.floor(draw("seed") * 0x7fffffff)
    // A twin of the neighbour is at least another variant of it.
    const seed: number = meta.id === neighbour && drawn === next?.seed ? drawn + 1 : drawn
    out.push(onLot(lot, meta, seed, setback))
    prev = { lot, prefab: meta.id, seed }
  }
  return out
}

/**
 * The building on the lot, centred on its width: the lot's +z is the street side, and the building's
 * front sits `setback` behind the lot's front. A civic building takes its kind's role.
 */
function onLot(lot: Lot, meta: PrefabMeta, seed: number, setback: number): Placement {
  const z: Vec2 = [DMath.sin(lot.rot), DMath.cos(lot.rot)]
  const centre = add(lot.origin, scale(z, lot.depth / 2 - Math.max(0, setback) - meta.depth / 2))
  const kind = civicKind(meta)
  return {
    prefab: meta.id,
    seed,
    at: snap(centre),
    rot: lot.rot,
    lot: lot.id,
    role: kind ? CIVIC_ROLES[kind] : meta.kind,
  }
}

/** Whether two lots stand side by side on the same frontage (`lots` numbers them in order along it). */
function adjacent(a: Lot, b: Lot): boolean {
  return b.id === a.id + 1 && a.block === b.block && a.street === b.street
}

/**
 * A prefab from the pool, weighted by the district's mix, by how exactly it fills the lot, and by its
 * height as `lean` asks (+1 favours tall houses, -1 low ones, 0 neither).
 */
function pick(
  pool: readonly PrefabMeta[],
  lot: Lot,
  district: DistrictKind,
  u: number,
  lean: number,
): PrefabMeta | null {
  const mix = DISTRICT_MIX[district]
  const weights = pool.map(
    (p) =>
      (mix[p.kind] ?? 1) *
      (p.frontage >= lot.w - EXACT ? EXACT_BONUS : (p.frontage / lot.w) ** 2) *
      (lean !== 0 && p.height > 0 ? (p.height / MID_HEIGHT) ** (LEAN * lean) : 1),
  )
  const total = weights.reduce((a, b) => a + b, 0)
  let x = u * total
  for (const [i, p] of pool.entries()) {
    x -= at(weights, i)
    if (x < 0) return p
  }
  return pool.length > 0 ? at(pool, pool.length - 1) : null
}
