import { DMath } from "../../dmath.ts"
import { type Cell, cellToWorld } from "../../lands.ts"
import { Heap } from "../heap.ts"
import { key, neighbours, noise, rng, unkey } from "../hex.ts"
import { bayOf, type Form, HUB, RESERVED } from "./keep.ts"

/**
 * Generator v2's island outline (ADR 0020 §2): one landmass drawn before any district claims it,
 * so a big repo reads as one island with an organic coast instead of a ring of lobes on thin necks
 * round an inner sea (v1's districts grow freely, each as far out as its land pushes it).
 *
 * The outline is a level set: every hex scores its distance from the island's centre over a wide
 * ellipse (ASPECT across), the radius waved by a few low harmonics (headlands and bays, seeded)
 * and a little per-hex jitter, and the land floods out from the keep, lowest score first, until it
 * holds the island's hexes. Flooding keeps it one piece; the level set keeps it round. The centre
 * sits a little north of the keep, so the harbour's cove (narrower than v1's bay) reaches the open
 * sea south of the hub without the keep ending up on the shore.
 */

/** The outline's width over its depth (x over z), before the harmonics wave it. */
const ASPECT = 1.4
/** How far north of the keep the island's centre sits, as a share of its half-depth. */
const NORTH = 0.12
/** Half-angle of the harbour's cove south of the hub (v1's bay is 35°). */
const COVE = (24 * Math.PI) / 180
/** Each harmonic's amplitude on the radius, from the 2nd (an oval's tilt) to the 6th (small capes). */
const WAVES: readonly number[] = [0.06, 0.07, 0.05, 0.04, 0.03]
/** Per-hex jitter on the score: a ragged, not ruled, shoreline. */
const JITTER = 0.06
/** One hex's area, square world units (8.66 × 10). */
const HEX_AREA = 86.6

export const inCove = bayOf(COVE)

/** Generator v2's form: an outline of `size` hexes round the keep, the cove left open. */
export function massForm(size: number, seed: number): Form {
  return { bay: inCove, mass: landMass(size, seed) }
}

/** The landmass: `size` hexes flooded out from the keep in order of the outline's score. */
export function landMass(size: number, seed: number): Set<string> {
  const score = outline(size, seed)
  const mass = new Set<string>([key(HUB), ...RESERVED])
  const queued = new Set<string>(mass)
  const heap = new Heap<[number, string]>((a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]))
  const offer = (cell: Cell): void => {
    const id = key(cell)
    if (queued.has(id) || inCove(cell)) return
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

/** A hex's place in the outline: under 1 inside the waved ellipse that holds `size` hexes. */
function outline(size: number, seed: number): (cell: Cell) => number {
  const depth = Math.sqrt((size * HEX_AREA) / (Math.PI * ASPECT))
  const width = depth * ASPECT
  // The keep stands at the origin; north is −z.
  const centreZ = -NORTH * depth
  const random = rng(seed ^ 0x6d61_7373)
  const phases = WAVES.map(() => random() * 2 * Math.PI)
  return (cell) => {
    const [x, z] = cellToWorld(cell)
    const u = x / width
    const v = (z - centreZ) / depth
    const angle = DMath.atan2(v, u)
    let radius = 1
    WAVES.forEach((amplitude, i) => {
      radius += amplitude * DMath.cos((i + 2) * angle - (phases[i] ?? 0))
    })
    return DMath.hypot(u, v) / radius + JITTER * noise(seed, cell, "mass")
  }
}
