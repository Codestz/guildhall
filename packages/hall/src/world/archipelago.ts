import { dominant, type Language, languageOf } from "./gen/biomes.ts"
import { hash } from "./gen/hex.ts"
import type { RepoEntry } from "./gen/repo.ts"
import type { Spot } from "./layout.ts"

/**
 * The archipelago (`?archipelago`, `?repos=`): several repos as islands on one sea. The home island
 * (the hand-drawn lands, or `?repo=`'s) stays at the origin with the guild on it; the others are
 * grown from their trees and placed in a ring round it. Each keeps its own World in its own
 * coordinates (the keep at its origin); the scene draws it translated by its offset.
 *
 * Pure: where the islands go, which crossings between them are clear, a repo's main language.
 */

/** The public site's archipelago round the guild's own island (the hand-drawn lands). */
export const DEFAULT_ARCHIPELAGO: readonly string[] = [
  "Codestz/claude-hindsight",
  "Codestz/mcpx",
  "Codestz/opencode-cockpit",
  "Codestz/Mintroot",
]
/** The home island's repo: never grown twice. */
export const HOME_REPO = "Codestz/guildhall"
/** At most this many islands round the home one (`?repos=`). */
export const MAX_ISLANDS = 6

/**
 * A far island's shore patch (nature/Water.tsx): the water there reads its own baked shore over
 * ±PATCH_HALF round its keep, and the open sea has a hole cut for it. Generated islands reach at
 * most ~118 (tile centres), so their coast and its foam fit inside.
 */
export const PATCH_HALF = 140
/** The open sea is a grid of this many world units a cell; offsets and patches snap to it. */
export const SEA_CELL = 20
/** The home island's own shore bake reaches ±this (nature/shore.ts SHORE.half): no patch over it. */
export const HOME_HALF = 120
/** Where the ring starts: one island's width out past the home island. */
const RING_START = 300

export interface IslandSeed {
  /** "owner/name": what places it (its hash turns the ring a little). */
  repo: string
}

/** Chebyshev distance: patches are axis-aligned squares, so this is what keeps them apart. */
const apart = (a: Spot, b: Spot): number => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]))
const snap = (v: number): number => Math.round(v / SEA_CELL) * SEA_CELL

/**
 * Each island's offset from the home island's keep, in order: a ring round the origin, one slot per
 * island, each pushed out until its patch clears the home island's shore and every patch before it.
 * Deterministic (the same repos give the same ring); every offset is a multiple of SEA_CELL.
 */
export function placeIslands(seeds: readonly IslandSeed[]): Spot[] {
  const placed: Spot[] = []
  const n = seeds.length
  for (let i = 0; i < n; i++) {
    const seed = seeds[i] as IslandSeed
    // A slot each round the ring, nudged up to ±8° by the repo's name, so it doesn't read as a grid.
    const nudge = ((hash(seed.repo) % 1000) / 1000 - 0.5) * ((16 * Math.PI) / 180)
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n + nudge
    for (let r = RING_START; ; r += SEA_CELL) {
      const at: Spot = [snap(Math.cos(angle) * r), snap(Math.sin(angle) * r)]
      if (apart(at, [0, 0]) < PATCH_HALF + HOME_HALF) continue
      if (placed.some((other) => apart(at, other) < 2 * PATCH_HALF)) continue
      placed.push(at)
      break
    }
  }
  return placed
}

/** An island as the crossings see it: where its keep is, and how far its land reaches from it. */
export interface Shore {
  at: Spot
  reach: number
}

/** Ships keep this far off any coast they pass (world units past its furthest land). */
export const OFFING = 22

/** Where a crossing from `from` to `to` leaves `from`'s coast: off its shore, facing `to`. */
export function portOf(from: Shore, to: Shore): Spot {
  const dx = to.at[0] - from.at[0]
  const dz = to.at[1] - from.at[1]
  const length = Math.hypot(dx, dz) || 1
  const out = from.reach + OFFING
  return [from.at[0] + (dx / length) * out, from.at[1] + (dz / length) * out]
}

/** Distance from `p` to the segment a–b. */
function toSegment(p: Spot, a: Spot, b: Spot): number {
  const ex = b[0] - a[0]
  const ez = b[1] - a[1]
  const length2 = ex * ex + ez * ez
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ez) / length2))
  return Math.hypot(a[0] + ex * t - p[0], a[1] + ez * t - p[1])
}

/**
 * The crossings a ship can sail in a straight line, as index pairs (i < j): port to port, passing
 * no other island closer than OFFING to its furthest land.
 */
export function crossingsOf(islands: readonly Shore[]): [number, number][] {
  const out: [number, number][] = []
  for (let i = 0; i < islands.length; i++)
    for (let j = i + 1; j < islands.length; j++) {
      const a = islands[i] as Shore
      const b = islands[j] as Shore
      const from = portOf(a, b)
      const to = portOf(b, a)
      const clear = islands.every(
        (other, k) => k === i || k === j || toSegment(other.at, from, to) > other.reach + OFFING,
      )
      if (clear) out.push([i, j])
    }
  return out
}

/** The fog's radius (atmosphere/Atmosphere.tsx `sea`) over an archipelago: every island clear of it. */
export const fogRadiusOf = (extent: number): number => extent * 1.1
/** The open sea's radius under an archipelago (nature/Water.tsx): past the fog's far edge. */
export const seaRadiusOf = (extent: number): number => Math.max(420, extent * 2)

/** How far the archipelago reaches from the origin: the furthest land of any island. */
export function extentOf(islands: readonly Shore[]): number {
  return Math.max(0, ...islands.map((island) => Math.hypot(island.at[0], island.at[1]) + island.reach))
}

/** A repo's main language: the most bytes across the whole tree, code before data and prose. */
export function mainLanguage(entries: readonly RepoEntry[]): Language {
  const bytes = new Map<string, { language: Language; bytes: number }>()
  for (const entry of entries) {
    if (entry.type !== "blob") continue
    const language = languageOf(entry.path)
    const known = bytes.get(language.name) ?? { language, bytes: 0 }
    known.bytes += entry.size ?? 0
    bytes.set(language.name, known)
  }
  return dominant(bytes)
}
