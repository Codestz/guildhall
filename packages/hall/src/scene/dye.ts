import type { Rank } from "@guildhall/roster"
import { Color } from "three"

/**
 * A cape's dye by rank (roster ranks.ts): an apprentice wears the archetype's colour as everyone
 * always did; a journeyman's is a deeper dye, a master's deeper still. Fed to the tint every figure
 * already has (Adventurer's cape clone, the crowd's per-member tint): no new material, no draw.
 */
const DEEPEN: Readonly<Record<Rank, number>> = { apprentice: 0, journeyman: 0.22, master: 0.4 }
const BLACK = new Color("#000000")

export function dyeOf(color: string, rank: Rank): string {
  if (DEEPEN[rank] === 0) return color
  return `#${new Color(color).lerp(BLACK, DEEPEN[rank]).getHexString()}`
}
