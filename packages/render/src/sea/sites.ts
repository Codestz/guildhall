/**
 * Where the sea's life sails on an island (pure, worker-safe: no three): two laps round the island for
 * the merchants (world `seaRing`, inner and outer), the moorings by the harbour's piers with a lane out
 * from each past the outer lap (world `seaLane`), and the lighthouse's lamp. Every hull keeps off land,
 * inland water and the piers' own tiles.
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

export interface Mooring {
  /** Where a rowboat lies, by the pier (xz). */
  at: [number, number]
  /** The pier's tile centre (xz): a raid's rowboat lands here. */
  pier: [number, number]
  /** The way out to sea from the mooring's tile, past the outer lap (xz, the mooring's tile first). */
  lane: [number, number][]
}

export interface SeaSites {
  /** The merchants' laps, inner then outer (closed rings). */
  laps: SeaRing[]
  /** The moorings by the harbour's piers (any pier's, with no harbour), shortest way out first. */
  moorings: Mooring[]
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

export function seaSites(
  island: HexIsland,
  zones: HexZones,
  world: HexWorld,
  opts: { sea: number },
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
  const seen = new Set<number>()
  for (const p of piers)
    for (const j of g.neighbours(p)) {
      if (j < 0 || !water(j) || seen.has(j)) continue
      seen.add(j)
      const lane = seaLane(g, solid, j, outer, { size: R, beyond: BEYOND })
      if (!lane) continue
      const [px, pz] = centre(p)
      const [wx, wz] = centre(j)
      moorings.push({ at: [px + (wx - px) * 0.62, pz + (wz - pz) * 0.62], pier: [px, pz], lane })
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
  return { laps, moorings: moorings.slice(0, 8), lighthouse, sea: opts.sea }
}
