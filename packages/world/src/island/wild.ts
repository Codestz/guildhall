/**
 * Growth step 7 (plan-w8 §4.7): the wild, on whatever land the island's earlier stages left free.
 * There is no second nature system here: the island's nature field (town/nature-field.ts over the
 * island's landform: its coast and lakes, its rock fields, the main town's radius, 2–4 clearings carved
 * into the biggest woods) is built from the site alone, so the router can read its woods as
 * `Occupancy.wood` before a road is laid (`woodCover`), and town/nature.ts plants it once over the
 * whole island, clear of the roads, the farms' fields, pastures, fences and buildings, and the
 * occupancy raster (settlement frames, POI pads, water).
 *
 * Then the wildlife, as data (motion and rendering are R5/W7's), sparse by decision: 3–5 grazing
 * herds (pastures first, then meadows), 2–3 deer groups wandering glade to glade, 10–20 rabbits in
 * warrens on the woods' rims, 2–3 bird flocks circling over a wood, a lake or a bay. Each herd has a
 * zone it lives in, a home inside it, a motion model with its idle points, and its species' day
 * (`HABITS`): grazers by day, deer at dawn and dusk, rabbits early and late, birds roosting at night.
 * Every draw is `roll("<what>:<zone id>")`, keyed by the zone, never by a counter shared across kinds.
 */
import { DMath } from "@guildhall/core"
import { area, centroid, contains, orient, type Ring } from "../geom/poly.ts"
import type { Roll } from "../geom/sample.ts"
import { dist, round3, snap, type Vec2 } from "../geom/vec.ts"
import { seedOf } from "../town/farms.ts"
import { type NatureField, type NatureLibrary, nature, natureField } from "../town/nature.ts"
import type { Block, Edge, StreetGraph } from "../town/types.ts"
import { OCCUPANTS, type Occupancy } from "./cost.ts"
import {
  type Countryside,
  GROUND_KINDS,
  type GroundGrid,
  type Herd,
  type IslandSite,
  type RoadNetwork,
  type Species,
  type Wild,
  type WildZone,
} from "./types.ts"

/** What `wild` reads beyond the pinned arguments, all optional. */
export interface WildOptions {
  /** The roads, tracks, trails and paths: nothing grows on them, trees line the roads. */
  network?: RoadNetwork
  /** The island's field, as built for the router (`wildField`); built here when absent. */
  field?: NatureField
  /** The main town's radius, for a field built here. */
  mainR?: number
  /** The growth rank every zone takes (ADR 014). */
  grown?: number
}

/** When a species is out and about (hours, 0–24, a range may wrap midnight), and where it rests. */
export interface Habit {
  active: [from: number, to: number][]
  /** Where it spends the rest of the day: a fold at its home, a bed in the wood, a burrow, a roost. */
  rest: "home" | "bed" | "burrow" | "roost"
}

/** Day and night, per species, for the crowd path. */
export const HABITS: Readonly<Record<Species, Habit>> = {
  sheep: { active: [[6, 20]], rest: "home" },
  cow: { active: [[6, 20]], rest: "home" },
  horse: { active: [[5.5, 21]], rest: "home" },
  deer: {
    active: [
      [4.5, 8.5],
      [17.5, 21.5],
    ],
    rest: "bed",
  },
  rabbit: {
    active: [
      [5, 9],
      [17, 22],
    ],
    rest: "burrow",
  },
  fox: { active: [[19, 5]], rest: "burrow" },
  bird: { active: [[5.5, 20.5]], rest: "roost" },
}

/** The sparse herd counts (decisions.md, W8 approvals): [min, max]. */
export const WILDLIFE = {
  grazing: [3, 5],
  deer: [2, 3],
  rabbits: [10, 20],
  flocks: [2, 3],
} as const

/** Clearings carved into the island's woods, beyond the glades the field makes itself. */
export const CLEARINGS = [2, 4] as const
/** Cover at and above which a ground cell is wood for its zones. */
const WOOD = 0.45
/** A rabbit's warren is on the rim: cover between these. */
const RIM = [0.12, WOOD] as const
/** Meadows are cut into tiles this wide, metres, so a zone stays local. */
const TILE = 128
/** The smallest wood, meadow and shore zone, m². */
const MIN_AREA = { wood: 1600, meadow: 2400, shore: 800 } as const
/** Shore zones are the coast's band cut in this many sectors round the island's centre. */
const SECTORS = 8
/** Warrens and deer homes keep this far apart, metres. */
const APART = { warren: 50, deer: 80 } as const
/** A deer group wanders to the glades within this distance of its own, metres. */
const WANDER = 220

const FREE = OCCUPANTS.indexOf("free")
const SEA = GROUND_KINDS.indexOf("sea")
const LAKE = GROUND_KINDS.indexOf("lake")
const LAND = GROUND_KINDS.indexOf("land")
const SHORE = GROUND_KINDS.indexOf("shore")

/**
 * The island's nature field, from its landform alone: the same for the router (through `woodCover`),
 * the POIs (glades, deep woods) and the wild, given the same `roll` and radius.
 */
export function wildField(site: IslandSite, roll: Roll, mainR?: number): NatureField {
  const [lo, hi] = CLEARINGS
  return natureField(
    {
      bounds: site.bounds,
      water: [...site.sea, ...site.lakes],
      rough: site.rough,
      radius: mainR,
      clearings: lo + Math.floor((hi - lo + 1) * roll("clearings")),
    },
    roll,
  )
}

/** The field's forest cover at each ground cell's centre (0 on water): `Occupancy.wood` for the router. */
export function woodCover(ground: GroundGrid, field: NatureField): Float32Array {
  const out = new Float32Array(ground.w * ground.h)
  for (let i = 0; i < out.length; i++) {
    const k = ground.kind[i]
    if (k === SEA || k === LAKE) continue
    out[i] = field.cover(centre(ground, i))
  }
  return out
}

export function wild(
  site: IslandSite,
  occupied: Occupancy,
  countryside: Countryside,
  lib: NatureLibrary,
  roll: Roll,
  opts: WildOptions = {},
): Wild {
  const field = opts.field ?? wildField(site, roll, opts.mainR)
  const g = site.ground
  const grown = opts.grown ?? 0
  const roads = roadMask(g, opts.network)
  const freeCell = (i: number) =>
    (occupied.use[i] as number) === FREE && g.kind[i] !== SEA && g.kind[i] !== LAKE

  const plants = nature(
    {
      bounds: site.bounds,
      blocks: site.land.map(
        (poly, id): Block => ({ id, poly: poly[0] ?? [], use: "green", district: "farm" }),
      ),
      water: [...site.sea, ...site.lakes],
      streets: streetsOf(opts.network),
      fields: countryside.fields,
      // Pastures keep their grass: closed like a paddock's fence, whatever the countryside fenced them with.
      edges: [
        ...countryside.edges,
        ...countryside.pastures.map(
          (ring, k): Edge => ({ id: -1 - k, kind: "fence", points: ring, closed: true, gaps: [] }),
        ),
      ],
      placements: countryside.placements,
      free: (p, clear) => {
        const x0 = Math.floor((p[0] - clear - g.origin[0]) / g.cell)
        const x1 = Math.floor((p[0] + clear - g.origin[0]) / g.cell)
        const z0 = Math.floor((p[1] - clear - g.origin[1]) / g.cell)
        const z1 = Math.floor((p[1] + clear - g.origin[1]) / g.cell)
        if (x0 < 0 || z0 < 0 || x1 >= g.w || z1 >= g.h) return false
        for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (!freeCell(z * g.w + x)) return false
        return true
      },
    },
    lib,
    roll,
    field,
  )

  // --- Zones. Each ground cell is wood, meadow or shore when it is free, open land off the roads.
  const cover = woodCover(g, field)
  const kindOf = new Uint8Array(g.w * g.h) // 0 none, 1 wood, 2 meadow, 3 shore
  for (let i = 0; i < kindOf.length; i++) {
    if (!freeCell(i) || roads[i]) continue
    const k = g.kind[i]
    if (k === SHORE) kindOf[i] = 3
    else if (k === LAND && field.glade(centre(g, i)) < 0) kindOf[i] = (cover[i] as number) >= WOOD ? 1 : 2
  }
  const tileOf = (i: number) => {
    const x = i % g.w
    const z = (i - x) / g.w
    return `${Math.floor((x * g.cell) / TILE)},${Math.floor((z * g.cell) / TILE)}`
  }
  const sectorOf = (i: number) => {
    const p = centre(g, i)
    const a = Math.atan2(p[1] - site.centre[1], p[0] - site.centre[0])
    return Math.floor(((a + Math.PI) / (2 * Math.PI)) * SECTORS) % SECTORS
  }
  const woods = components(g, kindOf, 1, () => 0, MIN_AREA.wood)
  const meadows = components(g, kindOf, 2, tileOf, MIN_AREA.meadow)
  const shores = components(g, kindOf, 3, sectorOf, MIN_AREA.shore)
  /** The meadow zone each meadow cell belongs to (index into `meadows`), -1 elsewhere. */
  const meadowAt = new Int32Array(g.w * g.h).fill(-1)
  meadows.forEach((m, k) => {
    for (const i of m.cells) meadowAt[i] = k
  })

  const zones: WildZone[] = []
  const zone = (id: string, kind: WildZone["kind"], poly: Ring): WildZone => {
    const z: WildZone = { id, kind, poly, grown }
    zones.push(z)
    return z
  }
  const pastures = countryside.pastures.map((ring, k) => zone(`pasture:${k}`, "pasture", ring))
  const woodZones = woods.map((c, k) => ({ zone: zone(`wood:${k}`, "wood", c.ring), comp: c }))
  // A glade nothing was built on (a road may cross one: roads like open ground).
  const glades = field.glades
    .filter((gl) => {
      const i = cellOf(g, gl.at)
      return i >= 0 && freeCell(i)
    })
    .map((gl) => ({
      glade: gl,
      zone: zone(`glade:${gl.id}`, "glade", circle(gl.at, gl.r, 12)),
      quiet: !roads[cellOf(g, gl.at)],
    }))
  const meadowZones = meadows.map((c, k) => ({ zone: zone(`meadow:${k}`, "meadow", c.ring), comp: c }))
  for (const [k, c] of shores.entries()) zone(`shore:${k}`, "shore", c.ring)
  // The sky: over the two biggest woods, each lake, and the bays (the harbour's first).
  const bigWoods = [...woodZones].sort((a, b) => b.comp.cells.length - a.comp.cells.length).slice(0, 2)
  const skyWoods = bigWoods.map((w, k) => ({
    zone: zone(`sky:wood:${k}`, "sky", w.zone.poly),
    home: w.comp.home,
  }))
  const skyWater = [
    ...site.lakes.map((ring, k) => ({
      zone: zone(`sky:lake:${k}`, "sky", ring),
      home: snap(centroid(ring)),
    })),
    ...[...site.bays]
      .sort((a, b) => Number(b.main) - Number(a.main))
      .map((bay) => {
        const mouth: Vec2 = [(bay.mouth[0][0] + bay.mouth[1][0]) / 2, (bay.mouth[0][1] + bay.mouth[1][1]) / 2]
        const at = snap([(bay.shore[0] + mouth[0]) / 2, (bay.shore[1] + mouth[1]) / 2])
        const r = Math.min(60, Math.max(25, dist(bay.mouth[0], bay.mouth[1]) / 2))
        return { zone: zone(`sky:${bay.id}`, "sky", circle(at, r, 16)), home: at }
      }),
  ]

  // --- Herds.
  const herds: Herd[] = []
  const between = (range: readonly [number, number], u: number) =>
    range[0] + Math.floor((range[1] - range[0] + 1) * u)

  // Grazing: one herd per pasture (the biggest first), then the biggest meadows, 3–5 in all.
  const grazeHomes = [
    ...pastures
      .map((z) => ({ zone: z, home: inside(z.poly), area: Math.abs(area(z.poly)) }))
      .sort((a, b) => b.area - a.area),
    ...[...meadowZones]
      .sort((a, b) => b.comp.cells.length - a.comp.cells.length)
      .map((m) => ({ zone: m.zone, home: m.comp.home, area: m.comp.cells.length * g.cell * g.cell })),
  ]
  const grazing = Math.min(grazeHomes.length, between(WILDLIFE.grazing, roll("grazing:wild")))
  for (const { zone: z, home, area: a } of grazeHomes.slice(0, grazing)) {
    const u = (k: number) => roll(`graze:${z.id}:${k}`)
    const species: Species =
      z.kind === "pasture"
        ? ((["sheep", "cow", "horse"] as const)[Math.floor(3 * u(0))] ?? "sheep")
        : u(0) < 0.6
          ? "sheep"
          : "horse"
    herds.push({
      id: `${species}-${herds.filter((h) => h.species === species).length}`,
      species,
      zone: z.id,
      count: 4 + Math.floor(5 * u(1)),
      home,
      motion: {
        model: "graze",
        radius: round3(Math.min(20, Math.max(5, 0.5 * Math.sqrt(a / Math.PI)))),
        speed: round3(0.4 + 0.2 * u(2)),
        dwell: [6, 20],
        cohesion: round3(0.6 + 0.3 * u(3)),
      },
      seed: seedOf(u(4)),
    })
  }

  // Deer: 2–3 groups, homes in glades far apart (no road through them), each wandering between its
  // glade and the nearest others.
  const quiet = glades.filter((gl) => gl.quiet)
  const deerHomes = spread(
    quiet.map((gl) => ({ at: gl.glade.at, item: gl })),
    between(WILDLIFE.deer, roll("deer:wild")),
    APART.deer,
  )
  // Too few quiet glades far apart: nearer ones are taken too, then a road's, up to the fewest groups.
  for (const gl of [...quiet, ...glades.filter((o) => !o.quiet)])
    if (deerHomes.length < WILDLIFE.deer[0] && !deerHomes.includes(gl)) deerHomes.push(gl)
  deerHomes.forEach(({ glade, zone: z }, n) => {
    const u = (k: number) => roll(`deer:${z.id}:${k}`)
    const others = glades
      .filter((o) => o.glade.id !== glade.id && dist(o.glade.at, glade.at) < WANDER)
      .sort((a, b) => dist(a.glade.at, glade.at) - dist(b.glade.at, glade.at) || a.glade.id - b.glade.id)
      .slice(0, 3)
    const stops = others.length > 0 ? [glade, ...others.map((o) => o.glade)] : [glade, glade, glade]
    const waypoints = stops.map((s, k) => {
      const a = 2 * Math.PI * u(10 + k)
      const d = (k === 0 ? 0 : 0.5) * s.r * u(20 + k)
      return snap([s.at[0] + d * DMath.cos(a), s.at[1] + d * DMath.sin(a)])
    })
    herds.push({
      id: `deer-${n}`,
      species: "deer",
      zone: z.id,
      count: 2 + Math.floor(3 * u(0)),
      home: waypoints[0] as Vec2,
      motion: { model: "wander", waypoints, speed: 1.4, dwell: [20, 60], shy: round3(20 + 10 * u(1)) },
      seed: seedOf(u(2)),
    })
  })

  // Rabbits: 10–20 in warrens of 2–4 on the woods' rims, in the meadow beside the wood.
  const rim: { at: Vec2; item: number }[] = []
  for (let i = 0; i < kindOf.length; i++) {
    const c = cover[i] as number
    if ((meadowAt[i] as number) < 0 || c < RIM[0] || c >= RIM[1]) continue
    // A wood's rim, not the coast's forest belt.
    const at = centre(g, i)
    if (field.woodAt(at) >= 0) rim.push({ at, item: i })
  }
  /** Open land a rabbit may hop over: a wood or meadow cell. */
  const hoppable = (p: Vec2) => {
    const i = cellOf(g, p)
    return i >= 0 && (kindOf[i] === 1 || kindOf[i] === 2)
  }
  const rabbits = between(WILDLIFE.rabbits, roll("rabbits:wild"))
  const warrens = spread(rim, Math.ceil(rabbits / 3), APART.warren)
  warrens.forEach((i, n) => {
    const count = Math.floor(rabbits / warrens.length) + (n < rabbits % warrens.length ? 1 : 0)
    const home = centre(g, i)
    const z = meadowZones[meadowAt[i] as number]?.zone as WildZone
    // Along the rim: across the slope of the cover, 8 m steps either way of the burrow.
    const gx = field.cover([home[0] + 4, home[1]]) - field.cover([home[0] - 4, home[1]])
    const gz = field.cover([home[0], home[1] + 4]) - field.cover([home[0], home[1] - 4])
    const l = Math.hypot(gx, gz) || 1
    const t: Vec2 = [-gz / l, gx / l]
    herds.push({
      id: `rabbit-${n}`,
      species: "rabbit",
      zone: z.id,
      count,
      home,
      motion: {
        model: "hop",
        along: [-16, -8, 0, 8, 16]
          .map((s) => snap([home[0] + s * t[0], home[1] + s * t[1]]))
          .filter((p) => hoppable(p)),
        speed: 3,
        burrow: home,
      },
      seed: seedOf(roll(`rabbit:${z.id}:${i}`)),
    })
  })

  // Birds: 2–3 flocks, over a wood first, then the water, then the next wood.
  const sky = [skyWoods[0], skyWater[0], skyWoods[1], ...skyWater.slice(1)].filter(
    (s): s is NonNullable<typeof s> => s !== undefined,
  )
  const flocks = Math.min(sky.length, between(WILDLIFE.flocks, roll("flocks:wild")))
  for (const [n, s] of sky.slice(0, flocks).entries()) {
    const u = (k: number) => roll(`flock:${s.zone.id}:${k}`)
    herds.push({
      id: `bird-${n}`,
      species: "bird",
      zone: s.zone.id,
      count: 5 + Math.floor(6 * u(0)),
      home: s.home,
      motion: {
        model: "circle",
        centre: s.home,
        radius: round3(25 + 20 * u(1)),
        height: [14, 30],
        speed: round3(6 + 3 * u(2)),
      },
      seed: seedOf(u(3)),
    })
  }

  return {
    nature: plants,
    clearings: field.glades.map((gl) => circle(gl.at, gl.r, 12)),
    zones,
    herds,
  }
}

/** A ground cell's centre. */
function centre(g: GroundGrid, i: number): Vec2 {
  const x = i % g.w
  const z = (i - x) / g.w
  return [g.origin[0] + (x + 0.5) * g.cell, g.origin[1] + (z + 0.5) * g.cell]
}

/** The ground cell under p, or -1 off the raster. */
function cellOf(g: GroundGrid, p: Vec2): number {
  const x = Math.floor((p[0] - g.origin[0]) / g.cell)
  const z = Math.floor((p[1] - g.origin[1]) / g.cell)
  return x < 0 || z < 0 || x >= g.w || z >= g.h ? -1 : z * g.w + x
}

/** The cells the network's land edges run through (an 8-connected line: it splits 4-connected zones). */
function roadMask(g: GroundGrid, network?: RoadNetwork): Uint8Array {
  const mask = new Uint8Array(g.w * g.h)
  for (const e of network?.edges ?? []) {
    if (e.walk === "pier" || e.walk === "boat-lane") continue
    for (let s = 1; s < e.points.length; s++) {
      const a = e.points[s - 1] as Vec2
      const b = e.points[s] as Vec2
      const n = Math.max(1, Math.ceil((4 * dist(a, b)) / g.cell))
      for (let q = 0; q <= n; q++) {
        const i = cellOf(g, [a[0] + ((b[0] - a[0]) * q) / n, a[1] + ((b[1] - a[1]) * q) / n])
        if (i >= 0) mask[i] = 1
      }
    }
  }
  return mask
}

/** The network as the street graph nature keeps clear of: roads are lined with trees, the rest are lanes. */
function streetsOf(network?: RoadNetwork): StreetGraph {
  return {
    nodes: [],
    edges: (network?.edges ?? [])
      .filter((e) => e.walk !== "pier" && e.walk !== "boat-lane")
      .map((e) => ({
        id: e.id,
        a: e.a,
        b: e.b,
        points: e.points,
        width: e.width,
        cls: e.cls === "road" ? "road" : "lane",
      })),
  }
}

interface Component {
  cells: number[]
  ring: Ring
  /** Its deepest cell's centre: a home that lies well inside it. */
  home: Vec2
}

/**
 * The 4-connected regions of cells of `kind` (never crossing between two `part`s), row-major order,
 * each at least `minArea` m², with its outline (the outer one: holes are left in) and a deep home.
 */
function components(
  g: GroundGrid,
  kinds: Uint8Array,
  kind: number,
  part: (i: number) => string | number,
  minArea: number,
): Component[] {
  const seen = new Uint8Array(kinds.length)
  const out: Component[] = []
  const inComp = new Int32Array(kinds.length).fill(-1)
  for (let s = 0; s < kinds.length; s++) {
    if (kinds[s] !== kind || seen[s]) continue
    const tag = part(s)
    const cells: number[] = []
    const stack = [s]
    seen[s] = 1
    while (stack.length > 0) {
      const i = stack.pop() as number
      cells.push(i)
      const x = i % g.w
      for (const j of [x > 0 ? i - 1 : -1, x < g.w - 1 ? i + 1 : -1, i - g.w, i + g.w])
        if (j >= 0 && j < kinds.length && !seen[j] && kinds[j] === kind && part(j) === tag) {
          seen[j] = 1
          stack.push(j)
        }
    }
    if (cells.length * g.cell * g.cell < minArea) continue
    cells.sort((a, b) => a - b)
    const id = out.length
    for (const i of cells) inComp[i] = id
    const mine = (x: number, z: number) =>
      x >= 0 && z >= 0 && x < g.w && z < g.h && inComp[z * g.w + x] === id
    out.push({ cells, ring: outline(g, cells, mine), home: deepest(g, cells, mine) })
  }
  return out
}

/**
 * The outer outline of a set of cells, as a CCW ring of cell corners with straight runs merged: every
 * side between a cell in the set and one out of it, linked head to tail into loops, the biggest kept.
 */
function outline(g: GroundGrid, cells: readonly number[], mine: (x: number, z: number) => boolean): Ring {
  const W = g.w + 1
  const next = new Map<number, number[]>()
  const link = (a: number, b: number) => {
    const list = next.get(a)
    if (list) list.push(b)
    else next.set(a, [b])
  }
  for (const i of cells) {
    const x = i % g.w
    const z = (i - x) / g.w
    const c = (cx: number, cz: number) => cz * W + cx
    // Each side runs with the cell on its left (x right, z down on the grid).
    if (!mine(x, z - 1)) link(c(x + 1, z), c(x, z))
    if (!mine(x - 1, z)) link(c(x, z), c(x, z + 1))
    if (!mine(x, z + 1)) link(c(x, z + 1), c(x + 1, z + 1))
    if (!mine(x + 1, z)) link(c(x + 1, z + 1), c(x + 1, z))
  }
  let best: number[] = []
  let bestArea = -1
  const starts = [...next.keys()].sort((a, b) => a - b)
  for (const s of starts) {
    while ((next.get(s)?.length ?? 0) > 0) {
      const loop: number[] = []
      let v = s
      do {
        loop.push(v)
        const list = next.get(v) as number[]
        v = list.shift() as number
      } while (v !== s && (next.get(v)?.length ?? 0) > 0)
      const pts = loop.map((k): Vec2 => [k % W, Math.floor(k / W)])
      const a = Math.abs(area(pts))
      if (a > bestArea) {
        bestArea = a
        best = loop
      }
    }
  }
  const pts = best.map(
    (k): Vec2 => [g.origin[0] + (k % W) * g.cell, g.origin[1] + Math.floor(k / W) * g.cell],
  )
  // Straight runs merged: keep a corner only where the outline turns.
  const ring = pts.filter((p, k) => {
    const a = pts[(k + pts.length - 1) % pts.length] as Vec2
    const b = pts[(k + 1) % pts.length] as Vec2
    return (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]) !== 0
  })
  return orient(ring)
}

/** The centre of the cell deepest in the set (the longest run to its edge, the shortest of four ways). */
function deepest(g: GroundGrid, cells: readonly number[], mine: (x: number, z: number) => boolean): Vec2 {
  const REACH = 8
  let best = cells[0] as number
  let bestDepth = -1
  for (const i of cells) {
    const x = i % g.w
    const z = (i - x) / g.w
    let depth = REACH
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      let k = 1
      while (k < depth && mine(x + k * dx, z + k * dz)) k++
      depth = Math.min(depth, k)
    }
    if (depth > bestDepth) {
      bestDepth = depth
      best = i
    }
  }
  return centre(g, best)
}

/**
 * Up to `n` items far apart: the first (in the given order) then, again and again, the one farthest
 * from those taken, while it is at least `apart` from them.
 */
function spread<T>(items: readonly { at: Vec2; item: T }[], n: number, apart: number): T[] {
  if (items.length === 0 || n <= 0) return []
  const taken = [items[0] as { at: Vec2; item: T }]
  const near = items.map((c) => dist(c.at, taken[0]?.at as Vec2))
  while (taken.length < n) {
    let k = -1
    for (let j = 0; j < items.length; j++) if (k < 0 || (near[j] as number) > (near[k] as number)) k = j
    if (k < 0 || (near[k] as number) < apart) break
    const pick = items[k] as { at: Vec2; item: T }
    taken.push(pick)
    for (let j = 0; j < items.length; j++)
      near[j] = Math.min(near[j] as number, dist(items[j]?.at as Vec2, pick.at))
  }
  return taken.map((t) => t.item)
}

/** A point well inside a ring: its centroid when that lies in it, else its vertex mean pulled to the nearest inside point. */
function inside(ring: Ring): Vec2 {
  const c = snap(centroid(ring))
  if (contains(ring, c)) return c
  // A bent paddock: the midpoint of the chord through the first vertex and its far opposite.
  const a = ring[0] as Vec2
  const b = ring[Math.floor(ring.length / 2)] as Vec2
  for (const t of [0.5, 0.35, 0.65, 0.2, 0.8]) {
    const p = snap([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
    if (contains(ring, p)) return p
  }
  return snap(a)
}

/** A circle as a CCW ring. */
function circle(at: Vec2, r: number, n: number): Ring {
  return Array.from({ length: n }, (_, k) =>
    snap([at[0] + r * DMath.cos((2 * Math.PI * k) / n), at[1] + r * DMath.sin((2 * Math.PI * k) / n)]),
  )
}
