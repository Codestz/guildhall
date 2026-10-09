import type { KitColour } from "../gen/biomes.ts"
import { HEX_SCALE, PIECES } from "../lands.ts"
import { type Prefab, pieceOf } from "./types.ts"
import { resolve } from "./variants.ts"

/**
 * What a prefab costs and holds, for the lab's inspector (lab/prefabInspector.ts): its parts, doors
 * and fixtures, size, triangles and draw calls, as one seed's variant of it. Pure: what the pieces
 * weigh comes from the caller (the lab reads it off the loaded pack), where they stand from the data.
 */

/** One piece as loaded: triangles, geometry bytes, meshes (draw calls unbatched) and its material. */
export interface PieceInfo {
  tris: number
  bytes: number
  meshes: number
  material: string
}

export interface Stats {
  id: string
  label: string
  kind: string
  rings: number
  /** Hexes the footprint covers: 1, 7 or 19. */
  hexes: number
  houses: number
  /** Pieces by name and how many stand, most first. */
  parts: { piece: string; count: number }[]
  doors: number
  windows: number
  chimneys: number
  /** Width, height, depth in world units, and how far the farthest corner reaches from the anchor. */
  size: [number, number, number]
  reach: number
  tris: number
  /** Draw calls drawn piece by piece, and as the island draws it (one batch per material). */
  draws: { loose: number; batched: number }
  /** Geometry of the distinct pieces, in memory. */
  bytes: number
  /** Pieces no one measured (a name the pack lacks): worth a look when it is not 0. */
  unknown: number
}

const round = (value: number): number => Math.round(value * 10) / 10

export function statsOf(
  prefab: Prefab,
  seed: number,
  kit: KitColour,
  info: (piece: string) => PieceInfo | undefined,
): Stats {
  const made = resolve(prefab, seed, kit)
  const counts = new Map<string, number>()
  const lo = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]
  const hi = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY]
  let reach = 0
  for (const part of made.parts) {
    const name = pieceOf(part.piece, made.kit)
    counts.set(name, (counts.get(name) ?? 0) + 1)
    const box = PIECES[name]
    if (!box) continue
    const k = HEX_SCALE * (part.scale ?? 1)
    const [sin, cos] = [Math.sin(part.rot ?? 0), Math.cos(part.rot ?? 0)]
    for (const cx of [box.min[0] ?? 0, box.max[0] ?? 0])
      for (const cz of [box.min[2] ?? 0, box.max[2] ?? 0]) {
        const [lx, lz] = [cx * k, cz * k]
        const x = part.x + lx * cos + lz * sin
        const z = part.z - lx * sin + lz * cos
        lo[0] = Math.min(lo[0] ?? x, x)
        hi[0] = Math.max(hi[0] ?? x, x)
        lo[2] = Math.min(lo[2] ?? z, z)
        hi[2] = Math.max(hi[2] ?? z, z)
        reach = Math.max(reach, Math.hypot(x, z))
      }
    lo[1] = Math.min(lo[1] ?? 0, (part.y ?? 0) + (box.min[1] ?? 0) * k)
    hi[1] = Math.max(hi[1] ?? 0, (part.y ?? 0) + (box.max[1] ?? 0) * k)
  }
  let tris = 0
  let loose = 0
  let unknown = 0
  const materials = new Set<string>()
  const distinct = new Map<string, PieceInfo>()
  for (const [piece, count] of counts) {
    const loaded = info(piece)
    if (!loaded) {
      unknown += count
      continue
    }
    tris += loaded.tris * count
    loose += loaded.meshes * count
    materials.add(loaded.material)
    distinct.set(piece, loaded)
  }
  const span = (axis: number): number => round(Math.max(0, (hi[axis] ?? 0) - (lo[axis] ?? 0)))
  return {
    id: prefab.id,
    label: prefab.label,
    kind: prefab.kind,
    rings: prefab.rings,
    hexes: [1, 7, 19][prefab.rings] ?? 1,
    houses: prefab.houses ?? 0,
    parts: [...counts].map(([piece, count]) => ({ piece, count })).sort((a, b) => b.count - a.count),
    doors: prefab.doors.length,
    windows: prefab.windows?.length ?? 0,
    chimneys: prefab.chimneys?.length ?? 0,
    size: [span(0), span(1), span(2)],
    reach: round(reach),
    tris,
    draws: { loose, batched: materials.size },
    bytes: [...distinct.values()].reduce((sum, piece) => sum + piece.bytes, 0),
    unknown,
  }
}
