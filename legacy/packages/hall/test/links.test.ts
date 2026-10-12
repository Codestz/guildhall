import { describe, expect, test } from "bun:test"
import { patchesOf } from "../src/scene/archipelago/footprint.ts"
import { crossingsOf, extentOf, type Footprint, OFFING, placeIslands } from "../src/world/archipelago.ts"
import type { Archipelago, FarIsland } from "../src/world/archipelagoSource.ts"
import { bridgeOf, DECK_EDGES, endsOf, RAIL_WIDTH, WALK_WIDTH } from "../src/world/bridges.ts"
import { DWELL_S, type FerryState, ferryAt, nextDeparture } from "../src/world/ferrySchedule.ts"
import { islandFromTree } from "../src/world/gen/islandFromTree.ts"
import { LANE_MARGIN, laneOf } from "../src/world/lanes.ts"
import type { Spot } from "../src/world/layout.ts"
import { netOf } from "../src/world/linkNet.ts"
import { isLand, linkSetOf, type Quay } from "../src/world/linkStub.ts"
import { travelBetween } from "../src/world/travel.ts"
import { handWorld, reachOf, repoWorld, type World } from "../src/world/world.ts"
import HINDSIGHT from "./fixtures/repos/codestz__claude-hindsight.json"
import MCPX from "./fixtures/repos/codestz__mcpx.json"
import MINTROOT from "./fixtures/repos/codestz__mintroot.json"
import COCKPIT from "./fixtures/repos/codestz__opencode-cockpit.json"

/** The default archipelago (gen 2), grown from the bundled fixtures, and its links. */
const fixtures = [HINDSIGHT, MCPX, COCKPIT, MINTROOT] as { repo: string; entries: never[] }[]
const home = handWorld()
const worlds: World[] = fixtures.map(({ repo, entries }) =>
  repoWorld(islandFromTree(entries, 0, 2), { repo, source: "fixture", gen: 2 }),
)
const footprint = (world: World, far: boolean): Footprint => ({
  reach: reachOf(world),
  patches: patchesOf(world, far),
})
const offsets = placeIslands(
  worlds.map((world, i) => ({ repo: (fixtures[i] as { repo: string }).repo, ...footprint(world, true) })),
  footprint(home, false),
)
const far = worlds.map(
  (world, i) =>
    ({
      repo: (fixtures[i] as { repo: string }).repo,
      name: (fixtures[i] as { repo: string }).repo,
      language: { name: "x", colour: "#fff" },
      at: offsets[i] as Spot,
      reach: reachOf(world),
      world,
    }) as unknown as FarIsland,
)
const homeInfo = {
  repo: "Codestz/guildhall",
  name: "guildhall",
  language: far[0]?.language,
  at: [0, 0] as Spot,
  reach: reachOf(home),
}
const shores = [homeInfo, ...far]
const archipelago = {
  home: homeInfo,
  islands: far,
  crossings: crossingsOf(shores),
  extent: extentOf(shores),
} as unknown as Archipelago
const worldOf = (id: string): World =>
  id === homeInfo.repo ? home : (far.find((i) => i.repo === id) as FarIsland).world

const ferries = netOf(linkSetOf(archipelago, home)).routes.filter((route) => route.table)
const dist = (a: readonly number[], b: readonly number[]): number =>
  Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0))

describe("quays", () => {
  const set = linkSetOf(archipelago, home)

  test("every link has a quay on each island: dry land at the coast, the pier end over water, facing the partner", () => {
    expect(set.links.length).toBeGreaterThan(0)
    for (const link of set.links)
      for (const [id, partner] of [
        [link.a, link.b],
        [link.b, link.a],
      ] as const) {
        const island = set.islands.find((i) => i.id === id)
        const other = set.islands.find((i) => i.id === partner)
        const quay = island?.quays[partner] as Quay
        const world = worldOf(id)
        const local = (p: Spot): Spot => [p[0] - (island?.center[0] ?? 0), p[1] - (island?.center[1] ?? 0)]
        expect(isLand(world, local(quay.land))).toBe(true)
        expect(isLand(world, local(quay.end))).toBe(false)
        const toPartner = Math.atan2(
          (other?.center[0] ?? 0) - (island?.center[0] ?? 0),
          (other?.center[1] ?? 0) - (island?.center[1] ?? 0),
        )
        expect(Math.cos(quay.facing - toPartner)).toBeGreaterThan(0.99)
      }
  })

  test("near quays are bridges, far ones ferries", () => {
    expect(set.links.every((link) => link.kind === "ferry")).toBe(true)
    expect(linkSetOf(archipelago, home, 150).links.some((link) => link.kind === "bridge")).toBe(true)
  })
})

describe("ferry lanes", () => {
  test("keep clear of every other island by its reach and the ships' offing", () => {
    expect(ferries.length).toBeGreaterThan(0)
    for (const route of ferries) {
      for (const island of shores) {
        if (island.repo === route.link.a || island.repo === route.link.b) continue
        for (const p of route.lane?.pts ?? [])
          expect(dist(p, island.at)).toBeGreaterThan(island.reach + OFFING)
      }
    }
  })

  test("run over open water between the two piers", () => {
    for (const route of ferries) {
      const [a, b] = [route.link.a, route.link.b]
      const pts = route.lane?.pts ?? []
      for (const p of pts) {
        for (const id of [a, b]) {
          const island = shores.find((i) => i.repo === id) as { at: Spot }
          expect(isLand(worldOf(id), [p[0] - island.at[0], p[1] - island.at[1]])).toBe(false)
        }
      }
    }
  })

  test("bow round an island in the way, keeping the margin", () => {
    const a: Quay = { land: [0, 0], end: [0, 12], facing: 0, height: 0, berthSide: 1 }
    const b: Quay = { land: [0, 400], end: [0, 388], facing: Math.PI, height: 0, berthSide: 1 }
    const blocker = { center: [10, 200] as Spot, reach: 60 }
    const lane = laneOf(a, b, [blocker])
    for (const p of lane.pts) expect(dist(p, blocker.center)).toBeGreaterThan(blocker.reach + LANE_MARGIN - 3)
    expect(laneOf(a, b, [])).toEqual(laneOf(a, b, []))
    expect(lane.length).toBeGreaterThan(laneOf(a, b, []).length)
  })
})

describe("ferry timetables", () => {
  const route = ferries[0] ?? (undefined as never)
  const table = route.table ?? (undefined as never)
  const at = (t: number): FerryState =>
    ferryAt(table, t, { x: 0, z: 0, heading: 0, moored: undefined, s: 0, speed: 0 })

  test("the same time gives the same place, and a round repeats", () => {
    for (const t of [0, 13.7, 91, 1234.5]) {
      expect(at(t)).toEqual(at(t))
      const later = at(t + table.period)
      const now = at(t)
      expect(later.x).toBeCloseTo(now.x, 6)
      expect(later.z).toBeCloseTo(now.z, 6)
    }
  })

  test("lies at a quay for its dwell, then sails and arrives at the other", () => {
    const depart = nextDeparture(table, "a", 0)
    const before = at(depart - 0.5)
    expect(before.moored).toBe("a")
    expect(before.speed).toBe(0)
    expect(dist([before.x, before.z], route.lane?.pts[0] ?? [])).toBeLessThan(0.01)
    expect(at(depart + 5).moored).toBeUndefined()
    const arrived = at(depart + table.sail + 0.5)
    expect(arrived.moored).toBe("b")
    const end = route.lane?.pts[(route.lane?.pts.length ?? 1) - 1] ?? []
    expect(dist([arrived.x, arrived.z], end)).toBeLessThan(0.01)
    // And it stays DWELL_S, then the next departure from B follows.
    expect(nextDeparture(table, "b", depart)).toBeCloseTo(depart + DWELL_S + table.sail, 6)
  })

  test("a next departure is never in the past, and is the soonest", () => {
    for (const t of [0, 5, 40.2, 500]) {
      for (const end of ["a", "b"] as const) {
        const d = nextDeparture(table, end, t)
        expect(d).toBeGreaterThanOrEqual(t)
        expect(d - t).toBeLessThanOrEqual(table.period)
        expect(at(d - 0.01).moored).toBe(end)
      }
    }
  })

  test("ferries do not all sail in step", () => {
    expect(new Set(ferries.map((r) => Math.round((r.table?.offset ?? 0) / 5))).size).toBeGreaterThan(1)
  })
})

describe("bridges", () => {
  const net = netOf(linkSetOf(archipelago, home, 150))
  const bridges = net.routes.filter((route) => route.bridge)

  test("their ends are at the two quays' landings, and the deck is continuous", () => {
    expect(bridges.length).toBeGreaterThan(0)
    for (const { bridge, quays } of bridges) {
      const [first, last] = endsOf(bridge as NonNullable<typeof bridge>)
      expect(dist(first, quays[0].land)).toBeLessThan(0.001)
      expect(dist(last, quays[1].land)).toBeLessThan(0.001)
      const path = bridge?.path ?? []
      for (let i = 1; i < path.length; i++) {
        const [p, q] = [path[i - 1], path[i]] as [number[], number[]]
        expect(Math.abs((q[2] ?? 0) - (p[2] ?? 0))).toBeLessThan(1)
      }
    }
  })

  test("piers divide it into spans of a similar length, abutments at the ramps' feet", () => {
    for (const { bridge } of bridges) {
      const piers = bridge?.piers ?? []
      expect(piers.length).toBeGreaterThanOrEqual(2)
      expect(piers[0]).toBe(bridge?.level[0] as number)
      expect(piers[piers.length - 1]).toBeCloseTo(bridge?.level[1] as number, 6)
    }
  })
})

describe("a bridge by its strait", () => {
  const quay = (z: number, facing: number): Quay => ({
    land: [0, z],
    end: [0, z],
    facing,
    height: 0,
    berthSide: 1,
  })
  const across = (gap: number) => bridgeOf(quay(0, 0), quay(gap, Math.PI))

  test("a strait of 70 is three arched spans on piers, level between ramps, with no tower", () => {
    const bridge = across(70)
    expect(bridge.piers.length - 1).toBe(3)
    expect(bridge.towers).toEqual([])
    const spans = bridge.piers.slice(1).map((pier, i) => pier - (bridge.piers[i] as number))
    for (const span of spans) expect(span).toBeGreaterThan(9)
    for (const span of spans) expect(span).toBeLessThan(17)
  })

  test("a long bridge gets a tower at its middle pier", () => {
    const bridge = across(130)
    expect(bridge.towers).toHaveLength(1)
    expect(bridge.piers).toContain(bridge.towers[0] as number)
  })

  test("a short strait still bridges: one span, ramps no longer than a third", () => {
    const bridge = across(30)
    expect(bridge.piers.length - 1).toBe(1)
    expect(bridge.level[0]).toBeLessThanOrEqual(10)
  })

  test("a lane is kept clear for a railway beside the walkway, inside the parapets", () => {
    const [left, right] = DECK_EDGES
    expect(right - left).toBeCloseTo(WALK_WIDTH + RAIL_WIDTH, 6)
    expect(left).toBe(-WALK_WIDTH / 2)
    // The walkable centreline stays on the axis, clear of the rail lane.
    expect(WALK_WIDTH / 2).toBeLessThan(right - RAIL_WIDTH + 0.5)
  })
})

describe("travelBetween", () => {
  const ferryNet = netOf(linkSetOf(archipelago, home))
  const bridgeNet = netOf(linkSetOf(archipelago, home, 150))
  const mcpx = "Codestz/mcpx"

  test("by ferry: walk to the pier, board at the next departure, ride, arrive", () => {
    const legs = travelBetween(ferryNet, homeInfo.repo, mcpx, 3) ?? []
    expect(legs.map((leg) => leg.kind)).toEqual(["walk", "ferry"])
    const [walk, ferry] = legs as [(typeof legs)[0], (typeof legs)[0]]
    expect(walk.endAt).toBeLessThanOrEqual(ferry.startAt)
    expect(ferry.endAt).toBeGreaterThan(ferry.startAt)
    const route = ferryNet.routes.find((r) => r.link.b === mcpx && r.link.a === homeInfo.repo)
    expect(ferry.startAt).toBeCloseTo(nextDeparture(route?.table as never, "a", walk.endAt), 6)
  })

  test("by bridge: walk the deck from landing to landing", () => {
    const legs = travelBetween(bridgeNet, homeInfo.repo, mcpx, 3) ?? []
    const bridge = legs.find((leg) => leg.kind === "bridge")
    expect(bridge?.kind).toBe("bridge")
    if (bridge?.kind !== "bridge") return
    expect(bridge.path.length).toBeGreaterThan(5)
    expect(bridge.endAt).toBeGreaterThan(bridge.startAt)
  })

  test("times only move forward through a journey, and the same call gives the same plan", () => {
    const legs = travelBetween(ferryNet, "Codestz/Mintroot", mcpx, 100) ?? []
    expect(legs.length).toBeGreaterThan(1)
    let clock = 100
    for (const leg of legs) {
      expect(leg.startAt).toBeGreaterThanOrEqual(clock - 1e-9)
      expect(leg.endAt).toBeGreaterThanOrEqual(leg.startAt)
      clock = leg.endAt
    }
    expect(travelBetween(ferryNet, "Codestz/Mintroot", mcpx, 100)).toEqual(legs)
  })

  test("nowhere to go: the same island is no legs, an unknown island or an unlinked one is null", () => {
    expect(travelBetween(ferryNet, mcpx, mcpx, 0)).toEqual([])
    expect(travelBetween(ferryNet, "nobody/nothing", mcpx, 0)).toBeNull()
    const alone = { set: ferryNet.set, routes: [] }
    expect(travelBetween(alone, homeInfo.repo, mcpx, 0)).toBeNull()
  })
})
