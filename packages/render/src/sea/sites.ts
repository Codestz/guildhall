/**
 * Where the sea's life sails on an island (pure, worker-safe: no three): two laps round the island for
 * the merchants (world `seaRing`, inner and outer), the moorings by the harbour's piers with a lane out
 * from each past the outer lap (world `seaLane`), a lane for each errand (the quay's rowboat, the raid,
 * the cargo: `errandsOf`), and the lighthouse's lamp. Every hull keeps off land, inland water and the
 * piers' own tiles.
 */
import {
  HEX_KINDS,
  HEX_TILE_SIZE,
  type HexIsland,
  type HexWorld,
  type HexZones,
  hexCentre,
  type SeaRing,
  seaLane,
  seaRing,
  TILE_USES,
} from "@guildhall/world"
import { pathOf, pointAt, SEA } from "./plan.ts"

export interface Mooring {
  /** Where a rowboat lies, by the pier (xz). */
  at: [number, number]
  /** The pier's tile centre (xz): a raid's rowboat lands here. */
  pier: [number, number]
  /** The way out to sea from the mooring's tile, past the outer lap (xz, the mooring's tile first). */
  lane: [number, number][]
}

/**
 * A lane for each errand from the harbour (`errandsOf`): the quay's rowboat lies at `quay`, the raid
 * sails in along `raid`'s lane and anchors on it, a push's cargo ships sail out along `cargo`'s, a lane
 * of its own that keeps clear of the anchored raid and its rowboat's pull (`RAID_CLEAR`). With no
 * clear way out, the cargo shares the raid's lane (`shared`).
 */
export interface SeaErrands {
  quay: Mooring | null
  raid: Mooring | null
  cargo: Mooring | null
  shared: boolean
}

export interface SeaSites {
  /** The merchants' laps, inner then outer (closed rings). */
  laps: SeaRing[]
  /** The moorings by the harbour's piers (any pier's, with no harbour), shortest way out first. */
  moorings: Mooring[]
  /** Which mooring and lane each errand takes (absent from sites made before them: the layer picks). */
  errands?: SeaErrands
  /** The lighthouse's lamp (on its lantern) and the bearing out to sea from it, or null with none. */
  lighthouse: { lamp: [number, number, number]; seaward: number } | null
  /** The sea's surface, metres. */
  sea: number
}

/** How far each lap keeps off the land, metres: the inner one clear of the berths, the outer of it. */
export const LAP_CLEAR = [14, 26] as const
/** How far a lane runs on past the outer lap, metres. */
const BEYOND = 120
const LANTERN = "kaykit-halloween/lantern-standing"
/** The lantern's glass, a share of its height (0.93 m at scale 1). */
const GLASS = 0.42 * 0.93

/** How far the cargo's lane keeps off the raid's anchorage, metres (the pirate's half-length swinging there, the cargo's beam, water between). */
export const RAID_CLEAR = 12
/** How far the cargo's lane keeps off the raid's rowboat's pull between its ship and the pier, metres. */
const ROW_CLEAR = 3

/** Where the raid anchors on its lane (plan.ts `raidPose`): `RAID_OFF` metres out, or 0.4 of a shorter lane. */
export function raidAnchor(lane: readonly [number, number][]): { at: [number, number]; along: number } {
  const path = pathOf(lane)
  const along = Math.min(SEA.RAID_OFF, path.length * 0.4)
  const p = pointAt(path, along)
  return { at: [p.x, p.z], along }
}

/** The nearest distance from (x, z) to a polyline (its first `upTo` metres, else all of it). */
export function distanceToLane(
  lane: readonly [number, number][],
  x: number,
  z: number,
  upTo = Infinity,
): number {
  let best = Number.POSITIVE_INFINITY
  let run = 0
  for (let i = 1; i < lane.length && run < upTo; i++) {
    const [ax, az] = lane[i - 1] as [number, number]
    const [bx, bz] = lane[i] as [number, number]
    const dx = bx - ax
    const dz = bz - az
    const l = Math.hypot(dx, dz)
    const reach = Math.min(1, (upTo - run) / (l || 1))
    const u = Math.max(0, Math.min(reach, ((x - ax) * dx + (z - az) * dz) / (l * l || 1)))
    best = Math.min(best, Math.hypot(ax + dx * u - x, az + dz * u - z))
    run += l
  }
  return best
}

/**
 * The errands' moorings (`SeaErrands`): the quay's rowboat where it lies clearest of `keepOff` (the
 * harbour ships' berths); the raid on the shortest lane out of the rest that is clear of them; the
 * cargo from another mooring (another pier's first), on a lane `reroute` finds round the raid's
 * anchorage and its rowboat's pull (each tile whose centre lies in `blocked` is land to it), as clear
 * as it can (RAID_CLEAR, then less, then the anchorage alone). Pure.
 */
export function errandsOf(
  moorings: readonly Mooring[],
  keepOff: readonly (readonly [number, number])[],
  reroute: (m: Mooring, blocked: (x: number, z: number) => boolean) => [number, number][] | null,
): SeaErrands {
  const clearOf = (m: Mooring) =>
    keepOff.length ? Math.min(...keepOff.map(([x, z]) => Math.hypot(x - m.at[0], z - m.at[1]))) : 99
  const byClear = [...moorings].sort((a, b) => clearOf(b) - clearOf(a))
  const quay = byClear[0] ?? null
  const raid = moorings.find((m) => m !== quay && clearOf(m) > 4) ?? byClear[1] ?? quay
  if (!raid) return { quay, raid, cargo: null, shared: false }
  const anchor = raidAnchor(raid.lane)
  const samePier = (m: Mooring) => m.pier[0] === raid.pier[0] && m.pier[1] === raid.pier[1]
  const candidates = moorings
    .filter((m) => m !== raid)
    .map((m, i) => ({ m, i, rank: (samePier(m) ? 4 : 0) + (m === quay ? 2 : 0) + (clearOf(m) > 4 ? 0 : 1) }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((c) => c.m)
  for (const [clear, row] of [
    [RAID_CLEAR, true],
    [RAID_CLEAR, false],
    [9, true],
    [9, false],
  ] as const) {
    const blocked = (x: number, z: number) =>
      Math.hypot(x - anchor.at[0], z - anchor.at[1]) < clear ||
      (row && distanceToLane(raid.lane, x, z, anchor.along) < ROW_CLEAR)
    for (const m of candidates) {
      const lane = reroute(m, blocked)
      if (lane && distanceToLane(lane, anchor.at[0], anchor.at[1]) >= clear - 2.5)
        return { quay, raid, cargo: { ...m, lane }, shared: false }
    }
  }
  return { quay, raid, cargo: raid, shared: true }
}

export function seaSites(
  island: HexIsland,
  zones: HexZones,
  world: HexWorld,
  opts: { sea: number; keepOff?: readonly (readonly [number, number])[] },
): SeaSites {
  const g = island.grid
  const R = HEX_TILE_SIZE
  const dock = (i: number) => TILE_USES[zones.use[i] ?? 0] === "dock"
  const water = (i: number) => {
    const k = HEX_KINDS[island.kind[i] ?? 0]
    return (k === "sea" || k === "shallows") && !dock(i)
  }
  const solid = (i: number) => !water(i)
  const centre = (i: number): [number, number] => {
    const [x, z] = hexCentre({ q: g.q[i] ?? 0, r: g.r[i] ?? 0 })
    return [x * R, z * R]
  }
  const laps = LAP_CLEAR.map((clear) => seaRing(g, solid, { size: R, clear }))
  const outer = laps[laps.length - 1] as SeaRing

  // the harbour's piers: its own, and any beside its tiles (any pier's on an island with no harbour)
  const piers = new Set<number>()
  zones.zones.forEach((zone, zi) => {
    if (zone.kind !== "harbour") return
    for (let i = 0; i < g.size; i++) if (dock(i) && zones.zoneOf[i] === zi + 1) piers.add(i)
    for (const t of zone.tiles) for (const j of g.neighbours(t)) if (j >= 0 && dock(j)) piers.add(j)
  })
  // a harbour with no pier ties up at its own shore
  if (!piers.size)
    zones.zones.forEach((zone) => {
      if (zone.kind === "harbour")
        for (const t of zone.tiles) if (g.neighbours(t).some((j) => j >= 0 && water(j))) piers.add(t)
    })
  if (!piers.size) for (let i = 0; i < g.size; i++) if (dock(i)) piers.add(i)
  const moorings: Mooring[] = []
  /** Each mooring's water tile, where its lane starts. */
  const tileOf = new Map<Mooring, number>()
  const seen = new Set<number>()
  for (const p of piers)
    for (const j of g.neighbours(p)) {
      if (j < 0 || !water(j) || seen.has(j)) continue
      seen.add(j)
      const lane = seaLane(g, solid, j, outer, { size: R, beyond: BEYOND })
      if (!lane) continue
      const [px, pz] = centre(p)
      const [wx, wz] = centre(j)
      const m: Mooring = { at: [px + (wx - px) * 0.62, pz + (wz - pz) * 0.62], pier: [px, pz], lane }
      moorings.push(m)
      tileOf.set(m, j)
    }
  const length = (lane: [number, number][]) => {
    let d = 0
    for (let k = 1; k < lane.length; k++)
      d += Math.hypot(
        (lane[k] as [number, number])[0] - (lane[k - 1] as [number, number])[0],
        (lane[k] as [number, number])[1] - (lane[k - 1] as [number, number])[1],
      )
    return d
  }
  moorings.sort((a, b) => length(a.lane) - length(b.lane) || a.at[0] - b.at[0] || a.at[1] - b.at[1])

  // the lighthouse: its lantern's glass, on the landmark's tile
  let lighthouse: SeaSites["lighthouse"] = null
  for (let i = 0; i < g.size && !lighthouse; i++) {
    if (TILE_USES[zones.use[i] ?? 0] !== "lighthouse") continue
    const [x, z] = centre(i)
    const lantern = world.pieces
      .filter((p) => p.piece === LANTERN && Math.hypot(p.x - x, p.z - z) < R * 1.2)
      .sort((a, b) => b.y - a.y)[0]
    const top = world.tiles.find((t) => t.i === i)?.top ?? 0
    const lamp: [number, number, number] = lantern
      ? [lantern.x, lantern.y + GLASS * lantern.scale, lantern.z]
      : [x, top + 6, z]
    const [cx, cz] = outer.centre
    lighthouse = { lamp, seaward: Math.atan2(lamp[2] - cz, lamp[0] - cx) }
  }
  const kept = moorings.slice(0, 8)
  // the cargo's lane round the raid: the tiles whose centres lie in the way are land to it
  const reroute = (m: Mooring, blocked: (x: number, z: number) => boolean) => {
    const from = tileOf.get(m)
    if (from === undefined || blocked(...centre(from))) return null
    return seaLane(g, (i) => solid(i) || blocked(...centre(i)), from, outer, { size: R, beyond: BEYOND })
  }
  const errands = errandsOf(kept, opts.keepOff ?? [], reroute)
  return { laps, moorings: kept, errands, lighthouse, sea: opts.sea }
}
