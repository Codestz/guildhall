/**
 * The town screen's deep link (`/town/<seed or preset>?tier=&hour=&harbour=&walls=&cam=&compare=1`):
 * what it reads, what it writes back, and the spec it asks the generator for. The path id is a seed
 * (`/town/2`) or a preset in `data/towns/` (`/town/concept`). Harbour and walls read as the planner's,
 * so the same link shows the same town on both screens. Pure.
 */
import { GOLDEN_HOUR } from "@guildhall/render"
import { TIERS, type Tier, type TownSpecInput } from "@guildhall/world"
import { compassOf, type HarbourChoice, parseHarbour, specOf, type WallChoice } from "../planner/query.ts"

/** The camera presets: the 3/4 establishing shot, down among the houses, and straight down. */
export const CAMS = ["hero", "street", "map"] as const
export type Cam = (typeof CAMS)[number]

export interface TownQuery {
  seed: number
  tier: Tier
  harbour: HarbourChoice
  walls: WallChoice
  /** 0–24; golden hour (17.5) by default. */
  hour: number
  cam: Cam
  /** Shows the planner's map of the same town in a corner. */
  compare: boolean
  /** A preset id from `data/towns/` the spec was read from; null for a plain seed. */
  preset: string | null
}

export const DEFAULT_TOWN: Readonly<TownQuery> = {
  seed: 1,
  tier: "town",
  harbour: "auto",
  walls: "auto",
  hour: GOLDEN_HOUR,
  cam: "hero",
  compare: false,
  preset: null,
}

/** The query key the path's id lands under (shell/router.ts). */
export const TOWN_KEY = "town"

const PRESET_ID = /^[a-z][a-z0-9-]*$/

export function parseTownQuery(q: URLSearchParams): TownQuery {
  const id = q.get(TOWN_KEY) ?? q.get("seed")
  const asSeed = id !== null && /^\d+$/.test(id) ? Number(id) : null
  const tier = q.get("tier") as Tier | null
  const hour = Number(q.get("hour"))
  const cam = q.get("cam") as Cam | null
  const walls = q.get("walls")
  return {
    seed: asSeed ?? DEFAULT_TOWN.seed,
    tier: tier && (TIERS as readonly string[]).includes(tier) ? tier : DEFAULT_TOWN.tier,
    harbour: parseHarbour(q.get("harbour")),
    walls: walls === "on" || walls === "off" ? walls : "auto",
    hour: q.has("hour") && Number.isFinite(hour) ? ((hour % 24) + 24) % 24 : DEFAULT_TOWN.hour,
    cam: cam && (CAMS as readonly string[]).includes(cam) ? cam : DEFAULT_TOWN.cam,
    compare: q.get("compare") === "1",
    preset: asSeed === null && id !== null && PRESET_ID.test(id) ? id : null,
  }
}

/** The view state as query params; defaults are left out so links stay short. */
export function townParams(t: TownQuery): URLSearchParams {
  const q = new URLSearchParams({ [TOWN_KEY]: t.preset ?? String(t.seed) })
  if (t.preset === null && t.tier !== DEFAULT_TOWN.tier) q.set("tier", t.tier)
  if (t.preset === null && t.harbour !== "auto")
    q.set("harbour", t.harbour === "none" ? "none" : (compassOf(t.harbour) ?? String(t.harbour)))
  if (t.preset === null && t.walls !== "auto") q.set("walls", t.walls)
  if (t.hour !== DEFAULT_TOWN.hour) q.set("hour", String(t.hour))
  if (t.cam !== DEFAULT_TOWN.cam) q.set("cam", t.cam)
  if (t.compare) q.set("compare", "1")
  return q
}

/** The spec a query asks for: `auto` fields are left out so the tier's defaults apply (as the planner). */
export function townSpec(t: TownQuery): TownSpecInput {
  return specOf(t)
}

/** The planner's link to the same town, for the compare inset's caption. */
export function plannerLink(t: TownQuery): URLSearchParams {
  const q = new URLSearchParams({ seed: String(t.seed), tier: t.tier })
  if (t.harbour !== "auto")
    q.set("harbour", t.harbour === "none" ? "none" : (compassOf(t.harbour) ?? String(t.harbour)))
  if (t.walls !== "auto") q.set("walls", t.walls)
  return q
}
