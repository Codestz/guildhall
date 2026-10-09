import { SEA_CELL } from "../../world/archipelago.ts"
import type { Spot } from "../../world/layout.ts"
import type { World } from "../../world/world.ts"
import { HEX_RADIUS } from "./scatter.ts"
import { SHORE } from "./shore.ts"

/**
 * The shore bake in tiles (ADR 0020 §3). An island that fits the home bake's square (±SHORE.half
 * round its keep: the hand-drawn lands, every generator-v1 island) has that one bake, as always. A
 * bigger one (generator v2) is covered by a grid of tiles of the same size and density, kept only
 * where there is coast, each drawn as its own water patch over its own bake (nature/Water.tsx), with
 * a hole cut in the open sea for it. The camera's reach and the growth mask follow the same measure.
 */

/** One shore bake: its square (centred `at`, world xz) and resolution. */
export interface ShoreTile {
  at: Spot
  half: number
  size: number
}

/** Half a hex's height across its flats (lands.ts: lines are 5 units apart). */
const HEX_APOTHEM = 5
/** Coast this close past a tile's edge still foams inside it. */
const MARGIN = SHORE.maxDistance + HEX_RADIUS

const isLand = (piece: string): boolean => piece !== "hex_water"

/** How far a world's land reaches from its keep along x or z, to its hexes' edges. */
export function spanOf(world: World): number {
  let span = 0
  for (const { piece, x, z } of world.island.tiles)
    if (isLand(piece)) span = Math.max(span, Math.abs(x) + HEX_RADIUS, Math.abs(z) + HEX_APOTHEM)
  return span
}

/**
 * How many home bakes' halves a world's land reaches: 1 for every island the one bake holds. Only a
 * generator-v2 island may reach further: the hall's camera and masks keep their sizes for the rest.
 */
export function outreachOf(world: World): number {
  if (world.repo?.gen !== 2) return 1
  return Math.max(1, spanOf(world) / SHORE.half)
}

const made = new WeakMap<World, readonly ShoreTile[]>()

/** A world's shore tiles, nearest its keep first (the order they bake in). */
export function shoreTilesOf(world: World): readonly ShoreTile[] {
  let tiles = made.get(world)
  if (!tiles) {
    tiles = tilesOf(world)
    made.set(world, tiles)
  }
  return tiles
}

function tilesOf(world: World): ShoreTile[] {
  const { half, size } = SHORE
  if (outreachOf(world) === 1) return [{ at: [0, 0], half, size }]
  const land = world.island.tiles.filter((tile) => isLand(tile.piece))
  const coast = land.filter((tile) => tile.piece.startsWith("hex_coast"))
  const xs = axis(land.map((tile) => tile.x))
  const zs = axis(land.map((tile) => tile.z))
  const near = (a: number, b: number): boolean => Math.abs(a - b) <= half + MARGIN
  const tiles: ShoreTile[] = []
  for (const x of xs)
    for (const z of zs)
      if (coast.some((tile) => near(tile.x, x) && near(tile.z, z))) tiles.push({ at: [x, z], half, size })
  return tiles.sort(
    (a, b) => Math.hypot(...a.at) - Math.hypot(...b.at) || a.at[0] - b.at[0] || a.at[1] - b.at[1],
  )
}

/** Tile centres along one axis covering every hex centred at `centres`, snapped to the sea's grid. */
function axis(centres: readonly number[]): number[] {
  const side = 2 * SHORE.half
  const min = Math.min(...centres) - HEX_RADIUS
  const max = Math.max(...centres) + HEX_RADIUS
  const n = Math.ceil((max - min + SEA_CELL) / side)
  const mid = Math.round((min + max) / 2 / SEA_CELL) * SEA_CELL
  return Array.from({ length: n }, (_, i) => mid + (i - (n - 1) / 2) * side)
}
