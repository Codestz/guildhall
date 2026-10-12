/**
 * Island presets: what the main town's tier gives a spec that leaves a field out, filling them in,
 * and the shape check `data/islands/*.json` goes through (plan-w8 §3, §4.3, §4.5).
 */
import { hash, roll } from "@guildhall/core"
import { round3 } from "../geom/vec.ts"
import { normalizeSpec, validateTownSpec } from "../town/spec.ts"
import { TIERS, type Tier } from "../town/types.ts"
import {
  type IslandSpecInput,
  type NormalIslandSpec,
  POI_KINDS,
  type PoiKind,
  ROLES,
  SATELLITE_TIERS,
  type SatelliteSpec,
} from "./types.ts"

export interface IslandDefaults {
  scale: number
  satellites: readonly SatelliteSpec[]
  pois: readonly PoiKind[]
  lakes: 0 | 1 | 2
  rough: 0 | 1 | 2
  wildlife: boolean
}

const TOWN_POIS: readonly PoiKind[] = [
  "lighthouse",
  "lake-pier",
  "lumber-camp",
  "fishing-spot",
  "ruins",
  "shrine",
  "lookout",
  "training-ground",
]
const CITY_POIS: readonly PoiKind[] = [
  "lighthouse",
  "quarry",
  "mine",
  "lake-pier",
  "lumber-camp",
  "fishing-spot",
  "ruins",
  "shrine",
  "lookout",
  "training-ground",
]
const SMALL_POIS: readonly PoiKind[] = [
  "fishing-spot",
  "lake-pier",
  "lumber-camp",
  "shrine",
  "lookout",
  "ruins",
]
const CITY_SATELLITES: readonly SatelliteSpec[] = [
  { role: "fishing", tier: "village" },
  { role: "farming", tier: "village" },
  { role: "mining", tier: "hamlet" },
]

/**
 * Per main tier (§4.3, §4.5): the island is 2.2 town radii (the town ≈ 21% of it), town 2 satellites
 * (fishing + farming), city and capital 3 (+ the mining camp, a hamlet), village at most 1 (dropped if
 * it does not fit); 6–10 POIs; one lake (two from city up); one rough field; sparse wildlife on.
 */
export const ISLAND_DEFAULTS: Readonly<Record<Tier, Readonly<IslandDefaults>>> = {
  hamlet: { scale: 2.2, satellites: [], pois: SMALL_POIS, lakes: 1, rough: 1, wildlife: true },
  village: {
    scale: 2.2,
    satellites: [{ role: "fishing", tier: "hamlet" }],
    pois: SMALL_POIS,
    lakes: 1,
    rough: 1,
    wildlife: true,
  },
  town: {
    scale: 2.2,
    satellites: [
      { role: "fishing", tier: "hamlet" },
      { role: "farming", tier: "hamlet" },
    ],
    pois: TOWN_POIS,
    lakes: 1,
    rough: 1,
    wildlife: true,
  },
  city: { scale: 2.2, satellites: CITY_SATELLITES, pois: CITY_POIS, lakes: 2, rough: 1, wildlife: true },
  capital: { scale: 2.2, satellites: CITY_SATELLITES, pois: CITY_POIS, lakes: 2, rough: 1, wildlife: true },
}

/** The scale a preset may ask for: below it the town's own frame (1.6r) crowds the coast, above it the island outgrows the budget. */
export const SCALE_RANGE = [1.8, 3.5] as const
/** At most this many satellites: the island cannot hold more frames apart (§4.3 spacing). */
export const MAX_SATELLITES = 4

/**
 * The spec with every default filled in. The town's harbour is forced on (the growth origin): left
 * out, its bearing is rolled from the town's seed as the town would roll it. A satellite without a
 * seed gets one salted by its role and its index among that role (ADR 014), so adding a farming
 * village never reseeds the fishing one. Idempotent.
 */
export function normalizeIslandSpec(spec: IslandSpecInput): NormalIslandSpec {
  const t = spec.town
  const harbour = t.harbour ?? { bearing: round3(2 * Math.PI * roll(t.seed, "bearing:harbour")) }
  const town = { ...normalizeSpec({ ...t, harbour }), harbour }
  const d = ISLAND_DEFAULTS[town.tier]
  const seen: Partial<Record<SatelliteSpec["role"], number>> = {}
  const satellites = (spec.satellites ?? d.satellites).map((sat) => {
    const k = seen[sat.role] ?? 0
    seen[sat.role] = k + 1
    return { role: sat.role, tier: sat.tier, seed: sat.seed ?? hash(spec.seed, `${sat.role}-${k}:satellite`) }
  })
  return {
    seed: spec.seed,
    town,
    scale: spec.scale ?? d.scale,
    satellites,
    pois: [...(spec.pois ?? d.pois)],
    lakes: spec.lakes ?? d.lakes,
    rough: spec.rough ?? d.rough,
    wildlife: spec.wildlife ?? d.wildlife,
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)
const isSeed = (v: unknown): boolean => Number.isInteger(v) && (v as number) >= 0
const oneOf = (list: readonly unknown[], v: unknown): boolean => list.includes(v)
const show = (v: unknown): string => JSON.stringify(v) ?? String(v)

/** Problems with an island preset, as "where: what"; empty when it is a valid `IslandSpecInput`. */
export function validateIslandSpec(json: unknown): string[] {
  if (!isRecord(json)) return ["island: expected an object"]
  const s = json
  const out: string[] = []
  if (!isSeed(s.seed)) out.push(`seed: expected a non-negative integer, got ${show(s.seed)}`)
  out.push(...validateTownSpec(s.town).map((p) => `town.${p}`))
  if (isRecord(s.town) && s.town.harbour === null)
    out.push("town.harbour: the main town is the harbour town; leave it out or give a bearing")
  const mainTier = isRecord(s.town) && oneOf(TIERS, s.town.tier) ? (s.town.tier as Tier) : null
  if (s.scale !== undefined) {
    const [min, max] = SCALE_RANGE
    if (!(isNum(s.scale) && s.scale >= min && s.scale <= max))
      out.push(`scale: expected town radii in ${min}..${max}, got ${show(s.scale)}`)
  }
  for (const key of ["lakes", "rough"] as const)
    if (s[key] !== undefined && !oneOf([0, 1, 2], s[key]))
      out.push(`${key}: expected 0, 1 or 2, got ${show(s[key])}`)
  if (s.wildlife !== undefined && typeof s.wildlife !== "boolean") out.push("wildlife: expected a boolean")
  if (s.satellites !== undefined) {
    if (!Array.isArray(s.satellites)) out.push("satellites: expected a list")
    else {
      if (s.satellites.length > MAX_SATELLITES)
        out.push(`satellites: at most ${MAX_SATELLITES}, got ${s.satellites.length}`)
      for (const [i, sat] of s.satellites.entries()) out.push(...satelliteProblems(sat, i, mainTier))
    }
  }
  if (s.pois !== undefined) {
    if (!Array.isArray(s.pois)) out.push("pois: expected a list of POI kinds")
    else
      for (const [i, k] of s.pois.entries())
        if (!oneOf(POI_KINDS, k)) out.push(`pois[${i}]: unknown POI ${show(k)}`)
  }
  out.push(...landNeeds(s, mainTier))
  return out
}

function satelliteProblems(sat: unknown, i: number, mainTier: Tier | null): string[] {
  const at = `satellites[${i}]`
  if (!isRecord(sat)) return [`${at}: expected { role, tier, seed? }`]
  const out: string[] = []
  const roles = ROLES.filter((r) => r !== "main")
  if (!oneOf(roles, sat.role))
    out.push(`${at}.role: expected one of ${roles.join(", ")}, got ${show(sat.role)}`)
  if (!oneOf(SATELLITE_TIERS, sat.tier))
    out.push(`${at}.tier: expected one of ${SATELLITE_TIERS.join(", ")}, got ${show(sat.tier)}`)
  else if (mainTier && TIERS.indexOf(sat.tier as Tier) >= TIERS.indexOf(mainTier))
    out.push(`${at}.tier: a satellite must be smaller than the main ${mainTier}`)
  if (sat.role === "mining" && sat.tier !== "hamlet") out.push(`${at}.tier: the mining camp is a hamlet`)
  if (sat.seed !== undefined && !isSeed(sat.seed))
    out.push(`${at}.seed: expected a non-negative integer, got ${show(sat.seed)}`)
  return out
}

/** What the spec asks for that its land cannot give: a lake POI with no lake, a mine with no rough ground. */
function landNeeds(s: Record<string, unknown>, mainTier: Tier | null): string[] {
  if (!mainTier) return []
  const d = ISLAND_DEFAULTS[mainTier]
  const lakes = s.lakes ?? d.lakes
  const rough = s.rough ?? d.rough
  const pois = Array.isArray(s.pois) ? (s.pois as unknown[]) : d.pois
  const sats = Array.isArray(s.satellites) ? (s.satellites as unknown[]) : d.satellites
  const out: string[] = []
  if (lakes === 0 && pois.includes("lake-pier")) out.push("pois: a lake-pier needs lakes >= 1")
  if (rough === 0) {
    for (const k of ["quarry", "mine"] as const)
      if (pois.includes(k)) out.push(`pois: a ${k} needs rough >= 1`)
    if (sats.some((sat) => isRecord(sat) && sat.role === "mining"))
      out.push("satellites: the mining camp needs rough >= 1")
  }
  return out
}
