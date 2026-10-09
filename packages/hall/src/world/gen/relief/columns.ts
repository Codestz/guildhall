import { type Cell, cellToWorld, type LandPlacement } from "../../lands.ts"
import { TERRACE } from "../../waterways.ts"
import { key } from "../hex.ts"
import { turn } from "../tiles.ts"
import type { Massif } from "./field.ts"

/**
 * Hex-native mountains (relief style e): each massif hex becomes a column of the island's own
 * `hex_grass` tiles, stacked the way the hand map stacks its terraces, so a range shows the same
 * bevelled cliff faces as every other raised ground. A column's top comes from the massif's height
 * field at the hex centre, scaled so the summit crowns (crowns.ts) carry the rest, then snapped to
 * `COLUMN_STEP`. Pure and deterministic; the ground walkers read is the column's flat top.
 */

/** Columns climb in whole tiles: a tile is 2 terraces (5 units) deep. */
export const COLUMN_STEP = 2 * TERRACE
/** The share of the field's height the columns carry; the crowns stand on the rest. */
export const BODY = 0.8
/** How the field's share is lifted (below 1: the middle heights stand higher), so a range is a body, not a spire. */
const LIFT = 0.85
/** The lowest a massif column stands: one tile above the lowland. */
const FOOT = COLUMN_STEP

/** A column's top for the field height `h` of a massif `peak` high. */
export const topOf = (h: number, peak: number): number =>
  Math.max(FOOT, Math.round((peak * BODY * (Math.max(0, h) / peak) ** LIFT) / COLUMN_STEP) * COLUMN_STEP)

/** Every massif hex's column top, by key. */
export function columnsOf(massifs: readonly Massif[]): Map<string, number> {
  const tops = new Map<string, number>()
  for (const massif of massifs)
    for (const cell of massif.cells) {
      const [x, z] = cellToWorld(cell)
      tops.set(key(cell), topOf(massif.grid.heightAt(x, z) ?? 0, massif.height))
    }
  return tops
}

/** The tiles of one column: its top, then a tile every `COLUMN_STEP` down to the ground (the hand map's stack). */
export function columnTiles(cell: Cell, top: number): LandPlacement[] {
  const [x, z] = cellToWorld(cell)
  const tiles: LandPlacement[] = []
  for (let y = top; y >= 0; y -= COLUMN_STEP)
    tiles.push({ piece: "hex_grass", x, z, rot: turn(0), ...(y ? { y } : {}) })
  return tiles
}
