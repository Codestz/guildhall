import type { Biome } from "./gen/biomes.ts"
import type { District, RepoIsland } from "./gen/dress.ts"
import type { Folder } from "./gen/repo.ts"
import {
  type Cell,
  type Island,
  island,
  MAP_FOR_TESTS,
  ROAD_EDGES,
  ROAD_NODES,
  SITES,
  type Site,
  type SiteId,
} from "./lands.ts"
import type { Post, Spot } from "./layout.ts"
import { mapSites } from "./siteMap.ts"
import { SITE_DEFS } from "./sites.ts"
import type { Mix } from "./wilds.ts"

/**
 * The world the scene draws: an island and everything placed from its data (ADR 0007) — the
 * hand-drawn guild lands (lands.ts) by default, or an island grown from a repo's tree (world/gen,
 * `?repo=`). Lights (lights.ts) and wilds (wilds.ts) are derived from it, so they follow whichever
 * island it is. Every world has the keep at the origin, its gate opening south onto the roads; a
 * repo island has districts, each a landmark with posts round it, and the story's job sites are
 * mapped onto them (world/siteMap.ts). Only the hand map has the graveyard.
 */

/** The map under the island, hex by hex (lands.ts' MAP legend: ~ sea, = road, . meadow…). */
export interface Terrain {
  /** The legend character at a hex; "~" (sea) off the map. */
  at(cell: Cell): string
  /** Terrace level: 0 level ground, 1 foothill or mountain, 2 high mountain. */
  level(cell: Cell): number
  /** Every hex on the map, by key ("q,line"). */
  cells(): readonly string[]
}

/** A place people work: its spot, where they stand, and what grows round it (world/wilds.ts). */
export interface WorkPlace {
  at: Spot
  posts: readonly Post[]
  wilds: { mix: Mix; barren?: boolean }
}

/** What a repo island was grown from, for the HUD. */
export interface RepoInfo {
  /** "owner/name". */
  repo: string
  /** Where the tree came from: a bundled fixture, or GitHub just now. */
  source: "fixture" | "github"
  branch?: string
  /** GitHub cut the listing short: the island is the part it sent. */
  truncated?: boolean
  districts: readonly District[]
  /**
   * The folder each district was grown from, aligned with `districts` (its workspace and pooling):
   * what a chronicle's units are mapped onto districts by (chronicle/reconstruct.ts `districtOf`).
   */
  folders: readonly Folder[]
}

export interface World {
  /** "hand": the guild's own lands, with the keep at the origin. "repo": a grown island. */
  kind: "hand" | "repo"
  island: Island
  /** The walking graph: road hexes by name, and the edges between neighbours. */
  roads: { nodes: Readonly<Record<string, Spot>>; edges: readonly (readonly [string, string])[] }
  terrain: Terrain
  /** Every place people work, for what grows and burns round them (wilds.ts, lights.ts). */
  sites: readonly WorkPlace[]
  /** The story's job sites on this island (`sitesOf`, world/siteMap.ts). */
  storySites: Readonly<Record<SiteId, Site>>
  repo?: RepoInfo
}

let hand: World | undefined
/** The hand-drawn guild lands (lands.ts): what the hall has always drawn. */
export function handWorld(): World {
  hand ??= {
    kind: "hand",
    island: island(),
    roads: { nodes: ROAD_NODES, edges: ROAD_EDGES },
    terrain: { at: MAP_FOR_TESTS.at, level: MAP_FOR_TESTS.level, cells: MAP_FOR_TESTS.cells },
    sites: Object.values(SITE_DEFS).map(({ at, posts, wilds }) => ({ at, posts, wilds })),
    storySites: SITES,
  }
  return hand
}

/** What grows round each biome's landmark: the hand map's sites, matched by trade. */
const BIOME_WILDS: Record<Biome, WorkPlace["wilds"]> = {
  harbour: { mix: { bush: 0.4, grass: 0.4, rock: 0.2 } },
  village: { mix: { tree: 0.15, bush: 0.45, grass: 0.4 } },
  proving: SITE_DEFS.proving.wilds,
  library: { mix: { tree: 0.35, rock: 0.3, grass: 0.35 } },
  quarry: SITE_DEFS.quarry.wilds,
  forest: SITE_DEFS.forest.wilds,
  farms: SITE_DEFS.yard.wilds,
  wilds: { mix: { tree: 0.3, bush: 0.4, grass: 0.3 } },
}

/** An island grown from a repo's tree (world/gen `islandFromTree`), as a world. */
export function repoWorld(made: RepoIsland, info: Omit<RepoInfo, "districts" | "folders">): World {
  const { land } = made.plan
  const storySites = mapSites(made)
  const districts: WorkPlace[] = made.districts
    .filter((district) => district.landmark)
    .map((district) => ({ at: district.at, posts: district.posts, wilds: BIOME_WILDS[district.biome] }))
  // A site that stands elsewhere than its district's own posts (the river's on the shore, sites
  // sharing a district round its landmark) keeps its posts clear too.
  const moved: WorkPlace[] = Object.values(storySites)
    .filter((site) => !districts.some((place) => place.posts === site.posts))
    .map((site) => ({ at: site.at, posts: site.posts, wilds: SITE_DEFS[site.id].wilds }))
  return {
    kind: "repo",
    island: made.island,
    roads: made.roads,
    terrain: {
      at: ([q, line]) => land.get(`${q},${line}`)?.char ?? "~",
      level: ([q, line]) => made.levels.get(`${q},${line}`) ?? 0,
      cells: () => [...land.keys()],
    },
    sites: [...districts, ...moved],
    storySites,
    repo: { ...info, districts: made.districts, folders: made.plan.districts.map((d) => d.folder) },
  }
}

/** How far the land reaches from the origin, world units (the sea's own tiles left out). */
export function reachOf(world: World): number {
  let reach = 0
  for (const tile of world.island.tiles)
    if (tile.piece !== "hex_water") reach = Math.max(reach, Math.hypot(tile.x, tile.z))
  return reach
}
