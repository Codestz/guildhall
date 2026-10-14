/**
 * The sea's life (sea/, world events Task D): the lifecycles as pure functions of time (a cargo ship's
 * cast off, the galleon's visit and its sparks, the ghost's glide, the raid and its rowboat, the lamp),
 * the hull a pull request's diff gets, and on real islands every hull's course over open water only.
 */
import { describe, expect, test } from "bun:test"
import { HEX_KINDS, HEX_TILE_SIZE, hexAt, hexIsland, hexWorld, hexZones, TILE_USES } from "@guildhall/world"
import {
  anchorage,
  cargoPose,
  cargoStarts,
  galleonPose,
  ghostPose,
  lampOf,
  merchants,
  pathOf,
  pointAt,
  prHull,
  raidPose,
  SEA,
  type ShipPose,
} from "../src/sea/plan.ts"
import { seaSites } from "../src/sea/sites.ts"

const lane = pathOf([
  [0, 0],
  [10, 0],
  [10, 90],
])

describe("paths", () => {
  test("a point along a path, and round a closed one", () => {
    expect(lane.length).toBe(100)
    expect(pointAt(lane, 5)).toEqual({ x: 5, z: 0, heading: 0 })
    const p = pointAt(lane, 60)
    expect([p.x, p.z]).toEqual([10, 50])
    expect(p.heading).toBeCloseTo(Math.PI / 2, 9)
    // past the end of an open path: its end; round a closed one: back to the start
    expect(pointAt(lane, 500)).toMatchObject({ x: 10, z: 90 })
    const ring = pathOf(
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
      true,
    )
    expect(ring.length).toBe(40)
    expect(pointAt(ring, 45)).toMatchObject({ x: 5, z: 0 })
    expect(pointAt(ring, -5)).toMatchObject({ x: 0, z: 5 })
  })
})

describe("merchants", () => {
  const laps = [
    pathOf(
      Array.from({ length: 64 }, (_, k) => [
        Math.cos((k / 64) * Math.PI * 2) * 100,
        Math.sin((k / 64) * Math.PI * 2) * 100,
      ]) as [number, number][],
      true,
    ),
    pathOf(
      Array.from({ length: 64 }, (_, k) => [
        Math.cos((k / 64) * Math.PI * 2) * 130,
        Math.sin((k / 64) * Math.PI * 2) * 130,
      ]) as [number, number][],
      true,
    ),
  ]
  test("two ships, a lap each, the other way round, back where they were after a lap", () => {
    const [a, b] = merchants(laps, 50) as [ShipPose, ShipPose]
    expect(a.hull).toBe("merchant-large")
    expect(b.hull).toBe("merchant-medium")
    expect(Math.hypot(a.x, a.z)).toBeCloseTo(100, 0)
    expect(Math.hypot(b.x, b.z)).toBeCloseTo(130, 0)
    const [a2] = merchants(laps, 50 + SEA.LAP_S[0]) as [ShipPose]
    expect(a2.x).toBeCloseTo(a.x, 6)
    expect(a2.z).toBeCloseTo(a.z, 6)
    // the inner one runs counter-clockwise (+angle), the outer clockwise
    const angle = (p: ShipPose) => Math.atan2(p.z, p.x)
    const [a3, b3] = merchants(laps, 51) as [ShipPose, ShipPose]
    expect(Math.sin(angle(a3) - angle(a))).toBeGreaterThan(0)
    expect(Math.sin(angle(b3) - angle(b))).toBeLessThan(0)
    // a lap of 300 s round 628 m: about 2 m/s
    expect(Math.hypot(a3.x - a.x, a3.z - a.z)).toBeCloseTo((Math.PI * 200) / SEA.LAP_S[0], 0)
  })
})

describe("cargo", () => {
  test("pushes set out at least the gap apart", () => {
    const starts = cargoStarts([
      { key: "b", at: 1000, commits: 1 },
      { key: "a", at: 0, commits: 1 },
      { key: "c", at: 30_000, commits: 1 },
    ])
    expect(starts.map((s) => [s.push.key, s.start])).toEqual([
      ["a", 0],
      ["b", SEA.CARGO_GAP_S * 1000],
      ["c", 30_000],
    ])
  })
  test("a cargo ship casts off from the quay, out along the lane, and is gone in 16 s", () => {
    expect(cargoPose(lane, "p", 3, -0.1)).toBeNull()
    expect(cargoPose(lane, "p", 3, SEA.CARGO_S)).toBeNull()
    const start = cargoPose(lane, "p", 3, 0) as ShipPose
    expect([start.x, start.z]).toEqual([0, 0])
    expect(start.seen).toBe(0)
    const early = cargoPose(lane, "p", 3, 2) as ShipPose
    const later = cargoPose(lane, "p", 3, 8) as ShipPose
    // slow off the quay, then away
    expect(early.x).toBeLessThan(3)
    expect(pointAt(lane, 0).x).toBe(0)
    expect(later.z).toBeGreaterThan(early.z)
    expect(early.seen).toBe(1)
    expect((cargoPose(lane, "p", 3, SEA.CARGO_S - 0.5) as ShipPose).seen).toBeLessThan(0.1)
    // a crate a commit, one to six
    expect((cargoPose(lane, "p", 0, 1) as ShipPose).crates).toBe(1)
    expect((cargoPose(lane, "p", 40, 1) as ShipPose).crates).toBe(SEA.CRATES)
  })
})

describe("galleon", () => {
  const rings = [100, 130].map((r) => ({
    centre: [0, 0] as [number, number],
    points: Array.from({ length: 64 }, (_, k) => [
      Math.cos((k / 64) * Math.PI * 2) * r,
      Math.sin((k / 64) * Math.PI * 2) * r,
    ]) as [number, number][],
  }))
  const at = anchorage(rings, 0)
  test("it anchors between the laps, broadside", () => {
    expect(Math.hypot(at.x, at.z)).toBeCloseTo(115, 0)
    // broadside: along the laps, across the way out
    expect(Math.cos(at.heading - at.out)).toBeCloseTo(0, 6)
  })
  test("sails in for 11 s, stays 120 s with its sparks once, sails off in 14 s", () => {
    const { GALLEON_IN_S: IN, GALLEON_STAY_S: STAY, GALLEON_OUT_S: OUT } = SEA
    expect(galleonPose(at, "r", -1)).toBeNull()
    const coming = galleonPose(at, "r", 2)
    expect(coming?.sparks).toBeNull()
    expect(Math.hypot((coming?.pose.x ?? 0) - at.x, (coming?.pose.z ?? 0) - at.z)).toBeGreaterThan(20)
    const anchored = galleonPose(at, "r", IN + 0.5)
    expect(anchored?.pose).toMatchObject({ x: at.x, z: at.z, way: 0, seen: 1 })
    expect(anchored?.sparks).toBeGreaterThan(0)
    expect(galleonPose(at, "r", IN + SEA.SPARKS_S + 1)?.sparks).toBeNull()
    expect(galleonPose(at, "r", IN + STAY - 1)?.pose.x).toBe(at.x)
    const leaving = galleonPose(at, "r", IN + STAY + OUT * 0.5)
    expect(Math.hypot(leaving?.pose.x ?? 0, leaving?.pose.z ?? 0)).toBeGreaterThan(115)
    expect(galleonPose(at, "r", IN + STAY + OUT)).toBeNull()
  })
})

describe("shows", () => {
  const lap = pathOf(
    Array.from({ length: 128 }, (_, k) => [
      Math.cos((k / 128) * Math.PI * 2) * 100,
      Math.sin((k / 128) * Math.PI * 2) * 100,
    ]) as [number, number][],
    true,
  )
  test("the ghost glides past its coast for 36 s, fading in and out", () => {
    const at = (s: number, left: number | null = null) => ghostPose(lap, [0, 0], Math.PI / 2, s, left)
    expect(at(-1)).toBeNull()
    expect(at(SEA.GHOST_S)).toBeNull()
    expect(at(0)?.seen).toBe(0)
    const mid = at(SEA.GHOST_S / 2) as ShipPose
    expect(mid.seen).toBe(1)
    // halfway, it passes the coast it was sent past (bearing +z)
    expect(Math.atan2(mid.z, mid.x)).toBeCloseTo(Math.PI / 2, 1)
    expect(Math.hypot(mid.x, mid.z)).toBeCloseTo(100, 0)
    // told to go early, it fades within 6 s
    expect((at(10, 3) as ShipPose).seen).toBeLessThan(1)
    expect(at(10, 6)).toBeNull()
  })
  test("the raid sails in, anchors broadside, rows to the pier and back until its end, then sails off", () => {
    const { RAID_IN_S: IN, RAID_OUT_S: OUT, ROW_S: ROW, ROW_WAIT_S: WAIT } = SEA
    expect(raidPose(lane, -1, null)).toEqual({ ship: null, boat: null })
    const coming = raidPose(lane, 2, null)
    expect(coming.boat).toBeNull()
    expect(coming.ship?.z).toBeGreaterThan(50)
    const anchored = raidPose(lane, IN + 1, null)
    const anchor = pointAt(lane, SEA.RAID_OFF)
    expect(anchored.ship).toMatchObject({ x: anchor.x, z: anchor.z, way: 0 })
    expect(Math.cos((anchored.ship?.heading ?? 0) - anchor.heading)).toBeCloseTo(0, 6)
    // the rowboat: by the ship, then at the pier (the lane's start), then back
    const row = (s: number) => raidPose(lane, IN + 2 + s, null).boat as ShipPose
    expect(Math.hypot(row(WAIT / 2).x - anchor.x, row(WAIT / 2).z - anchor.z)).toBeLessThan(5)
    expect(Math.hypot(row(WAIT + ROW + 1).x, row(WAIT + ROW + 1).z)).toBeLessThan(0.01)
    const cycle = 2 * (ROW + WAIT)
    expect(row(cycle + 1).x).toBeCloseTo(row(1).x, 6)
    // ended: the boat is taken up, the ship sails off and is gone
    const leaving = raidPose(lane, IN + 100, 5)
    expect(leaving.boat).toBeNull()
    expect(leaving.ship?.way).toBeGreaterThan(0)
    expect(raidPose(lane, IN + 100, OUT).ship).toBeNull()
  })
})

describe("the lighthouse", () => {
  test("warm and steady when passed, a slow red pulse when failed, an amber turning beam while running, dark before", () => {
    expect(lampOf(null, 0, 0).glow).toBe(0)
    const warm = lampOf("passed", 0, 5000)
    expect(warm).toEqual(lampOf("passed", 0, 9000))
    expect(warm.beam).toBeNull()
    const pulse = [0, 625, 1250, 1875, 2500].map((t) => lampOf("failed", 0, t).glow)
    expect(pulse[0]).toBeCloseTo(1, 6)
    expect(pulse[2]).toBeCloseTo(0.3, 6)
    expect(pulse[4]).toBeCloseTo(1, 6)
    expect(lampOf("failed", 0, 0).colour[0]).toBeGreaterThan(lampOf("failed", 0, 0).colour[1] * 4)
    const a = lampOf("running", 0, 1000)
    const b = lampOf("running", 0, 2000)
    expect((b.beam ?? 0) - (a.beam ?? 0)).toBeCloseTo(1.6, 6)
    expect(lampOf("queued", 0, 0).colour).toEqual(a.colour)
  })
})

describe("a pull request's hull", () => {
  test("small, medium, large by its diff, growing within each band", () => {
    expect(prHull(5).piece).toBe("kenney-pirate/ship-small")
    expect(prHull(200).piece).toBe("kenney-pirate/ship-medium")
    expect(prHull(3000).piece).toBe("kenney-pirate/ship-large")
    expect(prHull(70).scale).toBeGreaterThan(prHull(2).scale)
    expect(prHull(Number.NaN)).toEqual(prHull(1))
    // never shrinks as the diff grows, in metres stem to stern
    const LENGTH: Record<string, number> = {
      "kenney-pirate/ship-small": 14.3,
      "kenney-pirate/ship-medium": 17.23,
      "kenney-pirate/ship-large": 21.29,
    }
    let last = 0
    for (let n = 1; n < 20000; n *= 1.5) {
      const h = prHull(n)
      const m = (LENGTH[h.piece] as number) * h.scale
      expect(m).toBeGreaterThanOrEqual(last - 1e-9)
      last = m
    }
  })
})

describe("on an island", () => {
  for (const seed of [1, 4]) {
    test(`seed ${seed}: every hull's course keeps to open water`, () => {
      const island = hexIsland({ seed, files: 4000 })
      const zones = hexZones(island, {})
      const world = hexWorld(island, zones, {})
      const sites = seaSites(island, zones, world, { sea: -0.05 })
      const g = island.grid
      const R = HEX_TILE_SIZE
      const open = (x: number, z: number) => {
        const h = hexAt(x / R, z / R)
        const i = g.index(h.q, h.r)
        if (i < 0) return true
        const k = HEX_KINDS[island.kind[i] ?? 0]
        return (k === "sea" || k === "shallows") && TILE_USES[zones.use[i] ?? 0] !== "dock"
      }
      expect(sites.laps.length).toBe(2)
      expect(sites.moorings.length).toBeGreaterThan(0)
      const laps = sites.laps.map((r) => pathOf(r.points, true))
      for (const lap of laps)
        for (let d = 0; d < lap.length; d += 1) expect(open(pointAt(lap, d).x, pointAt(lap, d).z)).toBe(true)
      const m = sites.moorings[0] as (typeof sites.moorings)[number]
      const lane = pathOf(m.lane)
      const along = (pose: ShipPose | null) => {
        if (pose) expect(open(pose.x, pose.z)).toBe(true)
      }
      for (let s = 0; s < SEA.CARGO_S; s += 0.25) along(cargoPose(lane, "c", 3, s))
      for (let s = 0; s < 200; s += 0.5) {
        const r = raidPose(lane, s, s > 150 ? s - 150 : null)
        along(r.ship)
        along(r.boat)
      }
      const c = sites.laps[0]?.centre ?? [0, 0]
      const anchor = anchorage(sites.laps, Math.atan2(m.at[1] - c[1], m.at[0] - c[0]))
      for (let s = 0; s < 145; s += 0.5) along(galleonPose(anchor, "g", s)?.pose ?? null)
      for (let b = 0; b < 6; b++)
        for (let s = 0; s < SEA.GHOST_S; s += 0.5)
          along(ghostPose(laps[0] as ReturnType<typeof pathOf>, c, b, s, null))
      // the lighthouse's lamp stands over its tile, up its tower
      if (zones.use.some((u) => TILE_USES[u] === "lighthouse")) {
        expect(sites.lighthouse).not.toBeNull()
        expect(sites.lighthouse?.lamp[1]).toBeGreaterThan(3)
      }
    })
  }
})
