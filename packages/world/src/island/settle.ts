/**
 * Growth step 3 (plan-w8 §4.3, ADR 011, ADR 014): the satellites settle on the main roads. Each role
 * has its places, best first: the fishing village on a far bay the roads reach (sliding along its
 * shore and inland), else on a lake's shore as a hamlet; the mining camp (a hamlet) 20–60 m off the
 * rough ground's edge, nearest the roads; the farming village inland on a main road, 180–350 m of
 * road out from the town's exit, at a crossroads if it can, on open ground. A village that fits
 * nowhere settles as a hamlet (the veredas of decisions.md). Then one set of sites, one per role,
 * whose frames keep apart from each other and from the town's (the most roles, the earliest sites,
 * the most constrained role first); a site whose layout fails is struck and the set chosen again. A
 * role with no place is dropped and reported, never a crash.
 *
 * Each satellite is `generateTown` in its own frame (frame.ts), placed by its origin. Then the roads
 * make way: a road keeps out of every frame, stopping 40 m short of it and re-routed into the
 * settlement's nearest exit, so a road that ran through the site now runs through the village from
 * gate to gate. A settlement no road came into gets a track from its exit nearest a road, and any
 * other exit left alone one when it is short. There are no random draws here: a satellite's layout
 * draws from its own spec seed (role-keyed), and it grows after the roads, `grown` in spec order.
 */
import { closest, distTo, intersect, length } from "../geom/line.ts"
import { area, centroid, contains, type Ring } from "../geom/poly.ts"
import { type CostGrid, cellAt, cellCentre, gridAStar, smoothRoute, stringPull } from "../geom/route.ts"
import type { Roll } from "../geom/sample.ts"
import { add, dist, norm, scale, snap, sub, type Vec2 } from "../geom/vec.ts"
import { generateTown, type TownLayout } from "../town/index.ts"
import type { PlanLibrary } from "../town/library.ts"
import { TIER_DEFAULTS } from "../town/spec.ts"
import { costField, OCCUPANTS, type Occupancy } from "./cost.ts"
import { frameOf, toIsland } from "./frame.ts"
import { TOWN_CLEAR } from "./site.ts"
import {
  GROUND_KINDS,
  type IslandSite,
  type NormalIslandSpec,
  type RoadEdge,
  type RoadNetwork,
  type RoadNode,
  type Role,
  type SatelliteSpec,
  type Settlement,
} from "./types.ts"

type SatRole = Exclude<Role, "main">

/** A satellite's frame reach, in its own radii (§4.3; ≥ r + 12 m at every tier). */
export const SATELLITE_REACH: Readonly<Record<SatRole, number>> = { fishing: 1.4, farming: 1.3, mining: 1.3 }
/** Metres between two frames' edges, and between two centres, at least. */
export const GAP = 60
export const APART = 150
/** The farming village's road distance from the town's exit, metres. */
export const FARM_ROAD: readonly [number, number] = [180, 350]
/** A farming frame holds at least this share of land, and its centre keeps this far from the coast. */
const FARM_LAND = 0.85
const FARM_COAST = 60
/** At most this share of a farming frame is rock: it sits among fields. */
const FARM_ROUGH = 0.1
/** A junction this near makes a farming site a crossroads (preferred). */
const CROSSROADS = 30
/** Metres between the sites tried along a road. */
const STEP = 10
/** A farming site's centre beside its road, metres either side: the road still runs through its frame. */
const ASIDE = [0, 15, -15, 30, -30] as const
/** The mining camp's centre off the rough edge, metres, in the order tried (§4.3: 20–60). */
const MINE_OFF = [40, 30, 50, 20, 60] as const
/** A fishing village's centre inland of its shore, in its radii, in the order tried. */
const SHORE_IN = [0.55, 0.7, 0.85, 1] as const
/** How far a fishing village slides along its bay's shore either way from the innermost point, metres. */
const SLIDE = 90
/** Any frame holds at least this share of land (a fishing one has its harbour's water in it). */
const MIN_LAND = 0.45
/** Shore points tried round a lake or a rock field. */
const RIM_POINTS = 16
/** Rounds of choosing a set of sites, each striking the sites whose layout failed. */
const TRIES = 4
/** Spacing checks the search for a set of sites may spend. */
const SEARCH = 400_000
/** A road stops this far (along it) short of a frame and is re-routed to an exit. */
const PULL_BACK = 40
/** A settlement's other exits get a track to the roads only when it is this short, metres. */
const STUB = 120
/** The most crossings one new edge is split at (a guard: a few at most in practice). */
const MAX_CROSSINGS = 16
/** Metres a road keeps outside a frame's disc. */
const CLEAR = 2
/** A street or a building this far inside a lake's shore is on the lake, metres. */
const LAKE_EDGE = 0.5
/** A junction keeps this far from either end of the edge it splits, metres; nearer, it takes that end. */
const END_GAP = 6
const TRACK_WIDTH = 3
/** Siting order: the most constrained first. */
const ORDER: readonly SatRole[] = ["fishing", "mining", "farming"]

const LAND = GROUND_KINDS.indexOf("land")
const SEA = GROUND_KINDS.indexOf("sea")
const LAKE = GROUND_KINDS.indexOf("lake")
const ROUGH = GROUND_KINDS.indexOf("rough")
const FRAME = OCCUPANTS.indexOf("frame")

/** A role that found no place, and why. */
export interface Dropped {
  role: SatRole
  /** Its index in `spec.satellites`. */
  index: number
  why: string
}

export interface Settled {
  /** In spec order, the dropped left out. */
  settlements: Settlement[]
  net: RoadNetwork
  dropped: Dropped[]
}

export interface SettleOptions {
  /** Forest cover per ground cell (`woodCover`): a farming village takes the most open ground, roads skirt woods. */
  wood?: Float32Array
}

/** A place a satellite might take. */
interface Site {
  centre: Vec2
  reach: number
  tier: SatelliteSpec["tier"]
  /** Its harbour: the bearing out of town and a point in its water. */
  harbour?: { bearing: number; water: Vec2 }
  /** The reason end node it may cover (its own road's end). */
  owns?: string
}

interface Disc {
  c: Vec2
  reach: number
}

/**
 * The satellites on the main roads `net` (mainRoads' output: the main town at the origin, its exits
 * `main#<node>`), and the network re-routed into their exits. A role with no place is in `dropped`.
 */
export function settle(
  site: IslandSite,
  net: RoadNetwork,
  spec: NormalIslandSpec,
  lib: PlanLibrary,
  _roll: Roll,
  opts: SettleOptions = {},
): Settled {
  const main: Disc = { c: [0, 0], reach: TOWN_CLEAR * spec.town.radius }
  const base = 1 + net.edges.reduce((m, e) => Math.max(m, e.grown), 0)
  const seen: Partial<Record<SatRole, number>> = {}
  const sats = spec.satellites.map((sat, index) => {
    const k = seen[sat.role] ?? 0
    seen[sat.role] = k + 1
    return { sat, index, id: `${sat.role}-${k}` }
  })
  const order = [...sats].sort(
    (a, b) => ORDER.indexOf(a.sat.role) - ORDER.indexOf(b.sat.role) || a.index - b.index,
  )

  // Every role's sites that fit on their own (clear of the town, land enough), then the best set of
  // them that keeps apart; a site whose layout fails (no way out, or a street on a lake) is struck and
  // the set chosen again. A site whose frame would cover another reason's road end comes after those
  // that leave it be.
  const options = order.map(({ sat }) => {
    const fit = sites(site, net, sat, opts).filter(
      (s) =>
        spaced(s, [main]) &&
        discMean(site, s.centre, s.reach, (j) => (isWater(site, j) ? 0 : 1)) >=
          (sat.role === "farming" ? FARM_LAND : MIN_LAND),
    )
    return [...fit.filter((s) => !swallows(s, net)), ...fit.filter((s) => swallows(s, net))]
  })
  const struck = order.map(() => new Set<number>())
  const built = new Map<string, Settlement | null>()
  let pick: number[] = order.map(() => -1)
  for (let round = 0; round < TRIES; round++) {
    pick = choose(options, struck)
    let ok = true
    pick.forEach((k, slot) => {
      if (k < 0) return
      const key = `${slot}:${k}`
      if (!built.has(key)) {
        const { sat, index, id } = order[slot] as (typeof order)[number]
        built.set(key, satellite(site, options[slot]?.[k] as Site, sat, id, base + index, lib))
      }
      if (built.get(key) === null) {
        struck[slot]?.add(k)
        ok = false
      }
    })
    if (ok) break
  }

  const placed = new Map<number, Settlement>()
  const dropped: Dropped[] = []
  order.forEach(({ sat, index }, slot) => {
    const s = built.get(`${slot}:${pick[slot]}`)
    if (s) placed.set(index, s)
    else
      dropped.push({
        role: sat.role,
        index,
        why:
          (options[slot]?.length ?? 0) === 0
            ? "no site on the island"
            : pick[slot] === -1
              ? "no site keeps its frame apart from the others"
              : "no layout held (a way out, a quay, dry streets)",
      })
  })

  const settlements = sats.flatMap(({ index }) => placed.get(index) ?? [])
  return { settlements, net: rewire(site, net, settlements, main, opts), dropped }
}

/** The satellite laid out on a site; null when its layout keeps no way out, a harbour no quay, or puts a street on a lake. */
function satellite(
  site: IslandSite,
  s: Site,
  sat: SatelliteSpec & { seed: number },
  id: string,
  grown: number,
  lib: PlanLibrary,
): Settlement | null {
  const frame = frameOf(site, s.centre, s.reach, s.harbour?.water)
  const layout = generateTown(
    { seed: sat.seed, tier: s.tier, harbour: s.harbour ? { bearing: s.harbour.bearing } : null },
    lib,
    undefined,
    frame,
  )
  const nodes = layout.streets.nodes
  if (!nodes.some((n) => n.tag === "exit") || onLake(site, layout, s.centre)) return null
  if (s.harbour && !nodes.some((n) => n.kind === "quay")) return null
  return { id, role: sat.role, tier: s.tier, origin: s.centre, frame, layout, exits: [], grown }
}

/**
 * One site per role (an index into its options, -1: none) such that all keep apart: the most roles
 * placed, and among those the earliest sites in each role's order of preference (a bounded search).
 */
function choose(options: readonly Site[][], struck: readonly Set<number>[]): number[] {
  const n = options.length
  let best: number[] = options.map(() => -1)
  let bestCount = 0
  let budget = SEARCH
  const pick: number[] = []
  const discs: Disc[] = []
  const dfs = (slot: number, count: number): boolean => {
    if (slot === n) {
      if (count > bestCount) {
        bestCount = count
        best = [...pick]
      }
      return count === n
    }
    if (count + (n - slot) <= bestCount || budget <= 0) return false
    const list = options[slot] as Site[]
    for (let k = 0; k < list.length; k++) {
      if (struck[slot]?.has(k)) continue
      const s = list[k] as Site
      budget -= discs.length + 1
      if (budget <= 0) return false
      if (!spaced(s, discs)) continue
      pick.push(k)
      discs.push({ c: s.centre, reach: s.reach })
      const done = dfs(slot + 1, count + 1)
      pick.pop()
      discs.pop()
      if (done) return true
    }
    pick.push(-1)
    const done = dfs(slot + 1, count)
    pick.pop()
    return done
  }
  dfs(0, 0)
  return best
}

/** The sites a role may take, best first. */
function sites(site: IslandSite, net: RoadNetwork, sat: SatelliteSpec, opts: SettleOptions): Site[] {
  if (sat.role === "fishing") return fishingSites(site, net, sat.tier)
  if (sat.role === "mining") return miningSites(site, net)
  return farmingSites(site, net, sat.tier, opts)
}

const radius = (tier: SatelliteSpec["tier"]) => TIER_DEFAULTS[tier].radius
/** The tier asked for, then a hamlet: a village that fits nowhere settles as a hamlet (reported by its tier). */
const smaller = (tier: SatelliteSpec["tier"]): SatelliteSpec["tier"][] =>
  tier === "hamlet" ? ["hamlet"] : [tier, "hamlet"]
const reachOf = (role: SatRole, tier: SatelliteSpec["tier"]) => SATELLITE_REACH[role] * radius(tier)

/** The reasons the roads reached (their end nodes), by id. */
function ends(net: RoadNetwork): Map<string, RoadNode> {
  return new Map(net.nodes.filter((n) => n.kind === "end" && n.ref).map((n) => [n.ref as string, n]))
}

/**
 * On a far bay the roads reach (then any other far bay): the centre inland of its innermost shore,
 * the harbour facing out of the bay. Else on a lake's shore, the lake a road reaches first, as a
 * hamlet: the shore points nearest the roads, the harbour facing the lake.
 */
function fishingSites(site: IslandSite, net: RoadNetwork, tier: SatelliteSpec["tier"]): Site[] {
  const out: Site[] = []
  const reached = ends(net)
  const bays = site.bays
    .filter((b) => !b.main)
    .sort((a, b) => Number(!reached.has(`bay:${a.id}`)) - Number(!reached.has(`bay:${b.id}`)))
  for (const t of smaller(tier))
    for (const bay of bays)
      for (const { at, out: seaward } of shoreFrom(site, bay.shore, bay.out))
        for (const f of SHORE_IN)
          out.push({
            centre: snap(sub(at, scale(seaward, f * radius(t)))),
            reach: reachOf("fishing", t),
            tier: t,
            harbour: { bearing: Math.atan2(seaward[1], seaward[0]), water: add(at, scale(seaward, 8)) },
            owns: `bay:${bay.id}`,
          })
  const lakes = site.lakes
    .map((ring, i) => ({ ring, i }))
    .sort(
      (a, b) =>
        Number(!reached.has(`lake:${a.i}`)) - Number(!reached.has(`lake:${b.i}`)) ||
        Math.abs(area(b.ring)) - Math.abs(area(a.ring)),
    )
  for (const { ring, i } of lakes) {
    const mid = centroid(ring)
    for (const p of rim(ring, net)) {
      const centre = snap(add(p, scale(norm(sub(p, mid)), SHORE_IN[0] * radius("hamlet"))))
      const toward = sub(mid, centre)
      out.push({
        centre,
        reach: reachOf("fishing", "hamlet"),
        tier: "hamlet",
        harbour: { bearing: Math.atan2(toward[1], toward[0]), water: mid },
        owns: `lake:${i}`,
      })
    }
  }
  return out
}

/** Just off a rock field's edge, 20–60 m out: the field a road reaches first, its edge points nearest the roads. */
function miningSites(site: IslandSite, net: RoadNetwork): Site[] {
  const out: Site[] = []
  const reached = ends(net)
  const fields = site.rough
    .map((ring, i) => ({ ring, i }))
    .sort((a, b) => Number(!reached.has(`rough:${a.i}`)) - Number(!reached.has(`rough:${b.i}`)))
  for (const { ring, i } of fields) {
    const mid = centroid(ring)
    for (const p of rim(ring, net))
      for (const d of MINE_OFF) {
        const centre = snap(add(p, scale(norm(sub(p, mid)), d)))
        const off = distTo(centre, ring, true)
        if (contains(ring, centre) || off < 20 || off > 60 || ground(site, centre) !== LAND) continue
        out.push({ centre, reach: reachOf("mining", "hamlet"), tier: "hamlet", owns: `rough:${i}` })
      }
  }
  return out
}

/**
 * Along the roads, 180–350 m of road from the town's exit, every STEP metres: plain land well in from
 * the coast whose frame is nearly all land. A crossroads first, then the most open ground (least
 * wood), then the middle of the span.
 */
function farmingSites(
  site: IslandSite,
  net: RoadNetwork,
  tier: SatelliteSpec["tier"],
  opts: SettleOptions,
): Site[] {
  const g = site.ground
  const fromTown = roadDistances(net)
  const junctions = net.nodes.filter((n) => n.kind === "junction")
  const mid = (FARM_ROAD[0] + FARM_ROAD[1]) / 2
  const out: (Site & { key: number[] })[] = []
  smaller(tier).forEach((t, rank) => {
    const reach = reachOf("farming", t)
    for (const e of net.edges) {
      const total = length(e.points)
      for (let s = 0; s <= total; s += STEP) {
        const road = Math.min((fromTown[e.a] as number) + s, (fromTown[e.b] as number) + total - s)
        if (road < FARM_ROAD[0] || road > FARM_ROAD[1]) continue
        const on = pointAt(e.points, s)
        const along = sub(pointAt(e.points, Math.min(total, s + 1)), pointAt(e.points, Math.max(0, s - 1)))
        const side = norm([-along[1], along[0]])
        for (const off of ASIDE) {
          const centre = snap(add(on, scale(side, off)))
          const i = cellIndex(site, centre)
          if (i < 0 || g.kind[i] !== LAND || (g.coastDist[i] as number) < FARM_COAST) continue
          if (discMean(site, centre, reach, (j) => (g.kind[j] === ROUGH ? 1 : 0)) > FARM_ROUGH) continue
          const wood = opts.wood ? discMean(site, centre, reach, (j) => opts.wood?.[j] ?? 0) : 0
          const cross = junctions.some((n) => dist(n.at, centre) <= CROSSROADS) ? 0 : 1
          const key = [rank, cross, Math.abs(off), Math.round(wood * 20), Math.abs(road - mid), e.id, s, off]
          out.push({ centre, reach, tier: t, key })
        }
      }
    }
  })
  out.sort((a, b) => {
    for (let k = 0; k < a.key.length; k++)
      if (a.key[k] !== b.key[k]) return (a.key[k] as number) - (b.key[k] as number)
    return 0
  })
  return out.map(({ key: _key, ...s }) => s)
}

/**
 * A bay's shore from its innermost point outward, STEP metres at a time up to SLIDE either way
 * (nearest first, alternating), each point with its direction out to sea (the coast's normal there,
 * the bay's own at its innermost point).
 */
function shoreFrom(site: IslandSite, shore: Vec2, out: Vec2): { at: Vec2; out: Vec2 }[] {
  const ring = site.coast
  const n = ring.length
  let i0 = 0
  ring.forEach((p, i) => {
    if (dist(p, shore) < dist(ring[i0] as Vec2, shore)) i0 = i
  })
  const at = (i: number) => ring[(((i0 + i) % n) + n) % n] as Vec2
  const result = [{ at: shore, out }]
  for (const dir of [1, -1]) {
    let s = 0
    let next = STEP
    for (let k = 1; k < n / 2 && next <= SLIDE; k++) {
      s += dist(at(dir * (k - 1)), at(dir * k))
      if (s < next) continue
      next += STEP
      const tangent = sub(at(dir * k + 1), at(dir * k - 1))
      let normal = norm([tangent[1], -tangent[0]])
      if (ground(site, add(at(dir * k), scale(normal, 12))) !== SEA) normal = scale(normal, -1)
      result.push({ at: at(dir * k), out: normal })
    }
  }
  // Nearest the innermost point first: the two directions interleaved.
  return result
    .map((r, k) => ({ r, d: dist(r.at, shore), k }))
    .sort((a, b) => a.d - b.d || a.k - b.k)
    .map(({ r }) => r)
}

/** Up to RIM_POINTS points of a ring's outline, at least 20 m apart, nearest the roads first. */
function rim(ring: Ring, net: RoadNetwork): Vec2[] {
  const near = (p: Vec2) =>
    net.edges.reduce((best, e) => Math.min(best, distTo(p, e.points)), Number.POSITIVE_INFINITY)
  const ranked = ring.map((p) => ({ p, d: near(p) })).sort((a, b) => a.d - b.d)
  const out: Vec2[] = []
  for (const { p } of ranked) {
    if (out.length >= RIM_POINTS) break
    if (out.every((q) => dist(p, q) >= 20)) out.push(p)
  }
  return out
}

/** Clear of every frame taken: GAP between edges, APART between centres. */
const spaced = (s: Site, taken: readonly Disc[]): boolean =>
  taken.every((t) => dist(s.centre, t.c) >= Math.max(APART, s.reach + t.reach + GAP))

/**
 * Whether a layout puts a street or a building on a lake (a frame's lakes are holes in its land; a
 * town laid out round a lake harbour can still run a street across it): such a layout is not kept.
 */
function onLake(site: IslandSite, layout: TownLayout, origin: Vec2): boolean {
  const lakes = site.lakes.map((ring) => ring.map((p) => sub(p, origin)))
  if (lakes.length === 0) return false
  const afloat = new Set(["pier", "boat", "cargo"])
  const points = [
    ...layout.streets.edges.flatMap((e) => e.points),
    ...layout.placements.filter((p) => !afloat.has(p.role ?? "")).map((p) => p.at),
  ]
  return points.some((p) => lakes.some((ring) => contains(ring, p, 0) && distTo(p, ring, true) > LAKE_EDGE))
}

/** Whether the site's frame would cover another reason's road end. */
const swallows = (s: Site, net: RoadNetwork): boolean =>
  net.nodes.some((n) => n.kind === "end" && n.ref !== s.owns && dist(n.at, s.centre) <= s.reach + CLEAR)

/** Metres along the roads from the town's nearest exit to each node (Infinity where none reaches). */
function roadDistances(net: RoadNetwork): number[] {
  const d = net.nodes.map((n) => (n.kind === "exit" ? 0 : Number.POSITIVE_INFINITY))
  const lengths = net.edges.map((e) => length(e.points))
  // Bellman-Ford: the networks are small (tens of edges).
  for (let changed = true; changed; ) {
    changed = false
    net.edges.forEach((e, k) => {
      const l = lengths[k] as number
      for (const [a, b] of [
        [e.a, e.b],
        [e.b, e.a],
      ] as const)
        if ((d[a] as number) + l < (d[b] as number) - 1e-9) {
          d[b] = (d[a] as number) + l
          changed = true
        }
    })
  }
  return d
}

/**
 * The network with the satellites in it: every road kept out of every frame, its cut ends pulled back
 * and re-routed into the nearest exit; then a track from each exit still unjoined to the nearest road.
 * Nodes no edge reaches any more (road ends and junctions now inside a frame) are dropped and the ids
 * renumbered; each settlement's `exits` are its exit nodes' ids.
 */
function rewire(
  site: IslandSite,
  net: RoadNetwork,
  settlements: Settlement[],
  main: Disc,
  opts: SettleOptions,
): RoadNetwork {
  if (settlements.length === 0) return net
  const discs = settlements.map((s) => ({ c: s.origin, reach: s.frame.reach + CLEAR }))
  const nodes: RoadNode[] = net.nodes.map((n) => ({ ...n }))
  const exits = settlements.map((s) =>
    s.layout.streets.nodes
      .filter((n) => n.tag === "exit")
      .map((n) => {
        const id = nodes.length
        nodes.push({ id, at: toIsland(s, n.at), kind: "exit", ref: `${s.id}#${n.id}` })
        return id
      }),
  )
  const exitNodes = exits.flat().map((id) => nodes[id] as RoadNode)
  const occupancy = frames(
    site,
    [main, ...settlements.map((s) => ({ c: s.origin, reach: s.frame.reach }))],
    opts,
  )
  const g = grid(
    site,
    costField(site.ground, "road", occupancy, { nodes: [...net.nodes, ...exitNodes], edges: [] }),
  )
  const inside = (p: Vec2) => discs.findIndex((d) => dist(p, d.c) < d.reach)

  const edges: RoadEdge[] = []
  /**
   * The road from p into the settlement's nearest exit, or onto a road already led into one of its
   * exits (joining it in a junction, so two roads into one gate share their last stretch): its node
   * and its points from p.
   */
  const into = (k: number, p: Vec2): { node: number; points: Vec2[] } | null => {
    const mine = new Map((exits[k] ?? []).map((id) => [cellAt(g, (nodes[id] as RoadNode).at), id]))
    const led = edges.filter(
      (e) =>
        mine.has(cellAt(g, (nodes[e.a] as RoadNode).at)) || mine.has(cellAt(g, (nodes[e.b] as RoadNode).at)),
    )
    const onLed = cellsOf(g, led)
    const start = cellAt(g, p)
    const cells = gridAStar(g, start, (i) => mine.has(i) || (i !== start && onLed.has(i)))
    if (!cells) return null
    const last = cells[cells.length - 1] as number
    let node = mine.get(last)
    if (node === undefined) {
      const hit = project(led, cellCentre(g, last))
      if (!hit) return null
      node = attach(nodes, edges, { ...hit, edge: edges.indexOf(led[hit.edge] as RoadEdge) })
    }
    const line = stringPull(cells, g)
    line[0] = p
    line[line.length - 1] = (nodes[node] as RoadNode).at
    return { node, points: smoothRoute(line, g) }
  }

  for (const e of net.edges)
    for (const piece of outside(e.points, inside)) {
      let { points } = piece
      let a = e.a
      let b = e.b
      if (piece.from >= 0) {
        const r = into(piece.from, points[0] as Vec2)
        if (!r) continue
        a = r.node
        points = [...r.points.reverse(), ...points.slice(1)]
      }
      if (piece.to >= 0) {
        const r = into(piece.to, points[points.length - 1] as Vec2)
        if (!r) continue
        b = r.node
        points = [...points.slice(0, -1), ...r.points]
      }
      if (a !== b) insert(nodes, edges, { ...e, a, b, points: clean(points) })
    }

  // A settlement no road came into gets a track from its exit nearest a road (A* stops on the first
  // road cell it reaches); any other exit still alone gets one only when it is short.
  const plain = grid(site, costField(site.ground, "track", occupancy, { nodes: exitNodes, edges: [] }))
  const track = (id: number) => {
    const from = (nodes[id] as RoadNode).at
    const roads = grid(
      site,
      costField(site.ground, "track", occupancy, { nodes: [...net.nodes, ...exitNodes], edges }),
    )
    const start = cellAt(roads, from)
    const cells = gridAStar(roads, start, (i) => i !== start && (roads.cost[i] as number) < 1)
    const hit = cells && project(edges, cellCentre(roads, cells[cells.length - 1] as number))
    if (!cells || !hit) return null
    const line = stringPull(cells, plain)
    line[0] = from
    line[line.length - 1] = hit.at
    const points = clean(smoothRoute(line, plain))
    return { id, hit, points, length: length(points) }
  }
  const lay = (t: NonNullable<ReturnType<typeof track>>, grown: number) => {
    const j = attach(nodes, edges, t.hit)
    t.points[t.points.length - 1] = (nodes[j] as RoadNode).at
    const edge: RoadEdge = {
      id: -1,
      a: t.id,
      b: j,
      cls: "track",
      points: clean(t.points),
      width: TRACK_WIDTH,
      walk: "road",
      grown,
    }
    insert(nodes, edges, edge)
  }
  settlements.forEach((s, k) => {
    const used = () => new Set(edges.flatMap((e) => [e.a, e.b]))
    const mine = exits[k] ?? []
    if (!mine.some((id) => used().has(id))) {
      const first = mine
        .map(track)
        .filter((t) => t !== null)
        .reduce<ReturnType<typeof track>>((a, b) => (a && a.length <= b.length ? a : b), null)
      if (first) lay(first, s.grown)
    }
    for (const id of mine) {
      if (used().has(id)) continue
      const t = track(id)
      if (t && t.length <= STUB) lay(t, s.grown)
    }
  })

  // Renumber: the nodes edges reach, and every exit.
  const keep = new Set([...edges.flatMap((e) => [e.a, e.b]), ...exits.flat()])
  const ids = new Map<number, number>()
  const out: RoadNode[] = []
  for (const n of nodes)
    if (keep.has(n.id)) {
      ids.set(n.id, out.length)
      out.push({ ...n, id: out.length })
    }
  settlements.forEach((s, k) => {
    s.exits = (exits[k] ?? []).map((id) => ids.get(id) as number)
  })
  return {
    nodes: out,
    edges: edges.map((e, id) => ({ ...e, id, a: ids.get(e.a) as number, b: ids.get(e.b) as number })),
  }
}

/**
 * The stretches of a line outside every disc, each with the disc it was cut by at either end (-1:
 * the line's own end). A cut end is pulled back PULL_BACK metres along the stretch; a stretch with
 * nothing left of it once pulled back is dropped, unless one end is the line's own (then it shrinks
 * to that end's point).
 */
function outside(
  line: readonly Vec2[],
  inside: (p: Vec2) => number,
): { points: Vec2[]; from: number; to: number }[] {
  // Each point inside or out, with the boundary crossings found to 0.25 m on every segment.
  const pts: { p: Vec2; disc: number }[] = []
  for (let i = 0; i < line.length; i++) {
    const p = line[i] as Vec2
    if (i > 0) {
      const q = line[i - 1] as Vec2
      const n = Math.ceil(dist(q, p) / 0.25)
      let was = inside(q)
      for (let k = 1; k < n; k++) {
        const x: Vec2 = add(q, scale(sub(p, q), k / n))
        const now = inside(x)
        if (now !== was) pts.push({ p: x, disc: now >= 0 ? now : was })
        was = now
      }
    }
    pts.push({ p, disc: inside(p) })
  }
  const runs: { points: Vec2[]; from: number; to: number }[] = []
  let cur: { points: Vec2[]; from: number; to: number } | null = null
  pts.forEach(({ p, disc }, i) => {
    if (disc < 0) {
      if (!cur) cur = { points: [], from: i === 0 ? -1 : (pts[i - 1] as { disc: number }).disc, to: -1 }
      cur.points.push(p)
    } else if (cur) {
      cur.to = disc
      runs.push(cur)
      cur = null
    }
  })
  if (cur) runs.push(cur)

  const out: { points: Vec2[]; from: number; to: number }[] = []
  for (const run of runs) {
    const total = length(run.points)
    const s0 = run.from >= 0 ? PULL_BACK : 0
    const s1 = run.to >= 0 ? total - PULL_BACK : total
    if (s1 - s0 >= 1) out.push({ ...run, points: slice(run.points, s0, s1) })
    else if (run.from < 0 && run.to >= 0) out.push({ ...run, points: [run.points[0] as Vec2] })
    else if (run.to < 0 && run.from >= 0)
      out.push({ ...run, points: [run.points[run.points.length - 1] as Vec2] })
    // Short between two frames: its middle, so the two settlements are joined through it.
    else out.push({ ...run, points: [pointAt(run.points, total / 2)] })
  }
  return out
}

/** The line between arc lengths s0 and s1. */
function slice(line: readonly Vec2[], s0: number, s1: number): Vec2[] {
  const out: Vec2[] = [pointAt(line, s0)]
  let s = 0
  for (let i = 1; i < line.length; i++) {
    s += dist(line[i - 1] as Vec2, line[i] as Vec2)
    if (s > s0 && s < s1) out.push(line[i] as Vec2)
  }
  out.push(pointAt(line, s1))
  return out
}

/** The point at arc length s along the line. */
function pointAt(line: readonly Vec2[], s: number): Vec2 {
  let left = s
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1] as Vec2
    const b = line[i] as Vec2
    const l = dist(a, b)
    if (left <= l || i === line.length - 1)
      return add(a, scale(sub(b, a), l === 0 ? 0 : Math.min(1, left / l)))
    left -= l
  }
  return line[0] as Vec2
}

/** Snapped to the 1 mm grid, without repeats. */
const clean = (line: readonly Vec2[]): Vec2[] =>
  line.map(snap).filter((p, i, all) => i === 0 || dist(p, all[i - 1] as Vec2) > 0.01)

/** The nearest point of any edge to p. */
function project(edges: readonly RoadEdge[], p: Vec2): { edge: number; seg: number; at: Vec2 } | null {
  let best: { edge: number; seg: number; at: Vec2; d: number } | null = null
  edges.forEach((e, k) => {
    for (let i = 1; i < e.points.length; i++) {
      const c = closest(p, e.points[i - 1] as Vec2, e.points[i] as Vec2)
      if (!best || c.d < best.d - 1e-9) best = { edge: k, seg: i - 1, at: c.at, d: c.d }
    }
  })
  return best
}

/** Adds an edge, splitting it and any edge it crosses (away from its own ends) at each crossing. */
function insert(nodes: RoadNode[], edges: RoadEdge[], edge: RoadEdge): void {
  let from = edge.a
  // Its ends are its nodes' points exactly (an end re-measured along a line can drift a millimetre).
  let rest = [(nodes[edge.a] as RoadNode).at, ...edge.points.slice(1, -1), (nodes[edge.b] as RoadNode).at]
  for (let n = 0; n < MAX_CROSSINGS; n++) {
    const hit = firstCrossing(edges, rest)
    if (!hit) break
    // Split where they cross, exactly: a crossing is a junction even near an edge's end.
    const j = attach(nodes, edges, hit, 0.01)
    const at = (nodes[j] as RoadNode).at
    if (j !== from)
      edges.push({ ...edge, a: from, b: j, points: clean([...rest.slice(0, hit.mine + 1), at]) })
    from = j
    rest = [at, ...rest.slice(hit.mine + 1)]
  }
  if (from !== edge.b) edges.push({ ...edge, a: from, points: clean(rest) })
}

/** The first point along `line` where it crosses an edge, away from the line's own ends. */
function firstCrossing(
  edges: readonly RoadEdge[],
  line: readonly Vec2[],
): { edge: number; seg: number; at: Vec2; mine: number } | null {
  const start = line[0] as Vec2
  const end = line[line.length - 1] as Vec2
  for (let i = 1; i < line.length; i++) {
    let best: { edge: number; seg: number; at: Vec2; mine: number; t: number } | null = null
    edges.forEach((e, k) => {
      for (let s = 1; s < e.points.length; s++) {
        const x = intersect(
          line[i - 1] as Vec2,
          line[i] as Vec2,
          e.points[s - 1] as Vec2,
          e.points[s] as Vec2,
        )
        // A zero-length segment has no crossing (intersect divides by its length).
        if (!x || !Number.isFinite(x.at[0] + x.at[1]) || dist(x.at, start) < 1 || dist(x.at, end) < 1)
          continue
        if (!best || x.t < best.t) best = { edge: k, seg: s - 1, at: x.at, mine: i - 1, t: x.t }
      }
    })
    if (best) return best
  }
  return null
}

/** The node at a point on an edge: its end when near one, else a junction splitting it. */
function attach(
  nodes: RoadNode[],
  edges: RoadEdge[],
  p: { edge: number; seg: number; at: Vec2 },
  gap = END_GAP,
): number {
  const e = edges[p.edge] as RoadEdge
  const head = [...e.points.slice(0, p.seg + 1), snap(p.at)]
  const tail = [snap(p.at), ...e.points.slice(p.seg + 1)]
  if (length(head) < gap) return e.a
  if (length(tail) < gap) return e.b
  const id = nodes.length
  nodes.push({ id, at: snap(p.at), kind: "junction" })
  edges.push({ ...e, a: id, points: clean(tail) })
  e.b = id
  e.points = clean(head)
  return id
}

/** The cells the edges run through (a quarter-cell walk along each segment). */
function cellsOf(g: CostGrid, edges: readonly RoadEdge[]): Set<number> {
  const out = new Set<number>()
  const step = (g.cell ?? 1) / 4
  for (const e of edges)
    for (let s = 1; s < e.points.length; s++) {
      const a = e.points[s - 1] as Vec2
      const b = e.points[s] as Vec2
      const n = Math.max(1, Math.ceil(dist(a, b) / step))
      for (let q = 0; q <= n; q++) {
        const i = cellAt(g, add(a, scale(sub(b, a), q / n)))
        if (i >= 0) out.add(i)
      }
    }
  return out
}

/** Every frame's cells closed (their centres within reach), with the woods when given. */
function frames(site: IslandSite, discs: readonly Disc[], opts: SettleOptions): Occupancy {
  const { w, h, cell, origin } = site.ground
  const use = new Uint8Array(w * h)
  for (const d of discs) {
    const x0 = Math.max(0, Math.floor((d.c[0] - d.reach - origin[0]) / cell))
    const x1 = Math.min(w - 1, Math.floor((d.c[0] + d.reach - origin[0]) / cell))
    const z0 = Math.max(0, Math.floor((d.c[1] - d.reach - origin[1]) / cell))
    const z1 = Math.min(h - 1, Math.floor((d.c[1] + d.reach - origin[1]) / cell))
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        const p: Vec2 = [origin[0] + (x + 0.5) * cell, origin[1] + (z + 0.5) * cell]
        if (dist(p, d.c) < d.reach) use[z * w + x] = FRAME
      }
  }
  return opts.wood ? { use, wood: opts.wood } : { use }
}

const grid = (site: IslandSite, cost: Float32Array): CostGrid => ({
  w: site.ground.w,
  h: site.ground.h,
  cost,
  cell: site.ground.cell,
  origin: site.ground.origin,
})

/** The ground cell under p, -1 off the raster. */
function cellIndex(site: IslandSite, p: Vec2): number {
  const g = site.ground
  const x = Math.floor((p[0] - g.origin[0]) / g.cell)
  const z = Math.floor((p[1] - g.origin[1]) / g.cell)
  return x < 0 || z < 0 || x >= g.w || z >= g.h ? -1 : z * g.w + x
}

const isWater = (site: IslandSite, i: number): boolean =>
  site.ground.kind[i] === SEA || site.ground.kind[i] === LAKE

const ground = (site: IslandSite, p: Vec2): number => {
  const i = cellIndex(site, p)
  return i < 0 ? SEA : (site.ground.kind[i] as number)
}

/** The mean of f over the ground cells whose centres lie within the disc (cells off the raster count 0). */
function discMean(site: IslandSite, c: Vec2, reach: number, f: (i: number) => number): number {
  const g = site.ground
  const r = Math.ceil(reach / g.cell)
  const cx = Math.floor((c[0] - g.origin[0]) / g.cell)
  const cz = Math.floor((c[1] - g.origin[1]) / g.cell)
  let sum = 0
  let n = 0
  for (let z = cz - r; z <= cz + r; z++)
    for (let x = cx - r; x <= cx + r; x++) {
      const p: Vec2 = [g.origin[0] + (x + 0.5) * g.cell, g.origin[1] + (z + 0.5) * g.cell]
      if (dist(p, c) >= reach) continue
      n++
      if (x >= 0 && z >= 0 && x < g.w && z < g.h) sum += f(z * g.w + x)
    }
  return n === 0 ? 0 : sum / n
}
