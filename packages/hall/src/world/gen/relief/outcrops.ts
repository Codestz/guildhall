import { HEX_SCALE, type LandPiece, PIECES } from "../../lands.ts"
import type { Ground } from "./ground.ts"
import { fitRock } from "./rockSize.ts"

/**
 * The kit's own rocks laid on the mountain, so the close-up is hand-made: boulders on the lip of a
 * ledge, scree at a riser's foot, and clusters of rocks and the odd `mountain_*` crag embedded in
 * the steep faces of the peak. A piece is set on the ground's lowest point under it and sunk into
 * the slope by a share of its own height, so the downhill edge rests on the face and the uphill side
 * is buried in it, as a rock in a cliff is, rather than floating off it (the placements turn only
 * about the vertical, so sinking is how a rock is aligned to the slope).
 */

const ROCKS = ["rock_single_B", "rock_single_C", "rock_single_D", "rock_single_E"] as const
const CRAGS = ["mountain_A", "mountain_B", "mountain_C"] as const
/** A rock sits on ground between these grades (rise over run, 8 to 25 degrees): flat enough to rest on, tilted enough to be a slope's. */
const ROCKY = 0.15
const STEEPEST = 0.47
/** A crag, which is sunk deep and pointed, stands on steeper ground up to this. */
const CRAGGY = 0.3
const CRAG_STEEPEST = 0.9
/** Crags stand below this share of the massif's height (above it the snow would show them black). */
const CRAG_BELOW = 0.62

export interface Outcrop {
  piece: LandPiece
  x: number
  z: number
  /** The base's height: the ground under it, sunk. */
  y: number
  scale: number
}

/** A spot on a hex: where, and the ground's height there. */
export interface Spot {
  x: number
  z: number
  h: number
}

export interface Context {
  ground: Ground
  height: number
  ledgeTop: number
  random: () => number
}

const pick = <T>(list: readonly T[], random: () => number): T => list[Math.floor(random() * list.length)] as T

/** A piece of about `size` (held to a house and a half across) set on the ground at a spot, sunk by a `sink` share of its height so its downhill edge meets the ground. */
function setRock(
  piece: LandPiece,
  spot: Spot,
  size: number,
  sink: number,
  ground: Ground,
  slope = true,
): Outcrop {
  // Bigger higher up, but never more than a house and a half across (rockSize.ts).
  const scale = fitRock(piece, size)
  const [width, tall] = [PIECES[piece].size[0] as number, PIECES[piece].size[1] as number]
  // On a slope the base reaches down to the lowest ground under it; on a flat ledge top it is the top.
  const floor = slope ? ground.floorAt(spot.x, spot.z, spot.h, 0.5 * width * HEX_SCALE * scale) : spot.h
  return { piece, x: spot.x, z: spot.z, y: floor - sink * tall * HEX_SCALE * scale, scale }
}

/** The outcrops one random spot of a hex asks for (none, usually). */
export function outcropsAt(spot: Spot, { ground, height, ledgeTop, random }: Context): Outcrop[] {
  const { x, z, h } = spot
  const share = h / height
  const luck = random()
  const out: Outcrop[] = []
  if (share < 0.12) return out
  if (h <= ledgeTop + 0.01) {
    // The stairs: a boulder on a ledge's lip, scree at a riser's foot; flat ground only.
    if (!ground.flatAt(x, z, h)) return out
    if (ground.lipAt(x, z, h) && luck < 0.6)
      out.push(setRock(pick(ROCKS, random), spot, 0.7 + 0.6 * random(), 0.08, ground, false))
    else if (ground.footAt(x, z, h) && luck < 0.45 + 0.3 * share)
      out.push(setRock(pick(ROCKS, random), spot, 0.7 + 0.6 * random(), 0.08, ground, false))
    return out
  }
  // The peak's flanks: rocks in clusters where the face is gentle enough to hold them, bigger higher up, and a crag sunk into a steeper one.
  const grade = ground.grade(x, z, h)
  if (grade > CRAG_STEEPEST || luck > 0.5 + 0.5 * share) return out
  // A crag is big: only where the ground does not fall away from under its base.
  if (grade >= CRAGGY && share < CRAG_BELOW && h - ground.floorAt(x, z, h, 2.5) < 1.8 && random() < 0.3)
    out.push(setRock(pick(CRAGS, random), spot, 0.5 + 0.35 * random(), 0.4, ground))
  if (grade < ROCKY || grade > STEEPEST) return out
  const scale = 2 + 1.8 * share + random()
  out.push(setRock(pick(ROCKS, random), spot, scale, 0.2, ground))
  for (let k = 0; k < 2; k++) {
    if (random() < 0.5) continue
    const angle = random() * Math.PI * 2
    const [nx, nz] = [x + Math.cos(angle) * 1.8 * scale, z + Math.sin(angle) * 1.8 * scale]
    const nh = ground.heightAt(nx, nz)
    if (nh !== undefined && ground.grade(nx, nz, nh) <= STEEPEST)
      out.push(
        setRock(pick(ROCKS, random), { x: nx, z: nz, h: nh }, 0.6 * scale + 0.4 * random(), 0.2, ground),
      )
  }
  return out
}
