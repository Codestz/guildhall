import { createContext, useContext, useSyncExternalStore } from "react"
import type { Vector3 } from "three"
import type { GuildStore } from "./store.ts"

export const GuildContext = createContext<GuildStore | null>(null)

/** The store, re-rendering the caller whenever it changes (≈10×/s while the guild is busy). */
export function useGuild(): GuildStore {
  const store = useContext(GuildContext)
  if (!store) throw new Error("useGuild outside <GuildContext>")
  useSyncExternalStore(store.subscribe, store.snapshot)
  return store
}

/** The store without subscribing — for per-frame readers (useFrame) that must not re-render. */
export function useGuildStore(): GuildStore {
  const store = useContext(GuildContext)
  if (!store) throw new Error("useGuildStore outside <GuildContext>")
  return store
}

/**
 * Where each adventurer actually is this frame (they walk, so it lags their target).
 * Written by `Adventurer`, read by the Bard to frame shots.
 */
export const positions = new Map<string, Vector3>()
