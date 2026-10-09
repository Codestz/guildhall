import { HEX_SCALE, type LandPiece, PIECES } from "../../lands.ts"
import { orient, type Tilt } from "../../tilt.ts"
import type { Context, Spot } from "./outcrops.ts"

/**
 * The kit's rocks and crags lying along the peak's cliffs: each piece is tipped onto the face's own
 * normal (LandPlacement.tilt) and sunk until the whole of its base is under the ground, so it reads
 * as rock outcropping from the face rather than a boulder standing against it. Only above the top
 * ledge, where the mesh is the grid (below it the stairs' risers are not the grid's ramps).
 */

const ROCKS = ["rock_single_B", "rock_single_C", "rock_single_D", "rock_single_E"] as const
const CRAGS = ["mountain_A", "mountain_B", "mountain_C"] as const
/** A face this steep (rise over run, 27 degrees) or steeper takes them. */
const FACE = 0.5
/** The most a piece tips from upright (rad): on a sheer wall it sticks out of the face at this much. */
const MOST_TIP = 1
/** Crags stand below this share of the massif's height (above it the snow would show them black). */
const CRAG_BELOW = 0.62
/** The base is the disc this share of the piece's width across (its rock is rounder than its box), and sinks this share of its radius. */
export const BASE_REACH = 0.3
const SINK = 0.15
/** The origin lies at least this far under the ground at the piece's centre, world units. */
const SET = 0.6
/** The normal is read from the ground this far round a spot. */
const SPAN = 1.5
/** A piece's crown stands at least this far above the ground at its centre, world units. */
const CLEAR = 0.5

export interface Crag {
  piece: LandPiece
  x: number
  z: number
  y: number
  rot: number
  scale: number
  tilt: Tilt
}

/** The points of a piece's base (its centre and a ring) in world space: `place`'s origin, tilt and yaw carry them. */
export function baseOf(
  piece: LandPiece,
  scale: number,
  rot: number,
  tilt: Tilt,
  [x, y, z]: readonly [number, number, number],
): [number, number, number][] {
  const [width, , depth] = PIECES[piece].size as [number, number, number]
  const k = HEX_SCALE * scale
  const spots: [number, number, number][] = [[0, 0, 0]]
  for (let a = 0; a < 8; a++)
    spots.push([
      Math.cos(a * 0.785) * BASE_REACH * width * k,
      0,
      Math.sin(a * 0.785) * BASE_REACH * depth * k,
    ])
  return spots.map((spot) => {
    const [dx, dy, dz] = orient(spot, rot, tilt)
    return [x + dx, y + dy, z + dz]
  })
}

/** A cliff piece for one spot of the peak, or undefined where the face is too gentle, not on the peak, or edges off the massif. */
export function cragAt(spot: Spot, { ground, height, ledgeTop, random }: Context): Crag | undefined {
  const { x, z, h } = spot
  const share = h / height
  if (h <= ledgeTop + 1 || ground.grade(x, z, h) < FACE || random() > 0.45) return undefined
  const slope = (dx: number, dz: number): number | undefined => {
    const [a, b] = [ground.heightAt(x + dx, z + dz), ground.heightAt(x - dx, z - dz)]
    return a === undefined || b === undefined ? undefined : (a - b) / (2 * SPAN)
  }
  const [gx, gz] = [slope(SPAN, 0), slope(0, SPAN)]
  if (gx === undefined || gz === undefined) return undefined
  // The normal (-gx, 1, -gz) normalised; its horizontal part, held to the most a piece may tip.
  const flat = Math.hypot(gx, gz)
  if (flat < 0.2) return undefined
  const tip = Math.min(MOST_TIP, Math.atan(flat))
  const tilt: Tilt = [(-gx / flat) * Math.sin(tip), (-gz / flat) * Math.sin(tip)]
  const crag = share < CRAG_BELOW && random() < 0.25
  const piece = (crag ? CRAGS : ROCKS)[Math.floor(random() * (crag ? CRAGS : ROCKS).length)] as LandPiece
  const scale = crag ? 0.35 + 0.3 * random() : 1.6 + 1.6 * share + random()
  const rot = random() * Math.PI * 2
  // Sunk until every point of the base is at or under the ground, then a share of the piece's radius more.
  const [width, , depth] = PIECES[piece].size as [number, number, number]
  let y = Number.POSITIVE_INFINITY
  for (const [px, py, pz] of baseOf(piece, scale, rot, tilt, [x, 0, z])) {
    const under = ground.heightAt(px, pz)
    if (under === undefined) return undefined
    y = Math.min(y, under - py)
  }
  // Sunk a little more, and never less than a hand's depth at its centre: it is set into the rock.
  y = Math.min(y, h - SET) - SINK * 0.5 * Math.max(width, depth) * HEX_SCALE * scale
  // It must stand out of the face: its crown clear of the ground over its centre, or it is only a bump in the rock.
  const [, tall] = PIECES[piece].size as [number, number, number]
  const crown = orient([0, tall * HEX_SCALE * scale, 0], rot, tilt)[1]
  if (y + crown < h + CLEAR) return undefined
  return { piece, x, z, y, rot, scale, tilt }
}
