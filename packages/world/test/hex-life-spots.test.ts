import { describe, expect, test } from "bun:test"
import {
  agentLoop,
  clearWay,
  guildhallZone,
  hexIsland,
  hexWalk,
  hexWorld,
  hexZones,
  type LifeStep,
  lifePlaces,
  planFolk,
  WALK_CLEAR,
  workTiles,
} from "../src/hex/index.ts"

type Pt = [number, number, number]
const discsNear = (discs: { x: number; z: number; r: number }[]) => (x: number, z: number, r: number) =>
  discs.filter((d) => Math.hypot(d.x - x, d.z - z) < d.r + r)

/** The least distance from a polyline to a disc's centre, minus its radius (negative: it cuts in). */
function clearance(pts: readonly Pt[], d: { x: number; z: number; r: number }): number {
  let least = Infinity
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1]!
    const b = pts[k]!
    for (let f = 0; f <= 1; f += 0.02) {
      const x = a[0] + (b[0] - a[0]) * f
      const z = a[2] + (b[2] - a[2]) * f
      least = Math.min(least, Math.hypot(x - d.x, z - d.z) - d.r)
    }
  }
  return least
}

describe("walks keep clear of blockers", () => {
  test("a straight walk through a cart goes round it", () => {
    const cart = { x: 5, z: 0.2, r: 1 }
    const way = clearWay(
      [
        [0, 0, 0],
        [10, 0, 0],
      ],
      [true],
      discsNear([cart]),
    )
    expect(way.pts.length).toBeGreaterThan(2)
    expect(way.ground).toHaveLength(way.pts.length - 1)
    expect(clearance(way.pts, cart)).toBeGreaterThan(WALK_CLEAR * 0.9)
    // it rounds the side the way already passed (the cart's middle is a little to the left: right side)
    expect(way.pts.slice(1, -1).every((p) => p[2] < 0)).toBe(true)
  })

  test("a walk that misses every blocker is left as it is", () => {
    const pts: Pt[] = [
      [0, 0, 0],
      [10, 0, 0],
    ]
    expect(clearWay(pts, [true], discsNear([{ x: 5, z: 3, r: 1 }])).pts).toEqual(pts)
  })

  test("a walk ending in a blocker (a seat on a bench) is not turned away from it", () => {
    const bench = { x: 10, z: 0, r: 0.4 }
    const way = clearWay(
      [
        [0, 0, 0],
        [10, 0, 0],
      ],
      [true],
      discsNear([bench]),
    )
    expect(way.pts).toHaveLength(2)
  })

  test("several blockers in a row are all rounded", () => {
    const row = [3, 6, 9].map((x) => ({ x, z: 0.1, r: 0.6 }))
    const way = clearWay(
      [
        [0, 0, 0],
        [12, 0, 0],
      ],
      [true],
      discsNear(row),
    )
    for (const d of row) expect(clearance(way.pts, d)).toBeGreaterThan(0.2)
  })
})

describe("people at spots", () => {
  const h = hexIsland({ seed: 1, files: 4000 })
  const z = hexZones(h)
  const w = hexWorld(h, z)
  const walk = hexWalk(h, z, w, { reach: workTiles(h, z) })
  const places = lifePlaces(h, z, w, walk)
  const agents = [0, 1, 2].map((slot) =>
    agentLoop(walk, z, [{ place: "camp", work: 30, idle: 5 }], { slot, role: "archer", places }),
  )
  const folk = planFolk(h, z, w, walk, { seed: 1, pace: 144, places })
  const stays = (day: readonly LifeStep[]) => day.filter((s) => s.kind === "stay" && !s.indoors)
  const key = (at: readonly number[]) => `${at[0]!.toFixed(2)},${at[2]!.toFixed(2)}`
  const spotAt = new Map(places.furniture.spots.map((s) => [key([s.x, 0, s.z]), s]))

  /** Work made up for those the spots do not hold (beside someone's work, chores), and the woodcutters' piles. */
  const madeAt = new Map(
    [...z.zones.keys()].flatMap((zi) => places.madeUp(zi)).map((m) => [key(m.spot.at), m]),
  )
  const piles = new Set(
    places.furniture.spots.flatMap((_, k) => {
      const p = places.pileOf(k)
      return p ? [key(p.at)] : []
    }),
  )

  test("everyone works only at a spot (or work made up for them), facing its way, and no two people hold the same one", () => {
    const holder = new Map<string, number>()
    const made = new Set<number>()
    for (const f of folk)
      for (const s of stays(f.day)) {
        if (s.kind !== "stay" || s.act !== "work") continue
        const spot = spotAt.get(key(s.at))
        const who = holder.get(key(s.at))
        expect(who === undefined || who === f.id).toBe(true)
        holder.set(key(s.at), f.id)
        if (!spot) {
          // made-up work, a woodcutter's pile, or a castle guard's post on the rounds
          const m = madeAt.get(key(s.at))
          expect(!!m || piles.has(key(s.at)) || s.routine?.id === "post").toBe(true)
          if (m) expect(Math.abs(Math.sin((m.spot.facing - s.facing) / 2))).toBeLessThan(1e-6)
          if (!piles.has(key(s.at))) made.add(f.id)
          continue
        }
        expect(Math.abs(Math.sin((spot.facing - s.facing) / 2))).toBeLessThan(1e-6)
        expect(!spot.roles || spot.roles.includes(f.role)).toBe(true)
      }
    expect(holder.size).toBeGreaterThan(80)
    // made-up work is the exception: most work at the place's own spots
    expect(made.size).toBeLessThan(folk.length / 4)
  })

  test("archers shoot from the archery range's line: each at its own spot there (the rest lend a hand)", () => {
    const archers = folk.filter((f) => f.role === "archer")
    // (seed 1 has a camp's range: three at its line at least)
    expect(archers.length).toBeGreaterThanOrEqual(3)
    for (const f of archers) {
      const work = f.day.find((s) => s.kind === "stay" && s.act === "work")
      expect(work?.kind).toBe("stay")
      if (work?.kind !== "stay") continue
      const spot = spotAt.get(key(work.at))
      // (the agents, planned first, hold some of the line: an archer left over works made-up work)
      if (spot) expect(spot.roles).toContain("archer")
      else expect(madeAt.has(key(work.at))).toBe(true)
    }
  })

  test("people sit only on seats, with the seat's lift, never on a doorstep", () => {
    let sitting = 0
    for (const f of folk)
      for (const s of stays(f.day)) {
        if (s.kind !== "stay" || !s.clip?.startsWith("Sit")) continue
        sitting++
        expect(spotAt.get(key(s.at))?.kind).toBe("sit")
      }
    expect(sitting).toBeGreaterThan(5)
    const doors = new Set(walk.nodes.filter((n) => n.kind === "door").map((n) => key([n.x, 0, n.z])))
    for (const f of folk)
      for (const s of stays(f.day)) if (s.kind === "stay") expect(doors.has(key(s.at))).toBe(false)
  })

  test("at noon each person on a square has a slot of their own (no stacking at the well)", () => {
    for (const [zi] of z.zones.entries()) {
      const slots = places.slots(zi)
      const here = folk.filter((f) => f.zone === zi)
      if (!slots.length || here.length > slots.length) continue
      const at = new Set<string>()
      for (const f of here)
        for (const s of stays(f.day))
          if (s.kind === "stay" && s.act === "idle" && s.from < 12.5 && s.to > 12.5) {
            expect(at.has(key(s.at))).toBe(false)
            at.add(key(s.at))
          }
    }
  })

  test("slots keep apart and off every blocker", () => {
    for (const [zi] of z.zones.entries()) {
      const slots = places.slots(zi)
      for (const [k, s] of slots.entries()) {
        expect(places.furniture.near(s.at[0], s.at[2], 0.25)).toHaveLength(0)
        for (const o of slots.slice(k + 1))
          expect(Math.hypot(o.at[0] - s.at[0], o.at[2] - s.at[2])).toBeGreaterThan(0.8)
      }
    }
  })

  test("walks keep clear of blockers along their way", () => {
    let points = 0
    let inside = 0
    for (const f of folk.slice(0, 120))
      for (const s of f.day) {
        if (s.kind !== "walk") continue
        // the first and last metre are where a walk leaves or reaches its spot (a seat, a doorway)
        for (let k = 1; k < s.pts.length; k++) {
          const a = s.pts[k - 1]!
          const b = s.pts[k]!
          const len = Math.hypot(b[0] - a[0], b[2] - a[2])
          for (let d = 0.25; d < len; d += 0.5) {
            const x = a[0] + ((b[0] - a[0]) * d) / len
            const zz = a[2] + ((b[2] - a[2]) * d) / len
            const start = Math.hypot(x - s.pts[0]![0], zz - s.pts[0]![2])
            const end = Math.hypot(x - s.pts.at(-1)![0], zz - s.pts.at(-1)![2])
            if (start < 1.5 || end < 1.5) continue
            points++
            if (places.furniture.near(x, zz, 0).length) inside++
          }
        }
      }
    expect(points).toBeGreaterThan(5000)
    expect(inside / points).toBeLessThan(0.01)
  })

  test("agents idle at the Guildhall and work at a spot of the place they visit", () => {
    const home = guildhallZone(walk, z)
    expect(z.zones[home]!.kind).toBe("castle")
    const hall = walk.nodes[walk.hearts[home]!]!
    for (const a of agents) {
      const first = a.steps[0]!
      expect(first.kind).toBe("stay")
      if (first.kind === "stay")
        expect(Math.hypot(first.at[0] - hall.x, first.at[2] - hall.z)).toBeLessThan(8)
      const work = a.steps.find((s) => s.kind === "stay" && s.act === "work")
      expect(work && work.kind === "stay" && spotAt.has(key(work.at))).toBe(true)
    }
  })
})
