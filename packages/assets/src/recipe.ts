/**
 * What a composed prefab draws: a flat list of placed pieces plus its sockets. No compose engine in M1;
 * the M2 composer produces these. Ported from the archive's Recipe without the tree, nav and stations.
 */
import { hash } from "@guildhall/core"
import type { Anchor } from "./compose.ts"

/** One placed piece: metres, `rot` in radians about +y. */
export interface RecipeInstance {
  /** A catalog id. */
  piece: string
  x: number
  y: number
  z: number
  rot: number
  scale: number
  /**
   * A lean before the turn: radians about the piece's own x, then its own z (Euler YXZ with `rot`), for
   * a piece stood on end or leaned (a bow in a rack). None: upright.
   */
  tilt?: [number, number]
  /** Swatch id → swatch id, a per-instance re-tint. */
  swatchMap?: Record<number, number>
  /** Ramp name → ramp name, tone for tone (ADR 008); what composers and NPC recipes author. */
  rampMap?: Record<string, string>
}

export interface Recipe {
  id: string
  seed: number
  instances: RecipeInstance[]
  /** Mount points in recipe space. */
  sockets: Anchor[]
}

/** A number as fixed text to 1e-2; -0 and tiny negatives print as 0. */
const num = (value: number): string => {
  const text = value.toFixed(2)
  return text === "-0.00" ? "0.00" : text
}

/**
 * A stable fingerprint of what a recipe draws: instances and sockets in order, a fixed field order,
 * numbers to 1e-2 (the archive's rule), swatch and ramp maps by sorted key. 8 hex digits.
 */
export function recipeHash(recipe: Recipe): string {
  const parts: string[] = [recipe.id, String(recipe.seed)]
  for (const i of recipe.instances) {
    const map = i.swatchMap ?? {}
    const swaps = Object.keys(map)
      .map(Number)
      .sort((a, b) => a - b)
      .map((from) => `${from}>${map[from]}`)
      .join(";")
    // Ramp maps are appended only when present, so recipes without one keep their pinned hashes.
    const ramps = Object.keys(i.rampMap ?? {})
      .sort()
      .map((from) => `${from}>${i.rampMap?.[from]}`)
      .join(";")
    const tail = ramps ? `,r:${ramps}` : ""
    parts.push(
      `i:${i.piece},${num(i.x)},${num(i.y)},${num(i.z)},${num(i.rot)},${num(i.scale)},${swaps}${tail}`,
    )
  }
  for (const s of recipe.sockets) {
    const [x, y, z] = s.at
    parts.push(`k:${s.id},${s.kind},${num(x)},${num(y)},${num(z)},${num(s.facing)}`)
  }
  return hash(parts.join("|")).toString(16).padStart(8, "0")
}
