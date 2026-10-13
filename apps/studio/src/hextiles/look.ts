/** How the tile gallery draws a tile: its ground's colours, its paths, the scale figure, the turn toward the camera. */
import { HEX_TILE_SIZE, type TileGround, type TilePrefab, worldSide } from "@guildhall/world"

export const GROUND: Record<TileGround, [number, number, number]> = {
  grass: [143, 195, 86],
  soil: [150, 112, 70],
  dirt: [196, 160, 108],
  paved: [196, 186, 166],
  sand: [232, 210, 150],
  rock: [150, 140, 128],
  water: [79, 154, 214],
}
export const SIDE: [number, number, number] = [122, 90, 60]
/** Stands beside every tile for scale (CHARACTER_SCALE: a door's height). */
export const CHARACTER = "kaykit-adventurers/knight"
/** Every tile turned as the island turns one fronting world side FACE (world.ts rotOf), toward the camera. */
export const FACE = 5
export const TURN = (Math.PI / 180) * (90 + 60 * FACE)

/**
 * A road tile's dirt paths (triangles into `paths`) for a tile at (x, z) turned by TURN: a strip from
 * the centre out through each side the tile names (world side d's middle at 60°·d), a round patch where
 * they meet.
 */
export function pathStrips(t: TilePrefab, x: number, z: number, paths: number[]): void {
  if (!t.path) return
  const y = 0.53
  const w = 0.85
  const reach = HEX_TILE_SIZE * (Math.sqrt(3) / 2) + 0.05
  for (const d of t.path.map((k) => worldSide(k, FACE))) {
    const a = (Math.PI / 180) * (60 * d)
    const ex = Math.cos(a) * reach
    const ez = -Math.sin(a) * reach
    const nx = -ez / reach
    const nz = ex / reach
    const q = [
      [x + nx * w, z + nz * w],
      [x - nx * w, z - nz * w],
      [x + ex - nx * w, z + ez - nz * w],
      [x + ex + nx * w, z + ez + nz * w],
    ] as const
    for (const [a0, b0, c0] of [
      [0, 2, 1],
      [0, 3, 2],
      [0, 1, 2],
      [0, 2, 3],
    ] as const)
      paths.push(q[a0][0], y, q[a0][1], q[b0][0], y, q[b0][1], q[c0][0], y, q[c0][1])
  }
  for (let k = 0; k < 8; k++) {
    const a0 = (k / 8) * Math.PI * 2
    const a1 = ((k + 1) / 8) * Math.PI * 2
    const p0 = [x + Math.cos(a0) * w, y, z + Math.sin(a0) * w] as const
    const p1 = [x + Math.cos(a1) * w, y, z + Math.sin(a1) * w] as const
    paths.push(x, y, z, ...p1, ...p0)
    paths.push(x, y, z, ...p0, ...p1)
  }
}
