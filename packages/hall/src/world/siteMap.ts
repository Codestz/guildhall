import { activeWorld } from "./active.ts"
import type { Biome } from "./gen/biomes.ts"
import type { District, RepoIsland } from "./gen/dress.ts"
import { cellAt, key, neighbours, unkey } from "./gen/hex.ts"
import { type Cell, cellToWorld, SITES, type Site, type SiteId } from "./lands.ts"
import type { Post, Spot } from "./layout.ts"
import type { World } from "./world.ts"

/**
 * The story's job sites on a world. `SiteId` stays the story's fixed vocabulary (the roster sends
 * each role to one: explorers to the forest, implementers to the yard…); where each one *is* is the
 * world's. On the hand-drawn lands that's lands.ts' `SITES`; on a repo's island each site takes the
 * district that best fits its trade, and the district's landmark, spot and posts become the site's.
 */

/** The world's sites: the active world's when none is given (the hand lands' before any loads). */
export function sitesOf(world: World | undefined = activeWorld()): Readonly<Record<SiteId, Site>> {
  return world?.storySites ?? SITES
}

/** The biome each site's trade belongs in. The river wants a shore instead (`coastal`). */
const TRADE: Record<Exclude<SiteId, "river">, Biome> = {
  forest: "forest",
  quarry: "quarry",
  proving: "proving",
  tower: "library",
  yard: "village",
}
/** The order sites choose in (fixed: the mapping never depends on object key order). */
const ORDER: readonly SiteId[] = ["yard", "forest", "quarry", "proving", "tower", "river"]

/** A gen 2 island's story sites prefer a district this near the keep, world units: the walk from it stays short. */
const STORY_REACH = 90

/** How far a fishing post stands from its coast hex's centre, towards the sea. */
const SHORE = 1.5
/** Fishing posts keep this far off anything placed on the land (rocks, trees, the landmark's props). */
const CLEAR = 2.5

/**
 * Each site's district on a repo's island, deterministically: its trade's biome first (the largest
 * such district; the yard the biggest package's village of a split workspace when there is one, so
 * the builders work in the monorepo's biggest package), the river the largest district on the shore; any site left over takes the
 * unclaimed district nearest the keep. Districts without a landmark are passed over (no room on
 * the shore for one), the harbour too unless nothing else is left. When there are fewer districts
 * than sites, the leftover ones share the nearest district, each moved clear of the others' posts.
 */
export function mapSites(made: RepoIsland): Record<SiteId, Site> {
  const { plan } = made
  const indexOf = new Map(made.districts.map((district, i) => [district, i]))
  const all = made.districts.filter((district) => district.landmark)
  const harbour = all.filter((district) => district.biome === "harbour")
  const towns = all.filter((district) => district.biome !== "harbour")
  const coastal = new Set(towns.filter((district) => shoreOf(made, indexOf.get(district) ?? -1).length > 0))
  const largest = (list: readonly District[]) =>
    [...list].sort((a, b) => b.hexes - a.hexes || (a.id < b.id ? -1 : 1))[0]
  const biggest = (list: readonly District[]) =>
    [...list].sort((a, b) => b.bytes - a.bytes || (a.id < b.id ? -1 : 1))[0]
  /** On a gen 2 island, the districts within the story's reach of the keep, if any are (else all). */
  const reachable = (list: readonly District[]): readonly District[] => {
    const close = list.filter((district) => Math.hypot(...district.at) <= STORY_REACH)
    return plan.gen === 2 && close.length > 0 ? close : list
  }
  const nearest = (list: readonly District[]) =>
    [...list].sort((a, b) => Math.hypot(...a.at) - Math.hypot(...b.at) || (a.id < b.id ? -1 : 1))[0]

  const chosen = new Map<SiteId, District>()
  const free = (list: readonly District[]) =>
    list.filter((district) => ![...chosen.values()].includes(district))
  const isPackage = (district: District): boolean => {
    const folder = plan.districts[indexOf.get(district) ?? -1]?.folder
    return folder?.group !== undefined && !folder.pooled
  }
  for (const id of ORDER) {
    if (id === "river") continue
    const trade = reachable(free(towns).filter((district) => district.biome === TRADE[id]))
    const match = (id === "yard" ? biggest(trade.filter(isPackage)) : undefined) ?? largest(trade)
    if (match) chosen.set(id, match)
  }
  const shore = largest(free(towns).filter((district) => coastal.has(district)))
  if (shore) chosen.set("river", shore)
  for (const id of ORDER) {
    if (chosen.has(id)) continue
    const left = nearest(free(towns)) ?? nearest(free(harbour)) ?? nearest(towns) ?? nearest(harbour)
    if (left) chosen.set(id, left)
  }

  /** Districts whose own posts a site already stands at. */
  const sharers = new Map<District, true>()
  const out = {} as Record<SiteId, Site>
  for (const id of ORDER) {
    const district = chosen.get(id)
    const hand = SITES[id]
    if (!district) {
      // An island with no landmark at all: the harbour's square, the hub.
      const hub = cellToWorld(plan.hub)
      out[id] = { id, label: hand.label, at: hub, posts: [[hub[0], hub[1], 0]] }
      continue
    }
    const fishing = id === "river" ? fishingPosts(made, indexOf.get(district) ?? -1) : []
    const first = fishing.length === 0 && !sharers.has(district)
    if (fishing.length === 0) sharers.set(district, true)
    const taken = Object.values(out).flatMap((site) => site.posts)
    const posts = fishing.length > 0 ? fishing : first ? district.posts : shared(made, district.posts, taken)
    out[id] = {
      id,
      label: hand.label,
      at: district.at,
      posts,
      ...(district.landmark ? { landmark: district.landmark } : {}),
    }
  }
  return out
}

/**
 * Where a site sharing a district stands instead: its posts moved by the nearest of these offsets
 * (across the landmark's front, then back from it) that keeps every post on dry level ground and a
 * step from the other sites' posts. In the posts' own frame: [to their right, back from the work].
 */
const SHIFTS: readonly Spot[] = [
  [0, 2.4],
  [4.6, 0],
  [-4.6, 0],
  [4.6, 2.4],
  [-4.6, 2.4],
  [0, 4.8],
  [9.2, 0],
  [-9.2, 0],
  [4.6, 4.8],
  [-4.6, 4.8],
  [0, 7.2],
]
/** How far apart two sites' posts stay. */
const APART = 1.2
/** Off a sea hex's centre: its coast tile's sand slopes down to the water this far in (wilds.ts WATER_CLEARANCE). */
const BEACH = 8

/** A sharing site's posts: the district's own moved clear of `taken`, on dry level land. */
function shared(made: RepoIsland, posts: readonly Post[], taken: readonly Post[]): readonly Post[] {
  const middle = posts[Math.floor(posts.length / 2)]
  if (!middle) return posts
  const facing = middle[2]
  const right: Spot = [-Math.cos(facing), Math.sin(facing)]
  const back: Spot = [-Math.sin(facing), -Math.cos(facing)]
  const dry = (x: number, z: number): boolean => {
    const char = made.plan.land.get(key(cellAt([x, z])))?.char
    if (!char || !LEVEL_GROUND.has(char) || made.levels.has(key(cellAt([x, z])))) return false
    return !made.island.water.some((w) => Math.hypot(w[0] - x, w[1] - z) < BEACH)
  }
  for (const [side, away] of SHIFTS) {
    const dx = right[0] * side + back[0] * away
    const dz = right[1] * side + back[1] * away
    const moved = posts.map(([x, z, f]): Post => [round(x + dx), round(z + dz), f])
    const fits = moved.every(
      ([x, z]) => dry(x, z) && taken.every((t) => Math.hypot(t[0] - x, t[1] - z) >= APART),
    )
    if (fits) return moved
  }
  return posts
}

/** A district's level land hexes on the open sea, nearest its landmark first. */
function shoreOf(made: RepoIsland, district: number): { cell: Cell; sea: Spot }[] {
  const { land } = made.plan
  const at = made.districts[district]?.at ?? [0, 0]
  const out: { cell: Cell; sea: Spot; far: number }[] = []
  for (const [id, hex] of land) {
    if (hex.district !== district || !LEVEL_GROUND.has(hex.char) || made.levels.has(id)) continue
    const cell = unkey(id)
    const wet = neighbours(cell).filter((next) => !land.has(key(next)))
    // One or two sides on the water: a straight shore, not a spit.
    if (wet.length === 0 || wet.length > 2) continue
    const [x, z] = cellToWorld(cell)
    let sx = 0
    let sz = 0
    for (const next of wet) {
      const [wx, wz] = cellToWorld(next)
      sx += wx - x
      sz += wz - z
    }
    const length = Math.hypot(sx, sz) || 1
    out.push({ cell, sea: [sx / length, sz / length], far: Math.hypot(x - at[0], z - at[1]) })
  }
  return out.sort((a, b) => a.far - b.far || key(a.cell).localeCompare(key(b.cell)))
}
/** Plain level ground a body stands on (no fields, no raised ground, no keep; its lots are fine). */
const LEVEL_GROUND = new Set([".", "f", "v", "V", "s", "="])

/** Up to three fishing posts on a district's shore, each on its own hex, facing the sea. */
function fishingPosts(made: RepoIsland, district: number): Post[] {
  const decor = made.island.decor.filter((d) => (d.y ?? 0) >= 0)
  const posts: Post[] = []
  for (const { cell, sea } of shoreOf(made, district)) {
    const [x, z] = cellToWorld(cell)
    const post: Post = [round(x + sea[0] * SHORE), round(z + sea[1] * SHORE), Math.atan2(sea[0], sea[1])]
    if (decor.some((d) => Math.hypot(d.x - post[0], d.z - post[1]) < CLEAR)) continue
    posts.push(post)
    if (posts.length === 3) break
  }
  return posts
}

const round = (value: number): number => Math.round(value * 100) / 100
