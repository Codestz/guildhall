import { DMath } from "../dmath.ts"
import type { Spot } from "../layout.ts"
import type { Venue } from "../venues.ts"
import { footprintOf } from "./site.ts"
import type { Hall } from "./types.ts"

/**
 * A hall in the island's world: its gate on the walking graph (a road node `HALL` at the gate's
 * step, joined to the nearest road node whose straight way does not cross the hall's own walls),
 * and the venue it is (world/venues.ts: a visit's door, its capacity the seats and stations it has).
 */

type Roads = {
  nodes: Readonly<Record<string, Spot>>
  edges: readonly (readonly [string, string])[]
  costs?: readonly number[]
}

/** The node a hall's gate joins the roads at. */
export const GATE_NODE = "HALL"

/** Whether the straight way from `a` to `b` crosses the footprint (four corners): by its edges' sides. */
function crosses(shape: readonly (readonly [number, number])[], a: Spot, b: Spot): boolean {
  const side = (p: Spot, q: Spot, r: Spot): number =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
  return shape.some((from, i) => {
    const to = shape[(i + 1) % shape.length] as readonly [number, number]
    const [p, q] = [from as Spot, to as Spot]
    return side(p, q, a) * side(p, q, b) < 0 && side(a, b, p) * side(a, b, q) < 0
  })
}

/** The roads with the hall's gate joined to them; the roads as they were when no node is in reach. */
export function withHall<R extends Roads>(roads: R, hall: Hall): R {
  const shape = footprintOf(hall)
  const step = hall.door.step
  const reach = (id: string): number => {
    const at = roads.nodes[id] as Spot
    return DMath.hypot(at[0] - step[0], at[1] - step[1])
  }
  const near = Object.keys(roads.nodes)
    .filter((id) => !/^T\d+\./.test(id) && !crosses(shape, step, roads.nodes[id] as Spot))
    .sort((a, b) => reach(a) - reach(b) || (a < b ? -1 : 1))[0]
  if (!near) return roads
  return {
    ...roads,
    nodes: { ...roads.nodes, [GATE_NODE]: step },
    edges: [...roads.edges, [GATE_NODE, near]],
    ...(roads.costs ? { costs: [...roads.costs, reach(near)] } : {}),
  }
}

/** The venue a hall is (kind "hall", in the district "hall" which no folder is). */
export function venueOfHall(hall: Hall): Venue {
  return {
    id: "#hall",
    kind: "hall",
    district: "hall",
    prefab: hall.style,
    at: hall.at,
    rot: hall.rot,
    door: hall.door,
    node: GATE_NODE,
    capacity: hall.spots.length,
    windows: [],
    chimneys: [],
  }
}
