/**
 * Town presets: what each tier gives a spec that leaves a field out, filling them in, and the shape
 * check `data/towns/*.json` goes through.
 */
import { roll } from "@guildhall/core"
import { round3 } from "../geom/vec.ts"
import {
  DISTRICT_KINDS,
  type DistrictKind,
  LANDMARKS,
  type NormalSpec,
  TIERS,
  type Tier,
  type TierDefaults,
  type TownSpecInput,
} from "./types.ts"

/** Settlement tiers grow in reach, quarters, street density and defences (plan §4). */
export const TIER_DEFAULTS: Readonly<Record<Tier, Readonly<TierDefaults>>> = {
  hamlet: {
    radius: 45,
    districts: ["residential", "farm"],
    amax: 4000,
    gates: 2,
    plaza: 18,
    walls: false,
    farms: 4,
    harbourOdds: 0.2,
    landmark: null,
  },
  village: {
    radius: 70,
    districts: ["market", "residential", "farm"],
    amax: 3200,
    gates: 2,
    plaza: 24,
    walls: false,
    farms: 8,
    harbourOdds: 0.35,
    landmark: "chapel",
  },
  town: {
    radius: 110,
    districts: ["market", "residential", "craft", "farm"],
    amax: 2400,
    gates: 3,
    plaza: 30,
    walls: true,
    farms: 12,
    harbourOdds: 0.5,
    landmark: "guildhall",
  },
  city: {
    radius: 150,
    districts: ["market", "residential", "residential", "craft", "farm"],
    amax: 2000,
    gates: 4,
    plaza: 36,
    walls: true,
    farms: 16,
    harbourOdds: 0.6,
    landmark: "castle",
  },
  capital: {
    radius: 190,
    districts: ["market", "residential", "residential", "residential", "craft", "craft", "farm"],
    amax: 1800,
    gates: 4,
    plaza: 40,
    walls: true,
    farms: 20,
    harbourOdds: 0.7,
    landmark: "guildhall",
  },
}

/**
 * The spec with every default filled in. A harbour left out is rolled from the tier's odds (bearing
 * included); a harbour or castle adds its district when the default districts are used. Idempotent.
 */
export function normalizeSpec(spec: TownSpecInput): NormalSpec {
  const d = TIER_DEFAULTS[spec.tier]
  const harbour =
    spec.harbour !== undefined
      ? spec.harbour
      : roll(spec.seed, "odds:harbour") < d.harbourOdds
        ? { bearing: round3(2 * Math.PI * roll(spec.seed, "bearing:harbour")) }
        : null
  const landmark = spec.landmark !== undefined ? spec.landmark : d.landmark
  const districts: DistrictKind[] = spec.districts ?? [
    ...d.districts,
    ...(harbour ? (["harbour"] as const) : []),
    ...(landmark === "castle" ? (["castle"] as const) : []),
  ]
  return {
    seed: spec.seed,
    tier: spec.tier,
    districts,
    landmark,
    harbour,
    walls: spec.walls ?? d.walls,
    farms: spec.farms ?? d.farms,
    radius: spec.radius ?? d.radius,
  }
}

/** The radius a preset may ask for, metres: below it nothing fits, above it the bounds outgrow a region. */
export const RADIUS_RANGE = [20, 400] as const

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)
const oneOf = (list: readonly string[], v: unknown): boolean => typeof v === "string" && list.includes(v)
const show = (v: unknown): string => JSON.stringify(v) ?? String(v)

/** Problems with a town preset, as "where: what"; empty when it is a valid `TownSpecInput`. */
export function validateTownSpec(json: unknown): string[] {
  if (!isRecord(json)) return ["town: expected an object"]
  const s = json
  const out: string[] = []
  if (!(Number.isInteger(s.seed) && (s.seed as number) >= 0))
    out.push(`seed: expected a non-negative integer, got ${show(s.seed)}`)
  if (!oneOf(TIERS, s.tier)) out.push(`tier: expected one of ${TIERS.join(", ")}, got ${show(s.tier)}`)
  if (s.districts !== undefined) {
    if (!Array.isArray(s.districts) || s.districts.length === 0)
      out.push("districts: expected a non-empty list of district kinds")
    else
      for (const [i, k] of s.districts.entries())
        if (!oneOf(DISTRICT_KINDS, k)) out.push(`districts[${i}]: unknown district ${show(k)}`)
  }
  if (s.landmark !== undefined && s.landmark !== null && !oneOf(LANDMARKS, s.landmark))
    out.push(`landmark: expected null or one of ${LANDMARKS.join(", ")}, got ${show(s.landmark)}`)
  if (s.harbour !== undefined && s.harbour !== null && !(isRecord(s.harbour) && isNum(s.harbour.bearing)))
    out.push("harbour: expected null or { bearing: radians }")
  if (s.walls !== undefined && typeof s.walls !== "boolean") out.push("walls: expected a boolean")
  if (s.farms !== undefined && !(Number.isInteger(s.farms) && (s.farms as number) >= 0))
    out.push(`farms: expected a non-negative integer, got ${show(s.farms)}`)
  if (s.radius !== undefined) {
    const [min, max] = RADIUS_RANGE
    if (!(isNum(s.radius) && s.radius >= min && s.radius <= max))
      out.push(`radius: expected metres in ${min}..${max}, got ${show(s.radius)}`)
  }
  return out
}
