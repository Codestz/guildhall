/**
 * Which hex tile of the land pack opens onto which edges, and how to turn it there. A mirror of
 * lands.ts' private tables (`turn`, `PATH_TILES`, `COAST_TILES`, `fit`, `contiguous`): lands.ts keeps
 * them module-private, so the generator carries its own copy. test/islandGen.test.ts checks this
 * copy fits every road tile of the hand-drawn map exactly as lands.ts does, so the two can't drift.
 */

/** The y-rotation that puts a pointy-top tile's model edge k on grid edge k + m. */
export const turn = (m: number): number => -(Math.PI / 6 + (m * Math.PI) / 3)

/** Model edges that carry road (or river) on each tile, by tile letter. */
export const PATH_TILES: Record<string, readonly number[]> = {
  A: [0, 3],
  B: [3, 5],
  C: [3, 4],
  D: [1, 3, 5],
  E: [0, 3, 5],
  F: [0, 1, 3],
  G: [2, 3, 4],
  H: [0, 2, 3, 4],
  I: [1, 2, 4, 5],
  J: [0, 1, 2, 3],
  K: [1, 2, 3, 4, 5],
  L: [0, 1, 2, 3, 4, 5],
  M: [3],
}
/** Coast tiles: model edges that open onto water. */
export const COAST_TILES: Record<string, readonly number[]> = {
  A: [1],
  B: [1, 2],
  C: [0, 1, 2],
  D: [5, 0, 1, 2],
}

const mask = (edges: Iterable<number>): number => {
  let bits = 0
  for (const edge of edges) bits |= 1 << (((edge % 6) + 6) % 6)
  return bits
}

/** The tile (from `tiles`) and turn m whose open edges are exactly `edges`. */
export function fit(
  tiles: Record<string, readonly number[]>,
  edges: Iterable<number>,
): { tile: string; m: number } | undefined {
  const want = mask(edges)
  for (const [tile, model] of Object.entries(tiles))
    for (let m = 0; m < 6; m++) if (mask(model.map((k) => k + m)) === want) return { tile, m }
  return undefined
}

/** The start of the one contiguous run (round the hex) that `dirs` forms, or undefined. */
export function contiguous(dirs: readonly number[]): { start: number; length: number } | undefined {
  const set = new Set(dirs)
  if (set.size === 6) return { start: 0, length: 6 }
  for (let start = 0; start < 6; start++) {
    if (!set.has(start) || set.has((start + 5) % 6)) continue
    let length = 0
    while (set.has((start + length) % 6)) length++
    return length === set.size ? { start, length } : undefined
  }
  return undefined
}
