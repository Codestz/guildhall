import { describe, expect, test } from "bun:test"
import type { SeaEvent } from "@guildhall/core"
import { watersOf } from "../src/scene/Ships.tsx"
import {
  harbourOf,
  lighthouseSpot,
  type SeaSighting,
  seaAt,
  toWorld,
  toWorldClear,
} from "../src/scene/seas/fleet.ts"
import {
  BRIDGE_CLEAR,
  clearOf,
  pushedClear,
  type Wall,
  wallDistance,
  wallFrom,
} from "../src/world/bridgeWalls.ts"
import { type FerryState, ferryAt } from "../src/world/ferrySchedule.ts"
import { laneClear, laneOf } from "../src/world/lanes.ts"
import { trackAt, trackOf } from "../src/world/laps.ts"
import type { Spot } from "../src/world/layout.ts"
import { toSegment } from "../src/world/lights.ts"
import type { Quay } from "../src/world/linkStub.ts"
import { APRON, apronProblem, BUILDING, HEAD } from "../src/world/quays.ts"
import { wildsOf } from "../src/world/wilds.ts"
import { reachOf } from "../src/world/world.ts"
import { SLOW } from "./support/slow.ts"
import { reactSplit } from "./support/splitFixture.ts"

/**
 * A bridge is as high as a mast, and nothing sails under it: ferries, the islands' idle ships and the
 * GitHub sea's voyages all keep BRIDGE_CLEAR off every bridge's axis, and a bridge's head has an apron.
 */

const quay = (land: Spot, facing: number): Quay => ({
  land,
  end: [land[0] + Math.sin(facing) * 12, land[1] + Math.cos(facing) * 12],
  facing,
  height: 0,
  berthSide: 1,
})

describe("walls", () => {
  const wall: Wall = { a: [0, 0], b: [100, 0] }

  test("a point's distance is to the axis, ends included", () => {
    expect(wallDistance(wall, 50, 7)).toBe(7)
    expect(wallDistance(wall, 110, 0)).toBe(10)
    expect(wallDistance(wall, -3, 4)).toBe(5)
  })

  test("a point inside the margin is pushed out to it, on its own side; one outside is left alone", () => {
    const [x, z] = pushedClear([wall], 40, -3)
    expect(x).toBeCloseTo(40, 5)
    expect(z).toBeCloseTo(-BRIDGE_CLEAR, 5)
    expect(pushedClear([wall], 40, 30)).toEqual([40, 30])
    expect(clearOf([wall], ...pushedClear([wall], 40, 0))).toBe(true)
  })

  test("a wall seen from an island is moved by its keep", () => {
    expect(wallFrom(wall, [10, 5])).toEqual({ a: [-10, -5], b: [90, -5] })
  })
})

describe("a lane across a bridge goes round it", () => {
  // Two quays facing the sea between them, and a bridge's wall straight across the open water.
  const a = quay([0, 0], Math.PI / 2)
  const b = quay([300, 0], -Math.PI / 2)
  const across: Wall = { a: [150, -100], b: [150, 100] }

  test("the straight lane crosses it; with the wall known the lane keeps clear all the way", () => {
    expect(laneClear(laneOf(a, b, []), [across])).toBe(false)
    const around = laneOf(a, b, [], [across])
    expect(laneClear(around, [across])).toBe(true)
    expect(around.pts[0]).toEqual(laneOf(a, b, []).pts[0])
  })
})

describe("a lap crossed by a bridge", () => {
  const wall: Wall = { a: [60, 0], b: [200, 0] }

  test("with no bridge across it, the whole lap", () => {
    expect(trackOf(100, 100, [])).toEqual({ start: 0, span: Math.PI * 2 })
  })

  test("with one, the ship sails the longest clear arc, there and back, never within the margin", () => {
    const track = trackOf(100, 100, [wall])
    expect(track.span).toBeGreaterThan(Math.PI * 1.5)
    expect(track.span).toBeLessThan(Math.PI * 2)
    for (let travelled = -20; travelled < 40; travelled += 0.05) {
      const { angle } = trackAt(track, travelled)
      expect(clearOf([wall], Math.cos(angle) * 100, Math.sin(angle) * 100)).toBe(true)
    }
    expect(trackAt(track, 0).dir).toBe(1)
    expect(trackAt(track, track.span * 1.5).dir).toBe(-1)
  })
})

describe("React, an archipelago of its packages", () => {
  const sea = reactSplit()

  test(
    "it has bridges to keep clear of, and ferries",
    async () => {
      const { net } = await sea
      expect(net.walls.length).toBeGreaterThan(0)
      expect(net.routes.some((route) => route.table)).toBe(true)
    },
    60_000 * SLOW,
  )

  test(
    "no ferry comes within the margin of a bridge, moored or under way, over its whole timetable",
    async () => {
      const { net } = await sea
      const state: FerryState = { x: 0, z: 0, heading: 0, moored: undefined, s: 0, speed: 0 }
      let worst = Number.POSITIVE_INFINITY
      for (const route of net.routes) {
        if (!route.table) continue
        for (let t = 0; t < route.table.period; t += 1.5) {
          ferryAt(route.table, t, state)
          for (const wall of net.walls) worst = Math.min(worst, wallDistance(wall, state.x, state.z))
        }
      }
      expect(worst).toBeGreaterThanOrEqual(BRIDGE_CLEAR)
    },
    60_000 * SLOW,
  )

  test(
    "every island's idle ships keep clear of the bridges, their whole track",
    async () => {
      const { archipelago, net, home } = await sea
      const islands = [
        { at: archipelago.home.at, world: home },
        ...archipelago.islands.map((island) => ({ at: island.at, world: island.world })),
      ]
      for (const { at, world } of islands) {
        const walls = net.walls.map((wall) => wallFrom(wall, at))
        const { lap } = watersOf(world)
        const track = trackOf(lap.rx, lap.rz, walls)
        for (let travelled = 0; travelled < 40; travelled += 0.02) {
          const { angle } = trackAt(track, travelled)
          expect(clearOf(walls, Math.cos(angle) * lap.rx, Math.sin(angle) * lap.rz)).toBe(true)
        }
      }
    },
    60_000 * SLOW,
  )

  test(
    "the GitHub sea's voyages keep clear of the bridges, pushes, pull requests and the galleon",
    async () => {
      const { net, home } = await sea
      const base = { repo: "facebook/react", at: 0 }
      const pull = (kind: "pr_opened" | "pr_merged" | "pr_closed", number: number): SeaEvent => ({
        ...base,
        kind,
        id: `${kind}:${number}`,
        number,
        title: "t",
        author: "a",
        branch: "b",
      })
      const sightings: SeaSighting[] = [
        ...[1, 2, 3, 4, 5, 6].map((n) => ({ event: pull("pr_opened", n), at: 1000 + n })),
        {
          event: { ...base, kind: "push", id: "p1", branch: "main", commits: 4, author: "a", sha: "s" },
          at: 2000,
        },
        { event: pull("pr_merged", 2), at: 30_000 },
        { event: pull("pr_closed", 3), at: 40_000 },
        { event: { ...base, kind: "release", id: "r1", tag: "v1" }, at: 50_000 },
      ]
      const harbour = harbourOf(watersOf(home).quay)
      let seen = 0
      let loose = 0
      for (let t = 0; t < 260_000; t += 250) {
        for (const voyage of seaAt(sightings, t).voyages) {
          const free = toWorld(harbour, voyage.side, voyage.out)
          if (!clearOf(net.walls, free.x, free.z)) loose++
          const at = toWorldClear(harbour, net.walls, voyage.side, voyage.out)
          expect(clearOf(net.walls, at.x, at.z, BRIDGE_CLEAR - 1e-6)).toBe(true)
          seen++
        }
      }
      expect(seen).toBeGreaterThan(100)
      console.log(`voyages off a bridge by the filter: ${loose} of ${seen} samples`)
    },
    60_000 * SLOW,
  )

  test(
    "each bridge's head lands clear of every building (a full apron where the coast has room)",
    async () => {
      const { archipelago, home } = await sea
      let heads = 0
      let bare = 0
      let full = 0
      for (const info of [archipelago.home, ...archipelago.islands]) {
        const world =
          info.id === archipelago.home.id ? home : archipelago.islands.find((i) => i.id === info.id)?.world
        if (!world) continue
        for (const q of info.quays) {
          if (archipelago.links[q.link]?.kind !== "bridge") continue
          heads++
          if (!apronProblem(world, q.local, q.facing, HEAD, BUILDING)) bare++
          if (!apronProblem(world, q.local, q.facing, APRON)) full++
        }
      }
      console.log(`bridge heads clear of buildings: ${bare}, with a full apron: ${full}, of ${heads}`)
      expect(heads).toBeGreaterThan(0)
      expect(reachOf(home)).toBeGreaterThan(0)
      expect(bare).toBe(heads)
    },
    60_000 * SLOW,
  )

  test(
    "no lighthouse stands on a bridge's head or its ramp",
    async () => {
      const { archipelago, net, home } = await sea
      for (const info of [archipelago.home, ...archipelago.islands]) {
        const world =
          info.id === archipelago.home.id ? home : archipelago.islands.find((i) => i.id === info.id)?.world
        if (!world) continue
        const walls = net.walls.map((wall) => wallFrom(wall, info.at))
        const quays = info.quays.map((quay) => quay.local)
        const spot = lighthouseSpot(world.island, harbourOf(watersOf(world).quay), { walls, quays })
        if (spot) expect(clearOf(walls, spot.x, spot.z, 22)).toBe(true)
      }
    },
    60_000 * SLOW,
  )

  test(
    "nothing grows on a bridge's way over land: no tree or rock within its deck's width",
    async () => {
      const { archipelago, home } = await sea
      let lanes = 0
      for (const info of [archipelago.home, ...archipelago.islands]) {
        const world =
          info.id === archipelago.home.id ? home : archipelago.islands.find((i) => i.id === info.id)?.world
        if (!world) continue
        for (const q of info.quays) {
          if (archipelago.links[q.link]?.kind !== "bridge") continue
          const far = [archipelago.home, ...archipelago.islands]
            .flatMap((i) => i.quays)
            .find((o) => o.link === q.link && o !== q)
          const span = far ? Math.hypot(far.at[0] - q.at[0], far.at[1] - q.at[1]) : 12
          const from: Spot = [q.local[0] - q.facing[0] * 9, q.local[1] - q.facing[1] * 9]
          const to: Spot = [q.local[0] + q.facing[0] * span, q.local[1] + q.facing[1] * span]
          lanes++
          for (const wild of wildsOf(world)) {
            expect(toSegment([wild.x, wild.z], from, to)).toBeGreaterThanOrEqual(7.5 + wild.radius - 1e-6)
          }
        }
      }
      expect(lanes).toBe(8)
    },
    60_000 * SLOW,
  )
})
