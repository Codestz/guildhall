import { use, useSyncExternalStore } from "react"
import { islandFromTree } from "./gen/islandFromTree.ts"
import type { Tree } from "./gen/load.ts"
import { handWorld, repoWorld, type World } from "./world.ts"

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

class WorldSource {
  world: World = handWorld()
  status: WorldStatus = { state: "hand" }
  /**
   * Settles when the island being loaded is in (or failed): what the scene suspends on. The first
   * is already settled and marked so for React's `use`, so the hand island never suspends.
   */
  ready: Promise<void> = Object.assign(Promise.resolve(), { status: "fulfilled", value: undefined })
  private listeners = new Set<Listener>()
  private asked = 0

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Grows `wanted`'s island and makes it the world; resolves with the world drawn after (the hand
   * one when it failed). `fetchTree` is the source of trees (world/gen/load.ts in the hall).
   */
  load(wanted: string, fetchTree: (wanted: string) => Promise<Tree>): Promise<World> {
    const n = ++this.asked
    this.set(this.world, { state: "loading", repo: wanted })
    const done = (async () => {
      try {
        const tree = await fetchTree(wanted)
        const made = islandFromTree(tree.entries)
        const { repo, source, branch, truncated } = tree
        const world = repoWorld(made, {
          repo,
          source,
          ...(branch ? { branch } : {}),
          ...(truncated ? { truncated } : {}),
        })
        if (n === this.asked) this.set(world, { state: "repo" })
      } catch (error) {
        if (n === this.asked)
          this.set(handWorld(), { state: "failed", repo: wanted, reason: (error as Error).message })
      }
      return this.world
    })()
    this.ready = done.then(() => undefined)
    return done
  }

  private set(world: World, status: WorldStatus): void {
    this.world = world
    this.status = status
    for (const listener of this.listeners) listener()
  }
}

export const worldSource = new WorldSource()

/** Starts loading a repo's island (`?repo=`): fixtures or GitHub, loaded on first need. */
export function loadRepo(wanted: string): Promise<World> {
  return worldSource.load(wanted, async (name) => (await import("./gen/load.ts")).treeFor(name))
}

/** The world the scene draws now; re-renders when it changes. */
export function useWorld(): World {
  return useSyncExternalStore(worldSource.subscribe, () => worldSource.world)
}

export function useWorldStatus(): WorldStatus {
  return useSyncExternalStore(worldSource.subscribe, () => worldSource.status)
}

/** Suspends while a repo's island is loading (call it inside the world's Suspense). */
export function useWorldReady(): void {
  useWorldStatus()
  use(worldSource.ready)
}
