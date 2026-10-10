import type { Archipelago } from "../../world/archipelagoSource.ts"
import { HOME, type Stop } from "../../world/islandRing.ts"

/** What a stop's shot holds: its centre on the sea (x, z) and the radius round it to fit. */
export interface Frame {
  x: number
  z: number
  radius: number
}

/** The map: every island's land, centred on their bounding box, with a little sea round it. */
export function mapFrame(archipelago: Archipelago): Frame {
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (const { at, reach } of [archipelago.home, ...archipelago.islands]) {
    minX = Math.min(minX, at[0] - reach)
    maxX = Math.max(maxX, at[0] + reach)
    minZ = Math.min(minZ, at[1] - reach)
    maxZ = Math.max(maxZ, at[1] + reach)
  }
  return {
    x: (minX + maxX) / 2,
    z: (minZ + maxZ) / 2,
    radius: (Math.max(maxX - minX, maxZ - minZ) / 2) * 1.08,
  }
}

/** A stop's frame: the map's, or one island's (its keep, its reach). */
export function frameOf(stop: Stop, archipelago: Archipelago): Frame {
  if (stop === "map") return mapFrame(archipelago)
  const island = stop === HOME ? archipelago.home : (archipelago.islands[stop] ?? archipelago.home)
  return { x: island.at[0], z: island.at[1], radius: island.reach }
}

/** The extent (world units from the origin) the camera's depths below were set for: a default archipelago. */
const FITTED_EXTENT = 450

/**
 * How deep the cameras must see over an archipelago: how far back the orthographic one stands (not 220:
 * a far island on its side of the sea is never behind it), its far plane and the perspective one's, and
 * the farthest dolly. They grow with the archipelago's extent, so a ring of big islands is not cut off.
 */
export function depthsOf(archipelago: Archipelago): { back: number; orthoFar: number; far: number } {
  const scale = Math.max(1, archipelago.extent / FITTED_EXTENT)
  return { back: 1200 * scale, orthoFar: 2600 * scale, far: 3600 * scale }
}

/** How long a flight between two points takes, s: 1.4 for a hop, 1.8 across the whole sea. */
export function flightSeconds(distance: number): number {
  return Math.min(1.8, 1.4 + distance / 1500)
}

/**
 * A flight's shot size at `p` (0–1, eased): orthographic zoom (or perspective distance, `zoom`
 * false) eased from `from` to `to` on a log scale, pulled out halfway for a long trip — a crane
 * over the sea, not a dolly along it. `pull` is how far it pulls out (0: none).
 */
export function flightSize(from: number, to: number, p: number, pull: number, zoom: boolean): number {
  const size = Math.exp(Math.log(from) + (Math.log(to) - Math.log(from)) * p)
  const dip = 1 - pull * Math.sin(Math.PI * p)
  return zoom ? size * dip : size / dip
}
