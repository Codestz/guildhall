import { cellToWorld, type Island, type LandPiece } from "../lands.ts"
import type { Post, Spot } from "../layout.ts"
import type { Venue } from "../venues.ts"
import type { Biome, Language } from "./biomes.ts"
import { civicOf, type Fame } from "./dress/civic.ts"
import { dressHexes } from "./dress/hexes.ts"
import { dressRoads } from "./dress/roads.ts"
import { LANDMARK, landmarksOf, postsAround, quayOf } from "./dress/sites.ts"
import { terraceOf } from "./dress/terrace.ts"
import { type Lot, townOf } from "./dress/town.ts"
import { type Anchor, VENUE_CLEAR, venuesOf } from "./dress/venues.ts"
import { key, rng, unkey } from "./hex.ts"
import type { IslandPlan } from "./plan.ts"

/**
 * The adapter: an IslandPlan tiled and dressed into the shapes the hall already draws and walks —
 * lands.ts' `Island` (tiles, decor, water, meadow, landmarks, fields: scene/Island.tsx batches
 * `tiles` + `decor` as they are), its road graph (ROAD_NODES / ROAD_EDGES' shape), and a Site-shaped
 * entry per district. The per-hex rules are lands.ts' `island()` loop, read off the plan's chars
 * instead of the hand-drawn MAP (dress/hexes.ts).
 */

export interface District {
  /** The folder ("/" is the root's own files, "packages/react" a workspace's package). */
  id: string
  label: string
  biome: Biome
  language: Language
  /** Its palette accent (the dominant language's colour). */
  accent: string
  files: number
  bytes: number
  hexes: number
  /** Its landmark's spot (the square when there's no room for one). */
  at: Spot
  /** The road node its road ends at (a key of `roads.nodes`). */
  node: string
  /** Where people stand to work, facing the landmark: lands.ts Site.posts' shape. */
  posts: Post[]
  landmark?: LandPiece
}

export interface RepoIsland {
  plan: IslandPlan
  /**
   * Terrace level of every raised hex by key (1 foothill or mountain, 2 high mountain; absent is
   * level ground), after foothills that can't slope sank to knolls: lands.ts `level`'s answer.
   */
  levels: ReadonlyMap<string, number>
  island: Island
  roads: { nodes: Record<string, Spot>; edges: (readonly [string, string])[] }
  districts: District[]
  /** Generator v2: the buildings people go into, one per district that has a venue (world/venues.ts). */
  venues: Venue[]
}

/** Lots the civic centre, a venue or the wall stand on are dropped. */
function clearLots(lots: Map<string, Lot>, clear: readonly Anchor[], wall: readonly Spot[]): void {
  for (const id of [...lots.keys()]) {
    const [x, z] = cellToWorld(unkey(id))
    const crowded =
      clear.some(([cx, cz, r]) => Math.hypot(x - cx, z - cz) < r + 4) ||
      wall.some(([wx, wz]) => Math.hypot(wx - x, wz - z) < 7)
    if (crowded) lots.delete(id)
  }
}

/** Ground clutter a venue's yard leaves no room for. */
const CLUTTER =
  /^(trees?_|tree_single|rock_single|hill_single|hills_|fence_|building_(dirt|grain)|target$|tent$)/

export function dress(plan: IslandPlan, fame?: Fame): RepoIsland {
  const random = rng(plan.seed ^ 0x9e3779b9)
  const roads = dressRoads(plan)
  const terrace = terraceOf(plan, (cell) => !plan.land.has(key(cell)))
  // Generator v2: towns and a civic centre from the prefab catalogue (dress/town.ts, dress/civic.ts).
  const civic = plan.gen === 2 ? civicOf(plan, fame) : undefined
  const town = plan.gen === 2 ? townOf(plan, roads.links) : undefined
  // A venue keeps off the civic centre's halls and its wall (a wall piece is 10 long, a venue 10 across).
  const civicAnchors: Anchor[] = [
    ...(civic?.clear ?? []).map(([x, z, r]): Anchor => [x, z, r + 3]),
    ...(civic?.wall ?? []).map(([x, z]): Anchor => [x, z, 8.5]),
  ]
  const venues = plan.gen === 2 ? venuesOf(plan, roads, civicAnchors) : []
  const clear: Anchor[] = [
    ...(civic?.clear ?? []),
    ...venues.map(({ venue }): Anchor => [venue.at[0], venue.at[1], VENUE_CLEAR]),
  ]
  if (town) clearLots(town.lots, clear, civic?.wall ?? [])
  const { tiles, decor, water, meadow, fields } = dressHexes(
    plan,
    roads.links,
    terrace,
    random,
    town?.lots,
    new Map(venues.map(({ cell, placements }) => [key(cell), placements])),
  )
  if (town && civic) {
    decor.push(...town.plazas, ...civic.placements)
    const open = (spot: Spot): boolean => clear.every(([x, z, r]) => Math.hypot(spot[0] - x, spot[1] - z) > r)
    meadow.splice(0, meadow.length, ...meadow.filter(open))
    // The trees and rocks on the hexes round a venue made way for its yard (the venue's own pieces stay).
    const own = new Set(venues.flatMap(({ placements }) => placements))
    const kept = decor.filter(
      (item) =>
        own.has(item) ||
        !CLUTTER.test(item.piece) ||
        venues.every(({ venue }) => Math.hypot(item.x - venue.at[0], item.z - venue.at[1]) > VENUE_CLEAR + 2),
    )
    decor.splice(0, decor.length, ...kept)
  }
  decor.push(...quayOf(plan.hub))
  const landmarks = landmarksOf(plan.hub, decor)

  const districts: District[] = plan.districts.map((district) => {
    const square = cellToWorld(district.square)
    const folder = district.folder
    const venue = venues.find((placed) => placed.venue.district === folder.name)
    // Its landmark's hex: the venue's, which may have moved off the district's own site (dress/venues.ts).
    const siteAt = venue ? venue.venue.at : district.site ? cellToWorld(district.site) : undefined
    return {
      id: folder.name,
      label:
        folder.name === "/"
          ? "Harbour"
          : folder.group === undefined
            ? folder.name
            : folder.name.slice(folder.group.length + 1),
      biome: district.biome,
      language: folder.language,
      accent: folder.language.colour,
      files: folder.files,
      bytes: folder.bytes,
      hexes: district.hexes,
      at: siteAt ?? square,
      node: roads.nodeName(district.square),
      posts: siteAt
        ? postsAround(
            siteAt,
            square,
            venue?.main ?? LANDMARK[district.biome](folder.language.kit),
            venue?.front,
          )
        : [[square[0], square[1], 0]],
      ...(siteAt ? { landmark: venue?.main ?? LANDMARK[district.biome](folder.language.kit) } : {}),
    }
  })

  return {
    plan,
    levels: terrace.levels,
    island: { tiles, decor, water, meadow, landmarks, fields },
    roads: { nodes: roads.nodes, edges: roads.edges },
    districts,
    venues: venues.map(({ venue }) => venue),
  }
}
