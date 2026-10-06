import { HEX_SCALE, type Island } from "../../world/lands.ts"
import type { Spot } from "../../world/layout.ts"

/**
 * Where grass grows (ADR 0007, Nature): tufts scattered over the meadow hexes, sparser on level
 * forest hexes, kept off the trunks and rocks standing on them. Pure and seeded, so the island
 * grows the same grass every time.
 */

/** Hex circumradius in world units (flat-top: a corner at angle 0). */
export const HEX_RADIUS = (HEX_SCALE * 2) / Math.sqrt(3)

export interface Tuft {
  x: number
  z: number
  rot: number
  scale: number
  /** A flower on this tuft: its colour index into FLOWERS, or -1. */
  flower: number
}

/** Flower colours (sRGB): daisy white, buttercup, clover pink, harebell. */
export const FLOWERS = ["#f4f1e6", "#f2c94c", "#e58fb1", "#9d8ee0"] as const

/** Is (dx, dz) from a flat-top hex's centre inside it, with `margin` world units to spare? */
export function insideHex(dx: number, dz: number, margin = 0): boolean {
  const r = HEX_RADIUS - margin / (Math.sqrt(3) / 2)
  const x = Math.abs(dx)
  const z = Math.abs(dz)
  const apothem = (r * Math.sqrt(3)) / 2
  return z <= apothem && x * Math.sqrt(3) + z <= r * Math.sqrt(3)
}

/**
 * Tufts for the island. `density` is tufts per meadow hex (forest hexes get a quarter); 0 grows none.
 * Decor standing on a hex keeps a clear circle round it (a tree's trunk, a rock).
 */
export function scatter(land: Pick<Island, "meadow" | "tiles" | "decor">, density: number, seed = 3): Tuft[] {
  if (density <= 0) return []
  const random = rng(seed)
  const tufts: Tuft[] = []
  const decorNear = (x: number, z: number) =>
    land.decor.filter((d) => (d.y ?? 0) === 0 && Math.hypot(d.x - x, d.z - z) < HEX_RADIUS + 1)
  const forest = new Set<string>()
  for (const d of land.decor)
    if (/^trees_[AB]_(large|medium|small)$/.test(d.piece) && !d.y) forest.add(spot(d.x, d.z))

  const grow = (centre: Spot, count: number, clearing: number) => {
    const blockers = decorNear(centre[0], centre[1]).map((d) => ({
      x: d.x,
      z: d.z,
      r: /^trees_/.test(d.piece) ? clearing : /^tree_/.test(d.piece) ? 0.7 : 1.1,
    }))
    for (let i = 0, tries = 0; i < count && tries < count * 4; tries++) {
      const dx = (random() * 2 - 1) * HEX_RADIUS
      const dz = (random() * 2 - 1) * HEX_RADIUS
      if (!insideHex(dx, dz, 0.15)) continue
      const x = centre[0] + dx
      const z = centre[1] + dz
      if (blockers.some((b) => Math.hypot(b.x - x, b.z - z) < b.r)) continue
      const flowered = random() < 0.13
      tufts.push({
        x,
        z,
        rot: random() * Math.PI * 2,
        scale: 0.75 + random() * 0.55,
        flower: flowered ? Math.floor(random() * FLOWERS.length) : -1,
      })
      i++
    }
  }
  for (const centre of land.meadow) grow(centre, density, 1.5)
  // Level forest hexes: the clumps fill the middle, grass rings the edge.
  for (const tile of land.tiles) {
    if (tile.piece !== "hex_grass" || tile.y) continue
    if (!forest.has(spot(tile.x, tile.z))) continue
    grow([tile.x, tile.z], Math.round(density / 4), 3.2)
  }
  return tufts
}

const spot = (x: number, z: number) => `${Math.round(x)},${Math.round(z)}`

function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
