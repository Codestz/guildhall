import { DMath } from "../../dmath.ts"
import { type Cell, cellToWorld } from "../../lands.ts"
import { Heap } from "../heap.ts"
import { cellAt, key, neighbours, noise, rings, rng, unkey } from "../hex.ts"
import type { Archetype } from "../identity/types.ts"
import { disc } from "./heart.ts"

/**
 * The outlines the archetypes give an island's land (identity/archetype.ts), each a level set of
 * one score over the hexes, flooded out from the keep, lowest first, until it holds the island's
 * hexes (plan/mass.ts). One landmass either way, as ADR 0020 §2 draws it, except where the shape is
 * the point:
 *
 *   cone     a round island, its mountain at the middle
 *   plateau  a squarer one with straight shores, a high table
 *   ridge    twice as wide as it is deep, the keep on the south shore under a long spine
 *   atoll    a ring: the same flood with a lagoon of sea left inside it
 *   reef     a body and a few islets two hexes of sea off it
 */

/** One hex's area, square world units (8.66 × 10). */
const HEX_AREA = 86.6
/** The area of a unit disc and of a unit squircle: what an outline's size is scaled by. */
const DISC = Math.PI
const SQUIRCLE = 3.708

export interface Look {
  /** The outline's width over its depth (x over z), before the harmonics wave it. */
  aspect: number
  /** Each harmonic's amplitude on the radius, from the 2nd to the 6th. */
  waves: readonly number[]
  /** Per-hex jitter on the score. */
  jitter: number
  /** 0 a round outline, 1 a squircle. */
  square: number
}

export const LOOKS: Readonly<Record<Archetype, Look>> = {
  cone: { aspect: 1.4, waves: [0.06, 0.07, 0.05, 0.04, 0.03], jitter: 0.05, square: 0 },
  plateau: { aspect: 1.4, waves: [0.03, 0.03, 0.02, 0.02, 0.01], jitter: 0.03, square: 0.7 },
  // Little over half as wide as it is long, its ends blunt: the keep at its south end, the ridge running away north.
  ridge: { aspect: 1.1, waves: [0.07, 0.06, 0.04, 0.03, 0.02], jitter: 0.05, square: 0.5 },
  atoll: { aspect: 1.4, waves: [0.05, 0.07, 0.05, 0.04, 0.03], jitter: 0.06, square: 0 },
  reef: { aspect: 1.4, waves: [0.06, 0.07, 0.05, 0.04, 0.03], jitter: 0.06, square: 0 },
}

/** How far north of the keep the outline's centre sits, as a share of its half-depth (ADR 0020's: the keep a little south of the middle). */
const NORTH = 0.12
/** The outline's half-depth (z), world units, for `size` hexes. */
function depthOf(size: number, look: Look): number {
  const area = DISC * (1 - look.square) + SQUIRCLE * look.square
  return Math.sqrt((size * HEX_AREA) / (area * look.aspect))
}

/** The outline's centre in z (the keep stands at the origin; north is −z). */
const centreZOf = (size: number, look: Look): number => -NORTH * depthOf(size, look)

/** The hex at the outline's centre. */
export const centreOf = (size: number, look: Look): Cell => cellAt([0, centreZOf(size, look)])

/** A hex's place in the outline: under 1 inside the waved shape that holds `size` hexes. */
export function outline(size: number, seed: number, look: Look): (cell: Cell) => number {
  const depth = depthOf(size, look)
  const width = depth * look.aspect
  // The keep stands at the origin; north is −z.
  const centreZ = centreZOf(size, look)
  const random = rng(seed ^ 0x6d61_7373)
  const phases = look.waves.map(() => random() * 2 * Math.PI)
  return (cell) => {
    const [x, z] = cellToWorld(cell)
    const u = x / width
    const v = (z - centreZ) / depth
    const angle = DMath.atan2(v, u)
    let radius = 1
    look.waves.forEach((amplitude, i) => {
      radius += amplitude * DMath.cos((i + 2) * angle - (phases[i] ?? 0))
    })
    const round = DMath.hypot(u, v)
    const squircle = Math.sqrt(Math.sqrt(u * u * u * u + v * v * v * v))
    const place = round * (1 - look.square) + squircle * look.square
    return place / radius + look.jitter * noise(seed, cell, "mass")
  }
}

/** Flood: `size` hexes grown from `seeds` in order of `score`, never onto `blocked` or what `refuse`s. */
export function flood(
  size: number,
  seeds: ReadonlySet<string>,
  score: (cell: Cell) => number,
  refuse: (cell: Cell) => boolean,
  blocked: ReadonlySet<string> = new Set(),
): Set<string> {
  const mass = new Set<string>(seeds)
  const queued = new Set<string>(mass)
  const heap = new Heap<[number, string]>((a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]))
  const offer = (cell: Cell): void => {
    const id = key(cell)
    if (queued.has(id) || blocked.has(id) || refuse(cell)) return
    queued.add(id)
    heap.push([score(cell), id])
  }
  for (const id of mass) for (const next of neighbours(unkey(id))) offer(next)
  while (mass.size < size) {
    const item = heap.pop()
    if (!item) break
    mass.add(item[1])
    for (const next of neighbours(unkey(item[1]))) offer(next)
  }
  return mass
}

/** Hexes in a disc of `n` rings. */
const discSize = (n: number): number => 3 * n * n + 3 * n + 1

/** The most land hexes an atoll's lagoon takes from its outline: about a sixth of the island, a disc's worth. */
export function lagoonWant(size: number): number {
  const want = Math.max(7, Math.round(size * 0.17))
  let radius = 1
  while (discSize(radius + 1) <= want) radius++
  return discSize(radius)
}

/**
 * An atoll's lagoon and the outline round it: a disc of sea about a sixth of the island, as deep
 * inside the outline as it goes and clear of the `keep` ground, ringed by at least two hexes of land
 * (a thinner ring is worn through by the coast smoothing). Each size of lagoon has its own outline,
 * drawn for the land and the sea it holds, so the ring is as thick as the island's land allows;
 * the lagoon is shrunk until one fits, and none (undefined) where not even a small one does.
 */
export function lagoonOf(
  size: number,
  look: Look,
  seed: number,
  keep: ReadonlySet<string>,
  refuse: (cell: Cell) => boolean,
): { lagoon: Set<string>; score: (cell: Cell) => number } | undefined {
  let radius = 1
  while (discSize(radius + 1) <= lagoonWant(size)) radius++
  for (; radius >= 1; radius--) {
    const score = outline(size + discSize(radius), seed, look)
    const centre = centreOf(size + discSize(radius), look)
    const [cx, cz] = cellToWorld(centre)
    let best: { at: Cell; cost: number } | undefined
    for (const at of disc(centre, 12)) {
      const around = disc(at, radius + 2)
      if (around.some((h) => keep.has(key(h)) || refuse(h) || score(h) > 1.02)) continue
      const [x, z] = cellToWorld(at)
      const cost = DMath.hypot(x - cx, z - cz)
      if (!best || cost < best.cost || (cost === best.cost && key(at) < key(best.at))) best = { at, cost }
    }
    if (best) return { lagoon: new Set(disc(best.at, radius).map(key)), score }
  }
  return undefined
}

/**
 * A reef's islets: blobs of a hex and its six neighbours (or two rings) left standing in the sea
 * inside the island's outline, each ringed by a moat of two hexes of sea (a moat that wide is not
 * filled in by the coast smoothing). They sit towards the coast, clear of the `keep` ground and the
 * harbour's cove, apart from each other, about an eighth of the land: so a reef keeps the reach of
 * the island it is cut from. The moat is drawn for the land and the sea the outline holds.
 */
export function reefOf(
  size: number,
  look: Look,
  seed: number,
  keep: ReadonlySet<string>,
  refuse: (cell: Cell) => boolean,
): { islets: Set<string>; moat: Set<string>; score: (cell: Cell) => number } {
  const total = Math.min(40, Math.max(7, Math.round(size * 0.12)))
  const guess = outline(size + total * 3, seed, look)
  const centre = centreOf(size + total * 3, look)
  const ranked = disc(centre, 14)
    .filter((cell) => guess(cell) >= 0.5 && guess(cell) <= 0.9)
    .sort((a, b) => noise(seed, a, "islet") - noise(seed, b, "islet") || (key(a) < key(b) ? -1 : 1))
  const islets = new Set<string>()
  const moat = new Set<string>()
  const taken: { at: Cell; n: number }[] = []
  for (const cell of ranked) {
    if (islets.size >= total) break
    const n = total - islets.size >= discSize(2) && noise(seed, cell, "isletsize") < 0.4 ? 2 : 1
    // Two hexes of moat and then the sea or the land: no keep ground, cove or other islet within n + 2 of it.
    const around = disc(cell, n + 2)
    if (around.some((h) => keep.has(key(h)) || refuse(h) || guess(h) > 1.02)) continue
    if (taken.some((t) => rings([t.at[0] - cell[0], t.at[1] - cell[1]]) < n + t.n + 4)) continue
    taken.push({ at: cell, n })
    for (const h of disc(cell, n)) islets.add(key(h))
    for (const h of around) if (!islets.has(key(h))) moat.add(key(h))
  }
  return { islets, moat, score: outline(size + moat.size, seed, look) }
}
