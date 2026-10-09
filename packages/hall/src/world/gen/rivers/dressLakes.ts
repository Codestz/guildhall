import { type Cell, cellToWorld, type LandPiece, type LandPlacement } from "../../lands.ts"
import { TERRACE, type Waterways } from "../../waterways.ts"
import { key, neighbours, noise } from "../hex.ts"
import { COAST_TILES, fit, turn } from "../tiles.ts"

/**
 * The valley lakes' hexes, tiled: the kit's water tile on the lake's level for each hex of the lake,
 * and a ring of lakeshore (coast) tiles turned to the water, with a filler every two levels beneath
 * each, and reeds on the shore and lilies on the water from the kit's own water plants. Under a
 * massif the relief is the shore (it stands above the water: rivers/lakes.ts checks), so it is left
 * as it is.
 */

export interface LakeDress {
  tiles: LandPlacement[]
  decor: LandPlacement[]
  /** The lake hexes' centres: the island's water list. */
  water: [number, number][]
  /** Every hex the lake takes the ground of (water and shore tiles): what stood there is taken away. */
  taken: Set<string>
}

const REEDS = ["waterplant_A", "waterplant_B", "waterplant_C"] as const
const LILIES = ["waterlily_A", "waterlily_B"] as const

export function dressLakes(waters: Waterways, massif: ReadonlySet<string>): LakeDress {
  const out: LakeDress = { tiles: [], decor: [], water: [], taken: new Set() }
  for (const lake of waters.lakes) {
    const y = lake.level * TERRACE
    const raised = y ? { y } : {}
    const lay = (piece: LandPiece, cell: Cell, m = 0) => {
      const [x, z] = cellToWorld(cell)
      out.tiles.push({ piece, x, z, rot: turn(m), ...raised })
      for (let below = lake.level - 2; below >= 0; below -= 2)
        out.tiles.push({ piece: "hex_grass", x, z, rot: turn(0), ...(below ? { y: below * TERRACE } : {}) })
    }
    const wet = new Set(lake.cells.map(key))
    for (const cell of lake.cells) {
      out.taken.add(key(cell))
      lay("hex_water", cell)
      const [x, z] = cellToWorld(cell)
      out.water.push([x, z])
      const n = noise(0, cell, "lily")
      if (n < 0.7) out.decor.push(plant(LILIES, cell, n / 0.7, 2.6, raised))
    }
    for (const cell of lake.shore) {
      out.taken.add(key(cell))
      if (massif.has(key(cell))) continue
      const edges = neighbours(cell).flatMap((n, dir) => (wet.has(key(n)) ? [dir] : []))
      const coast = fit(COAST_TILES, edges)
      if (!coast) throw new Error(`lakeshore at ${key(cell)}: no tile opens onto ${edges}`)
      lay(`hex_coast_${coast.tile}` as LandPiece, cell, coast.m)
      // Reeds stand at the water's edge: on the first wet side, set back toward the middle of the shore tile.
      const n = noise(0, cell, "reed")
      if (n < 0.6) out.decor.push(reed(cell, edges[0] ?? 0, n / 0.6, raised))
    }
  }
  return out
}

/** One of `pieces` at a spot in `cell` `reach` from its centre, turned by the cell's own noise. */
function plant(
  pieces: readonly LandPiece[],
  cell: Cell,
  roll: number,
  reach: number,
  raised: { y?: number },
): LandPlacement {
  const [x, z] = cellToWorld(cell)
  const angle = noise(0, cell, "angle") * Math.PI * 2
  return {
    piece: pieces[Math.floor(roll * pieces.length)] as LandPiece,
    x: Math.round((x + Math.cos(angle) * reach) * 100) / 100,
    z: Math.round((z + Math.sin(angle) * reach) * 100) / 100,
    rot: noise(0, cell, "turn") * Math.PI * 2,
    ...raised,
  }
}

/** Reeds on a shore hex, toward its wet side `dir`. */
function reed(cell: Cell, dir: number, roll: number, raised: { y?: number }): LandPlacement {
  const [x, z] = cellToWorld(cell)
  const [nx, nz] = cellToWorld(neighbours(cell)[dir] as Cell)
  return {
    piece: REEDS[Math.floor(roll * REEDS.length)] as LandPiece,
    x: Math.round((x + (nx - x) * 0.32) * 100) / 100,
    z: Math.round((z + (nz - z) * 0.32) * 100) / 100,
    rot: noise(0, cell, "turn") * Math.PI * 2,
    ...raised,
  }
}
