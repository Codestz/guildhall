import { activeWorld } from "./active.ts"
import { type Behaviour, type Place, repoSpots, SITE_WORK, spotsOf } from "./behaviours.ts"
import type { Biome } from "./gen/biomes.ts"
import type { District } from "./gen/dress.ts"
import type { SiteId } from "./lands.ts"
import type { Post } from "./layout.ts"
import { sitesOf } from "./siteMap.ts"
import type { World } from "./world.ts"

/**
 * Work at any district of a repo's island (ADR 0013), not only the six the story's sites took
 * (world/siteMap.ts): the townsfolk work in their own district. A district works the trade its
 * landmark is for, laid out round its own posts as a repo site's is (behaviours.ts `repoSpots`):
 * pickaxes at the mine, spells at the tower, bows at the range. Everywhere else builders hammer at
 * the landmark and saw at the heap, since that needs no scenery of its own (a lumberjack needs the
 * forest site's work trees, an angler its shore). A district a story site already stands on is that
 * site's place, so its agents and townsfolk share the posts and their sharers' rows.
 */

/** The trade a district's landmark is for; the yard's where a trade would need what isn't there. */
const TRADE: Partial<Record<Biome, SiteId>> = { quarry: "quarry", library: "tower", proving: "proving" }

export function tradeOf(district: Pick<District, "biome">): SiteId {
  return TRADE[district.biome] ?? "yard"
}

/** A district of the world by id (its folder: "/", "compiler", "packages/react-dom"). */
export function districtById(id: string, world: World | undefined = activeWorld()): District | undefined {
  return world?.repo?.districts.find((district) => district.id === id)
}

/** The story site standing on this district's own posts, if any: work there is that site's. */
export function siteOfDistrict(id: string, world: World | undefined = activeWorld()): SiteId | undefined {
  const district = districtById(id, world)
  if (!district || district.posts.length === 0) return undefined
  const sites = sitesOf(world)
  return (Object.keys(sites) as SiteId[]).find((site) => sites[site].posts === district.posts)
}

const behaviours = new WeakMap<World, Map<string, Behaviour | null>>()

/** A district's work: its trade's loop round its own posts. Undefined for no such district, or one without posts. */
export function districtWork(id: string, world: World | undefined = activeWorld()): Behaviour | undefined {
  if (!world) return undefined
  const known = behaviours.get(world) ?? new Map<string, Behaviour | null>()
  behaviours.set(world, known)
  let behaviour = known.get(id)
  if (behaviour === undefined) {
    const district = districtById(id, world)
    const trade = district ? tradeOf(district) : undefined
    behaviour =
      district && trade && district.posts.length > 0
        ? { ...SITE_WORK[trade], spots: repoSpots(trade, district.at, district.posts) }
        : null
    known.set(id, behaviour)
  }
  return behaviour ?? undefined
}

/** The place key of a district's work (scene/activity.ts reserves berths by it; world/sharers.ts spreads them). */
export const districtKey = (id: string): string => `district:${id}`

/** The place a worker sent to `target` (one of the district's posts) is at; undefined anywhere else. */
export function districtPlaceOf(
  id: string,
  target: Post,
  world: World | undefined = activeWorld(),
): Place | undefined {
  const behaviour = districtWork(id, world)
  const posts = districtById(id, world)?.posts ?? []
  const berth = posts.findIndex(
    (post) => Math.abs(post[0] - target[0]) < 1e-6 && Math.abs(post[1] - target[1]) < 1e-6,
  )
  if (!behaviour || berth < 0) return undefined
  return { key: districtKey(id), behaviour, berth, post: target, spots: spotsOf(behaviour, target, berth) }
}
