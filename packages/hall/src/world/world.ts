import type { Biome } from "./gen/biomes.ts"
import type { District, RepoIsland } from "./gen/dress.ts"
import { cellAt, key } from "./gen/hex.ts"
import type { Gen } from "./gen/islandFromTree.ts"
import { forestOf } from "./gen/relief/forest.ts"
import { hexMountains } from "./gen/relief/hexMountains.ts"
import { lowlandRivers } from "./gen/relief/hexRivers.ts"
import { type Relief, type ReliefStyle, reliefOf } from "./gen/relief/index.ts"
import { joinRoads, type TrailNet, trailsOf } from "./gen/relief/trails.ts"
import type { Folder } from "./gen/repo.ts"
import { dressRivers, riversOf } from "./gen/rivers/index.ts"
import type { Home } from "./homes.ts"
import {
  type Cell,
  cellToWorld,
  type Island,
  island,
  type LandPlacement,
  MAP_FOR_TESTS,
  ROAD_EDGES,
  ROAD_NODES,
  SITES,
  type Site,
  type SiteId,
} from "./lands.ts"
import type { Post, Spot } from "./layout.ts"
import { instantiate, prefab } from "./prefabs/index.ts"
import { mapSites } from "./siteMap.ts"
import { SITE_DEFS } from "./sites.ts"
import type { Venue } from "./venues.ts"
import { TERRACE, type Waterways } from "./waterways.ts"
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
  /** The district holding a land hex (a repo island's; the hand map has none). */
  district?(cell: Cell): number | undefined
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
  /** The generator that grew it (world/gen/islandFromTree.ts); absent is 1. */
  gen?: Gen
  /** The relief's art direction (`?relief=`, world/gen/relief/style.ts); absent is the default. */
  relief?: ReliefStyle
  districts: readonly District[]
  /**
   * The folder each district was grown from, aligned with `districts` (its workspace and pooling):
   * what a chronicle's units are mapped onto districts by (chronicle/reconstruct.ts `districtOf`).
   */
  folders: readonly Folder[]
}

/** What people stand on: the height of the ground at a world point (hex tops by level, a massif's lattice). */
export interface Ground {
  heightAt(x: number, z: number): number
}

export interface World {
  /** "hand": the guild's own lands, with the keep at the origin. "repo": a grown island. */
  kind: "hand" | "repo"
  island: Island
  /** The walking graph: road hexes by name, and the edges between neighbours. */
  roads: {
    nodes: Readonly<Record<string, Spot>>
    edges: readonly (readonly [string, string])[]
    /** What walking each edge costs, aligned with `edges`; absent, its length. A gen 2 island's trails cost by grade. */
    costs?: readonly number[]
  }
  terrain: Terrain
  /** The ground's height for walkers: hex tops by level, and a massif's own height on a gen 2 island. */
  ground: Ground
  /** The mountains of a gen 2 island (world/gen/relief), drawn in place of the hexes they cover. */
  relief?: Relief
  /** Hex-native mountains (relief style e): the island's tiles and crowns that are the range, drawn in the snow-line material. */
  mountains?: ReadonlySet<LandPlacement>
  /** The rivers and falls of a gen 2 island (world/gen/rivers), drawn by scene/nature/Rivers.tsx. */
  water?: Waterways
  /** The trails up its mountains and the lookouts they end at (world/gen/relief/trails.ts); joined to `roads`. */
  trails?: TrailNet
  /** Every place people work, for what grows and burns round them (wilds.ts, lights.ts). */
  sites: readonly WorkPlace[]
  /** The story's job sites on this island (`sitesOf`, world/siteMap.ts). */
  storySites: Readonly<Record<SiteId, Site>>
  /** The buildings people go into, a gen 2 island's (world/venues.ts); none on the hand lands. */
  venues?: readonly Venue[]
  /** The houses people live in, a gen 2 island's (world/homes.ts); none on the hand lands. */
  homes?: readonly Home[]
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
    ground: { heightAt: (x, z) => MAP_FOR_TESTS.level(cellAt([x, z])) * TERRACE },
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

/**
 * The venues still standing in the island as drawn, and the decor without the yards of those that
 * are not: a mountain or a river that took the ground under a venue's main building (it goes with
 * the decor on the hexes they cover) leaves no door to go in by, and its props stand about for nothing.
 */
function standing(
  venues: readonly Venue[],
  decor: LandPlacement[],
): { open: Venue[]; decor: LandPlacement[] } {
  const here = (a: LandPlacement, b: LandPlacement): boolean =>
    a.piece === b.piece && Math.hypot(a.x - b.x, a.z - b.z) < 0.05
  const lost: LandPlacement[] = []
  const open = venues.filter((venue) => {
    const parts = instantiate(prefab(venue.prefab), venue.at, venue.rot, "blue")
    const main = parts[0]
    if (main && decor.some((d) => here(d, main))) return true
    lost.push(...parts)
    return false
  })
  return {
    open,
    decor: lost.length > 0 ? decor.filter((d) => !lost.some((part) => here(d, part))) : decor,
  }
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
  const level = (cell: Cell): number => made.levels.get(key(cell)) ?? 0
  const relief =
    info.gen === 2
      ? reliefOf({ plan: made.plan, level, ...(info.relief ? { style: info.relief } : {}) })
      : undefined
  const mountain = relief && relief.massifs.length > 0 ? relief : undefined
  // Rivers spring on the ranges: the relief is carved to their beds before anything reads its ground.
  const carved = mountain ? riversOf(made.plan, mountain, level) : undefined
  // The hex-native style (e) stands its mountains of the island's own tiles and pieces instead: no
  // river runs over its columns, and no trail is carved into them (a lattice it does not have).
  const hexed = mountain?.hex !== undefined
  const rivers = carved && mountain && hexed ? lowlandRivers(carved, mountain.keys) : carved
  const hexes = mountain ? hexMountains(mountain, made.plan.seed, rivers?.hexes) : undefined
  // Trails up the ranges, carved into the relief once the rivers have been (before the trees are set on it).
  const trails = mountain && !hexed ? trailsOf(mountain, made.roads, rivers?.hexes) : undefined
  const covered = (x: number, z: number): boolean => mountain?.keys.has(key(cellAt([x, z]))) ?? false
  // The hexes a massif covers are drawn by the massif (scene/Island.tsx), not by their tiles.
  const dry = mountain
    ? {
        ...made.island,
        tiles: made.island.tiles.filter((t) => !covered(t.x, t.z)),
        // The per-hex mountain cones the massifs replace ("mini mountains together") go too, wherever they stand.
        decor: made.island.decor.filter((d) => !covered(d.x, d.z) && !d.piece.startsWith("mountain_")),
        meadow: made.island.meadow.filter(([x, z]) => !covered(x, z)),
      }
    : made.island
  const wet = rivers && mountain ? dressRivers(dry, rivers.waters, mountain.keys, rivers.bridges) : dry
  // Forest on the mountains' lower slopes, thinning to the treeline.
  const island = mountain
    ? {
        ...wet,
        tiles: hexes ? [...wet.tiles, ...hexes.tiles] : wet.tiles,
        decor: [
          ...wet.decor,
          ...(hexes ? hexes.decor : forestOf(mountain, made.plan.seed, rivers?.hexes)),
          ...(trails?.lookouts ?? []).flatMap((l) =>
            instantiate(prefab("lookout"), l.at, l.rot, "blue", l.y),
          ),
        ],
      }
    : wet
  const { open, decor } = standing(made.venues, island.decor)
  // A mountain or a river that took the ground under a house took the house.
  const homes = made.homes.filter((home) => !covered(home.door.step[0], home.door.step[1]))
  return {
    kind: "repo",
    island: decor === island.decor ? island : { ...island, decor },
    roads: trails && trails.trails.length > 0 ? joinRoads(made.roads, trails) : made.roads,
    terrain: {
      at: ([q, line]) => (rivers?.hexes.has(`${q},${line}`) ? "r" : (land.get(`${q},${line}`)?.char ?? "~")),
      // A hex under a massif is raised (wilds and walkers keep off it), by its centre's height.
      level: (cell) => {
        if (!mountain?.massifAt(cell)) return level(cell)
        const [x, z] = cellToWorld(cell)
        return Math.max(1, Math.round((mountain.heightAt(x, z) ?? 0) / TERRACE))
      },
      cells: () => [...land.keys()],
      district: ([q, line]) => land.get(`${q},${line}`)?.district,
    },
    ground: { heightAt: (x, z) => mountain?.heightAt(x, z) ?? level(cellAt([x, z])) * TERRACE },
    ...(mountain ? { relief: mountain } : {}),
    ...(hexes ? { mountains: hexes.ground } : {}),
    ...(rivers ? { water: rivers.waters } : {}),
    ...(trails && trails.trails.length > 0 ? { trails } : {}),
    sites: [...districts, ...moved],
    storySites,
    ...(open.length > 0 ? { venues: open } : {}),
    ...(homes.length > 0 ? { homes } : {}),
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
