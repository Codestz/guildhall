/**
 * The hex island's walk graph (decisions.md "Relief must be walkable", "Hex plan go"): where people can
 * walk, as nodes with height and edges between them, built from the tiles (pure).
 *
 *   road / square / bridge  one node at the centre of every tile a road runs over (bridges at their
 *                           deck's height, which meets both banks), joined along each road's own tile
 *                           path: the same links the path strips are drawn from, so people walk on them;
 *   door                    a spot outside the front of every building tile that faces a street (the
 *                           side the prefab is turned to: hexWorld turns a building to its first
 *                           road-like neighbour), joined to that street tile;
 *   path / dock             spurs out to tiles people work on that no road reaches (a field, a dock, a
 *                           forest edge): the cheapest steps over open land to the nearest node.
 *
 * `route(a, b)` is the shortest node path (A*), so any place reaches any other the roads join.
 */
import { hexCentre } from "./grid.ts"
import { type HexIsland, kindOf } from "./island.ts"
import { HEX_TILE_SIZE } from "./tiles.ts"
import type { HexWorld } from "./world.ts"
import { type HexZones, useOf } from "./zones.ts"

export const HEX_WALK_KINDS = ["road", "square", "bridge", "door", "path", "dock"] as const
export type HexWalkKind = (typeof HEX_WALK_KINDS)[number]

export interface HexWalkNode {
  x: number
  /** Where the feet are, metres: the tile's top, a bridge's or a dock's deck. */
  y: number
  z: number
  /** The tile it stands on. */
  tile: number
  kind: HexWalkKind
}

export interface HexWalkEdge {
  a: number
  b: number
  kind: HexWalkKind
  /** Metres, with height. */
  len: number
}

export interface HexWalk {
  nodes: HexWalkNode[]
  edges: HexWalkEdge[]
  /** Edge ids out of each node. */
  out: number[][]
  /** The node at a tile's centre (road, square, bridge or a spur tile), −1 for none. */
  at(tile: number): number
  /** The door node of a building tile, −1 for none. */
  door(tile: number): number
  /** The heart node of each zone (−1 when its heart has no node). */
  hearts: number[]
  /** Shortest node path from `from` to `to` (both included), null when unreachable. */
  route(from: number, to: number): number[] | null
}

/** How far out from a building tile's centre its door spot is, metres (the prefab's front wall is ~1.3 m out). */
export const DOOR_OUT = 1.75
/**
 * A bridge deck stands this far over its banks (as world.ts lays it); a dock's deck this high (the
 * dock prefab's pier platforms, 0.75 m tall, stand on the shallows' bed at −0.4, as its crates do).
 */
export const DECK_LIFT = 0.08
export const DOCK_Y = 0.35
/** Most steps a spur takes to reach the graph. */
const SPUR_STEPS = 6

/** Clearance kept from a blocker's edge by a walker's middle, metres (a shoulder and a little). */
export const WALK_CLEAR = 0.3

type Pt = [number, number, number]

/**
 * A polyline that keeps clear of the blocker discs `near` finds (decisions.md "Activity spots": paths
 * go round carts, stalls and houses): where a segment would cut a disc (grown by WALK_CLEAR), two
 * waypoints are put in beside it, on the side the segment already passed, and the new segments are
 * checked again (a few rounds). A disc either end stands in is left alone (a spot on a bench, a door
 * in a doorway): that is where the walk starts or ends. `ground[k]` is segment k's flag; the segments
 * a detour adds take the flag of the one they replace.
 */
export function clearWay(
  pts: readonly Pt[],
  ground: readonly boolean[],
  near: (x: number, z: number, r: number) => readonly { x: number; z: number; r: number }[],
): { pts: Pt[]; ground: boolean[] } {
  const P = [...pts]
  const G = [...ground]
  // a way point inside a blocker (a square's middle under its well) is set out on the disc's edge,
  // on the side the way passes; only the ends may stand in one
  for (let k = 1; k < P.length - 1; k++) {
    const p = P[k]!
    for (const d of near(p[0], p[2], WALK_CLEAR)) {
      const r = (d.r + WALK_CLEAR) * 1.05
      let ex = p[0] - d.x
      let ez = p[2] - d.z
      let m = Math.hypot(ex, ez)
      if (m >= r) continue
      if (m < 1e-3) {
        // dead centre: out to the right of the way through it
        const a = P[k - 1]!
        const b = P[k + 1]!
        const l = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1
        ex = -(b[2] - a[2]) / l
        ez = (b[0] - a[0]) / l
        m = 1
      }
      P[k] = [d.x + (ex / m) * r, p[1], d.z + (ez / m) * r]
    }
  }
  for (let k = 0, added = 0; k < P.length - 1 && added < 24; k++) {
    const a = P[k]!
    const b = P[k + 1]!
    const dx = b[0] - a[0]
    const dz = b[2] - a[2]
    const len = Math.hypot(dx, dz)
    if (len < 1e-6) continue
    const ux = dx / len
    const uz = dz / len
    // the first disc the segment cuts, along it
    let hit: { x: number; z: number; r: number } | null = null
    let along = Infinity
    let side = 0
    for (const d of near((a[0] + b[0]) / 2, (a[2] + b[2]) / 2, len / 2 + 0.5)) {
      const r = d.r + WALK_CLEAR
      if (Math.hypot(a[0] - d.x, a[2] - d.z) < r || Math.hypot(b[0] - d.x, b[2] - d.z) < r) continue
      const t = (d.x - a[0]) * ux + (d.z - a[2]) * uz
      if (t <= 0 || t >= len) continue
      const off = (d.x - a[0]) * -uz + (d.z - a[2]) * ux
      if (Math.abs(off) >= r || t >= along) continue
      hit = d
      along = t
      side = off
    }
    if (!hit) continue
    // round the side the segment's line already passes (left when the disc is to the right)
    const sgn = side >= 0 ? -1 : 1
    const r = (hit.r + WALK_CLEAR) * 1.08
    const nx = -uz * sgn
    const nz = ux * sgn
    const y = (f: number) => a[1] + (b[1] - a[1]) * f
    const t0 = Math.max(0.05, along - r * 0.75) / len
    const t1 = Math.min(len - 0.05, along + r * 0.75) / len
    const w0: Pt = [hit.x + nx * r - ux * r * 0.75, y(t0), hit.z + nz * r - uz * r * 0.75]
    const w1: Pt = [hit.x + nx * r + ux * r * 0.75, y(t1), hit.z + nz * r + uz * r * 0.75]
    P.splice(k + 1, 0, w0, w1)
    G.splice(k, 0, G[k]!, G[k]!)
    added++
    // look at the new first segment again
    k--
  }
  return { pts: P, ground: G }
}

/** Unit vector out through side d (60°·d counter-clockwise from +x, toward −z), as tilePath. */
const side = (d: number): [number, number] => {
  const a = (Math.PI / 180) * (60 * d)
  return [Math.cos(a), -Math.sin(a)]
}

/**
 * The walk graph of a built island. `reach` lists tiles people must be able to walk to (work tiles off
 * the roads); each gets a spur to the graph when one is found within a few steps.
 */
export function hexWalk(
  h: HexIsland,
  z: HexZones,
  w: Pick<HexWorld, "tiles">,
  opts: { reach?: readonly number[] } = {},
): HexWalk {
  const g = h.grid
  const R = HEX_TILE_SIZE
  const top = new Float64Array(g.size).fill(Number.NaN)
  for (const t of w.tiles) top[t.i] = t.top
  const centre = (i: number): [number, number] => {
    const [x, y] = hexCentre({ q: g.q[i]!, r: g.r[i]! })
    return [x * R, y * R]
  }
  const nodes: HexWalkNode[] = []
  const edges: HexWalkEdge[] = []
  const out: number[][] = []
  const byTile = new Map<number, number>()
  const doors = new Map<number, number>()
  const add = (n: HexWalkNode): number => {
    nodes.push(n)
    out.push([])
    return nodes.length - 1
  }
  const join = (a: number, b: number, kind: HexWalkKind) => {
    if (a === b || out[a]!.some((e) => edges[e]!.a === b || edges[e]!.b === b)) return
    const p = nodes[a]!
    const q = nodes[b]!
    edges.push({ a, b, kind, len: Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) })
    out[a]!.push(edges.length - 1)
    out[b]!.push(edges.length - 1)
  }

  // ---- road tiles, joined along each road ----
  const links = new Map<number, Set<number>>()
  const link = (a: number, b: number) => {
    if (!links.has(a)) links.set(a, new Set())
    links.get(a)!.add(b)
  }
  for (const r of z.roads)
    for (let k = 1; k < r.tiles.length; k++) {
      link(r.tiles[k - 1]!, r.tiles[k]!)
      link(r.tiles[k]!, r.tiles[k - 1]!)
    }
  const tileKind = (i: number): HexWalkKind => {
    const u = useOf(z, i)
    return u === "bridge" ? "bridge" : u === "square" || u === "landmark" ? "square" : "road"
  }
  const ground = (i: number) => (Number.isNaN(top[i]!) ? 0 : Math.max(0, top[i]!))
  const centreNode = (i: number, kind: HexWalkKind): number => {
    const have = byTile.get(i)
    if (have !== undefined) return have
    const [x, zz] = centre(i)
    let y = ground(i)
    if (kind === "bridge") {
      // the deck at its banks' height, as world.ts lays it
      let bank = 0
      let n = 0
      for (const j of links.get(i) ?? []) {
        if (useOf(z, j) === "bridge") continue
        bank += ground(j)
        n++
      }
      y = (n ? bank / n : y + 0.4) + DECK_LIFT
    } else if (kind === "dock") y = DOCK_Y
    const id = add({ x, y, z: zz, tile: i, kind })
    byTile.set(i, id)
    return id
  }
  for (const [i, to] of links) {
    const a = centreNode(i, tileKind(i))
    for (const j of to) join(a, centreNode(j, tileKind(j)), tileKind(j) === "bridge" ? "bridge" : tileKind(i))
  }
  // every place's heart, even one no road reached
  const hearts = z.zones.map((zone) => (zone.tiles.length ? centreNode(zone.tile, "square") : -1))
  // bridge legs: a bridge's edges take its kind whichever end they were made from
  for (const e of edges) if (nodes[e.a]!.kind === "bridge" || nodes[e.b]!.kind === "bridge") e.kind = "bridge"

  // ---- doors: outside the front of every building that faces a street ----
  const roadLike = (i: number) => {
    const u = useOf(z, i)
    return u === "road" || u === "bridge" || u === "square"
  }
  for (let i = 0; i < g.size; i++) {
    const u = useOf(z, i)
    if (u !== "building" && u !== "farmstead" && u !== "homestead") continue
    const nb = g.neighbours(i)
    // the side hexWorld turns a building to: its first road-like neighbour
    let d = -1
    for (let k = 0; k < 6; k++)
      if (nb[k]! >= 0 && roadLike(nb[k]!)) {
        d = k
        break
      }
    if (d < 0) continue
    const street = byTile.get(nb[d]!)
    // a building over a street more than a step below it has no way down: no door
    if (street === undefined || Math.abs(h.level[nb[d]!]! - h.level[i]!) > 1) continue
    const [cx, cz] = centre(i)
    const [ux, uz] = side(d)
    const id = add({ x: cx + ux * DOOR_OUT, y: ground(i), z: cz + uz * DOOR_OUT, tile: i, kind: "door" })
    doors.set(i, id)
    join(id, street, "door")
  }

  // ---- spurs out to work tiles off the roads ----
  const open = (i: number) => {
    const k = kindOf(h, i)
    if (useOf(z, i) === "dock") return true
    return k !== "sea" && k !== "shallows" && k !== "lake" && k !== "river" && k !== "rock"
  }
  const level = (i: number) => (useOf(z, i) === "dock" ? 0 : h.level[i]!)
  for (const start of opts.reach ?? []) {
    if (byTile.has(start) || !open(start)) continue
    // breadth first (a few steps) to the nearest tile with a node, round buildings where it can
    const prev = new Map<number, number>([[start, -1]])
    let frontier = [start]
    let hit = -1
    for (let step = 0; step < SPUR_STEPS && hit < 0 && frontier.length; step++) {
      const next: number[] = []
      const ordered = [...frontier].sort(
        (a, b) => Number(useOf(z, a) === "building") - Number(useOf(z, b) === "building"),
      )
      for (const i of ordered) {
        for (const j of g.neighbours(i)) {
          if (j < 0 || prev.has(j)) continue
          if (Math.abs(level(j) - level(i)) > 1) continue
          if (byTile.has(j) && nodes[byTile.get(j)!]!.kind !== "bridge") {
            prev.set(j, i)
            hit = j
            break
          }
          if (!open(j)) continue
          prev.set(j, i)
          next.push(j)
        }
        if (hit >= 0) break
      }
      frontier = next
    }
    if (hit < 0) continue
    let cur = hit
    let node = byTile.get(hit)!
    for (let i = prev.get(cur)!; i >= 0; i = prev.get(i)!) {
      const dock = useOf(z, i) === "dock"
      const id = centreNode(i, dock ? "dock" : "path")
      join(node, id, dock || nodes[node]!.kind === "dock" ? "dock" : "path")
      node = id
      cur = i
    }
  }

  // ---- A* over it ----
  const route = (from: number, to: number): number[] | null => {
    if (from < 0 || to < 0 || from >= nodes.length || to >= nodes.length) return null
    if (from === to) return [from]
    const n = nodes.length
    const dist = new Float64Array(n).fill(Infinity)
    const prev = new Int32Array(n).fill(-1)
    const done = new Uint8Array(n)
    const goal = nodes[to]!
    const guess = (i: number) => Math.hypot(nodes[i]!.x - goal.x, nodes[i]!.z - goal.z)
    const heap: [number, number][] = []
    const push = (f: number, i: number) => {
      heap.push([f, i])
      let j = heap.length - 1
      while (j > 0) {
        const p = (j - 1) >> 1
        if (heap[p]![0] <= f) break
        ;[heap[p], heap[j]] = [heap[j]!, heap[p]!]
        j = p
      }
    }
    const pop = (): number => {
      const topItem = heap[0]!
      const last = heap.pop()!
      if (heap.length) {
        heap[0] = last
        let j = 0
        for (;;) {
          const l = 2 * j + 1
          const r = l + 1
          let m = j
          if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l
          if (r < heap.length && heap[r]![0] < heap[m]![0]) m = r
          if (m === j) break
          ;[heap[m], heap[j]] = [heap[j]!, heap[m]!]
          j = m
        }
      }
      return topItem[1]
    }
    dist[from] = 0
    push(guess(from), from)
    while (heap.length) {
      const i = pop()
      if (done[i]) continue
      done[i] = 1
      if (i === to) break
      for (const e of out[i]!) {
        const edge = edges[e]!
        const j = edge.a === i ? edge.b : edge.a
        const d = dist[i]! + edge.len
        if (d < dist[j]!) {
          dist[j] = d
          prev[j] = i
          push(d + guess(j), j)
        }
      }
    }
    if (!Number.isFinite(dist[to]!)) return null
    const path = [to]
    for (let k = to; prev[k]! >= 0; ) {
      k = prev[k]!
      path.push(k)
    }
    return path.reverse()
  }

  return {
    nodes,
    edges,
    out,
    at: (tile) => byTile.get(tile) ?? -1,
    door: (tile) => doors.get(tile) ?? -1,
    hearts,
    route,
  }
}
