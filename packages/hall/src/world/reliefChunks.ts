import type { Chunks } from "./chunks.ts"
import { key } from "./gen/hex.ts"
import type { Relief } from "./gen/relief/index.ts"
import type { Cell } from "./lands.ts"

/**
 * The relief cut by the island's regions (world/chunks.ts): per region, the massif hexes it holds,
 * which the renderer meshes once per detail tier (`reliefMesh(relief, cells, tier)`) and swaps with
 * the region. Every massif hex lies in exactly one region, because every land hex does; a region
 * with no massif hex holds an empty list.
 */
export function reliefCells(relief: Relief, chunks: Chunks): Cell[][] {
  return chunks.list.map((chunk) => chunk.cells.filter((cell) => relief.keys.has(key(cell))))
}
