import { DMath } from "../dmath.ts"
import type { KitColour } from "../gen/biomes.ts"
import type { LandPlacement } from "../lands.ts"
import { type Door, type Fixture, type Prefab, pieceOf } from "./types.ts"
import { resolve } from "./variants.ts"

/** Putting a prefab into the world: its parts, doors and fixtures at a hex, turned. */

const round = (value: number): number => Math.round(value * 100) / 100

/** A point of the prefab's frame in the world, the prefab stood at `at` and turned by `rot`. */
function toWorld(at: readonly [number, number], rot: number, x: number, z: number): [number, number] {
  const sin = DMath.sin(rot)
  const cos = DMath.cos(rot)
  return [round(at[0] + x * cos + z * sin), round(at[1] - x * sin + z * cos)]
}

/**
 * The prefab stood at `at`, turned by `rot` (its front toward (sin rot, cos rot)), lifted by `y`, as
 * `seed` varies it (variants.ts; 0, the default, is the plain prefab). `kit` is the district's colour.
 */
export function instantiate(
  prefab: Prefab,
  at: readonly [number, number],
  rot: number,
  kit: KitColour,
  y = 0,
  seed = 0,
): LandPlacement[] {
  const made = resolve(prefab, seed, kit)
  return made.parts.map((part) => {
    const [x, z] = toWorld(at, rot, part.x, part.z)
    const lift = y + (part.y ?? 0)
    return {
      piece: pieceOf(part.piece, made.kit),
      x,
      z,
      rot: round(rot + (part.rot ?? 0)),
      ...(lift ? { y: lift } : {}),
      ...(part.scale ? { scale: part.scale } : {}),
    }
  })
}

/** A prefab's door spots in the world, by the same transform (and the same seed's flip). */
export function doorsOf(prefab: Prefab, at: readonly [number, number], rot: number, seed = 0): Door[] {
  return resolve(prefab, seed, "blue").doors.map((door) => {
    const [x, z] = toWorld(at, rot, door.x, door.z)
    return {
      x,
      z,
      rot: round(rot + door.rot),
      ...(door.depth ? { depth: door.depth } : {}),
      ...(door.y ? { y: door.y } : {}),
    }
  })
}

/** A prefab's fixtures (windows, chimneys) in the world, by the same transform; `y` lifts them. */
export function fixturesOf(
  list: readonly Fixture[] | undefined,
  at: readonly [number, number],
  rot: number,
  y = 0,
): Fixture[] {
  return (list ?? []).map((fixture) => {
    const [x, z] = toWorld(at, rot, fixture.x, fixture.z)
    return { x, y: round(fixture.y + y), z }
  })
}
