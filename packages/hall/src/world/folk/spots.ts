import { blocker, islandObstacles, type Obstacle, onDryLand } from "../clearance.ts"
import type { Spot } from "../layout.ts"
import type { World } from "../world.ts"

/**
 * Where a folk may stand: dry level land clear of everything standing on the island (world/
 * clearance.ts), a body apart from whoever has the spot already. One `Ground` per plan; it keeps
 * the spots it has handed out, so no two ever share one.
 */

/** Bodies (0.35 each) this far apart never touch. */
const APART = 1.1
/** A spot keeps this far off every prop and wall. */
const CLEAR = 0.75

export class Ground {
  private readonly taken: Spot[] = []
  private readonly obstacles: readonly Obstacle[]
  constructor(private readonly world: World) {
    this.obstacles = islandObstacles(world)
  }

  /** Is `spot` open ground, clear of props and of anyone's spot (`apart`)? */
  free(spot: Spot, apart = APART, among: readonly Obstacle[] = this.obstacles): boolean {
    return (
      this.taken.every((other) => Math.hypot(other[0] - spot[0], other[1] - spot[1]) >= apart) &&
      !blocker(spot, among, CLEAR) &&
      onDryLand(spot, this.world)
    )
  }

  /** Is `spot` open ground (not minding who stands there)? */
  open(spot: Spot): boolean {
    return onDryLand(spot, this.world) && !blocker(spot, this.obstacles, CLEAR)
  }

  /** Keeps `spot` as someone's. */
  take(spot: Spot): Spot {
    this.taken.push(spot)
    return spot
  }

  /**
   * The first free spot on rings round `centre`, nearest ring first and from `turn` (radians)
   * round it, kept. Undefined when the rings are full.
   */
  near(centre: Spot, radii: readonly number[], turn = 0, apart = APART): Spot | undefined {
    // Only what stands within reach of the rings can be in the way (a spot is no nearer to a thing
    // than the centre is, less its own distance from the centre): the rest are not asked each time.
    const reach = (radii[radii.length - 1] ?? 0) + CLEAR
    const among = this.obstacles.filter((o) => o.distance(centre[0], centre[1]) <= reach)
    for (const radius of radii) {
      const count = Math.max(6, Math.round((2 * Math.PI * radius) / APART))
      for (let n = 0; n < count; n++) {
        const angle = turn + (n * 2 * Math.PI) / count
        const spot: Spot = [
          round(centre[0] + Math.sin(angle) * radius),
          round(centre[1] + Math.cos(angle) * radius),
        ]
        if (this.free(spot, apart, among)) return this.take(spot)
      }
    }
    return undefined
  }
}

/** The heading (rotation-y) of someone at `from` facing `to`. */
export const facing = (from: Spot, to: Spot): number => Math.atan2(to[0] - from[0], to[1] - from[1])

export const round = (value: number): number => Math.round(value * 100) / 100
