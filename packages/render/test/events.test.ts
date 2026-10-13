import { describe, expect, test } from "bun:test"
import { HEX_KINDS, HEX_TILE_SIZE, hexAt, hexIsland, hexWorld, hexZones, TILE_USES } from "@guildhall/world"
import { boltPath, flashAt, nextStrike } from "../src/events/bolt.ts"
import { random, transition } from "../src/events/ease.ts"
import { FLEET, harbourChanges, planFleet, type ShipLog, voyagePose } from "../src/events/fleet.ts"
import { scaffoldGeometry } from "../src/events/scaffold.ts"
import { along, laneLengths } from "../src/events/ships.ts"
import { eventSites } from "../src/events/sites.ts"
import { BASE_COVER, BASE_WIND, isClear, mixOf, weathered, weatherLook } from "../src/events/weather.ts"
import { lightAt } from "../src/light.ts"

/** The event FX (F1): their pure parts. */

describe("transition", () => {
  test("eases from where it is to the target over its time, ends exactly, and stops moving", () => {
    const tr = transition(0, 4)
    tr.to(1, 10)
    expect(tr.at(10)).toBe(0)
    expect(tr.at(12)).toBeCloseTo(0.5, 6)
    expect(tr.at(14)).toBe(1)
    expect(tr.at(100)).toBe(1)
    expect(tr.moving(13)).toBe(true)
    expect(tr.moving(14)).toBe(false)
  })

  test("a new target mid-way starts from the current value (no jump)", () => {
    const tr = transition(0, 4)
    tr.to(1, 0)
    const mid = tr.at(1)
    tr.to(0, 1)
    expect(tr.at(1)).toBeCloseTo(mid, 9)
    expect(tr.at(5)).toBe(0)
  })

  test("the same target again changes nothing; jump lands at once", () => {
    const tr = transition(0, 4)
    tr.to(1, 0)
    tr.to(1, 3)
    expect(tr.at(4)).toBe(1)
    tr.jump(0.25)
    expect(tr.at(4)).toBe(0.25)
    expect(tr.moving(4)).toBe(false)
  })

  test("the seeded stream replays", () => {
    const a = random(7)
    const b = random(7)
    const xs = Array.from({ length: 5 }, a)
    expect(Array.from({ length: 5 }, b)).toEqual(xs)
    for (const x of xs) expect(x >= 0 && x < 1).toBe(true)
  })
})

describe("weather", () => {
  test("clear is today's sky exactly: every multiplier 1, the light itself", () => {
    const look = weatherLook(mixOf("clear"))
    expect(isClear(look)).toBe(true)
    expect(look.coverage).toBe(BASE_COVER)
    expect(look.wind).toBe(BASE_WIND)
    const light = lightAt(12)
    expect(weathered(light, look)).toBe(light)
  })

  test("a clear look keeps a deck that was already thicker (the ?clouds= knob)", () => {
    expect(weatherLook(mixOf("clear"), { coverage: 0.9, wind: 4 }).coverage).toBe(0.9)
    expect(weatherLook(mixOf("storm"), { coverage: 0.99, wind: 4 }).coverage).toBe(0.99)
  })

  test("cloudy then storm: darker, greyer, thicker step by step; only a storm rains and strikes", () => {
    const clear = weatherLook(mixOf("clear"))
    const cloudy = weatherLook(mixOf("cloudy"))
    const storm = weatherLook(mixOf("storm"))
    expect(cloudy.coverage).toBeGreaterThan(clear.coverage)
    expect(storm.coverage).toBeGreaterThan(cloudy.coverage)
    expect(storm.sun).toBeLessThan(cloudy.sun)
    expect(cloudy.sun).toBeLessThan(clear.sun)
    expect(storm.grey).toBeGreaterThan(cloudy.grey)
    expect(cloudy.rain).toBe(0)
    expect(cloudy.lightning).toBe(false)
    expect(storm.rain).toBe(1)
    expect(storm.lightning).toBe(true)
  })

  test("the weather never moves the hour: the sun stays where the clock put it", () => {
    const light = lightAt(15)
    const w = weathered(light, weatherLook(mixOf("storm")))
    expect(w.hour).toBe(light.hour)
    expect(w.sunDir).toEqual(light.sunDir)
    expect(w.elevation).toBe(light.elevation)
    expect(w.sunIntensity).toBeLessThan(light.sunIntensity)
    expect(w.lamps).toBeGreaterThanOrEqual(0.6)
    // the input is untouched
    expect(lightAt(15).zenith.getHex()).toBe(light.zenith.getHex())
  })

  test("half-way mixes lie between their ends", () => {
    const half = weatherLook({ cloud: 1, storm: 0.5 })
    const cloudy = weatherLook(mixOf("cloudy"))
    const storm = weatherLook(mixOf("storm"))
    expect(half.sun).toBeLessThan(cloudy.sun)
    expect(half.sun).toBeGreaterThan(storm.sun)
  })
})

describe("lightning", () => {
  test("a strike flashes and is dark again within its time", () => {
    expect(flashAt(0.045)).toBeGreaterThan(0.9)
    expect(flashAt(0.13)).toBe(0)
    expect(flashAt(0.21)).toBeGreaterThan(0.4)
    expect(flashAt(0.5)).toBe(0)
  })

  test("strikes come 4 to 11 s apart", () => {
    const next = random(3)
    for (let i = 0; i < 50; i++) {
      const s = nextStrike(next)
      expect(s).toBeGreaterThanOrEqual(4)
      expect(s).toBeLessThan(11)
    }
  })

  test("a bolt runs from the cloud to its mark, the same for the same seed", () => {
    const top: [number, number, number] = [0, 100, 0]
    const mark: [number, number, number] = [5, 10, -3]
    const a = boltPath(top, mark, 42)
    expect(a.main[0]).toEqual(top)
    expect(a.main[a.main.length - 1]).toEqual(mark)
    for (let i = 1; i < a.main.length; i++)
      expect((a.main[i] as number[])[1]).toBeLessThan((a.main[i - 1] as number[])[1] as number)
    expect(a.branches.length).toBeGreaterThanOrEqual(1)
    expect(boltPath(top, mark, 42)).toEqual(a)
  })
})

const log = (key: string, opened: number, ended?: ShipLog["ended"], docked?: boolean): ShipLog => ({
  key,
  opened,
  ...(ended ? { ended } : {}),
  ...(docked ? { docked } : {}),
})

describe("fleet", () => {
  test("a ship sails in, docks, and on merge casts off with its pennant glinting, then is gone", () => {
    const [v] = planFleet([log("#1", 0, { at: 30, how: "merged" })], 3)
    if (!v) throw new Error("no voyage")
    expect(v.arrive).toBe(FLEET.ARRIVE_S)
    expect(voyagePose(v, 1).phase).toBe("arriving")
    expect(voyagePose(v, 0.3).seen).toBeLessThan(1)
    expect(voyagePose(v, 20).phase).toBe("docked")
    expect(voyagePose(v, 20).along).toBe(1)
    const off = voyagePose(v, 30.5)
    expect(off.phase).toBe("leaving")
    expect(off.glint).toBeGreaterThan(0.5)
    expect(voyagePose(v, 30 + FLEET.LEAVE_S * 0.5).turn).toBe(1)
    expect(voyagePose(v, 30 + FLEET.LEAVE_S).phase).toBe("gone")
  })

  test("merged before it docked: it docks first, stays a moment, then leaves", () => {
    const [v] = planFleet([log("#1", 0, { at: 5, how: "merged" })], 1)
    expect(v?.leave).toBe(FLEET.ARRIVE_S + FLEET.STAY_S)
  })

  test("closed at the berth it sinks; with close: sail it sails off; closed on the way in it turns back", () => {
    const [sunk] = planFleet([log("#1", 0, { at: 20, how: "closed" })], 1)
    if (!sunk) throw new Error("no voyage")
    expect(voyagePose(sunk, 20 + FLEET.SINK_S * 0.5).phase).toBe("sinking")
    expect(voyagePose(sunk, 20 + FLEET.SINK_S * 0.5).sink).toBeGreaterThan(0.3)
    expect(voyagePose(sunk, 20 + FLEET.SINK_S).phase).toBe("gone")
    const [sailed] = planFleet([log("#1", 0, { at: 20, how: "closed" })], 1, { close: "sail" })
    if (!sailed) throw new Error("no voyage")
    expect(voyagePose(sailed, 21).phase).toBe("leaving")
    expect(voyagePose(sailed, 21).glint).toBe(0)
    const [back] = planFleet([log("#1", 0, { at: 5, how: "closed" })], 1)
    if (!back) throw new Error("no voyage")
    expect(back.back).toBeGreaterThan(0)
    expect(back.back).toBeLessThan(1)
    const p = voyagePose(back, 6)
    expect(p.phase).toBe("turning-back")
    expect(p.along).toBeLessThanOrEqual(back.back as number)
  })

  test("never more ships than berths (and never over six); the rest wait for a berth", () => {
    const logs = Array.from({ length: 10 }, (_, i) => log(`#${i}`, i))
    const plan = planFleet(logs, 8)
    expect(plan.length).toBe(FLEET.MAX)
    expect(new Set(plan.map((v) => v.berth)).size).toBe(FLEET.MAX)
    expect(planFleet(logs, 3).length).toBe(3)
  })

  test("a waiting pull request sails once a ship has gone from its berth, never before", () => {
    const logs = [log("#1", 0, { at: 30, how: "merged" }), log("#2", 1)]
    const plan = planFleet(logs, 1)
    const first = plan.find((v) => v.key === "#1")
    const second = plan.find((v) => v.key === "#2")
    expect(second?.start).toBe(first?.gone)
    // in any history, at any time, one ship per berth at most
    for (let t = 0; t < 120; t += 0.5) {
      const busy = plan.filter((v) => t >= v.start && t < v.gone).map((v) => v.berth)
      expect(new Set(busy).size).toBe(busy.length)
    }
  })

  test("ships set out at least GAP_S apart (one lane in); those already docked are there at once", () => {
    const plan = planFleet([log("#1", 0), log("#2", 0), log("#3", 0)], 6)
    const starts = plan.map((v) => v.start).sort((a, b) => a - b)
    for (let i = 1; i < starts.length; i++)
      expect((starts[i] as number) - (starts[i - 1] as number)).toBeGreaterThanOrEqual(FLEET.GAP_S)
    const docked = planFleet([log("#1", 0, undefined, true), log("#2", 0, undefined, true)], 6)
    for (const v of docked) expect(voyagePose(v, 0).phase).toBe("docked")
  })

  test("closed while still waiting: it never sails", () => {
    const plan = planFleet([log("#1", 0), log("#2", 1, { at: 3, how: "closed" })], 1)
    expect(plan.map((v) => v.key)).toEqual(["#1"])
  })

  test("the same history gives the same plan (scrub = play)", () => {
    const logs = [
      log("#1", 0, { at: 40, how: "merged" }),
      log("#2", 2, { at: 9, how: "closed" }),
      log("#3", 3),
    ]
    expect(planFleet([...logs].reverse(), 4)).toEqual(planFleet(logs, 4))
  })
})

describe("harbourChanges", () => {
  test("new keys open; vanished ones end, merged as far as the merged count rose, the rest closed", () => {
    const before = ["r#1", "r#2", "r#3"]
    const now = {
      prs: [
        { repo: "r", n: 3 },
        { repo: "r", n: 4 },
      ],
      merged: 6,
    }
    const { opened, ended } = harbourChanges(before, 5, now)
    expect(opened).toEqual(["r#4"])
    expect(ended).toEqual([
      { key: "r#1", how: "merged" },
      { key: "r#2", how: "closed" },
    ])
  })

  test("no change, no events", () => {
    const { opened, ended } = harbourChanges(["#1"], 2, { prs: [{ n: 1 }], merged: 2 })
    expect(opened).toEqual([])
    expect(ended).toEqual([])
  })
})

describe("lanes", () => {
  test("a point along a lane, and the way it runs there", () => {
    const lane: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
    ]
    const lengths = laneLengths(lane)
    expect(lengths).toEqual([0, 10, 20])
    expect(along(lane, lengths, 0.25)).toEqual([5, 0, 0])
    const [x, z, h] = along(lane, lengths, 0.75)
    expect([x, z]).toEqual([10, 5])
    expect(h).toBeCloseTo(Math.PI / 2, 9)
    expect(along(lane, lengths, 1).slice(0, 2)).toEqual([10, 10])
  })
})

describe("sites", () => {
  for (const seed of [1, 2, 3]) {
    test(`seed ${seed}: berths on open water by the harbour, apart, each with a lane in over water only`, () => {
      const island = hexIsland({ seed, files: 4000 })
      const zones = hexZones(island, {})
      const world = hexWorld(island, zones, {})
      const sites = eventSites(island, zones, world, { sea: -0.05 })
      const g = island.grid
      const tileAt = (x: number, z: number) => {
        const h = hexAt(x / HEX_TILE_SIZE, z / HEX_TILE_SIZE)
        return g.index(h.q, h.r)
      }
      const water = (i: number) =>
        i < 0 || ["sea", "shallows"].includes(HEX_KINDS[island.kind[i] ?? 0] as string)
      expect(sites.castle).not.toBeNull()
      expect(sites.places.length).toBe(zones.zones.length)
      expect(sites.harbours.length).toBeGreaterThan(0)
      for (const h of sites.harbours) {
        expect(h.berths.length).toBeGreaterThanOrEqual(3)
        expect(h.berths.length).toBeLessThanOrEqual(6)
        const tiles = h.berths.map((b) => tileAt(b.at[0], b.at[2]))
        for (const [k, b] of h.berths.entries()) {
          const i = tiles[k] as number
          expect(water(i)).toBe(true)
          expect(TILE_USES[zones.use[i] ?? 0]).not.toBe("dock")
          // no berth beside another
          for (const j of tiles) if (j !== i) expect(Array.from(g.neighbours(i)).includes(j)).toBe(false)
          // the lane ends at the berth and never crosses land
          const end = b.lane[b.lane.length - 1] as [number, number]
          expect(end[0]).toBeCloseTo(b.at[0], 6)
          expect(end[1]).toBeCloseTo(b.at[2], 6)
          for (let s = 0; s + 1 < b.lane.length; s++) {
            const [ax, az] = b.lane[s] as [number, number]
            const [bx, bz] = b.lane[s + 1] as [number, number]
            for (let u = 0; u <= 1; u += 0.25)
              expect(water(tileAt(ax + (bx - ax) * u, az + (bz - az) * u))).toBe(true)
          }
          const [sx, sz] = b.lane[0] as [number, number]
          expect(Math.hypot(sx - b.at[0], sz - b.at[2])).toBeGreaterThan(60)
        }
      }
    })
  }
})

describe("scaffold", () => {
  test("stands on the ground (foot at 0), a crane over it, tint 0 everywhere", () => {
    const g = scaffoldGeometry()
    g.computeBoundingBox()
    const box = g.boundingBox
    expect(box?.min.y).toBeGreaterThanOrEqual(-0.05)
    expect(box?.max.y).toBeGreaterThan(7)
    expect(box?.max.x).toBeLessThan(4.5)
    const tint = g.getAttribute("tint")
    for (let i = 0; i < tint.count; i++) expect(tint.getX(i)).toBe(0)
  })
})
