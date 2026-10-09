import { DMath } from "../../dmath.ts"
import { type Cell, cellToWorld, type LandPlacement } from "../../lands.ts"
import type { Spot } from "../../layout.ts"
import { instantiate, type Prefab, prefab } from "../../prefabs/index.ts"
import { cellAt, key, noise } from "../hex.ts"
import { AVENUE } from "../plan/keep.ts"
import { type Tier, tierOf } from "../plan/tier.ts"
import type { IslandPlan } from "../plan.ts"
import { facing } from "./sites.ts"

/**
 * An island's civic centre (world-gen v2 §3.2, slice 4a), on and about the keep block: the guild's
 * hall (Room) stays where it is, and what makes the island a place stands round it. By tier:
 *
 *   hamlet   an inn on the lot west of the gate avenue, a well on the east
 *   village  a guildhouse and the market stalls on the two lots
 *   town     a town hall behind the keep, the market square (stalls and well) on the lots
 *   city     a castle behind the keep, the plaza on the lots, a gatehouse and curtain wall across the
 *            avenue; and, for a famous repo, the wall closes into a ring round the central district
 *
 * A castle is also what a repo of 5k stars or 150 contributors gets, and the ring wall 50k stars,
 * when the hall knows them (RepoInfo does not reach the plan yet: `fame` is empty and tiers decide).
 */

export interface Fame {
  stars?: number
  contributors?: number
}

/** The lots either side of the gate (lands.ts' V), the hex behind the keep, and its two beside it. */
const WEST: Cell = [-1, 3]
const EAST: Cell = [1, 3]
const BEHIND: Cell = [0, -4]
/** Where the stable may stand: either side of the avenue, within the gate. */
const STABLE: readonly Cell[] = [
  [-2, 4],
  [2, 4],
]
/** The gatehouse stands on the avenue between its hex and the harbour's hub. */
const GATE_Z = cellToWorld(AVENUE)[1] + 4.5
/** The ring wall's half-width and its north edge, world units: round the keep block and its lots. */
const HALF = 35
const NORTH = -30

export interface Civic {
  placements: LandPlacement[]
  /** Anchors (x, z, radius) the ground under should be left open for: meadow grass, lots. */
  clear: [number, number, number][]
  /** Where wall pieces stand, so lots do not grow through them. */
  wall: Spot[]
  /** The wall's own pieces (also among `placements`): the ones that give way to a building in their path. */
  walls: LandPlacement[]
  tier: Tier
}

export function civicOf(plan: IslandPlan, fame: Fame = {}): Civic {
  const tier = tierOf(plan.districts.reduce((sum, d) => sum + d.folder.files, 0))
  const out: Civic = { placements: [], clear: [], wall: [], walls: [], tier }
  const land = (cell: Cell): boolean => plan.land.has(key(cell))
  const put = (item: Prefab, at: Spot, rot: number, radius = 6, seed = 0): void => {
    out.placements.push(...instantiate(item, at, rot, "blue", 0, seed))
    out.clear.push([at[0], at[1], radius])
  }
  const onLot = (item: Prefab, cell: Cell): void => {
    if (!land(cell)) return
    const at = cellToWorld(cell)
    // Its own variant (prefabs/variants.ts): the inn's flag, the market's awning, which side things stand.
    put(
      item,
      at,
      facing(at, cellToWorld(AVENUE)),
      6,
      1 + Math.floor(noise(plan.seed, cell, "variant") * 65535),
    )
  }

  // The stable stands inside the walls beside the gate avenue, on the first free meadow or lot of its two hexes.
  const stables = (): void => {
    const home = STABLE.find((cell) => land(cell) && ".fV".includes(plan.land.get(key(cell))?.char ?? " "))
    if (home && plan.land.get(key(home))?.level === undefined) onLot(prefab("stable"), home)
  }

  const castle = tier === "city" || (fame.stars ?? 0) >= 5000 || (fame.contributors ?? 0) >= 150
  if (castle) {
    put(prefab("castle"), cellToWorld(BEHIND), 0, 16)
    onLot(prefab("chapel"), EAST)
    stables()
    onLot(prefab("market-stalls"), WEST)
    gatehouse(plan, out, fame)
  } else if (tier === "town") {
    put(prefab("town-hall"), cellToWorld(BEHIND), 0, 14)
    onLot(prefab("chapel"), EAST)
    stables()
    onLot(prefab("market-stalls"), WEST)
  } else if (tier === "village") {
    onLot(prefab("guildhouse"), WEST)
    onLot(prefab("market-stalls"), EAST)
  } else {
    onLot(prefab("inn"), WEST)
    onLot(prefab("plaza-well"), EAST)
  }
  return out
}

/**
 * The curtain wall across the avenue: a gate in the middle with a tower either side, runs of wall
 * out to the corners, and (a famous repo, or tier alone when fame is unknown) the other three sides.
 */
function gatehouse(plan: IslandPlan, out: Civic, fame: Fame): void {
  const ring = fame.stars === undefined ? true : fame.stars >= 50_000
  const open = (x: number, z: number): boolean => {
    const cell = cellAt([x, z])
    const hex = plan.land.get(key(cell))
    return hex !== undefined && hex.level === undefined && !"mMhH".includes(hex.char)
  }
  const road = (x: number, z: number): boolean => plan.land.get(key(cellAt([x, z])))?.char === "="
  const stand = (id: string, x: number, z: number, rot: number): void => {
    if (!open(x, z)) return
    const pieces = instantiate(prefab(id), [x, z], rot, "blue")
    out.placements.push(...pieces)
    out.walls.push(...pieces)
    out.wall.push([x, z])
  }
  // A run of wall pieces between two points along an axis; where a road crosses, a gate.
  const run = (x0: number, z0: number, x1: number, z1: number, rot: number): void => {
    const length = DMath.hypot(x1 - x0, z1 - z0)
    const pieces = Math.round(length / 10)
    for (let n = 0; n < pieces; n++) {
      const t = (n + 0.5) / pieces
      const x = x0 + (x1 - x0) * t
      const z = z0 + (z1 - z0) * t
      stand(road(x, z) ? "wall-gate" : "wall-straight", x, z, rot)
    }
  }
  stand("wall-gate", 0, GATE_Z, Math.PI)
  for (const side of [-1, 1]) stand("wall-tower", side * 8.5, GATE_Z, 0)
  // The south run, gate to corner; its tower.
  for (const side of [-1, 1]) {
    run(side * 12, GATE_Z, side * (HALF - 2), GATE_Z, Math.PI)
    stand("wall-tower", side * HALF, GATE_Z, 0)
  }
  if (!ring) return
  for (const side of [-1, 1]) {
    run(side * HALF, GATE_Z - 3, side * HALF, NORTH + 3, -side * (Math.PI / 2))
    stand("wall-tower", side * HALF, NORTH, 0)
  }
  run(-HALF + 3, NORTH, HALF - 3, NORTH, 0)
}
