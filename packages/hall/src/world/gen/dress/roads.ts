import { type Cell, cellToWorld } from "../../lands.ts"
import type { Spot } from "../../layout.ts"
import { direction, key, step } from "../hex.ts"
import type { IslandPlan } from "../plan.ts"

/** The plan's roads as the hall walks and tiles them. */
export interface DressedRoads {
  /** Which edges each road hex opens onto, by key: what picks its tile. */
  links: Map<string, Set<number>>
  /** The walking graph (ROAD_NODES / ROAD_EDGES' shape). */
  nodes: Record<string, Spot>
  edges: (readonly [string, string])[]
  /** A road hex's node: "HARBOUR" at the hub, "D:<folder>" at a district's square, else "R<q>_<line>". */
  nodeName: (cell: Cell) => string
}

export function dressRoads(plan: IslandPlan): DressedRoads {
  const links = new Map<string, Set<number>>()
  const link = (cell: Cell, dir: number): void => {
    const set = links.get(key(cell)) ?? new Set<number>()
    set.add(dir)
    links.set(key(cell), set)
  }
  const squares = new Map(plan.districts.map((district, i) => [key(district.square), i]))
  const nodeName = (cell: Cell): string => {
    const i = squares.get(key(cell))
    if (i === 0) return "HARBOUR"
    if (i !== undefined) return `D:${plan.districts[i]?.folder.name}`
    return `R${cell[0]}_${cell[1]}`
  }
  const nodes: Record<string, Spot> = { HARBOUR: cellToWorld(plan.hub) }
  const edges: (readonly [string, string])[] = []
  const walked = new Set<string>()
  for (const road of plan.roads)
    for (let i = 0; i < road.length; i++) {
      const b = road[i]
      if (!b) continue
      nodes[nodeName(b)] = cellToWorld(b)
      const a = road[i - 1]
      if (!a) continue
      link(a, direction(a, b))
      link(b, direction(b, a))
      const edge = [nodeName(a), nodeName(b)].sort().join("|")
      if (walked.has(edge)) continue
      walked.add(edge)
      edges.push([nodeName(a), nodeName(b)])
    }
  // The quay: the hub's road opens south onto it (a drawn stub, like lands.ts' DOCKS). The keep's
  // gate: the avenue opens north onto its apron, the apron south onto the avenue (lands.ts' STUBS).
  link(plan.hub, direction(plan.hub, plan.quay))
  const avenue = step(plan.gate, 1)
  link(avenue, direction(avenue, plan.gate))
  link(plan.gate, direction(plan.gate, avenue))
  return { links, nodes, edges, nodeName }
}
