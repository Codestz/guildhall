/**
 * The sea's follow-ups: a lane for each errand (the raid's and the cargo's apart, the cargo's clear of
 * the anchored raid and over open water only), every moving hull's wake merged into one capped list,
 * the cargo ship's own hull, and the triangles an instanced fleet really draws.
 */
import { describe, expect, test } from "bun:test"
import { HEX_KINDS, HEX_TILE_SIZE, hexAt, hexIsland, hexWorld, hexZones, TILE_USES } from "@guildhall/world"
import { BufferAttribute, BufferGeometry } from "three"
import { swatch } from "../src/events/fxMaterial.ts"
import { prFleetGeometry, wakeOf } from "../src/events/ships.ts"
import { eventSites } from "../src/events/sites.ts"
import { roundedPath } from "../src/sea/course.ts"
import { cargoModel, loadTris } from "../src/sea/life.ts"
import { cargoPose, pointAt, raidPose, SEA } from "../src/sea/plan.ts"
import {
  distanceToLane,
  errandsOf,
  type Mooring,
  RAID_CLEAR,
  raidAnchor,
  seaSites,
} from "../src/sea/sites.ts"
import { MAX_WAKES, mergeWakes, type Wake, wakeShape, wakeStrength } from "../src/water.ts"

type P = [number, number]

/** Whether segments ab and cd cross. */
const crosses = (a: P, b: P, c: P, d: P) => {
  const o = (p: P, q: P, r: P) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]))
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0
}

describe("errands", () => {
  const mooring = (x: number, lane: P[]): Mooring => ({ at: [x, 0], pier: [x, -2], lane })
  const out = (x: number): P[] => [
    [x, 0],
    [x, 60],
  ]

  test("the quay's boat lies clearest of the berths, the raid on another lane, the cargo on a third", () => {
    const ms = [mooring(0, out(0)), mooring(30, out(30)), mooring(60, out(60))]
    const e = errandsOf(ms, [[2, 0]], (m) => m.lane)
    expect(e.quay).toBe(ms[2] as Mooring)
    // the raid on the shortest way out clear of the berths (the first lies 2 m off one), the cargo from what is left
    expect(e.raid).toBe(ms[1] as Mooring)
    expect(e.cargo?.at).toEqual((ms[0] as Mooring).at)
    expect(e.shared).toBe(false)
  })

  test("with no clear way round the raid, the cargo shares its lane (and says so)", () => {
    const ms = [mooring(0, out(0)), mooring(3, out(3))]
    const e = errandsOf(ms, [], () => null)
    expect(e.cargo).toBe(e.raid)
    expect(e.shared).toBe(true)
  })

  test("a rerouted lane that still passes the anchorage is refused", () => {
    const ms = [mooring(0, out(0)), mooring(4, out(4))]
    // a "reroute" that ignores what is blocked: it runs 4 m from the raid's anchorage
    const e = errandsOf(ms, [], (m) => m.lane)
    expect(e.shared).toBe(true)
  })

  test("the raid's anchorage: RAID_OFF out along its lane, or 0.4 of a short one", () => {
    expect(raidAnchor(out(0)).at).toEqual([0, SEA.RAID_OFF])
    expect(
      raidAnchor([
        [0, 0],
        [0, 20],
      ]).at,
    ).toEqual([0, 8])
  })
})

describe("on an island, the raid's lane and the cargo's", () => {
  for (const seed of [1, 2, 4, 6, 9]) {
    test(`seed ${seed}: apart, over open water, the cargo clear of the anchored raid and its rowboat`, () => {
      const island = hexIsland({ seed, files: 4000 })
      const zones = hexZones(island, {})
      const world = hexWorld(island, zones, {})
      const ev = eventSites(island, zones, world, { sea: -0.05 })
      const keepOff = ev.harbours.flatMap((h) => h.berths.map((b) => [b.at[0], b.at[2]] as P))
      const sites = seaSites(island, zones, world, { sea: -0.05, keepOff })
      const g = island.grid
      const R = HEX_TILE_SIZE
      const open = (x: number, z: number) => {
        const h = hexAt(x / R, z / R)
        const i = g.index(h.q, h.r)
        if (i < 0) return true
        const k = HEX_KINDS[island.kind[i] ?? 0]
        return (k === "sea" || k === "shallows") && TILE_USES[zones.use[i] ?? 0] !== "dock"
      }
      const e = sites.errands
      if (!e?.raid || !e.cargo) throw new Error("no raid or cargo lane")
      expect(e.shared).toBe(false)
      expect(e.cargo.lane).not.toEqual(e.raid.lane)
      // over open water only, as drawn (the rounded lane) and as the cargo ship sails it
      const route = roundedPath(e.cargo.lane)
      for (let d = 0; d < route.length; d += 0.5) {
        const p = pointAt(route, d)
        expect(open(p.x, p.z)).toBe(true)
      }
      for (let s = 0; s < SEA.CARGO_S; s += 0.25) {
        const c = cargoPose(route, "c", 3, s)
        if (c) expect(open(c.x, c.z)).toBe(true)
      }
      // clear of the anchorage (where the raid lies, as drawn) by RAID_CLEAR, give or take a tile's rounding
      const anchor = raidAnchor(e.raid.lane)
      expect(distanceToLane(e.cargo.lane, ...anchor.at)).toBeGreaterThanOrEqual(RAID_CLEAR - 2.5)
      const raidRoute = roundedPath(e.raid.lane)
      const lying = raidPose(raidRoute, SEA.RAID_IN_S + 30, null).ship
      if (!lying) throw new Error("no raid at anchor")
      for (let d = 0; d < route.length; d += 0.5) {
        const p = pointAt(route, d)
        expect(Math.hypot(p.x - lying.x, p.z - lying.z)).toBeGreaterThan(RAID_CLEAR - 3)
      }
      // the lanes never cross near the anchorage (within twice its clearance)
      const near = (p: P) => Math.hypot(p[0] - anchor.at[0], p[1] - anchor.at[1]) < RAID_CLEAR * 2
      for (let i = 1; i < e.cargo.lane.length; i++)
        for (let j = 1; j < e.raid.lane.length; j++) {
          const a = e.cargo.lane[i - 1] as P
          const b = e.cargo.lane[i] as P
          const c = e.raid.lane[j - 1] as P
          const d = e.raid.lane[j] as P
          if (near(a) || near(b) || near(c) || near(d)) expect(crosses(a, b, c, d)).toBe(false)
        }
    })
  }
})

describe("wakes", () => {
  const wake = (speed: number, beam = 1.2, x = 0): Wake => ({ x, z: 0, heading: 0, speed, beam })

  test("every source's together, at most MAX_WAKES: the weakest dropped, the rest in their order", () => {
    const harbour = Array.from({ length: 8 }, (_, i) => wake(0.5 + i * 0.4, 1.2, i))
    const sea = Array.from({ length: 8 }, (_, i) => wake(6, 1.8, 100 + i))
    const merged = mergeWakes([harbour, sea])
    expect(merged.length).toBe(MAX_WAKES)
    // the sea's big, fast hulls all kept; the harbour's slowest dropped
    for (const w of sea) expect(merged).toContain(w)
    const weakest = Math.min(...merged.map(wakeStrength))
    for (const w of [...harbour, ...sea])
      if (!merged.includes(w)) expect(wakeStrength(w)).toBeLessThanOrEqual(weakest)
    // in their sources' order
    const xs = merged.map((w) => w.x)
    expect([...xs].sort((a, b) => a - b)).toEqual(xs)
  })

  test("a hull at rest leaves none; one out of view is not given to the water", () => {
    expect(mergeWakes([[wake(0), wake(2)]])).toEqual([wake(2)])
    expect(mergeWakes([[wake(2, 1.2, 0), wake(2, 1.2, 500)]], MAX_WAKES, (w) => w.x < 100).length).toBe(1)
  })

  test("a wake fades with its speed: whiter and longer the faster, nothing at rest", () => {
    expect(wakeShape(wake(0)).white).toBe(0)
    let last = wakeShape(wake(0))
    for (const s of [0.5, 1, 2, 3, 5, 8]) {
      const now = wakeShape(wake(s))
      expect(now.white).toBeGreaterThanOrEqual(last.white)
      expect(now.length).toBeGreaterThanOrEqual(last.length)
      last = now
    }
    expect(last.white).toBe(1)
    // a bigger hull, a longer wake
    expect(wakeShape(wake(4, 1.8)).length).toBeGreaterThan(wakeShape(wake(4, 0.6)).length)
  })

  test("a hull's wake runs the way it moves, astern as it backs off", () => {
    const backing = (t: number) => ({ x: -2 * t, z: 0 })
    const w = wakeOf(backing, 1)
    expect(Math.abs(Math.cos(w.heading) + 1)).toBeLessThan(1e-9)
    expect(w.speed).toBeCloseTo(2, 9)
  })
})

/** A non-indexed geometry of `n` triangles at x (position, normal, colour). */
const tris = (n: number, x = 0, colour: [number, number, number] = [0.69, 0.33, 0.18]) => {
  const g = new BufferGeometry()
  const pos: number[] = []
  for (let i = 0; i < n; i++) pos.push(x, 0, i, x, 1, i, x, 0, i + 0.5)
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3))
  g.setAttribute("normal", new BufferAttribute(new Float32Array(pos.length).fill(0), 3))
  g.setAttribute(
    "color",
    new BufferAttribute(new Float32Array(Array.from({ length: pos.length / 3 }, () => colour).flat()), 3),
  )
  return g
}

describe("the cargo ship", () => {
  test("the rowboat's hull with its oars shipped, under one plain sail with a red stripe", () => {
    const hull = tris(10)
    const oars = tris(4, 2.2)
    const pos = [
      ...(hull.getAttribute("position").array as Float32Array),
      ...(oars.getAttribute("position").array as Float32Array),
    ]
    const rowboat = new BufferGeometry()
    rowboat.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3))
    rowboat.setAttribute("normal", new BufferAttribute(new Float32Array(pos.length), 3))
    rowboat.setAttribute("color", new BufferAttribute(new Float32Array(pos.length).fill(0.5), 3))
    const g = cargoModel(rowboat)
    const p = g.getAttribute("position")
    const c = g.getAttribute("color")
    const cloth = g.getAttribute("cloth")
    // no oar left: nothing reaches past the gunwales below the sail's foot
    for (let i = 0; i < p.count; i++)
      if (p.getY(i) < 1.5) expect(Math.abs(p.getX(i))).toBeLessThanOrEqual(1.25)
    // the stripe: the palette's red, on the cloth, which the wind works
    const red = swatch("banner-red")
    let striped = 0
    let worked = 0
    for (let i = 0; i < p.count; i++) {
      if (Math.abs(c.getX(i) - red[0]) < 1e-6 && Math.abs(c.getY(i) - red[1]) < 1e-6) striped++
      if (cloth.getX(i) > 0) worked++
    }
    expect(striped).toBeGreaterThan(0)
    expect(worked).toBeGreaterThan(striped)
  })
})

describe("the instanced fleets' triangles", () => {
  test("the sea's fleet: each hull's own and its loads up to y, nothing of the others", () => {
    // hull 0: 5 triangles; hull 2: 7 of its own, crates of 2 each in slots 1 … 3
    const part: number[] = []
    const mark = (hull: number, slot: number, n: number) => {
      for (let i = 0; i < n * 3; i++) part.push(hull * 8 + slot)
    }
    mark(0, 0, 5)
    mark(2, 0, 7)
    for (const s of [1, 2, 3]) mark(2, s, 2)
    const g = new BufferGeometry()
    g.setAttribute("part", new BufferAttribute(new Float32Array(part), 1))
    g.setIndex(part.map((_, i) => i))
    const t = loadTris(g)
    expect(t[0]?.[0]).toBe(5)
    expect(t[2]?.[0]).toBe(7)
    expect(t[2]?.[2]).toBe(11)
    expect(t[2]?.[7]).toBe(13)
    expect(t[1]).toBeUndefined()
  })

  test("the harbour's: three hulls side by side, each vertex marked with its own, each one's triangles", () => {
    const { geometry, tris: counts } = prFleetGeometry([tris(10), tris(20), tris(30)])
    const rig = geometry.getAttribute("rig")
    const seen = new Set<number>()
    for (let i = 0; i < rig.count; i++) {
      seen.add(rig.getZ(i))
      expect(rig.getX(i)).toBeGreaterThanOrEqual(0)
      expect(rig.getX(i)).toBeLessThanOrEqual(1)
    }
    expect([...seen].sort()).toEqual([0, 1, 2])
    // each hull's own, its pennant (two faces) and its flare
    expect(counts[1]! - counts[0]!).toBe(10)
    expect(counts[2]! - counts[1]!).toBe(10)
    expect(counts.reduce((a, b) => a + b, 0)).toBe(geometry.getAttribute("position").count / 3)
  })
})
