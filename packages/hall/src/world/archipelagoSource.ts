import { useSyncExternalStore } from "react"
import {
  crossingsOf,
  extentOf,
  type Footprint,
  HOME_REPO,
  mainLanguage,
  type Patch,
  placeIslands,
  type Shore,
} from "./archipelago.ts"
import { type Language, languageOf } from "./gen/biomes.ts"
import type { Tree } from "./gen/load.ts"
import type { Spot } from "./layout.ts"
import type { IslandLink, Quay } from "./repoArchipelago.ts"
import { growWorldAsync, worldSource } from "./source.ts"
import { growSplit } from "./splitArchipelago.ts"
import { reachOf, type World } from "./world.ts"

/**
 * The archipelago being drawn (world/archipelago.ts): grown once from its repos' trees, then fixed.
 * Off (null) unless a link asked for it (world/archipelagoLink.ts). An island that can't be grown
 * is left out and named in the status; the rest still sail.
 */

export interface IslandInfo {
  /**
   * What names it in the archipelago (links, quays, keys): "owner/name", or for an island of a split
   * repo ("?repo=…&split") the repo and its package: "facebook/react#packages/react-dom".
   */
  id: string
  /** The same as `id` (the key the scene and `island=` have always used). */
  repo: string
  /** Its short name, as the labels show it ("mcpx", "react-dom"). */
  name: string
  /** What the HUD calls it: the repo's name, or a package's. The same as `name`. */
  label: string
  language: Language
  /** Its keep's offset from the home island's (world units, a multiple of SEA_CELL). */
  at: Spot
  /** The same as `at`: where its keep is, in the archipelago's coordinates. */
  center: Spot
  /** How far its land reaches from its keep. */
  reach: number
  /** Where its links meet its coast (world/repoArchipelago.ts); none outside a split repo. */
  quays: readonly Quay[]
  /** A split repo's tiny packages are islets. */
  kind?: "island" | "islet"
  /** Files in the tree it was grown from (a split repo's). */
  files?: number
  /** Its water is drawn in a tight patch (a split repo's islands lie in narrow straits). */
  tight?: true
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
  /** The bridges and ferries between islands (by id); none outside a split repo. */
  links: readonly IslandLink[]
}

export type ArchipelagoStatus =
  | { state: "off" }
  | { state: "loading"; repos: readonly string[] }
  | { state: "ready"; failed: readonly { repo: string; reason: string }[] }

type Listener = () => void

/**
 * The squares of water an island is drawn in, from its keep (scene/archipelago/footprint.ts): the
 * scene knows its shore tiles, the world does not. `far` is a far island's, else the home one's.
 */
export type PatchesOf = (world: World, far: boolean, tight?: boolean) => readonly Patch[]

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
   * Every island is grown as the link asks the home one (`?gen=`, `?relief=`: world/source.ts) and
   * placed by how far it reaches (`patchesOf`).
   */
  load(
    repos: readonly string[],
    fetchTree: (repo: string) => Promise<Tree>,
    patchesOf: PatchesOf,
  ): Promise<Archipelago | null> {
    if (this.loading) return this.loading
    this.set(null, { state: "loading", repos })
    this.loading = (async () => {
      type Grown = { repo: string; world: World; language: Language } | { repo: string; reason: string }
      const grown = await Promise.all(
        repos.map(async (repo): Promise<Grown> => {
          try {
            const tree = await fetchTree(repo)
            // A big island takes a while to grow: a worker grows it (world/grow), so the page stays alive.
            return {
              repo: tree.repo,
              world: await growWorldAsync(tree),
              language: mainLanguage(tree.entries),
            }
          } catch (error) {
            return { repo, reason: (error as Error).message }
          }
        }),
      )
      // The home island first: a `?repo=` island is the home one, once it has grown.
      await worldSource.ready
      const kept = grown.filter((one): one is Extract<Grown, { world: World }> => "world" in one)
      const failed = grown.filter((one): one is Extract<Grown, { reason: string }> => "reason" in one)
      const homeWorld = worldSource.world
      const footprint = (world: World, far: boolean): Footprint => ({
        reach: reachOf(world),
        patches: patchesOf(world, far),
      })
      const offsets = placeIslands(
        kept.map((one) => ({ repo: one.repo, ...footprint(one.world, true) })),
        footprint(homeWorld, false),
      )
      const islands: FarIsland[] = kept.map((one, i) => ({
        ...infoOf(one.repo, offsets[i] as Spot, reachOf(one.world), one.language),
        world: one.world,
      }))
      const home = homeOf(homeWorld)
      const shores: Shore[] = [home, ...islands]
      const archipelago: Archipelago | null =
        islands.length > 0
          ? { home, islands, crossings: crossingsOf(shores), extent: extentOf(shores), links: [] }
          : null
      this.set(archipelago, { state: "ready", failed })
      return archipelago
    })()
    return this.loading
  }

  /**
   * A repo as an archipelago (`?repo=…&split`, world/gen/split.ts): its core becomes the home world
   * (adopted at once, so a deep link's own `repo=` finds it loading), the rest far islands, with
   * their links and quays. A repo that is not to be split is grown whole, as `?repo=` always did.
   * `patchesOf` comes late (the scene's code is a lazy chunk).
   */
  loadSplit(
    repo: string,
    fetchTree: (repo: string) => Promise<Tree>,
    patchesOf: Promise<PatchesOf>,
  ): Promise<Archipelago | null> {
    if (this.loading) return this.loading
    this.set(null, { state: "loading", repos: [repo] })
    const making = fetchTree(repo).then(async (tree) => ({
      tree,
      grown: await growSplit(tree, await patchesOf),
    }))
    void worldSource.adopt(
      repo,
      making.then(async ({ tree, grown }) => grown?.home ?? (await growWorldAsync(tree))),
    )
    this.loading = making.then(
      ({ grown }) => {
        this.set(grown?.archipelago ?? null, { state: "ready", failed: grown?.failed ?? [] })
        return grown?.archipelago ?? null
      },
      (error: Error) => {
        this.set(null, { state: "ready", failed: [{ repo, reason: error.message }] })
        return null
      },
    )
    return this.loading
  }

  private set(archipelago: Archipelago | null, status: ArchipelagoStatus): void {
    this.archipelago = archipelago
    this.status = status
    for (const listener of this.listeners) listener()
  }
}

const nameOf = (repo: string): string => repo.split("/")[1] ?? repo

/** A repo's island as the archipelago sees it (outside a split repo: its own id and label, no quays). */
function infoOf(repo: string, at: Spot, reach: number, language: Language): IslandInfo {
  const name = nameOf(repo)
  return { id: repo, repo, name, label: name, language, at, center: at, reach, quays: [] }
}

/** The home island as an island of the archipelago: the guild's own repo, or `?repo=`'s. */
function homeOf(world: World): IslandInfo {
  const repo = world.repo?.repo ?? HOME_REPO
  // The hand-drawn lands are the guild's own repo: TypeScript. A grown home is its districts' code.
  const language = world.repo
    ? ([...world.repo.districts].sort((a, b) => b.bytes - a.bytes)[0]?.language ?? languageOf("x.ts"))
    : languageOf("x.ts")
  return infoOf(repo, [0, 0], reachOf(world), language)
}

export const archipelagoSource = new ArchipelagoSource()

/** Grows the archipelago from these repos: bundled fixtures or GitHub, as `?repo=` does. */
export function loadArchipelago(repos: readonly string[], patchesOf: PatchesOf): Promise<Archipelago | null> {
  return archipelagoSource.load(
    repos,
    async (repo) => (await import("./gen/load.ts")).treeFor(repo),
    patchesOf,
  )
}

/** Grows `repo` as an archipelago of its packages (`?repo=…&split`): bundled fixture or GitHub. */
export function loadSplitRepo(repo: string, patchesOf: Promise<PatchesOf>): Promise<Archipelago | null> {
  return archipelagoSource.loadSplit(
    repo,
    async (wanted) => (await import("./gen/load.ts")).treeFor(wanted),
    patchesOf,
  )
}

/** The archipelago drawn now (null: just the home island); re-renders when it changes. */
export function useArchipelago(): Archipelago | null {
  return useSyncExternalStore(archipelagoSource.subscribe, () => archipelagoSource.archipelago)
}

export function useArchipelagoStatus(): ArchipelagoStatus {
  return useSyncExternalStore(archipelagoSource.subscribe, () => archipelagoSource.status)
}
