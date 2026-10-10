import { type Footprint, type IslandSeed, SEA_CELL, SEA_GAP, waterClear } from "./archipelago.ts"
import { coastOf, EDGE, straitBetween } from "./coast.ts"
import { DMath } from "./dmath.ts"
import { type Coupling, weightOf } from "./gen/coupling.ts"
import { hash } from "./gen/hex.ts"
import type { Spot } from "./layout.ts"
import { quayFacing } from "./quays.ts"
import type { World } from "./world.ts"

/**
 * A repo as an archipelago (`?repo=…&split`, world/gen/split.ts): where its islands lie, which are
 * joined, and where the crossings meet each coast. Pure and deterministic (DMath, no unseeded
 * choices), so every machine lays out the same sea.
 *
 * The contract the scene builds on: `IslandLink`s between island ids, and per island a `Quay` for
 * each of its links (archipelago coordinates, and island-local for walking to it).
 */

export interface IslandLink {
  /** Island ids (world/archipelagoSource.ts `IslandInfo.id`). */
  a: string
  b: string
  /** How tightly the two are bound, 0..1 (world/gen/coupling.ts). */
  weight: number
  /** Open sea between the two coasts at their nearest (the strait), world units; what a bridge or a railway spans. */
  gap: number
  /** A bridge: tightly bound and the strait no wider than BRIDGE_GAP; otherwise a ferry. */
  kind: "bridge" | "ferry"
}

/** Where a link meets an island: a dry spot on its coast facing the partner. */
export interface Quay {
  /** Index into the archipelago's `links`. */
  link: number
  /** The island on the link's other end (its id). */
  partner: string
  /** In the archipelago's coordinates (the home island's keep at the origin). */
  at: Spot
  /** In the island's own (the keep at its origin): where its folk walk to. */
  local: Spot
  /** Unit vector from the quay towards the partner's quay. */
  facing: Spot
}

/** Bound at least this much, with a strait no wider than BRIDGE_GAP, a link is a bridge. */
export const BRIDGE_WEIGHT = 0.5
export const BRIDGE_GAP = 70
/** Packages bound at least BRIDGE_WEIGHT lie in a strait of at least this much (coast to coast); the rest, SEA_GAP. */
export const STRAIT_MIN = 30

/** A bridge when tightly bound and the strait is no wider than BRIDGE_GAP; else a ferry. */
export const linkKind = (weight: number, gap: number): IslandLink["kind"] =>
  weight >= BRIDGE_WEIGHT && gap <= BRIDGE_GAP ? "bridge" : "ferry"
/** A tree's links are all the island needs; a pair bound at least this much gets a link of its own too. */
const EXTRA_WEIGHT = 0.5
/** Links at one island, at most (a quay each). */
const MAX_LINKS = 3
/** Even unbound islands lean a little towards each other, so the ring stays compact. */
const BASE_PULL = 0.05
/** Directions tried round each neighbour when placing an island. */
const ANGLES = 16

export interface Laid {
  id: string
  world: World
  footprint: Footprint
}

/** What placing an island needs: its water, how far it reaches, and its coast. */
export interface Body extends IslandSeed {
  coast: readonly Spot[]
}

export interface SplitLayout {
  /** Each island's keep, aligned with the islands given (the first, the core, at the origin). */
  centers: Spot[]
  links: IslandLink[]
  /** Aligned with the islands given: each one's quays. */
  quays: Quay[][]
}

/**
 * Which pairs are joined: the strongest tree that connects every island (a package nothing binds
 * is joined to its nearest neighbour), then any further pair bound at least EXTRA_WEIGHT, while both have room.
 */
export function chooseLinks(
  ids: readonly string[],
  coupling: Coupling,
  centers: readonly Spot[],
): { a: string; b: string; weight: number }[] {
  const pairs: { a: string; b: string; weight: number; apart: number }[] = []
  for (const [i, a] of ids.entries())
    for (const [j, b] of ids.entries())
      if (j > i)
        pairs.push({
          a,
          b,
          weight: weightOf(coupling, a, b),
          apart: hypot(centers[i] as Spot, centers[j] as Spot),
        })
  // Strongest first; at a tie, the nearer, then by name.
  pairs.sort((x, y) => y.weight - x.weight || x.apart - y.apart || (x.a + x.b < y.a + y.b ? -1 : 1))
  const group = new Map(ids.map((id) => [id, id]))
  const find = (id: string): string => {
    const up = group.get(id) as string
    return up === id ? id : find(up)
  }
  const degree = new Map<string, number>()
  const bump = (id: string): void => void degree.set(id, (degree.get(id) ?? 0) + 1)
  const out: { a: string; b: string; weight: number }[] = []
  const used = new Set<(typeof pairs)[number]>()
  const join = (pair: (typeof pairs)[number]): void => {
    group.set(find(pair.a), find(pair.b))
    bump(pair.a)
    bump(pair.b)
    used.add(pair)
    out.push({ a: pair.a, b: pair.b, weight: Math.max(pair.weight, BASE_PULL) })
  }
  const room = (pair: (typeof pairs)[number]): boolean =>
    (degree.get(pair.a) ?? 0) < MAX_LINKS && (degree.get(pair.b) ?? 0) < MAX_LINKS
  // The tree, an island's quays being few: no island takes more than MAX_LINKS of it unless it must.
  for (const pair of pairs) if (find(pair.a) !== find(pair.b) && room(pair)) join(pair)
  for (const pair of pairs) if (find(pair.a) !== find(pair.b)) join(pair)
  for (const pair of pairs)
    if (!used.has(pair) && pair.weight >= EXTRA_WEIGHT && room(pair)) {
      bump(pair.a)
      bump(pair.b)
      out.push({ a: pair.a, b: pair.b, weight: pair.weight })
    }
  return out
}

const hypot = (a: Spot, b: Spot): number => DMath.hypot(a[0] - b[0], a[1] - b[1])
const snap = (v: number): number => Math.round(v / SEA_CELL) * SEA_CELL

/** Whether `a` (keep at `from`) and `b` (at `to`) share no water and leave at least `gap` of sea between their coasts. */
function room(a: Body, from: Spot, b: Body, to: Spot, gap: number): boolean {
  if (!waterClear(a, from, b, to)) return false
  // The land is nowhere further than `reach` from its keep: nearer than this, look at the coasts themselves.
  if (hypot(from, to) - a.reach - b.reach - 2 * EDGE >= gap) return true
  const strait = straitBetween(a.coast, from, b.coast, to, gap)
  return !strait || strait.gap >= gap
}

/**
 * Where each island lies: the core at the origin, the rest in the order of how bound they are to
 * what is already placed. Each takes the spot round a neighbour that is nearest the ones it is bound
 * to, so a package sits by its family: packages bound at least BRIDGE_WEIGHT in a strait of
 * STRAIT_MIN, the rest SEA_GAP of sea off every coast, and no two islands share water.
 */
export function placeCoupled(seeds: readonly Body[], core: Body, coupling: Coupling): Spot[] {
  const ids = [core.repo, ...seeds.map((s) => s.repo)]
  const all: Body[] = [core, ...seeds]
  const at = new Map<number, Spot>([[0, [0, 0]]])
  const weight = (i: number, j: number): number => weightOf(coupling, ids[i] as string, ids[j] as string)
  const pull = (i: number, j: number): number => Math.max(weight(i, j), BASE_PULL)
  const pending = new Set(seeds.map((_, k) => k + 1))
  while (pending.size > 0) {
    // The island most bound to those placed goes next (the lowest index on a tie).
    let next = 0
    let best = -1
    for (const i of pending) {
      const bound = Math.max(...[...at.keys()].map((j) => pull(i, j)))
      if (bound > best) {
        best = bound
        next = i
      }
    }
    pending.delete(next)
    const seed = all[next] as Body
    const placed = [...at.entries()]
    const fits = (spot: Spot): boolean =>
      placed.every(([j, other]) =>
        room(all[j] as Body, other, seed, spot, weight(next, j) >= BRIDGE_WEIGHT ? STRAIT_MIN : SEA_GAP),
      )
    // Anchors: the core and the three it is most bound to.
    const anchors = placed
      .map(([j]) => j)
      .sort((x, y) => pull(next, y) - pull(next, x) || x - y)
      .slice(0, 3)
    if (!anchors.includes(0)) anchors.push(0)
    let choice: { spot: Spot; cost: number } | undefined
    for (const anchor of anchors) {
      const from = at.get(anchor) as Spot
      const base = all[anchor] as Body
      for (let k = 0; k < ANGLES; k++) {
        const angle =
          -Math.PI / 2 +
          (k * 2 * Math.PI) / ANGLES +
          (((hash(seed.repo) % 1000) / 1000 - 0.5) * Math.PI) / ANGLES
        for (let r = snap((base.reach + seed.reach) / 2); ; r += SEA_CELL) {
          const spot: Spot = [snap(from[0] + DMath.cos(angle) * r), snap(from[1] + DMath.sin(angle) * r)]
          if (!fits(spot)) continue
          // Near every neighbour it is bound to by the strait itself (a bridge's span), the rest by their keeps.
          const cost = placed.reduce((sum, [j, other]) => {
            const near = hypot(spot, other)
            if (weight(next, j) < BRIDGE_WEIGHT) return sum + pull(next, j) * near
            const strait = straitBetween((all[j] as Body).coast, other, seed.coast, spot)
            return sum + weight(next, j) * (near + 8 * (strait?.gap ?? near))
          }, 0)
          if (!choice || cost < choice.cost) choice = { spot, cost }
          break
        }
      }
    }
    at.set(next, (choice as { spot: Spot }).spot)
  }
  return seeds.map((_, k) => at.get(k + 1) as Spot)
}

/**
 * The whole sea of a split repo: islands (core first) placed, joined, and given their quays: each at
 * the coast nearest the partner's, so a bridge spans the strait where it is narrowest. A link whose
 * coast has no valid quay at either end is dropped.
 */
export function layoutSplit(islands: readonly Laid[], coupling: Coupling): SplitLayout {
  const [core, ...rest] = islands as [Laid, ...Laid[]]
  const body = (one: Laid): Body => ({ repo: one.id, ...one.footprint, coast: coastOf(one.world) })
  const centers: Spot[] = [[0, 0], ...placeCoupled(rest.map(body), body(core), coupling)]
  const index = new Map(islands.map((one, i) => [one.id, i]))
  const links: IslandLink[] = []
  const quays: Quay[][] = islands.map(() => [])
  const local: Spot[][] = islands.map(() => [])
  const upon = (k: number, q: Spot): Spot => [(centers[k] as Spot)[0] + q[0], (centers[k] as Spot)[1] + q[1]]
  for (const wanted of chooseLinks(
    islands.map((one) => one.id),
    coupling,
    centers,
  )) {
    const [i, j] = [index.get(wanted.a) as number, index.get(wanted.b) as number]
    const strait = straitBetween(
      coastOf((islands[i] as Laid).world),
      centers[i] as Spot,
      coastOf((islands[j] as Laid).world),
      centers[j] as Spot,
    )
    if (!strait) continue
    const qi = quayFacing((islands[i] as Laid).world, strait.a, local[i])
    const qj = quayFacing((islands[j] as Laid).world, strait.b, local[j])
    if (!qi || !qj) continue
    const [wi, wj] = [upon(i, qi), upon(j, qj)]
    const span = hypot(wi, wj) || 1
    const facing = (from: Spot, to: Spot): Spot => [(to[0] - from[0]) / span, (to[1] - from[1]) / span]
    const link = links.length
    const gap = Math.round(strait.gap * 10) / 10
    links.push({ ...wanted, gap, kind: linkKind(wanted.weight, gap) })
    local[i]?.push(qi)
    local[j]?.push(qj)
    quays[i]?.push({ link, partner: wanted.b, at: wi, local: qi, facing: facing(wi, wj) })
    quays[j]?.push({ link, partner: wanted.a, at: wj, local: qj, facing: facing(wj, wi) })
  }
  return { centers, links, quays }
}
