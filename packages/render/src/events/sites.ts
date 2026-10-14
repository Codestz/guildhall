/**
 * Where the event FX happen on an island (pure, worker-safe: no three): the castle's keep (lightning),
 * each harbour's berths (or, with no harbour, a fishing village's or the first coastal place's) with a sea lane in to each (ships), and every place's heart (scaffolds).
 *
 * A berth is a water tile off the harbour, a tile or two from its shore, beside one of its piers where
 * it can, never on a pier's own tile and never next to another berth (a ship needs its room). Its lane
 * is found on the grid: from the berth, always on to the neighbouring water tile farthest from any land,
 * until the open sea, then straight out (turned, if land lies ahead) to `reach` metres; reversed, it is
 * the way in. So a ship never sails over land, however the coast bends.
 */
import {
  HEX_KINDS,
  HEX_TILE_SIZE,
  type HexIsland,
  type HexWorld,
  type HexZones,
  hexAt,
  hexCentre,
  type PeakSite,
  peakSite,
  pieceOutline,
  type SquareSite,
  solidToFoot,
  squareSite,
  TILE_USES,
} from "@guildhall/world"

export type Vec3 = [number, number, number]

export interface Berth {
  /** Where the ship lies, on the water. */
  at: Vec3
  /** The lane in, xz points from the open sea to `at` (its last point). */
  lane: [number, number][]
}

export interface HarbourSite {
  /** The zone's index (`zones.zones`). */
  zone: number
  heart: Vec3
  /** Nearest the harbour first. */
  berths: Berth[]
}

export interface PlaceSite {
  zone: number
  kind: string
  /** The repo unit it stands for, when the island was built from one. */
  id?: string
  /** Its heart tile's centre, on top. */
  at: Vec3
  /**
   * The building a scaffold goes up round: the biggest near its heart (`HEART_REACH` tiles), the middle
   * of its foot on the ground; the heart without one.
   */
  build: Vec3
  /** That building's front (its door's way, radians about +y, 0 = +z): the scaffold's frame. */
  yaw: number
  /** Its foot's half size in that frame (x across the front, z front to back), metres; 0 without one. */
  half: [number, number]
  /** Its height, metres (0 without one). */
  top: number
  /** That building's colour (a KayKit building's `-red`/`-blue`/`-green`/`-yellow`), when it has one: the scaffold's flag takes it. */
  colour?: string
}

/** A building piece's colour: the suffix of its name (`kaykit-hexagon/building-home-b-blue`), or none. */
export function pieceColour(piece: string): string | undefined {
  return /-(red|blue|green|yellow)$/.exec(piece)?.[1]
}

export interface EventSites {
  /** A little over the top of the castle's keep (where lightning strikes); null without a castle. */
  castle: Vec3 | null
  harbours: HarbourSite[]
  places: PlaceSite[]
  /** The island's peaks, where the dragon circles (world `peakSite`); null with no rock. */
  peak?: PeakSite | null
  /** The festival's poles round the busiest square (world `squareSite`); null without a square. */
  square?: SquareSite | null
}

export interface SiteOpts {
  /** The sea's surface, metres. */
  sea: number
  /** Berths per harbour at most. */
  berths?: number
  /** How far out a lane starts, metres from its berth. */
  reach?: number
}

/** The keep's height over its tile (the castle prefab's keep, scale B): lightning strikes its top. */
const KEEP_TOP = 9
const R = HEX_TILE_SIZE
/** How far from a place's heart (tiles) its scaffold looks for the biggest building. */
export const HEART_REACH = 3

/** A closed building's foot (an open one, a market's stalls or a range, is none) in a frame turned `yaw`. */
export interface Footing {
  /** The middle of its foot, xz. */
  at: [number, number]
  half: [number, number]
  top: number
  /** Its bulk (its foot's box in its own frame × its height, whatever `yaw`): the biggest has the most. */
  bulk: number
}

/**
 * A placed piece's foot as a box in the frame turned `yaw` (its front +z), or null when it is not a
 * closed building (stalls, props, trees). Pure.
 */
export function footing(
  p: { piece: string; x: number; z: number; rot: number; scale: number; stretch?: number },
  yaw: number,
): Footing | null {
  if (!solidToFoot(p.piece)) return null
  const o = pieceOutline(p.piece)
  if (!o) return null
  const c = Math.cos(p.rot)
  const s = Math.sin(p.rot)
  const cy = Math.cos(yaw)
  const sy = Math.sin(yaw)
  let x0 = Infinity
  let x1 = -Infinity
  let z0 = Infinity
  let z1 = -Infinity
  let own = [Infinity, -Infinity, Infinity, -Infinity]
  for (let k = 0; k + 1 < o.foot.length; k += 2) {
    const fx = (o.foot[k] as number) * (p.stretch ?? 1) * p.scale
    const fz = (o.foot[k + 1] as number) * p.scale
    own = [
      Math.min(own[0] as number, fx),
      Math.max(own[1] as number, fx),
      Math.min(own[2] as number, fz),
      Math.max(own[3] as number, fz),
    ]
    // the piece's frame to the world's (as doorways), then into the frame turned `yaw`
    const wx = fx * c + fz * s
    const wz = -fx * s + fz * c
    const lx = wx * cy - wz * sy
    const lz = wx * sy + wz * cy
    x0 = Math.min(x0, lx)
    x1 = Math.max(x1, lx)
    z0 = Math.min(z0, lz)
    z1 = Math.max(z1, lz)
  }
  if (!(x1 > x0 && z1 > z0)) return null
  const mx = (x0 + x1) / 2
  const mz = (z0 + z1) / 2
  const half: [number, number] = [(x1 - x0) / 2, (z1 - z0) / 2]
  const top = o.top * p.scale
  return {
    // the frame's middle back in the world
    at: [p.x + mx * cy + mz * sy, p.z - mx * sy + mz * cy],
    half,
    top,
    bulk: ((own[1] as number) - (own[0] as number)) * ((own[3] as number) - (own[2] as number)) * top,
  }
}

export function eventSites(island: HexIsland, zones: HexZones, world: HexWorld, opts: SiteOpts): EventSites {
  const g = island.grid
  const kindOf = (i: number) => HEX_KINDS[island.kind[i] ?? 0]
  const sea = (i: number) => i >= 0 && (kindOf(i) === "sea" || kindOf(i) === "shallows")
  const tops = new Map<number, number>()
  for (const t of world.tiles) tops.set(t.i, t.top)
  const centre = (i: number): [number, number] => {
    const [x, z] = hexCentre({ q: g.q[i] ?? 0, r: g.r[i] ?? 0 })
    return [x * R, z * R]
  }
  const top = (i: number): Vec3 => {
    const [x, z] = centre(i)
    return [x, tops.get(i) ?? 0, z]
  }
  // steps from the land, over the sea (0 on land and on inland water)
  const far = new Int16Array(g.size).fill(-1)
  const queue: number[] = []
  for (let i = 0; i < g.size; i++)
    if (!sea(i)) {
      far[i] = 0
      queue.push(i)
    }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head] as number
    for (const j of g.neighbours(i))
      if (j >= 0 && far[j] === -1) {
        far[j] = (far[i] ?? 0) + 1
        queue.push(j)
      }
  }
  const landAt = (x: number, z: number) => {
    const h = hexAt(x / R, z / R)
    const i = g.index(h.q, h.r)
    return i >= 0 && !sea(i)
  }

  const lane = (from: number, reach: number): [number, number][] => {
    const out: number[] = [from]
    let at = from
    for (let k = 0; k < 40 && (far[at] ?? 0) < 8; k++) {
      let best = -1
      let bestScore = -1e9
      const prev = out.length > 1 ? (out[out.length - 2] as number) : -1
      const [px, pz] = centre(at)
      const [qx, qz] = prev >= 0 ? centre(prev) : [px, pz]
      for (const j of g.neighbours(at)) {
        if (j < 0 || !sea(j) || out.includes(j)) continue
        const [jx, jz] = centre(j)
        // farther from land first; then straight on
        const straight = prev >= 0 ? ((jx - px) * (px - qx) + (jz - pz) * (pz - qz)) / (R * R * 3) : 0
        const score = (far[j] ?? 0) * 10 + straight
        if (score > bestScore) {
          bestScore = score
          best = j
        }
      }
      if (best < 0 || (far[best] ?? 0) < (far[at] ?? 0)) break
      out.push(best)
      at = best
    }
    const points = out.map(centre)
    // then straight out, turned off any land ahead
    const last = points[points.length - 1] as [number, number]
    const before = points.length > 1 ? (points[points.length - 2] as [number, number]) : centre(from)
    let heading =
      points.length > 1 ? Math.atan2(last[1] - before[1], last[0] - before[0]) : Math.atan2(last[1], last[0])
    let travelled = 0
    for (let k = 1; k < points.length; k++) {
      const [ax, az] = points[k - 1] as [number, number]
      const [bx, bz] = points[k] as [number, number]
      travelled += Math.hypot(bx - ax, bz - az)
    }
    const rest = Math.max(R * 4, reach - travelled)
    const clear = (h: number) => {
      for (let s = R; s <= rest; s += R)
        if (landAt(last[0] + Math.cos(h) * s, last[1] + Math.sin(h) * s)) return false
      return true
    }
    const turns = [0, 0.25, -0.25, 0.5, -0.5, 0.8, -0.8, 1.1, -1.1]
    const turn = turns.find((d) => clear(heading + d))
    if (turn !== undefined) heading += turn
    const steps = Math.ceil(rest / (R * 2))
    for (let s = 1; s <= steps; s++)
      points.push([
        last[0] + (Math.cos(heading) * (rest * s)) / steps,
        last[1] + (Math.sin(heading) * (rest * s)) / steps,
      ])
    return smooth(points.reverse())
  }

  const harbours: HarbourSite[] = []
  const max = opts.berths ?? 6
  const reach = opts.reach ?? 150
  const moor = (zone: HexZones["zones"][number], zi: number) => {
    const own = new Set(zone.tiles)
    const docks = new Set<number>()
    for (let i = 0; i < g.size; i++)
      if (TILE_USES[zones.use[i] ?? 0] === "dock" && zones.zoneOf[i] === zi + 1) docks.add(i)
    // the harbour's docks may sit off its own tiles: any dock beside one of them is its own
    for (const t of zone.tiles)
      for (const j of g.neighbours(t)) if (j >= 0 && TILE_USES[zones.use[j] ?? 0] === "dock") docks.add(j)
    const heart = top(zone.tile)
    const near = (i: number) => {
      const h = { q: g.q[i] ?? 0, r: g.r[i] ?? 0 }
      let best = 99
      for (const t of own) {
        const d =
          (Math.abs(h.q - (g.q[t] ?? 0)) +
            Math.abs(h.r - (g.r[t] ?? 0)) +
            Math.abs(h.q + h.r - (g.q[t] ?? 0) - (g.r[t] ?? 0))) /
          2
        if (d < best) best = d
      }
      return best
    }
    const candidates: { i: number; score: number }[] = []
    for (let i = 0; i < g.size; i++) {
      if (!sea(i) || docks.has(i) || TILE_USES[zones.use[i] ?? 0] === "dock") continue
      const f = far[i] ?? 0
      if (f < 1 || f > 2) continue
      const d = near(i)
      if (d > 4) continue
      const byPier = g.neighbours(i).some((j) => docks.has(j))
      // beside a pier, clear of the bank by a tile, near the harbour's own streets
      const [x, z] = centre(i)
      candidates.push({
        i,
        score:
          (byPier ? 6 : 0) + (f === 2 ? 3 : 0) - d * 1.5 - Math.hypot(x - heart[0], z - heart[2]) / (R * 8),
      })
    }
    candidates.sort((a, b) => b.score - a.score || a.i - b.i)
    const taken: number[] = []
    for (const c of candidates) {
      if (taken.length >= max) break
      if (taken.some((t) => t === c.i || g.neighbours(t).includes(c.i))) continue
      taken.push(c.i)
    }
    if (!taken.length) return false
    harbours.push({
      zone: zi,
      heart,
      berths: taken.map((i) => {
        const [x, z] = centre(i)
        return { at: [x, opts.sea, z] as Vec3, lane: lane(i, reach) }
      }),
    })
    return true
  }
  // the harbours; an island without one (a repo with no data or assets) moors at a fishing village, or
  // at the first place on the coast, so its pull requests still have somewhere to dock
  zones.zones.forEach((zone, zi) => {
    if (zone.kind === "harbour") moor(zone, zi)
  })
  if (!harbours.length)
    for (const kind of ["fishing", null])
      if (zones.zones.some((zone, zi) => (kind === null || zone.kind === kind) && moor(zone, zi))) break

  // the buildings by tile (closed ones, for their foot) and each building's door
  const piecesOn = new Map<number, HexWorld["pieces"]>()
  for (const p of world.pieces) {
    if (!solidToFoot(p.piece)) continue
    const h = hexAt(p.x / R, p.z / R)
    const i = g.index(h.q, h.r)
    if (i < 0) continue
    const list = piecesOn.get(i)
    if (list) list.push(p)
    else piecesOn.set(i, [p])
  }
  const doors = new Map(world.doorways.map((d) => [d.tile, d]))
  const plan = zones.castle
  const keep = plan ? top(plan.keep) : null
  // the shows' (render shows/): the peaks, and the square of the place with the most buildings
  const use = (i: number) => TILE_USES[zones.use[i] ?? 0]
  let busiest: HexZones["zones"][number] | null = null
  for (const zone of zones.zones)
    if (use(zone.tile) === "square" && (!busiest || zone.buildings > busiest.buildings)) busiest = zone
  const peak = peakSite(world.tiles, (i) => kindOf(i) === "rock" || kindOf(i) === "cliff")
  const square = busiest
    ? squareSite(
        g,
        busiest.tile,
        (i) => tops.get(i),
        (i) => use(i) === "road" || use(i) === "square",
        world.pieces,
      )
    : null
  return {
    castle: keep ? [keep[0], keep[1] + KEEP_TOP, keep[2]] : null,
    peak,
    square,
    harbours,
    places: zones.zones.map((zone, zi) => {
      const at = top(zone.tile)
      const heart = { q: g.q[zone.tile] ?? 0, r: g.r[zone.tile] ?? 0 }
      let best: { tile: number; f: Footing | null; yaw: number; score: number; piece?: string } | null = null
      for (const i of zone.tiles) {
        if (TILE_USES[zones.use[i] ?? 0] !== "building") continue
        const dq = (g.q[i] ?? 0) - heart.q
        const dr = (g.r[i] ?? 0) - heart.r
        const steps = (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2
        const b = top(i)
        const dist = Math.hypot(b[0] - at[0], b[2] - at[2])
        const door = doors.get(i)
        let f: Footing | null = null
        let yaw = 0
        let piece: string | undefined
        for (const p of piecesOn.get(i) ?? []) {
          const turn = door?.facing ?? p.rot
          const here = footing(p, turn)
          if (here && (!f || here.bulk > f.bulk)) {
            f = here
            yaw = turn
            piece = p.piece
          }
        }
        // the biggest closed building near the heart; failing any, the nearest building
        const score = steps <= HEART_REACH && f ? 1e6 + f.bulk : -dist
        if (!best || score > best.score) best = { tile: i, f, yaw, score, ...(piece ? { piece } : {}) }
      }
      if (!best)
        return {
          zone: zi,
          kind: zone.kind,
          ...(zone.place ? { id: zone.place.id } : {}),
          at,
          build: at,
          yaw: 0,
          half: [0, 0] as [number, number],
          top: 0,
        }
      const ground = top(best.tile)
      const f = best.f
      return {
        zone: zi,
        kind: zone.kind,
        ...(zone.place ? { id: zone.place.id } : {}),
        at,
        build: f ? ([f.at[0], ground[1], f.at[1]] as Vec3) : ground,
        yaw: f ? best.yaw : 0,
        half: f ? f.half : ([0, 0] as [number, number]),
        top: f ? f.top : 0,
        ...(best.piece && pieceColour(best.piece) ? { colour: pieceColour(best.piece) } : {}),
      }
    }),
  }
}

/** Chaikin's corner cutting, twice, ends kept: a lane's hex steps become a smooth course. */
export function smooth(points: [number, number][]): [number, number][] {
  let p = points
  for (let pass = 0; pass < 2 && p.length > 2; pass++) {
    const out: [number, number][] = [p[0] as [number, number]]
    for (let i = 0; i + 1 < p.length; i++) {
      const a = p[i] as [number, number]
      const b = p[i + 1] as [number, number]
      if (i > 0) out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25])
      if (i + 2 < p.length) out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75])
    }
    out.push(p[p.length - 1] as [number, number])
    p = out
  }
  return p
}
