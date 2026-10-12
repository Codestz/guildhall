import type { LandPlacement } from "../lands.ts"
import { roleOf } from "./growthPieces.ts"
import type { Kind } from "./growthStages.ts"

/**
 * The second town kit's buildings, for the growth film (ADR 0021), pure. A gen 2 prefab
 * (world/prefabs/town2.ts) is many placements (wall panels, roof modules, a tower's stacked
 * pieces), not one piece like the hex pack's homes, and the film builds a building, not a pile of
 * panels: the pieces of one building (the `t2_` ones, linked when close and on one hex) are
 * gathered here, and growthBuild.ts schedules them as one.
 *
 *   level 0   the ground floor (wall panels, a tower's base): the building's own kind, rising together
 *   above     roofs, chimneys, a tower's upper pieces: pop in order once the walls are up
 *
 * What kind it is, from what it holds: a gate bridge's gatehouse is a gate; a hexagon tower
 * (a windmill's, the harbour light) a tower; a chapel (a bell tower or a high roof) and a plain
 * windowless shed (warehouse, stable) a hall; the rest, windowed, a house.
 */

/** Pieces closer than this (world units) belong to one building (a wall panel is 3 across). */
const LINK = 4.6

export interface Town2Building {
  kind: Kind
  /** The piece standing for the building in its lot (the first of the ground floor). */
  lead: LandPlacement
  /** Every piece of it, the lead too, with how many storeys up it stands (0: the ground floor). */
  parts: { piece: LandPlacement; level: number }[]
}

/** Whether `piece` is one of a second-kit building's parts (its walls, roofs and towers). */
export const isTown2Part = (piece: string): boolean => piece.startsWith("t2_") && roleOf(piece) === "build"

function kindOf(names: readonly string[]): Kind {
  const has = (re: RegExp): boolean => names.some((n) => re.test(n))
  if (has(/c_wall_narrow_gate/)) return "gate"
  if (has(/c_tower_hexagon/)) return "tower"
  if (has(/roof_high_gable|c_tower_square/) || !has(/window/)) return "hall"
  return "house"
}

const apart = (a: LandPlacement, b: LandPlacement): number => Math.hypot(a.x - b.x, a.z - b.z)

/** The second kit's buildings among `decor`, pieces gathered by `hexOf` (a piece's hex) and closeness. */
export function town2Buildings(
  decor: readonly LandPlacement[],
  hexOf: (p: LandPlacement) => number,
): Town2Building[] {
  const byHex = new Map<number, LandPlacement[]>()
  for (const p of decor) {
    if (!isTown2Part(p.piece)) continue
    const h = hexOf(p)
    byHex.set(h, [...(byHex.get(h) ?? []), p])
  }
  const out: Town2Building[] = []
  for (const list of byHex.values()) {
    list.sort((a, b) => a.z - b.z || a.x - b.x)
    const seen = new Set<LandPlacement>()
    for (const first of list) {
      if (seen.has(first)) continue
      const group = [first]
      seen.add(first)
      for (let i = 0; i < group.length; i++)
        for (const q of list)
          if (!seen.has(q) && apart(q, group[i] as LandPlacement) <= LINK) {
            seen.add(q)
            group.push(q)
          }
      const storeys = [...new Set(group.map((p) => Math.round(p.y ?? 0)))].sort((a, b) => a - b)
      const parts = group.map((piece) => ({ piece, level: storeys.indexOf(Math.round(piece.y ?? 0)) }))
      const lead = parts.find((part) => part.level === 0)?.piece ?? first
      out.push({ kind: kindOf(group.map((p) => p.piece)), lead, parts })
    }
  }
  return out
}
