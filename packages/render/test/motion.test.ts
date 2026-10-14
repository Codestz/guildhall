/**
 * Natural motion on the water (sea/swell.ts, sea/course.ts): every hull's pose is a function of time
 * alone (a seek lands where play would), its way and its turn never jump, it rides the swell the water
 * draws, and on real islands no hull (bow, stern or swinging at anchor) ever touches land.
 */
import { describe, expect, test } from "bun:test"
import { HEX_KINDS, HEX_TILE_SIZE, hexAt, hexIsland, hexWorld, hexZones, TILE_USES } from "@guildhall/world"
import { arriveAlong, FLEET, planFleet, type Voyage, voyagePose } from "../src/events/fleet.ts"
import { voyagePlace } from "../src/events/ships.ts"
import { eventSites } from "../src/events/sites.ts"
import { courseAt, pacedAt, pacedLap, rounded, roundedPath, wayAlong } from "../src/sea/course.ts"
import {
  anchorage,
  cargoPose,
  galleonPose,
  ghostPose,
  merchants,
  type Path,
  pathOf,
  raidPose,
  SEA,
  type ShipPose,
} from "../src/sea/plan.ts"
import { seaSites } from "../src/sea/sites.ts"
import {
  anchorSwing,
  attitudeOf,
  FEEL,
  rideAt,
  seaBob,
  swellHeight,
  WIND,
  windPace,
} from "../src/sea/swell.ts"

const ring = (r: number, n = 64): [number, number][] =>
  Array.from({ length: n }, (_, k) => [
    Math.cos((k / n) * Math.PI * 2) * r,
    Math.sin((k / n) * Math.PI * 2) * r,
  ])

const FRAME = 1 / 60

/**
 * Samples a lifecycle at 60 Hz over [from, to) and returns the biggest change of velocity between
 * frames (m/s) and of heading rate (rad/s), skipping frames where it is not on the water.
 */
function jerk(at: (s: number) => { x: number; z: number; heading: number } | null, from: number, to: number) {
  let dv = 0
  let dw = 0
  let last: { vx: number; vz: number; w: number } | null = null
  for (let s = from; s < to; s += FRAME) {
    const a = at(s)
    const b = at(s + FRAME)
    if (!a || !b) {
      last = null
      continue
    }
    const v = {
      vx: (b.x - a.x) / FRAME,
      vz: (b.z - a.z) / FRAME,
      w: Math.atan2(Math.sin(b.heading - a.heading), Math.cos(b.heading - a.heading)) / FRAME,
    }
    if (last) {
      dv = Math.max(dv, Math.hypot(v.vx - last.vx, v.vz - last.vz))
      dw = Math.max(dw, Math.abs(v.w - last.w))
    }
    last = v
  }
  return { dv, dw }
}

describe("the swell", () => {
  test("the sea's bob is the water shader's, and the swell is a few centimetres", () => {
    expect(seaBob(0)).toBe(0)
    expect(seaBob(1)).toBeCloseTo(0.05 * (0.6 * Math.sin(1.1) + 0.4 * Math.sin(0.7)), 12)
    let top = 0
    for (let i = 0; i < 400; i++) top = Math.max(top, Math.abs(swellHeight(i * 1.7, i * -2.3, i * 0.31)))
    expect(top).toBeGreaterThan(0.03)
    expect(top).toBeLessThanOrEqual(0.078 + 1e-9)
  })

  test("a small boat bobs more than the galleon on the same water", () => {
    const spread = (feel: (typeof FEEL)[keyof typeof FEEL]) => {
      let heave = 0
      let roll = 0
      for (let t = 0; t < 60; t += 0.1) {
        const r = rideAt(feel, 30, -12, 0.4, t, 1)
        heave = Math.max(heave, Math.abs(r.heave - seaBob(t)))
        roll = Math.max(roll, Math.abs(r.roll))
      }
      return { heave, roll }
    }
    const boat = spread(FEEL.rowboat)
    const galleon = spread(FEEL.galleon)
    expect(boat.heave).toBeGreaterThan(galleon.heave * 1.5)
    expect(boat.roll).toBeGreaterThan(galleon.roll * 1.5)
    // and nothing is thrown about: a few degrees at most
    expect(boat.roll).toBeLessThan(0.2)
  })

  test("at anchor a hull wanders well under a metre and swings a few degrees, none of it until it has settled", () => {
    let far = 0
    let yaw = 0
    for (let t = 0; t < 600; t += 0.5) {
      const s = anchorSwing(FEEL.galleon, 40, 40, t, 2, 1)
      far = Math.max(far, Math.hypot(s.dx, s.dz))
      yaw = Math.max(yaw, Math.abs(s.yaw))
    }
    expect(far).toBeGreaterThan(0.2)
    expect(far).toBeLessThan(1.2)
    expect(yaw).toBeGreaterThan(0.02)
    expect(yaw).toBeLessThan(0.1)
    const none = anchorSwing(FEEL.galleon, 40, 40, 77, 2, 0)
    expect(Math.abs(none.dx) + Math.abs(none.dz) + Math.abs(none.yaw)).toBe(0)
  })

  test("a hull heels into its turn, more the faster it goes, and the wind heels a ship under sail", () => {
    const base = { x: 0, z: 0, heading: WIND + Math.PI / 2, hold: 0, way: 0 }
    const still = attitudeOf({ ...base, speed: 0, yawRate: 0 }, FEEL.medium, 10, 0)
    const slow = attitudeOf({ ...base, speed: 2, yawRate: 0.05 }, FEEL.medium, 10, 0)
    const fast = attitudeOf({ ...base, speed: 6, yawRate: 0.05 }, FEEL.medium, 10, 0)
    // to starboard (+ yaw rate): it leans to starboard (+ roll)
    expect(slow.roll).toBeGreaterThan(still.roll)
    expect(fast.roll - still.roll).toBeGreaterThan(slow.roll - still.roll)
    const port = attitudeOf({ ...base, speed: 6, yawRate: -0.05 }, FEEL.medium, 10, 0)
    expect(port.roll).toBeLessThan(still.roll)
    const sailing = attitudeOf({ ...base, speed: 0, yawRate: 0, way: 1 }, FEEL.medium, 10, 0, { sails: true })
    expect(Math.abs(sailing.roll - still.roll)).toBeGreaterThan(0.03)
  })

  test("a sailing ship is slowest into the wind, quickest across it", () => {
    expect(windPace(WIND + Math.PI)).toBeLessThan(windPace(WIND + Math.PI / 2))
    expect(windPace(WIND + Math.PI)).toBeLessThan(windPace(WIND))
  })
})

describe("courses", () => {
  test("a rounded route keeps its ends and stays near its corners", () => {
    const pts: [number, number][] = [
      [0, 0],
      [20, 0],
      [20, 20],
    ]
    const r = rounded(pts)
    expect(r[0]).toEqual([0, 0])
    expect(r[r.length - 1]).toEqual([20, 20])
    for (const [x, z] of r) expect(Math.min(Math.abs(z), Math.abs(x - 20))).toBeLessThan(4)
  })

  test("the heading turns smoothly through a corner (no step at a vertex)", () => {
    const path = roundedPath([
      [0, 0],
      [30, 0],
      [30, 30],
    ])
    let step = 0
    for (let d = 0; d < path.length; d += 0.1) {
      const a = courseAt(path, d).heading
      const b = courseAt(path, d + 0.1).heading
      step = Math.max(step, Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a))))
    }
    expect(step).toBeLessThan(0.03)
  })

  test("a voyage takes its time exactly, gathers way from rest and comes to rest, with no jump in speed", () => {
    const L = 100
    const T = 20
    const d = (t: number) => wayAlong(t, T, L, { gather: 5, slow: 6, overshoot: 0.8, settle: 3 })
    expect(d(0)).toBe(0)
    expect(d(T)).toBeCloseTo(L, 9)
    // from rest and to rest
    expect((d(0.05) - d(0)) / 0.05).toBeLessThan(0.2)
    expect(Math.abs(d(T) - d(T - 0.05)) / 0.05).toBeLessThan(0.2)
    // it runs past and settles back
    let past = 0
    for (let t = T - 3; t < T; t += 0.05) past = Math.max(past, d(t) - L)
    expect(past).toBeGreaterThan(0.3)
    let jump = 0
    let v0 = 0
    for (let t = FRAME; t < T; t += FRAME) {
      const v = (d(t) - d(t - FRAME)) / FRAME
      if (t > FRAME * 1.5) jump = Math.max(jump, Math.abs(v - v0))
      v0 = v
    }
    expect(jump).toBeLessThan(0.2)
  })

  test("a paced lap takes its lap time and repeats", () => {
    const lap = pathOf(ring(100), true)
    const p = pacedLap(lap, 300, (h) => windPace(h))
    expect(pacedAt(p, 0)).toBe(0)
    expect(pacedAt(p, 300)).toBeCloseTo(lap.length, 6)
    expect(pacedAt(p, 450)).toBeCloseTo(lap.length + pacedAt(p, 150), 6)
  })
})

describe("every lifecycle is smooth", () => {
  const laps = [pathOf(ring(100, 128), true), pathOf(ring(130, 128), true)]
  // a lane out from a quay as the islands lay them: bends of 30–45 degrees
  const lane = roundedPath([
    [0, 0],
    [20, 0],
    [40, 16],
    [60, 50],
    [80, 140],
  ])
  const MAX_DV = 0.35 // m/s change from one frame to the next (≈ 21 m/s²: a hull never lurches)
  const MAX_DW = 0.08 // rad/s change of rate of turn a frame

  test("the merchants on their laps", () => {
    for (const k of [0, 1]) {
      const j = jerk((s) => merchants(laps, s)[k] as ShipPose, 0, 300)
      expect(j.dv).toBeLessThan(MAX_DV)
      expect(j.dw).toBeLessThan(MAX_DW)
    }
  })

  test("a cargo ship casting off, the galleon's visit, the ghost's glide", () => {
    let j = jerk((s) => cargoPose(lane, "c", 3, s), 0, SEA.CARGO_S)
    expect(j.dv).toBeLessThan(MAX_DV)
    expect(j.dw).toBeLessThan(MAX_DW)
    const rings = [100, 130].map((r) => ({ centre: [0, 0] as [number, number], points: ring(r) }))
    const at = anchorage(rings, 0)
    j = jerk(
      (s) => galleonPose(at, "g", s)?.pose ?? null,
      0,
      SEA.GALLEON_IN_S + SEA.GALLEON_STAY_S + SEA.GALLEON_OUT_S,
    )
    expect(j.dv).toBeLessThan(MAX_DV)
    expect(j.dw).toBeLessThan(MAX_DW)
    j = jerk((s) => ghostPose(laps[0] as Path, [0, 0], 1, s, null), 0, SEA.GHOST_S)
    expect(j.dv).toBeLessThan(MAX_DV)
  })

  test("the raid sailing in, lying at anchor, its rowboat pulling, the ship sailing off", () => {
    const longLane = roundedPath([
      [0, 0],
      [0, 60],
      [40, 160],
    ])
    let j = jerk((s) => raidPose(longLane, s, null).ship, 0, 60)
    expect(j.dv).toBeLessThan(MAX_DV)
    expect(j.dw).toBeLessThan(MAX_DW)
    j = jerk((s) => raidPose(longLane, 60 + s, s).ship, 0, SEA.RAID_OUT_S)
    expect(j.dv).toBeLessThan(MAX_DV)
    // the rowboat surges stroke by stroke but never jumps
    j = jerk((s) => raidPose(longLane, s, null).boat, SEA.RAID_IN_S + 3, SEA.RAID_IN_S + 80)
    expect(j.dv).toBeLessThan(MAX_DV)
  })

  test("a pull request's ship sailing in, docking with a little overshoot, casting off and out", () => {
    const route = roundedPath([
      [0, 0],
      [60, 0],
      [80, 20],
    ])
    const [v] = planFleet([{ key: "#1", opened: 0, ended: { at: 40, how: "merged" } }], 1) as [Voyage]
    const j = jerk((s) => (s >= v.start && s < v.gone ? voyagePlace(route, v, s) : null), 0, v.gone)
    expect(j.dv).toBeLessThan(MAX_DV)
    // it runs a little past its berth before it settles
    let past = 0
    for (let s = 0; s < FLEET.ARRIVE_S; s += 0.05) past = Math.max(past, arriveAlong(s) - 1)
    expect(past * route.length).toBeGreaterThan(0.2)
    expect(past * route.length).toBeLessThan(1.2)
    expect(voyagePose(v, FLEET.ARRIVE_S + 10).hold).toBe(1)
  })
})

describe("play and seek agree", () => {
  test("a pose at a time is the same however the clock got there", () => {
    const laps = [pathOf(ring(100), true), pathOf(ring(130), true)]
    const seek = merchants(laps, 123.45)
    for (let s = 0; s < 123.45; s += 0.7) merchants(laps, s)
    expect(merchants(laps, 123.45)).toEqual(seek)
    const a = attitudeOf({ ...(seek[0] as ShipPose) }, FEEL.large, 77.7, 1.2, { sails: true })
    expect(attitudeOf({ ...(seek[0] as ShipPose) }, FEEL.large, 77.7, 1.2, { sails: true })).toEqual(a)
  })
})

describe("on an island no hull touches land", () => {
  for (const seed of [1, 4]) {
    test(`seed ${seed}: bow, stern and beam over open water, swinging at anchor too`, () => {
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
      const hull = (p: { x: number; z: number; heading: number } | null, length: number, label: string) => {
        if (!p) return
        const c = Math.cos(p.heading)
        const s = Math.sin(p.heading)
        for (const k of [-0.45, 0, 0.45]) {
          const ok = open(p.x + c * length * k, p.z + s * length * k)
          if (!ok) throw new Error(`${label} touches land at ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`)
        }
      }
      const laps = sites.laps.map((r) => roundedPath(r.points, true))
      for (let s = 0; s < 300; s += 0.5) for (const m of merchants(laps, s)) hull(m, 9, m.key)
      const m = sites.moorings[0] as (typeof sites.moorings)[number]
      const lane = roundedPath(m.lane)
      for (let s = 0; s < SEA.CARGO_S; s += 0.25) hull(cargoPose(lane, "c", 3, s), 5.5, "cargo")
      // and on the island's own lanes nothing lurches either
      expect(jerk((s) => cargoPose(lane, "c", 3, s), 0, SEA.CARGO_S).dv).toBeLessThan(0.35)
      expect(jerk((s) => raidPose(lane, s, null).ship, 0, 40).dv).toBeLessThan(0.35)
      for (let s = 0; s < 200; s += 0.5) hull(raidPose(lane, s, s > 150 ? s - 150 : null).ship, 7, "raid")
      const c = sites.laps[0]?.centre ?? [0, 0]
      const anchor = anchorage(sites.laps, Math.atan2(m.at[1] - c[1], m.at[0] - c[0]))
      for (let s = 0; s < SEA.GALLEON_IN_S + SEA.GALLEON_STAY_S + SEA.GALLEON_OUT_S; s += 0.5) {
        const pose = galleonPose(anchor, "g", s)?.pose ?? null
        if (pose) hull(attitudeOf(pose, FEEL.galleon, s * 1.7, 2), 11, "galleon")
      }
      // the harbour's pull-request ships, in along their lanes, docked and swinging, and out again
      const ev = eventSites(island, zones, world, { sea: -0.05 })
      const berths = ev.harbours.find((h) => h.berths.length)?.berths ?? []
      const [v] = planFleet([{ key: "#1", opened: 0, ended: { at: 60, how: "merged" } }], 1) as [Voyage]
      for (const b of berths) {
        const route = roundedPath(b.lane)
        for (let s = 0; s < v.gone; s += 0.25) {
          const place = voyagePlace(route, v, s)
          const pose = voyagePose(v, s)
          hull(
            attitudeOf({ ...place, speed: 0, yawRate: 0, hold: pose.hold, way: pose.way }, FEEL.small, s, 1, {
              reach: 0.35,
            }),
            4.6,
            "pr ship",
          )
        }
      }
    })
  }
})
