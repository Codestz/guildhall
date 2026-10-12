/**
 * The town planner's deep link (`/planner?seed=&tier=&layers=&harbour=&walls=&look=`): what it
 * reads, what it writes back, and the spec input it turns into. Pure, so tests and the worker share it.
 */
import { TIERS, type Tier, type TownSpecInput } from "@guildhall/world"

/** Every layer the map can draw, in panel order. A layer with no data yet is shown greyed, then fills in. */
export const LAYERS = [
  "streets",
  "blocks",
  "lots",
  "houses",
  "walls",
  "castle",
  "farms",
  "nature",
  "harbour",
  "pois",
  "walk",
  "labels",
] as const
export type Layer = (typeof LAYERS)[number]

export const LAYER_NAMES: Readonly<Record<Layer, string>> = {
  streets: "Streets",
  blocks: "Blocks",
  lots: "Lots",
  houses: "Houses",
  walls: "Walls",
  castle: "Castle",
  farms: "Farms",
  nature: "Nature",
  harbour: "Harbour",
  pois: "POIs",
  walk: "Walk graph",
  labels: "Labels",
}

/** On unless the link says otherwise: everything but the walk graph (a debug overlay). */
export const DEFAULT_LAYERS: readonly Layer[] = LAYERS.filter((l) => l !== "walk")

/** Compass points for the harbour, as bearings on the map (x east, z south, so north is −z). */
export const COMPASS = {
  E: 0,
  SE: Math.PI / 4,
  S: Math.PI / 2,
  SW: (3 * Math.PI) / 4,
  W: Math.PI,
  NW: (5 * Math.PI) / 4,
  N: (3 * Math.PI) / 2,
  NE: (7 * Math.PI) / 4,
} as const
export type CompassPoint = keyof typeof COMPASS

/** `auto` rolls the tier's odds (as a preset that leaves it out does); `none` is dry land. */
export type HarbourChoice = "auto" | "none" | number
export type WallChoice = "auto" | "on" | "off"
export type Look = "colour" | "parchment"

export interface PlannerQuery {
  seed: number
  tier: Tier
  harbour: HarbourChoice
  walls: WallChoice
  layers: Layer[]
  look: Look
}

export const DEFAULT_QUERY: Readonly<PlannerQuery> = {
  seed: 1,
  tier: "town",
  harbour: "auto",
  walls: "auto",
  layers: [...DEFAULT_LAYERS],
  look: "colour",
}

/** A harbour value from the link: auto, none, a compass point or radians. */
export function parseHarbour(text: string | null): HarbourChoice {
  if (text === null || text === "" || text === "auto") return "auto"
  if (text === "none") return "none"
  const point = text.toUpperCase() as CompassPoint
  if (point in COMPASS) return COMPASS[point]
  const v = Number(text)
  return Number.isFinite(v) ? v : "auto"
}

/** The compass point a bearing is (to 1e-3), or null when it is between them. */
export function compassOf(bearing: number): CompassPoint | null {
  const tau = 2 * Math.PI
  const b = ((bearing % tau) + tau) % tau
  for (const [name, v] of Object.entries(COMPASS)) if (Math.abs(v - b) < 1e-3) return name as CompassPoint
  return null
}

export function parsePlannerQuery(q: URLSearchParams): PlannerQuery {
  const seed = Number(q.get("seed"))
  const tier = q.get("tier") as Tier | null
  const walls = q.get("walls")
  const layers = q.get("layers")
  const wanted =
    layers === null
      ? [...DEFAULT_LAYERS]
      : LAYERS.filter((l) =>
          layers
            .split(",")
            .map((s) => s.trim())
            .includes(l),
        )
  return {
    seed: q.has("seed") && Number.isFinite(seed) ? Math.max(0, Math.floor(seed)) : DEFAULT_QUERY.seed,
    tier: tier && (TIERS as readonly string[]).includes(tier) ? tier : DEFAULT_QUERY.tier,
    harbour: parseHarbour(q.get("harbour")),
    walls: walls === "on" || walls === "off" ? walls : "auto",
    layers: wanted,
    look: q.get("look") === "parchment" ? "parchment" : "colour",
  }
}

/** The view state as query params (the route is `/planner`); defaults are left out so links stay short. */
export function plannerParams(p: PlannerQuery): URLSearchParams {
  const q = new URLSearchParams({ seed: String(p.seed), tier: p.tier })
  if (p.harbour !== "auto")
    q.set("harbour", p.harbour === "none" ? "none" : (compassOf(p.harbour) ?? String(p.harbour)))
  if (p.walls !== "auto") q.set("walls", p.walls)
  const same = p.layers.length === DEFAULT_LAYERS.length && DEFAULT_LAYERS.every((l) => p.layers.includes(l))
  if (!same) q.set("layers", LAYERS.filter((l) => p.layers.includes(l)).join(","))
  if (p.look !== "colour") q.set("look", p.look)
  return q
}

/** The spec a query asks the generator for: `auto` fields are left out so the tier's defaults apply. */
export function specOf(p: Pick<PlannerQuery, "seed" | "tier" | "harbour" | "walls">): TownSpecInput {
  const spec: TownSpecInput = { seed: p.seed, tier: p.tier }
  if (p.harbour === "none") spec.harbour = null
  else if (p.harbour !== "auto") spec.harbour = { bearing: p.harbour }
  if (p.walls !== "auto") spec.walls = p.walls === "on"
  return spec
}

/** The six seeds the comparison strip shows round `seed`: three before and three after, never below 0. */
export function neighbourSeeds(seed: number): number[] {
  const start = Math.max(0, seed - 3)
  const out: number[] = []
  for (let s = start; out.length < 6; s++) if (s !== seed) out.push(s)
  return out
}
