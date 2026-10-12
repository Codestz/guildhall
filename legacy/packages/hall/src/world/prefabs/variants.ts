import type { KitColour } from "../gen/biomes.ts"
import { hash } from "../gen/hex.ts"
import type { Door, Part, Prefab } from "./types.ts"

/**
 * A prefab as one seed makes it (types.ts `Variation`): the colour its `{kit}` parts take, whether
 * the layout is flipped, which props stand and which pieces were swapped. Pure and deterministic:
 * a seed's variant is the same wherever and whenever it is asked, and seed 0 is the plain prefab.
 */

export const KITS: readonly KitColour[] = ["blue", "red", "yellow", "green"]

/** A number in [0, 1) from a seed and what is being drawn (each choice has its own salt). */
export const roll = (seed: number, salt: string): number => hash(`${seed}:${salt}`) / 4294967296

export interface Resolved {
  /** The colour the `{kit}` parts take. */
  kit: KitColour
  mirrored: boolean
  /** The pieces the seed swapped, as `from → to`. */
  swapped: string[]
  /** The parts that stand: the prefab's own (swapped, mirrored) and the props the seed let in. */
  parts: Part[]
  doors: Door[]
}

/** The share of tinted prefabs that keep their district's colour; the rest draw from all four. */
const KEEP_KIT = 0.5

/** The prefab with `seed`'s choices made; `kit` is the district's colour. Seed 0 changes nothing. */
export function resolve(prefab: Prefab, seed: number, kit: KitColour): Resolved {
  const how = seed === 0 ? undefined : prefab.variation
  const mirrored = how?.mirror === true && roll(seed, "mirror") < 0.5
  const flip = (x: number): number => (mirrored ? -x : x)
  const swapped: string[] = []
  const place = (part: Part): Part => {
    const options = how?.swaps?.[part.piece]
    const pick = options?.[Math.floor(roll(seed, `swap:${part.piece}`) * (options.length + 1))]
    if (pick) swapped.push(`${part.piece} → ${pick}`)
    return {
      ...part,
      piece: pick ?? part.piece,
      x: flip(part.x),
      ...(part.rot ? { rot: flip(part.rot) } : {}),
    }
  }
  const props = (how?.props ?? []).filter((prop, n) => roll(seed, `prop:${n}`) < (prop.chance ?? 0.5))
  return {
    kit:
      how?.tint && roll(seed, "tint") >= KEEP_KIT
        ? (KITS[Math.floor(roll(seed, "colour") * KITS.length)] ?? kit)
        : kit,
    mirrored,
    swapped,
    parts: [...prefab.parts.map(place), ...props.map(place)],
    doors: prefab.doors.map((door) => ({ ...door, x: flip(door.x), rot: flip(door.rot) })),
  }
}
