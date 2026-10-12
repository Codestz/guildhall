/**
 * The walk graph (decisions.md "Relief must be walkable"): the one network townsfolk and agents path
 * over. Nodes carry a ground height `y` (0 everywhere on M3's flat ground); edges are typed, and each
 * type has the steepest grade it may take and how it is moved along. M4 terrain only fills in heights
 * and adds stair, ramp, bridge and ford edges, so neither the shape nor this API changes.
 *
 * M3 builds it from the streets (street and road edges, split wherever a station joins them), a
 * path from each station to the nearest street (a pier for pier-end stations), and boat lanes between
 * pier ends: water is crossed by boat, never swum. Station nodes sit on a flat pad.
 */
import { closest } from "../geom/line.ts"
import { at, round3, snap, type Vec2 } from "../geom/vec.ts"
import type { Station, StreetGraph } from "./types.ts"

export const WALK_KINDS = [
  "street",
  "road",
  "path",
  "trail",
  "stairs",
  "ramp",
  "bridge",
  "ford",
  "pier",
  "boat-lane",
] as const
export type WalkKind = (typeof WALK_KINDS)[number]

/**
 * Per edge type: the steepest grade (rise over run) it may climb, the rig clip it is moved along with
 * (null: carried, a boat), and the speed as a share of a walk. Rig_Medium has no climb or swim clips.
 */
export const WALK_RULES: Readonly<
  Record<WalkKind, { maxGrade: number; clip: string | null; speed: number }>
> = {
  street: { maxGrade: 0.1, clip: "Walking_A", speed: 1 },
  road: { maxGrade: 0.15, clip: "Walking_A", speed: 1 },
  path: { maxGrade: 0.3, clip: "Walking_A", speed: 1 },
  trail: { maxGrade: 0.45, clip: "Walking_B", speed: 0.85 },
  stairs: { maxGrade: 1, clip: "Walking_A", speed: 0.6 },
  ramp: { maxGrade: 0.25, clip: "Walking_A", speed: 0.9 },
  bridge: { maxGrade: 0.05, clip: "Walking_A", speed: 1 },
  ford: { maxGrade: 0.05, clip: "Walking_C", speed: 0.6 },
  pier: { maxGrade: 0, clip: "Walking_A", speed: 1 },
  "boat-lane": { maxGrade: 0, clip: null, speed: 1.5 },
}

/** Radius of the flat ground a station stands on, metres (terrain keeps it level). */
export const STATION_PAD = 1.5

export interface WalkNode {
  id: number
  at: Vec2
  /** Ground height, metres (0 on flat M3). */
  y: number
  /** The station this node is, if any; it sits on a flat pad of `pad` metres. */
  station?: string
  pad?: number
}

export interface WalkEdge {
  id: number
  a: number
  b: number
  kind: WalkKind
  /** The polyline from a to b, each point `[x, y, z]` (y the ground height). */
  points: [x: number, y: number, z: number][]
}

export interface WalkGraph {
  nodes: WalkNode[]
  edges: WalkEdge[]
}

/** A station's way onto the street: the edge and point it joins at. */
interface Join {
  edge: number
  /** Segment index and parameter along it, for ordering joins along the edge. */
  seg: number
  t: number
  at: Vec2
}

export function walkGraph(streets: StreetGraph, stations: readonly Station[]): WalkGraph {
  const nodes: WalkNode[] = streets.nodes.map((n, i) => ({ id: i, at: n.at, y: 0 }))
  const index = new Map(streets.nodes.map((n, i) => [n.id, i]))
  const node = (p: Vec2, extra: Partial<WalkNode> = {}): number => {
    nodes.push({ id: nodes.length, at: snap(p), y: 0, ...extra })
    return nodes.length - 1
  }

  // Where each station joins its nearest street.
  const joins = stations.map((s): Join => {
    let best: Join & { d: number } = { edge: -1, seg: 0, t: 0, at: s.at, d: Infinity }
    streets.edges.forEach((e, ei) => {
      for (let k = 0; k + 1 < e.points.length; k++) {
        const c = closest(s.at, at(e.points, k), at(e.points, k + 1))
        if (c.d < best.d) best = { edge: ei, seg: k, t: c.t, at: c.at, d: c.d }
      }
    })
    return best
  })
  const joinNode = joins.map((j) => (j.edge < 0 ? -1 : node(j.at)))

  const edges: WalkEdge[] = []
  const link = (a: number, b: number, kind: WalkKind, pts: Vec2[]) =>
    edges.push({ id: edges.length, a, b, kind, points: pts.map((p) => [round3(p[0]), 0, round3(p[1])]) })

  // Each street, split at the joins along it.
  streets.edges.forEach((e, ei) => {
    const kind: WalkKind = e.cls === "road" ? "road" : "street"
    const cuts = joins
      .map((j, si) => ({ j, n: joinNode[si] as number }))
      .filter(({ j }) => j.edge === ei)
      .sort((x, y) => x.j.seg - y.j.seg || x.j.t - y.j.t)
    let from = index.get(e.a) as number
    let pts: Vec2[] = [at(e.points, 0)]
    let k = 0
    for (const { j, n } of cuts) {
      for (; k < j.seg; k++) pts.push(at(e.points, k + 1))
      pts.push(j.at)
      link(from, n, kind, pts)
      from = n
      pts = [j.at]
    }
    for (; k + 1 < e.points.length; k++) pts.push(at(e.points, k + 1))
    link(from, index.get(e.b) as number, kind, pts)
  })

  // Each station on its pad, a path (or its pier) to the street.
  const docks: number[] = []
  stations.forEach((s, si) => {
    const n = node(s.at, { station: s.id, pad: STATION_PAD })
    const j = joinNode[si] as number
    const pier = s.kind === "dock" && s.id !== "dock:harbourmaster"
    if (j >= 0) link(n, j, pier ? "pier" : "path", [s.at, (nodes[j] as WalkNode).at])
    if (pier) docks.push(n)
  })
  // Boats ply between pier ends, one after another along the shore.
  for (let i = 0; i + 1 < docks.length; i++) {
    const a = docks[i] as number
    const b = docks[i + 1] as number
    link(a, b, "boat-lane", [(nodes[a] as WalkNode).at, (nodes[b] as WalkNode).at])
  }
  return { nodes, edges }
}
