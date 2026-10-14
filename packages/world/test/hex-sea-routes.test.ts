/**
 * The sea's routes (sites.ts `seaRing`, `seaLane`; world events Task D): the merchants' laps keep their
 * distance from every solid tile all the way round, and a lane out from a pier's water runs over open
 * water only and ends outside the outer lap. Swept over seeds and island sizes.
 */
import { describe, expect, test } from "bun:test"
import {
  HEX_KINDS,
  HEX_TILE_SIZE,
  hexAt,
  hexCentre,
  hexIsland,
  hexZones,
  ringRadius,
  seaLane,
  seaRing,
  TILE_USES,
} from "../src/index.ts"

const R = HEX_TILE_SIZE

function islandOf(seed: number, files: number) {
  const island = hexIsland({ seed, files })
  const zones = hexZones(island, {})
  const g = island.grid
  const dock = (i: number) => TILE_USES[zones.use[i] ?? 0] === "dock"
  const solid = (i: number) => {
    const k = HEX_KINDS[island.kind[i] ?? 0]
    return !(k === "sea" || k === "shallows") || dock(i)
  }
  const tileAt = (x: number, z: number) => {
    const h = hexAt(x / R, z / R)
    return g.index(h.q, h.r)
  }
  const solids: [number, number][] = []
  for (let i = 0; i < g.size; i++)
    if (solid(i)) {
      const [x, z] = hexCentre({ q: g.q[i] ?? 0, r: g.r[i] ?? 0 })
      solids.push([x * R, z * R])
    }
  return { island, zones, g, solid, dock, tileAt, solids }
}

/** Points every `step` metres along a polyline (closed: back to the first). */
function dense(points: readonly [number, number][], step: number, closed: boolean): [number, number][] {
  const out: [number, number][] = []
  const n = closed ? points.length : points.length - 1
  for (let k = 0; k < n; k++) {
    const a = points[k] as [number, number]
    const b = points[(k + 1) % points.length] as [number, number]
    const d = Math.hypot(b[0] - a[0], b[1] - a[1])
    const m = Math.max(1, Math.ceil(d / step))
    for (let s = 0; s < m; s++) out.push([a[0] + ((b[0] - a[0]) * s) / m, a[1] + ((b[1] - a[1]) * s) / m])
  }
  return out
}

const CASES = [
  [1, 4000],
  [2, 1500],
  [3, 12000],
  [7, 500],
  [11, 4000],
] as const

describe("sea routes", () => {
  for (const [seed, files] of CASES)
    test(`seed ${seed}, ${files} files: the laps keep their distance and the lanes keep to open water`, () => {
      const { g, solid, dock, tileAt, solids } = islandOf(seed, files)
      const rings = [16, 30].map((clear) => ({ clear, ring: seaRing(g, solid, { size: R, clear }) }))
      for (const { clear, ring } of rings) {
        expect(ring.points.length).toBe(256)
        let closest = Number.POSITIVE_INFINITY
        for (const [x, z] of dense(ring.points, 0.5, true))
          for (const [sx, sz] of solids) closest = Math.min(closest, Math.hypot(x - sx, z - sz) - R)
        // never nearer any solid tile's corners than the clearance (a little lost on a chord)
        expect(closest).toBeGreaterThan(clear - 0.5)
        // and not flung far out: somewhere it comes within a few tiles of its clearance
        expect(closest).toBeLessThan(clear + R * 3)
      }
      const [inner, outer] = rings.map((r) => r.ring) as [
        ReturnType<typeof seaRing>,
        ReturnType<typeof seaRing>,
      ]
      // the outer lap lies outside the inner one at every bearing
      for (let k = 0; k < 64; k++) {
        const b = (k / 64) * Math.PI * 2
        expect(ringRadius(outer, b)).toBeGreaterThan(ringRadius(inner, b) + 8)
      }
      let lanes = 0
      for (let i = 0; i < g.size; i++) {
        if (!dock(i)) continue
        for (const j of g.neighbours(i)) {
          if (j < 0 || solid(j)) continue
          const lane = seaLane(g, solid, j, outer, { size: R, beyond: 120 })
          // a pocket of water the piers close in has no way out
          if (!lane) continue
          lanes++
          for (const [x, z] of dense(lane, 0.5, false)) {
            const t = tileAt(x, z)
            if (t >= 0) expect(solid(t)).toBe(false)
          }
          const [ex, ez] = lane[lane.length - 1] as [number, number]
          const [cx, cz] = outer.centre
          expect(Math.hypot(ex - cx, ez - cz)).toBeGreaterThan(
            ringRadius(outer, Math.atan2(ez - cz, ex - cx)),
          )
        }
      }
      expect(lanes).toBeGreaterThan(0)
    })
})
