import { useSyncExternalStore } from "react"
import { setSea } from "./abroad.ts"
import {
  crossingsOf,
  extentOf,
  type Footprint,
  HOME_REPO,
  type IslandSeed,
  mainLanguage,
  type Patch,
  placeIsland,
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

/** An island that couldn't be had, and why; `retry` when asking again may help (a far island of `?repos=`). */
export interface FailedIsland {
  repo: string
  reason: string
  retry?: true
}

/** `loading`: the repos still being grown (`repos`), with what failed so far; each island that is ready is drawn as it comes. */
export type ArchipelagoStatus =
  | { state: "off" }
  | { state: "loading"; repos: readonly string[]; failed?: readonly FailedIsland[] }
  | { state: "ready"; failed: readonly FailedIsland[] }

type Listener = () => void

/**
 * The squares of water an island is drawn in, from its keep (scene/archipelago/footprint.ts): the
 * scene knows its shore tiles, the world does not. `far` is a far island's, else the home one's.
 */
export type PatchesOf = (world: World, far: boolean, tight?: boolean) => readonly Patch[]

/** A `load` in progress: what it was asked, and the islands placed so far (with the footprints they were placed by). */
interface Run {
  repos: readonly string[]
  fetchTree: (repo: string) => Promise<Tree>
  patchesOf: PatchesOf
  islands: FarIsland[]
  seeds: IslandSeed[]
  failed: FailedIsland[]
  pending: Set<string>
}

class ArchipelagoSource {
  archipelago: Archipelago | null = null
  status: ArchipelagoStatus = { state: "off" }
  /** The far islands whose land is on screen (`markDrawn`): the only ones the open sea is cut for. */
  drawn: ReadonlySet<string> = new Set()
  private listeners = new Set<Listener>()
  private loading: Promise<Archipelago | null> | undefined
  private run: Run | undefined

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Grows every repo's island (in parallel) and adds each to the archipelago as it is ready, round
   * the home island: asked again, it answers with the first load, which settles when every repo has
   * grown or failed. An island takes its ring slot by its place in `repos` and clears the islands
   * already there, so none moves when another arrives. `fetchTree` is the source of trees
   * (world/gen/load.ts). Every island is grown as the link asks the home one (`?gen=`, `?relief=`:
   * world/source.ts) and placed by how far it reaches (`patchesOf`). One that can't be had is named
   * in the status (`retry` asks again) and costs the sea nothing.
   */
  load(
    repos: readonly string[],
    fetchTree: (repo: string) => Promise<Tree>,
    patchesOf: PatchesOf,
  ): Promise<Archipelago | null> {
    if (this.loading) return this.loading
    this.run = { repos, fetchTree, patchesOf, islands: [], seeds: [], failed: [], pending: new Set(repos) }
    this.progress()
    this.loading = Promise.all(repos.map((repo) => this.grow(repo))).then(() => this.archipelago)
    return this.loading
  }

  /** Asks again for a far island that failed (`?repos=`): it is grown and added when it comes. */
  retry(repo: string): void {
    const run = this.run
    if (!run?.failed.some((one) => one.repo === repo)) return
    run.failed = run.failed.filter((one) => one.repo !== repo)
    run.pending.add(repo)
    this.progress()
    void this.grow(repo)
  }

  /** One repo's island, grown and, once the home island is known, added; or failed. Never rejects. */
  private async grow(repo: string): Promise<void> {
    const run = this.run as Run
    let grown: { repo: string; world: World; language: Language }
    try {
      const tree = await run.fetchTree(repo)
      // A big island takes a while to grow: a worker grows it (world/grow), so the page stays alive.
      grown = { repo: tree.repo, world: await growWorldAsync(tree), language: mainLanguage(tree.entries) }
    } catch (error) {
      run.failed.push({ repo, reason: (error as Error).message, retry: true })
      run.pending.delete(repo)
      this.progress()
      return
    }
    // The home island first: a `?repo=` island is the home one, once it has grown.
    await worldSource.ready
    const homeWorld = worldSource.world
    const footprint = (world: World, far: boolean): Footprint => ({
      reach: reachOf(world),
      patches: run.patchesOf(world, far),
    })
    run.pending.delete(repo)
    // The same repo under two spellings is one island.
    if (!run.islands.some((one) => one.repo === grown.repo)) {
      const seed = { repo: grown.repo, ...footprint(grown.world, true) }
      const at = placeIsland(
        seed,
        run.repos.indexOf(repo),
        run.repos.length,
        run.seeds,
        run.islands.map((one) => one.at),
        footprint(homeWorld, false),
      )
      run.seeds.push(seed)
      run.islands.push({
        ...infoOf(grown.repo, at, reachOf(grown.world), grown.language),
        world: grown.world,
      })
    }
    this.progress()
  }

  /** The archipelago and status as the run stands: the islands grown so far, and what is still coming. */
  private progress(): void {
    const run = this.run as Run
    const failed = [...run.failed]
    const status: ArchipelagoStatus =
      run.pending.size > 0
        ? { state: "loading", repos: [...run.pending], failed }
        : { state: "ready", failed }
    if (run.islands.length === 0) {
      this.set(null, status)
      return
    }
    const home = homeOf(worldSource.world)
    const shores: Shore[] = [home, ...run.islands]
    const islands = [...run.islands]
    this.set({ home, islands, crossings: crossingsOf(shores), extent: extentOf(shores), links: [] }, status)
  }

  /**
   * An island's land is on screen (scene/archipelago/ArchipelagoLayer.tsx): the open sea is cut for
   * it from then on, never before, so a sea is never cut for an island that isn't drawn. Returns the
   * undoing, for when it goes.
   */
  markDrawn = (id: string): (() => void) => {
    this.drawn = new Set(this.drawn).add(id)
    this.emit()
    return () => {
      const rest = new Set(this.drawn)
      rest.delete(id)
      this.drawn = rest
      this.emit()
    }
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
    /**
     * Held back until this settles: the island is grown now, but neither the home world nor the
     * archipelago is taken until then (the home page's film plays on the whole repo's island first).
     * The core is then adopted under its own name, `repo#split`, the repo's whole island being the
     * world's last, and the archipelago is set in the same turn as the world.
     */
    gate?: Promise<unknown>,
  ): Promise<Archipelago | null> {
    if (this.loading) return this.loading
    if (!gate) this.set(null, { state: "loading", repos: [repo] })
    const making = fetchTree(repo).then(async (tree) => ({
      tree,
      grown: await growSplit(tree, await patchesOf),
    }))
    if (!gate)
      void worldSource.adopt(
        repo,
        making.then(async ({ tree, grown }) => grown?.home ?? (await growWorldAsync(tree))),
      )
    this.loading = (gate ? making.then(async (made) => (await gate, made)) : making).then(
      async ({ grown }) => {
        if (gate && grown) await worldSource.adopt(`${repo}#split`, Promise.resolve(grown.home))
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
    setSea(archipelago)
    this.status = status
    this.emit()
  }

  private emit(): void {
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
export function loadSplitRepo(
  repo: string,
  patchesOf: Promise<PatchesOf>,
  gate?: Promise<unknown>,
): Promise<Archipelago | null> {
  return archipelagoSource.loadSplit(
    repo,
    async (wanted) => (await import("./gen/load.ts")).treeFor(wanted),
    patchesOf,
    gate,
  )
}

/** The archipelago drawn now (null: just the home island); re-renders when it changes. */
export function useArchipelago(): Archipelago | null {
  return useSyncExternalStore(archipelagoSource.subscribe, () => archipelagoSource.archipelago)
}

export function useArchipelagoStatus(): ArchipelagoStatus {
  return useSyncExternalStore(archipelagoSource.subscribe, () => archipelagoSource.status)
}

const NO_ISLANDS: ReadonlySet<string> = new Set()

/** The far islands drawn now (their land is on screen): what the open sea is cut for. `live` false: none, and no re-render. */
export function useDrawnIslands(live = true): ReadonlySet<string> {
  return useSyncExternalStore(archipelagoSource.subscribe, () =>
    live ? archipelagoSource.drawn : NO_ISLANDS,
  )
}
