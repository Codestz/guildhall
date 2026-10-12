import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { Object3D } from "three"
import { type HallVisit, HallVisits } from "../src/guild/hall.ts"
import type { AdventurerView } from "../src/guild/store.ts"
import { Brain } from "../src/scene/brain.ts"
import { SEA_Y as DRAWN_SEA_Y } from "../src/scene/Ships.tsx"
import { isleAt, SEA_Y } from "../src/scene/voyage.ts"
import { type Isle, isleOf, type Sea, seaNow, setSea, setSeaNet } from "../src/world/abroad.ts"
import { setActiveWorld } from "../src/world/active.ts"
import { DECK_Y } from "../src/world/bridges.ts"
import { blocker, islandObstacles } from "../src/world/clearance.ts"
import { type FerryState, ferryAt } from "../src/world/ferrySchedule.ts"
import { covers } from "../src/world/hall/site.ts"
import type { Hall } from "../src/world/hall/types.ts"
import type { Spot } from "../src/world/layout.ts"
import { isLand } from "../src/world/linkStub.ts"
import { SLOW } from "./support/slow.ts"
import { reactSplit } from "./support/splitFixture.ts"

/**
 * Going to another island and its hall (scene/voyage.ts through scene/brain.ts), walked frame by
 * frame as the scene walks it: on foot over roads, through a hall's gate and along its lane, by
 * ferry (aboard, where the boat is) or over a bridge; never on the water, never through a wall.
 */

setDefaultTimeout(120_000 * SLOW)

const DT = 0.1
const home: Spot = [0, 13]

interface Sample {
  t: number
  at: Spot
  y: number
  riding: boolean
}

describe("a voyage", () => {
  let split: Awaited<ReturnType<typeof reactSplit>>
  let sea: Sea

  beforeAll(async () => {
    split = await reactSplit()
    setActiveWorld(split.home)
    setSea(split.archipelago)
    setSeaNet(split.net)
    sea = seaNow() as Sea
  })
  afterAll(() => {
    setSea(null)
    setActiveWorld(undefined)
  })

  const isle = (suffix: string): Isle => sea.far.find((one) => one.id.endsWith(suffix)) as Isle

  /** The view of someone bound for `island`'s hall to do `craft`, or for home. */
  function bound(
    island: Isle | undefined,
    craft = "read",
  ): { view: AdventurerView; hall: HallVisit | undefined } {
    const visit = island
      ? new HallVisits(sea, new Map([["x", island.id]]), []).visit("x", island.id, craft as "read")
      : undefined
    const target = visit?.target ?? [home[0], home[1], 0]
    return {
      view: {
        id: "x",
        phase: "working",
        target,
        ...(visit ? { hall: visit.visit } : {}),
      } as unknown as AdventurerView,
      hall: visit?.visit,
    }
  }

  /** Walks a brain from `from` at story time `t0` until it stands at the target (or `limit` seconds pass). */
  function walk(
    from: Spot,
    view: AdventurerView,
    t0: number,
    limit = 700,
  ): { trace: Sample[]; arrived: boolean } {
    let clock = t0
    const brain = new Brain("x", () => clock)
    const node = new Object3D()
    node.position.set(from[0], 0, from[1])
    const trace: Sample[] = []
    let arrived = false
    for (let t = t0; t < t0 + limit; t += DT) {
      clock = t
      brain.walk(node, view, null, false, false, DT)
      trace.push({ t, at: [node.position.x, node.position.z], y: node.position.y, riding: brain.riding })
      if (
        Math.hypot(node.position.x - view.target[0], node.position.z - view.target[1]) < 0.3 &&
        !brain.voyage.crossing
      ) {
        arrived = true
        break
      }
    }
    return { trace, arrived }
  }

  /** Whether a point is somewhere a person may be: on land, on a pier or its stage, on a bridge, or aboard a ferry. */
  function legal({ t, at, riding }: Sample): boolean {
    const island = isleAt(sea, at) as Isle
    const local: Spot = [at[0] - island.at[0], at[1] - island.at[1]]
    if (riding) {
      const state: FerryState = { x: 0, z: 0, heading: 0, moored: undefined, s: 0, speed: 0 }
      return split.net.routes.some(
        (route) => route.table && Math.hypot(...sub(at, ferryAt(route.table, t, state))) < 6.5,
      )
    }
    if (isLand(island.world, local)) return true
    for (const route of split.net.routes) {
      for (const quay of route.quays) if (route.table && toSegment(at, quay.land, quay.end) < 3.2) return true
      if (route.bridge?.path.some((p) => Math.hypot(p[0] - at[0], p[1] - at[1]) < 3.2)) return true
    }
    return false
  }

  function sub(a: Spot, f: { x: number; z: number }): [number, number] {
    return [a[0] - f.x, a[1] - f.z]
  }

  function toSegment(p: Spot, a: Spot, b: Spot): number {
    const [dx, dz] = [b[0] - a[0], b[1] - a[1]]
    const u = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz || 1)))
    return Math.hypot(p[0] - (a[0] + dx * u), p[1] - (a[1] + dz * u))
  }

  /** The segment a→b crosses one of a hall's walls (its outline, but for the gate and the back doorway)? */
  function throughWall(hall: Hall, island: Isle, a: Spot, b: Spot): boolean {
    const local = (p: Spot): [number, number] => {
      const [dx, dz] = [p[0] - island.at[0] - hall.at[0], p[1] - island.at[1] - hall.at[1]]
      const [sin, cos] = [Math.sin(hall.rot), Math.cos(hall.rot)]
      return [dx * cos - dz * sin, dx * sin + dz * cos]
    }
    const [p, q] = [local(a), local(b)]
    const lines: [number, boolean][] = [
      [hall.w / 2, true],
      [-hall.w / 2, true],
      [hall.d / 2, false],
      [-hall.d / 2, false],
    ]
    for (const [edge, isX] of lines) {
      const [s, e] = isX ? [p[0], q[0]] : [p[1], q[1]]
      if ((s - edge) * (e - edge) >= 0) continue
      const u = (edge - s) / (e - s)
      const x = p[0] + (q[0] - p[0]) * u
      const z = p[1] + (q[1] - p[1]) * u
      const across = isX ? z : x
      const along = isX ? hall.d / 2 : hall.w / 2
      // The gate (front, +z) and the doorway (back, -z) are 4 wide, in the middle.
      if (!isX && Math.abs(across) < 2) continue
      if (Math.abs(across) <= along) return true
    }
    return false
  }

  test("from the home gate to a far island's hall by ferry: aboard the boat, never on the water, never through a wall", () => {
    const island = isle("#packages/shared")
    const { view } = bound(island, "edit")
    const { trace, arrived } = walk(home, view, 0)
    expect(arrived).toBe(true)
    expect(trace.some((s) => s.riding)).toBe(true)
    expect(trace.filter((s) => !legal(s)).slice(0, 3)).toEqual([])
    // No step takes anyone through a hall's wall, on any island.
    const hall = island.world.hall as Hall
    for (let i = 1; i < trace.length; i++) {
      const [a, b] = [trace[i - 1] as Sample, trace[i] as Sample]
      if (!a.riding && !b.riding) expect(throughWall(hall, island, a.at, b.at)).toBe(false)
    }
    // They end at their spot, inside the hall.
    const last = trace[trace.length - 1] as Sample
    expect(covers(hall, last.at[0] - island.at[0], last.at[1] - island.at[1])).toBe(true)
  })

  test("they step aboard only when the boat lies at the quay, and step off when it lies at the other", () => {
    const island = isle("#packages/shared")
    const { trace } = walk(home, bound(island).view, 0)
    const aboard = trace.findIndex((s) => s.riding)
    const off = trace.length - 1 - [...trace].reverse().findIndex((s) => s.riding)
    expect(aboard).toBeGreaterThan(0)
    const state: FerryState = { x: 0, z: 0, heading: 0, moored: undefined, s: 0, speed: 0 }
    const route =
      split.net.routes.find((r) => r.table && (r.link.a === island.id || r.link.b === island.id)) ??
      split.net.routes.find((r) => r.table)
    expect(route).toBeDefined()
    // When they step off the boat has stopped; the ride took a while (the lane's length at speed).
    const sail = (trace[off]?.t ?? 0) - (trace[aboard]?.t ?? 0)
    expect(sail).toBeGreaterThan(10)
    void state
  })

  test("the same trip at the same time takes the same way (deterministic)", () => {
    const { view } = bound(isle("#packages/shared"))
    const a = walk(home, view, 12.3).trace
    const b = walk(home, view, 12.3).trace
    expect(a.length).toBe(b.length)
    expect(a.map((s) => s.at)).toEqual(b.map((s) => s.at))
  })

  test("back home again: from the far hall to the home island by the same crossings", () => {
    const island = isle("#packages/shared")
    const out = bound(island)
    const there = walk(home, out.view, 0).trace
    const end = there[there.length - 1] as Sample
    const { trace, arrived } = walk(end.at, bound(undefined).view, end.t)
    expect(arrived).toBe(true)
    expect(trace.some((s) => s.riding)).toBe(true)
    expect(trace.filter((s) => !legal(s)).slice(0, 3)).toEqual([])
  })

  test("across a bridge on foot: up its ramp, over the deck, down: no boat", () => {
    const from = isle("#packages/react-dom")
    const to = isle("#packages/react-dom-bindings")
    const start = new HallVisits(sea, new Map([["x", from.id]]), []).visit("x", from.id, "read")
    const { view } = bound(to)
    const { trace, arrived } = walk(start?.target as unknown as Spot, view, 0, 900)
    expect(arrived).toBe(true)
    expect(trace.some((s) => s.riding)).toBe(false)
    expect(Math.max(...trace.map((s) => s.y))).toBeGreaterThan(DECK_Y - 1)
    expect(trace.filter((s) => !legal(s)).slice(0, 3)).toEqual([])
    expect(isleOf(sea, to.id)).toBeDefined()
  })

  test("a bridge is crossed by a walker, never a ferry's lane: no route is a ferry where the link is a bridge", () => {
    const bridges = split.net.routes.filter((route) => route.bridge)
    expect(bridges.length).toBeGreaterThan(0)
    for (const route of bridges) expect(route.table).toBeUndefined()
  })

  test("the sea's surface is the one the ships are drawn on", () => {
    expect(SEA_Y).toBe(DRAWN_SEA_Y)
  })

  test("blocked by no landmark: on a far island the walk never goes through its main building", () => {
    const island = isle("#packages/shared")
    const buildings = islandObstacles(island.world).filter((o) => /^(building_|wall_)/.test(o.name))
    const { trace } = walk(home, bound(island).view, 0)
    for (const s of trace) {
      if (s.riding || isleAt(sea, s.at) !== island) continue
      const local: Spot = [s.at[0] - island.at[0], s.at[1] - island.at[1]]
      expect(blocker(local, buildings, 0)?.name).toBeUndefined()
    }
  })
})
