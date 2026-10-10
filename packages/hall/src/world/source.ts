import { createContext, use, useContext, useSyncExternalStore } from "react"
import { setActiveWorld } from "./active.ts"
import { type Gen, genOf } from "./gen/islandFromTree.ts"
import type { Tree } from "./gen/load.ts"
import { growSync } from "./grow/grow.ts"
import { growPool } from "./grow/pool.ts"
import { handWorld, type World } from "./world.ts"

/**
 * Which world the scene draws (world/world.ts): the hand-drawn lands unless `?repo=` asked for an
 * island grown from a repo (guild/deeplink.ts starts the load before the scene mounts). While one
 * loads, the world's layers wait under their Suspense (`useWorldReady`), so the hand island never
 * flashes up first; if it can't be had (no such repo, GitHub's rate limit), the hand island stays
 * and the status says why (hud/RepoLegend.tsx).
 */

export type WorldStatus =
  | { state: "hand" }
  | { state: "loading"; repo: string }
  | { state: "repo" }
  | { state: "failed"; repo: string; reason: string }

type Listener = () => void

/** The generator this visit's link asks repo islands of (2; `?gen=1` opts out), read once at load. */
const LINKED_GEN: Gen = typeof location === "undefined" ? 2 : genOf(location.search)

/** A repo's island as this visit's link asks it grown (`?gen=`): the home island's, and every far one's. */
export const growWorld = (tree: Tree): World => growSync(tree, LINKED_GEN)

/** The same island grown in a Web Worker, off the main thread (world/grow/pool.ts; here, when there is none). */
export const growWorldAsync = (tree: Tree): Promise<World> => growPool.grow(tree, LINKED_GEN)

class WorldSource {
  world: World = handWorld()
  status: WorldStatus = { state: "hand" }
  /**
   * Settles when the island being loaded is in (or failed): what the scene suspends on. The first
   * is already settled and marked so for React's `use`, so the hand island never suspends.
   */
  ready: Promise<void> = settled()
  private listeners = new Set<Listener>()
  private asked = 0
  /** The last island asked for, and what loading it settles to. */
  private last: { wanted: string; done: Promise<World> } | undefined

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Grows `wanted`'s island and makes it the world; resolves with the world drawn after (the hand
   * one when it failed). `fetchTree` is the source of trees (world/gen/load.ts in the hall).
   */
  load(wanted: string, fetchTree: (wanted: string) => Promise<Tree>): Promise<World> {
    // Asked again for the island it has (or is growing), as a re-applied deep link does: the same
    // world, kept, so nothing built per world is built again.
    if (this.last && this.last.wanted === wanted) return this.last.done
    return this.adopt(wanted, (async () => growWorldAsync(await fetchTree(wanted)))())
  }

  /**
   * Makes `making` (a world still being made, as `load` makes one) the world for `wanted`. For a world
   * made some other way: a repo split into islands (world/archipelagoSource.ts) makes its core's.
   */
  adopt(wanted: string, making: Promise<World>): Promise<World> {
    if (this.last && this.last.wanted === wanted) return this.last.done
    const n = ++this.asked
    this.set(this.world, { state: "loading", repo: wanted })
    const done = (async () => {
      try {
        const world = await making
        if (n === this.asked) this.set(world, { state: "repo" })
      } catch (error) {
        if (n === this.asked)
          this.set(handWorld(), { state: "failed", repo: wanted, reason: (error as Error).message })
      }
      return this.world
    })()
    this.ready = done.then(() => undefined)
    this.last = { wanted, done }
    return done
  }

  /**
   * Back to the hand-drawn lands (`repo=home`), at once: whatever island was growing is let go (its
   * load still settles, but no longer changes the world), so asking for it again grows it again.
   */
  home(): World {
    this.asked++
    this.last = undefined
    this.ready = settled()
    if (this.status.state !== "hand") this.set(handWorld(), { state: "hand" })
    return this.world
  }

  private set(world: World, status: WorldStatus): void {
    this.world = world
    setActiveWorld(world)
    this.status = status
    for (const listener of this.listeners) listener()
  }
}

/** A promise already settled, and marked so for React's `use`: nothing suspends on it. */
function settled(): Promise<void> {
  return Object.assign(Promise.resolve(), { status: "fulfilled", value: undefined })
}

export const worldSource = new WorldSource()

/** What `repo=` names to go back to the guild's own island: `home`, as the archipelago's `island=home`. */
export const HOME_ISLAND = "home"

/** Starts loading a repo's island (`?repo=`): fixtures or GitHub, loaded on first need. */
export function loadRepo(wanted: string): Promise<World> {
  return worldSource.load(wanted, async (name) => (await import("./gen/load.ts")).treeFor(name))
}

/** Shows `repo`'s island (`HOME_ISLAND`: the hand-drawn lands), swapped in place on a running hall. */
export function showIsland(repo: string): Promise<World> {
  return repo === HOME_ISLAND ? Promise.resolve(worldSource.home()) : loadRepo(repo)
}

/**
 * A world drawn beside the active one (an archipelago's far island, scene/archipelago): the layers
 * under it read that world from `useWorld` instead. Only drawing reads it; the guild's own code
 * (paths, sites, the director) always works on the active world.
 */
const Scoped = createContext<World | null>(null)
export const WorldScope = Scoped.Provider

/** The world the scene draws now (or the one a WorldScope gives); re-renders when it changes. */
export function useWorld(): World {
  const scoped = useContext(Scoped)
  const active = useSyncExternalStore(worldSource.subscribe, () => worldSource.world)
  return scoped ?? active
}

export function useWorldStatus(): WorldStatus {
  return useSyncExternalStore(worldSource.subscribe, () => worldSource.status)
}

/** Suspends while a repo's island is loading (call it inside the world's Suspense). */
export function useWorldReady(): void {
  useWorldStatus()
  use(worldSource.ready)
}
