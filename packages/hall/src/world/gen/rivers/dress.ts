import { cellToWorld, type Island, type LandPiece, type LandPlacement } from "../../lands.ts"
import { TERRACE, type Waterways } from "../../waterways.ts"
import { cellAt, key } from "../hex.ts"
import { fit, PATH_TILES, turn } from "../tiles.ts"

/**
 * The rivers' hexes in the lowland, tiled: where a river runs outside the massifs its hex gets the
 * kit's river tile (fitted to the edges the water comes in and goes out by, as the water lab does),
 * on its level's terrace, with a filler every two levels beneath. A river hex that was a straight
 * road gets a bridge over it, spanning along the road. Whatever stood on the hex (its old tile,
 * trees, grass, fields) is taken away. The massifs' river hexes are not here: the relief is carved
 * (rivers/carve.ts) and draws its own.
 */

const at = (x: number, z: number): string => key(cellAt([x, z]))

/** The island with its lowland river hexes tiled; `bridges` maps a crossable road hex to its axis (0–2). */
export function dressRivers(
  island: Island,
  waters: Waterways,
  massif: ReadonlySet<string>,
  bridges: ReadonlyMap<string, number>,
): Island {
  const hexes = waters.rivers.flatMap((reach) => reach.hexes).filter((hex) => !massif.has(key(hex.cell)))
  if (hexes.length === 0) return island
  const wet = new Set(hexes.map((hex) => key(hex.cell)))
  const tiles: LandPlacement[] = island.tiles.filter((t) => !wet.has(at(t.x, t.z)))
  const decor: LandPlacement[] = island.decor.filter((d) => !wet.has(at(d.x, d.z)))
  const water = [...island.water]
  for (const hex of hexes) {
    const [x, z] = cellToWorld(hex.cell)
    const y = hex.level * TERRACE
    // A spring's hex is a straight run: the pack has no dead-end river tile.
    const edges = hex.ins.length > 0 ? [...hex.ins, hex.out] : [hex.out, (hex.out + 3) % 6]
    const fitted = fit(PATH_TILES, edges)
    if (!fitted) throw new Error(`river at ${key(hex.cell)}: no tile opens onto ${edges}`)
    tiles.push({
      piece: `hex_river_${fitted.tile}` as LandPiece,
      x,
      z,
      rot: turn(fitted.m),
      ...(y ? { y } : {}),
    })
    for (let below = hex.level - 2; below >= 0; below -= 2)
      tiles.push({ piece: "hex_grass", x, z, rot: turn(0), ...(below ? { y: below * TERRACE } : {}) })
    water.push([x, z])
    const axis = bridges.get(key(hex.cell))
    // The bridge's length runs along its model's z; turned so it lies along the road's axis.
    if (axis !== undefined)
      decor.push({ piece: "building_bridge_A", x, z, rot: ((1 - axis) * Math.PI) / 3, ...(y ? { y } : {}) })
  }
  return {
    ...island,
    tiles,
    decor,
    water,
    meadow: island.meadow.filter(([x, z]) => !wet.has(at(x, z))),
    fields: island.fields.filter((f) => !wet.has(at(f.x, f.z))),
  }
}
