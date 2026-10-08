import { useSyncExternalStore } from "react"
import { crossingsOf, extentOf, HOME_REPO, mainLanguage, placeIslands, type Shore } from "./archipelago.ts"
import { type Language, languageOf } from "./gen/biomes.ts"
import { islandFromTree } from "./gen/islandFromTree.ts"
import type { Tree } from "./gen/load.ts"
import type { Spot } from "./layout.ts"
import { worldSource } from "./source.ts"
import { reachOf, repoWorld, type World } from "./world.ts"

/**
 * The archipelago being drawn (world/archipelago.ts): grown once from its repos' trees, then fixed.
 * Off (null) unless a link asked for it (world/archipelagoLink.ts). An island that can't be grown
 * is left out and named in the status; the rest still sail.
 */

export interface IslandInfo {
  /** "owner/name". */
  repo: string
  /** Its short name, as the labels show it ("mcpx"). */
  name: string
  language: Language
  /** Its keep's offset from the home island's (world units, a multiple of SEA_CELL). */
  at: Spot
  /** How far its land reaches from its keep. */
  reach: number
}

/** A far island: its info and its own world, in its own coordinates. */
export interface FarIsland extends IslandInfo {
  world: World
}

export interface Archipelago {
  home: IslandInfo
  islands: readonly FarIsland[]
  /** Clear straight crossings, as index pairs into [home, ...islands]. */
  crossings: readonly (readonly [number, number])[]
  /** How far the furthest land reaches from the origin. */
  extent: number
}

export type ArchipelagoStatus =
  | { state: "off" }
  | { state: "loading"; repos: readonly string[] }
  | { state: "ready"; failed: readonly { repo: string; reason: string }[] }

type Listener = () => void

class ArchipelagoSource {
  archipelago: Archipelago | null = null
  status: ArchipelagoStatus = { state: "off" }
  private listeners = new Set<Listener>()
  private loading: Promise<Archipelago | null> | undefined

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Grows every repo's island (in parallel) and places them round the home island, once: asked
   * again, it answers with the first load. `fetchTree` is the source of trees (world/gen/load.ts).
   */
  load(repos: readonly string[], fetchTree: (repo: string) => Promise<Tree>): Promise<Archipelago | null> {
    if (this.loading) return this.loading
    this.set(null, { state: "loading", repos })
    this.loading = (async () => {
      type Grown = { repo: string; world: World; language: Language } | { repo: string; reason: string }
      const grown = await Promise.all(
        repos.map(async (repo): Promise<Grown> => {
          try {
            const tree = await fetchTree(repo)
            const world = repoWorld(islandFromTree(tree.entries), {
              repo: tree.repo,
              source: tree.source,
              ...(tree.branch ? { branch: tree.branch } : {}),
              ...(tree.truncated ? { truncated: tree.truncated } : {}),
            })
            return { repo: tree.repo, world, language: mainLanguage(tree.entries) }
          } catch (error) {
            return { repo, reason: (error as Error).message }
          }
        }),
      )
      // The home island first: a `?repo=` island is the home one, once it has grown.
      await worldSource.ready
      const kept = grown.filter((one): one is Extract<Grown, { world: World }> => "world" in one)
      const failed = grown.filter((one): one is Extract<Grown, { reason: string }> => "reason" in one)
      const offsets = placeIslands(kept)
      const islands: FarIsland[] = kept.map((one, i) => ({
        repo: one.repo,
        name: nameOf(one.repo),
        language: one.language,
        at: offsets[i] as Spot,
        reach: reachOf(one.world),
        world: one.world,
      }))
      const home = homeOf(worldSource.world)
      const shores: Shore[] = [home, ...islands]
      const archipelago: Archipelago | null =
        islands.length > 0
          ? { home, islands, crossings: crossingsOf(shores), extent: extentOf(shores) }
          : null
      this.set(archipelago, { state: "ready", failed })
      return archipelago
    })()
    return this.loading
  }

  private set(archipelago: Archipelago | null, status: ArchipelagoStatus): void {
    this.archipelago = archipelago
    this.status = status
    for (const listener of this.listeners) listener()
  }
}

const nameOf = (repo: string): string => repo.split("/")[1] ?? repo

/** The home island as an island of the archipelago: the guild's own repo, or `?repo=`'s. */
function homeOf(world: World): IslandInfo {
  const repo = world.repo?.repo ?? HOME_REPO
  // The hand-drawn lands are the guild's own repo: TypeScript. A grown home is its districts' code.
  const language = world.repo
    ? ([...world.repo.districts].sort((a, b) => b.bytes - a.bytes)[0]?.language ?? languageOf("x.ts"))
    : languageOf("x.ts")
  return { repo, name: nameOf(repo), language, at: [0, 0], reach: reachOf(world) }
}

export const archipelagoSource = new ArchipelagoSource()

/** Grows the archipelago from these repos: bundled fixtures or GitHub, as `?repo=` does. */
export function loadArchipelago(repos: readonly string[]): Promise<Archipelago | null> {
  return archipelagoSource.load(repos, async (repo) => (await import("./gen/load.ts")).treeFor(repo))
}

/** The archipelago drawn now (null: just the home island); re-renders when it changes. */
export function useArchipelago(): Archipelago | null {
  return useSyncExternalStore(archipelagoSource.subscribe, () => archipelagoSource.archipelago)
}

export function useArchipelagoStatus(): ArchipelagoStatus {
  return useSyncExternalStore(archipelagoSource.subscribe, () => archipelagoSource.status)
}
