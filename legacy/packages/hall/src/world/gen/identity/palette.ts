import { type LandPlacement, PIECES } from "../../lands.ts"
import type { KitColour } from "../biomes.ts"
import { hash } from "../hex.ts"
import type { Palette } from "./types.ts"

/**
 * An island's colours: the pack's team colours only (its roofs, its banners), picked so the islands
 * of one sea differ: the core's blue, then each next island a different roof from the last. A
 * palette is a set, not a rule: most of an island's coloured pieces take its roof colour, some its
 * accent, a few keep the colour the district's language gave them, so a town is not one colour.
 */

const ROOFS: readonly KitColour[] = ["blue", "red", "green", "yellow"]

/**
 * Twelve palettes: each roof colour with each other as its accent. Ordered so that consecutive ones
 * never share a roof colour (a ring of four) nor, from one lap to the next, an accent.
 */
export const PALETTES: readonly Palette[] = ROOFS.flatMap((_, lap) =>
  ROOFS.map((roof, n): Palette => {
    const accent = ROOFS[(ROOFS.indexOf(roof) + 1 + ((lap + n) % 3)) % 4] as KitColour
    return {
      id: lap * 4 + n,
      roof,
      accent,
      // A banner the roof does not already say: red under blue and green, blue under red, yellow under green.
      flag: roof === "blue" ? "red" : roof === "red" ? "blue" : roof === "green" ? "yellow" : "blue",
    }
  }),
).slice(0, 12)

/** The palette in slot `slot` of an archipelago's, or a lone island's by its seed. */
export function paletteOf(seed: number, slot?: number): Palette {
  return PALETTES[
    slot === undefined ? hash(`palette:${seed}`) % PALETTES.length : slot % PALETTES.length
  ] as Palette
}

/**
 * The palette slot of each island (in the order given; the core, first, has the first), so that
 * islands bound to each other differ: the most bound go first (a hub is coloured before the
 * packages round it), each taking the slot whose roof (and then whose accent) its stronger bonds to
 * those coloured already do not wear, the least used colours first. `bond` is how bound two are
 * (0..1). Deterministic: the lowest slot on a tie.
 */
export function slotsOf(ids: readonly string[], bond: (a: string, b: string) => number): number[] {
  const strength = ids.map((id) => ids.reduce((sum, other) => sum + (other === id ? 0 : bond(id, other)), 0))
  const order = ids
    .map((_, i) => i)
    .sort((a, b) => (a === 0 ? -1 : b === 0 ? 1 : (strength[b] as number) - (strength[a] as number) || a - b))
  const out: number[] = ids.map(() => -1)
  const roofs = new Map<string, number>()
  for (const i of order) {
    const near = ids
      .map((other, j) => ({ slot: out[j] as number, weight: j === i ? 0 : bond(ids[i] as string, other) }))
      .filter((n) => n.slot >= 0 && n.weight > 0)
    let best = 0
    let cost = Number.POSITIVE_INFINITY
    PALETTES.forEach((palette, slot) => {
      const clash = near.reduce((sum, n) => {
        const there = PALETTES[n.slot] as Palette
        return sum + (there.roof === palette.roof ? 10 * n.weight : 0) + (n.slot === slot ? 4 * n.weight : 0)
      }, 0)
      const total = clash + 0.1 * (roofs.get(palette.roof) ?? 0)
      if (total < cost - 1e-9) {
        cost = total
        best = slot
      }
    })
    out[i] = i === 0 ? 0 : best
    const roof = (PALETTES[out[i] as number] as Palette).roof
    roofs.set(roof, (roofs.get(roof) ?? 0) + 1)
  }
  return out
}
/** The share of coloured pieces that take the roof colour, and then the accent; the rest keep their own. */
const ROOF_SHARE = 0.62
const ACCENT_SHARE = 0.28

/** What the pack makes in more than one colour and a palette may turn: the homes (in all four) and the banners. */
const COLOURED = /^(building_home_[AB]|flag)_(blue|red|green|yellow)$/
const pieces = PIECES as Record<string, unknown>

/** The piece in the palette's colours, or the same piece where the pack has no such colour of it. */
export function paintedOf(piece: string, palette: Palette, x: number, z: number): string {
  const found = COLOURED.exec(piece)
  if (!found) return piece
  const [, base, colour] = found as unknown as [string, string, string]
  let wanted: string
  if (base === "flag") wanted = palette.flag
  else {
    const roll = (hash(`${x},${z}`) % 1000) / 1000
    wanted = roll < ROOF_SHARE ? palette.roof : roll < ROOF_SHARE + ACCENT_SHARE ? palette.accent : colour
  }
  const next = `${base}_${wanted}`
  return next in pieces ? next : piece
}

/**
 * The placements painted in a palette's colours (the same ones, where nothing changes); `fixed` are
 * left as they are (a venue's main building is found in the decor by its piece, world/world.ts).
 */
export function painted(
  placements: readonly LandPlacement[],
  palette: Palette,
  fixed: ReadonlySet<LandPlacement> = new Set(),
): LandPlacement[] {
  return placements.map((item) => {
    if (fixed.has(item)) return item
    const piece = paintedOf(item.piece, palette, item.x, item.z)
    return piece === item.piece ? item : { ...item, piece: piece as LandPlacement["piece"] }
  })
}
