import { key, neighbours, noise, rings, step } from "../world/gen/hex.ts"
import { COAST_TILES, fit, PATH_TILES, turn } from "../world/gen/tiles.ts"
import { type Cell, cellToWorld, type LandPiece, type LandPlacement, SITES } from "../world/lands.ts"
import type { Spot } from "../world/layout.ts"
import { TERRACE, type Waterways, waterwaysOf } from "../world/waterways.ts"
import type { World } from "../world/world.ts"

/**
 * The water lab's island (lab/waterLab.tsx): a small terraced hex patch, levels 0–3, high to the
 * north-west and down to the sea in the south-east, so its falls face the diorama's camera. A
 * spring on level 3 runs to a promontory and falls south to level 2, runs on and falls into a lake
 * on level 1, which drains over a last fall to level 0 and out to sea. The tiles are fitted the way
 * lands.ts fits them (river and coast masks, a filler every two levels under a raised hex); what
 * slice 2's generator will produce for a whole island, in miniature.
 */

/** Land out to this many hexes from the centre; the sea beyond. */
const RADIUS = 5
const SEED = 3
/** The river, spring to sea. */
export const COURSE: readonly Cell[] = [
  [-2, -4],
  [-1, -3],
  [0, -2],
  [0, 0],
  [1, 1],
  [2, 2],
  [3, 3],
  [4, 4],
  [4, 6],
  [4, 8],
]
export const LAKE: readonly Cell[] = [
  [2, 2],
  [3, 3],
  [2, 4],
]
/** Hexes the slope rule below would put elsewhere: the promontory the first fall leaves from, a lake rim. */
const SET: Readonly<Record<string, number>> = { "0,-2": 3, "3,5": 1 }

/** A hex's level: the slope falls by a terrace every ~25 units towards the south-east. */
export function levelOf(cell: Cell): number | undefined {
  if (rings(cell) > RADIUS) return undefined
  const set = SET[key(cell)]
  if (set !== undefined) return set
  const [x, z] = cellToWorld(cell)
  const along = x + z
  return along < -15 ? 3 : along < 20 ? 2 : along < 50 ? 1 : 0
}

/** The patch's water, sorted (world/waterways.ts). */
export function patchWaters(): Waterways {
  return waterwaysOf({ level: levelOf, rivers: [COURSE], lakes: LAKE })
}

/** Every land hex of the patch. */
function cells(): Cell[] {
  const out: Cell[] = []
  for (let q = -RADIUS; q <= RADIUS; q++)
    for (let line = -2 * RADIUS; line <= 2 * RADIUS; line++)
      if ((q - line) % 2 === 0 && rings([q, line]) <= RADIUS) out.push([q, line])
  return out
}

/** The tiles and dressing: river and lake tiles from the water, lakeshore and sea coast, terraces. */
function dress(waters: Waterways): { tiles: LandPlacement[]; decor: LandPlacement[]; water: Spot[] } {
  const tiles: LandPlacement[] = []
  const decor: LandPlacement[] = []
  const water: Spot[] = []
  const river = new Map(waters.rivers.flatMap((reach) => reach.hexes).map((hex) => [key(hex.cell), hex]))
  const lake = new Set(waters.lakes.flatMap((l) => l.cells).map(key))
  const lakeLevel = new Map(waters.lakes.flatMap((l) => l.cells.map((cell) => [key(cell), l.level])))
  const nearWater = new Set(COURSE.flatMap((cell) => [cell, ...neighbours(cell)]).map(key))
  const springs = new Set(
    waters.rivers.flatMap(({ prev, hexes: [first] }) =>
      prev || !first ? [] : [key(step(first.cell, first.out + 3))],
    ),
  )

  for (const cell of cells()) {
    const level = levelOf(cell) ?? 0
    const [x, z] = cellToWorld(cell)
    const y = level * TERRACE
    const tile = (piece: LandPiece, m: number) =>
      tiles.push({ piece, x, z, rot: turn(m), ...(y ? { y } : {}) })
    for (let below = level - 2; below >= 0; below -= 2)
      tiles.push({ piece: "hex_grass", x, z, rot: turn(0), ...(below ? { y: below * TERRACE } : {}) })
    const hex = river.get(key(cell))
    if (lake.has(key(cell))) {
      tile("hex_water", 0)
      water.push([x, z])
      continue
    }
    if (hex) {
      // A spring's hex is a straight run (the pack has no dead-end river tile), rising at the foot
      // of the mountain behind it.
      const edges = hex.ins.length > 0 ? [...hex.ins, hex.out] : [hex.out, (hex.out + 3) % 6]
      const fitted = fit(PATH_TILES, edges)
      if (!fitted) throw new Error(`water lab: no river tile opens onto ${edges}`)
      tile(`hex_river_${fitted.tile}` as LandPiece, fitted.m)
      water.push([x, z])
      continue
    }
    // Shore: a lake's on its own level, the sea's at sea level.
    const wet = neighbours(cell).flatMap((next, dir) =>
      lakeLevel.get(key(next)) === level || (level === 0 && levelOf(next) === undefined) ? [dir] : [],
    )
    const coast = wet.length > 0 ? fit(COAST_TILES, wet) : undefined
    tile(coast ? (`hex_coast_${coast.tile}` as LandPiece) : "hex_grass", coast?.m ?? 0)
    if (springs.has(key(cell)))
      decor.push({ piece: "mountain_B_grass", x, z, rot: turn(1), ...(y ? { y } : {}) })
    if (coast || nearWater.has(key(cell))) continue
    // A little dressing, kept off the water's banks so the falls stay in view.
    const roll = noise(SEED, cell, "decor")
    const spin = turn(Math.floor(noise(SEED, cell, "spin") * 6))
    const piece: LandPiece | undefined =
      level === 3
        ? roll < 0.5
          ? "mountain_A_grass_trees"
          : roll < 0.8
            ? "mountain_B_grass"
            : "hills_A_trees"
        : roll < 0.3
          ? "trees_A_medium"
          : roll < 0.45
            ? "hills_B_trees"
            : roll < 0.6
              ? "tree_single_A"
              : undefined
    if (piece) decor.push({ piece, x, z, rot: spin, ...(y ? { y } : {}) })
  }
  return { tiles, decor, water }
}

/**
 * The patch as a World (world/world.ts), so the hall's own layers draw it under a WorldScope: the
 * Island batches its tiles, the Water bakes its sea's shore from them, the Atmosphere fogs its edge.
 */
export function patchWorld(waters: Waterways): World {
  const { tiles, decor, water } = dress(waters)
  const river = new Set(waters.rivers.flatMap((reach) => reach.hexes.map((hex) => key(hex.cell))))
  const lake = new Set(LAKE.map(key))
  return {
    kind: "repo",
    island: { tiles, decor, water, meadow: [], landmarks: [], fields: [] },
    roads: { nodes: {}, edges: [] },
    terrain: {
      at: (cell) =>
        levelOf(cell) === undefined ? "~" : lake.has(key(cell)) ? "o" : river.has(key(cell)) ? "r" : ".",
      level: (cell) => levelOf(cell) ?? 0,
      cells: () => cells().map(key),
    },
    sites: [],
    storySites: SITES,
  }
}
