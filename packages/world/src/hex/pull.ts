/**
 * Ways pulled taut (decisions.md "one collision truth"): a walk's corners it can do without are dropped,
 * so it goes straight where it can instead of zig-zagging from lane to lane, round a corner by the inside
 * and across a square or a green between two streets, never through what stands in the way and only over
 * open, dry, level ground (`openGround`): no crops, no water, no step off a terrace, no house's plot.
 *
 *   openGround   the ground a shortcut may cross: a street, a square, a court, a yard, a garden, a market
 *                or a well's square, a meadow, a pasture, an orchard or a grove, a hillside, a beach; dry,
 *                not bare rock. Its height where it is (the tile's top), null elsewhere.
 *   pullWay      the corners of a way dropped while the straight line between the ones kept stays on that
 *                ground at the way's own height, cuts no wall or house (what its ends stand in aside), brushes
 *                no prop (a body's room off it) and runs through no one's place (a spot someone stands at),
 *                on the ground (a deck's or a flight's corners are kept).
 */
import { hexAt } from "./grid.ts"
import { type HexIsland, kindOf } from "./island.ts"
import { HEX_TILE_SIZE } from "./tiles.ts"
import { type HexZones, type TileUse, useOf } from "./zones.ts"

/** Tile uses a shortcut may cross: open ground people walk over (not a field's crops, not a house's plot). */
const OPEN_USES: ReadonlySet<TileUse> = new Set<TileUse>([
  "none",
  "road",
  "square",
  "court",
  "yard",
  "garden",
  "market",
  "well",
  "meadow",
  "pasture",
  "orchard",
  "grove",
  "hillside",
  "beach",
])
/** Ground kinds nobody crosses off a walkway: water, bare rock, a cliff's face. */
const CLOSED_KINDS = new Set(["sea", "shallows", "lake", "river", "rock", "cliff"])

/** Whether tile `i` is open ground a shortcut may cross. */
export function openTile(h: HexIsland, z: HexZones, i: number): boolean {
  return i >= 0 && !CLOSED_KINDS.has(kindOf(h, i)) && OPEN_USES.has(useOf(z, i))
}

/**
 * The open ground's height at a point (its tile's level, as `level`: one number per tile, so a step between
 * two tiles reads as one), or null where no shortcut goes (water, rock, a field, a house's plot, off the
 * island).
 */
export function openGround(h: HexIsland, z: HexZones): (x: number, z: number) => number | null {
  const g = h.grid
  return (x, zz) => {
    const { q, r } = hexAt(x / HEX_TILE_SIZE, zz / HEX_TILE_SIZE)
    const i = g.index(q, r)
    return openTile(h, z, i) ? h.level[i]! : null
  }
}
