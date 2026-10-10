import { describe, expect, test } from "bun:test"
import { DECK_EDGES, PARAPET } from "../src/world/bridges.ts"
import { blocker, islandObstacles } from "../src/world/clearance.ts"
import { DWELL_S, type FerryState, ferryAt } from "../src/world/ferrySchedule.ts"
import { HULL_BEAM, HULL_LENGTH, STAGE_EDGE } from "../src/world/lanes.ts"
import type { Spot } from "../src/world/layout.ts"
import { toSegment } from "../src/world/lights.ts"
import { isLand, PIER, type Quay } from "../src/world/linkStub.ts"
import { BRIDGE_SPACING, BUILDING, HEAD_LAND } from "../src/world/quays.ts"
import { SLOW } from "./support/slow.ts"
import { reactSplit } from "./support/splitFixture.ts"

/**
 * A bridge leaves its island from the coast: its way over land is a ramp from a quay at the shore,
 * joined to the island's roads by a road of its own, and the span is over water. The docks keep
 * clear of the bridges and of each other, and a ferry lying at its dock never meets a pier.
 * (React, split.)
 */

/** The ends of every bridge: the island, and the axis out from where the deck leaves it (island-local). */
async function endsOfBridges() {
  const { archipelago, net, home } = await reactSplit()
  const infos = [archipelago.home, ...archipelago.islands]
  const worldOf = (id: string) =>
    id === archipelago.home.id ? home : (archipelago.islands.find((i) => i.id === id)?.world as typeof home)
  const ends = []
  for (const route of net.routes) {
    const bridge = route.bridge
    if (!bridge) continue
    const first = bridge.path[0] as readonly [number, number, number]
    const last = bridge.path[bridge.path.length - 1] as readonly [number, number, number]
    const ux = Math.sin(bridge.heading)
    const uz = Math.cos(bridge.heading)
    for (const [id, from, sign] of [
      [route.link.a, first, 1],
      [route.link.b, last, -1],
    ] as const) {
      const info = infos.find((i) => i.id === id)
      if (!info) continue
      ends.push({
        id,
        world: worldOf(id),
        /** The point `s` along the axis from this end, `side` to the axis's right, island-local. */
        at: (s: number, side = 0): Spot => [
          from[0] - info.at[0] + sign * (ux * s) + uz * side * sign,
          from[1] - info.at[1] + sign * (uz * s) - ux * side * sign,
        ],
        length: bridge.length,
      })
    }
  }
  return ends
}

describe("bridges leave from the coast", () => {
  test(
    "each end's way over its own island's land is a ramp: no longer than a hex, then water",
    async () => {
      const ends = await endsOfBridges()
      expect(ends.length).toBeGreaterThanOrEqual(2)
      for (const end of ends) {
        let overLand = 0
        for (let s = 0; s <= end.length; s += 0.5) if (isLand(end.world, end.at(s))) overLand = s
        expect(overLand).toBeLessThanOrEqual(HEAD_LAND + 1)
      }
    },
    60_000 * SLOW,
  )

  test(
    "the deck never lies over a building, nor over a road but the bridge's own",
    async () => {
      const ends = await endsOfBridges()
      const [left, right] = DECK_EDGES
      for (const end of ends) {
        const buildings = islandObstacles(end.world).filter((o) => BUILDING.test(o.name))
        const { nodes, edges } = end.world.roads
        // The roads of the bridge's own quay: Q<n>, and the waypoints of its road (Q<n>.<k>).
        const others = edges.filter(([a, b]) => !/^Q\d/.test(a) && !/^Q\d/.test(b))
        for (let s = 0; s <= HEAD_LAND; s += 1)
          for (const side of [left - PARAPET, 0, right + PARAPET]) {
            const at = end.at(s, side)
            if (!isLand(end.world, at)) continue
            expect(blocker(at, buildings, 0.2)?.name).toBeUndefined()
            for (const [a, b] of others)
              expect(toSegment(at, nodes[a] as Spot, nodes[b] as Spot)).toBeGreaterThan(1)
          }
      }
    },
    60_000 * SLOW,
  )
})

// ---- Docks -------------------------------------------------------------------------------------

/** An oriented box on the sea: its centre, heading (radians, 0 = +z) and half sizes (across, along). */
interface Box {
  at: Spot
  heading: number
  half: readonly [across: number, along: number]
}

const acrossOf = (heading: number): Spot => [Math.cos(heading), -Math.sin(heading)]
const alongOf = (heading: number): Spot => [Math.sin(heading), Math.cos(heading)]

/** Whether two boxes overlap (the separating axis test). */
function overlap(a: Box, b: Box): boolean {
  const reach = (box: Box, axis: Spot): number => {
    const [x, z] = acrossOf(box.heading)
    const [u, w] = alongOf(box.heading)
    return (
      Math.abs(x * axis[0] + z * axis[1]) * box.half[0] + Math.abs(u * axis[0] + w * axis[1]) * box.half[1]
    )
  }
  return [a, b]
    .flatMap(({ heading }) => [acrossOf(heading), alongOf(heading)])
    .every(
      (axis) =>
        Math.abs((b.at[0] - a.at[0]) * axis[0] + (b.at[1] - a.at[1]) * axis[1]) <
        reach(a, axis) + reach(b, axis),
    )
}

/** A dock as timber: the pier out from the coast, and the wider landing stage at its end. */
function dockBoxes(quay: Quay): Box[] {
  const [ux, uz] = alongOf(quay.facing)
  const stage = 4
  const at = (s: number): Spot => [quay.land[0] + ux * s, quay.land[1] + uz * s]
  return [
    { at: at((PIER - stage) / 2), heading: quay.facing, half: [1.3, (PIER - stage) / 2] },
    { at: at(PIER - stage / 2), heading: quay.facing, half: [STAGE_EDGE, stage / 2] },
  ]
}

describe("docks", () => {
  const sea = async () => {
    const { net } = await reactSplit()
    const ferries = net.routes.filter((route) => route.link.kind === "ferry")
    const bridges = net.routes.flatMap((route) => (route.bridge ? [route.bridge] : []))
    /** The bridge's body over the water, piers and cutwaters included: the axis, widened (bridges.ts' deck edges and parapets). */
    const bridgeBoxes: Box[] = bridges.map((bridge) => {
      const first = bridge.path[0] as readonly [number, number, number]
      const last = bridge.path[bridge.path.length - 1] as readonly [number, number, number]
      const [left, right] = DECK_EDGES
      const middle = (left + right) / 2
      const [rx, rz] = acrossOf(bridge.heading)
      const wide = (right - left) / 2 + PARAPET + 2
      return {
        at: [(first[0] + last[0]) / 2 + rx * middle, (first[1] + last[1]) / 2 + rz * middle],
        heading: bridge.heading,
        half: [wide, bridge.length / 2],
      }
    })
    return { net, ferries, bridgeBoxes }
  }

  test(
    "a ferry's dock keeps its distance from every bridge's head, on every island",
    async () => {
      const { archipelago } = await reactSplit()
      let checked = 0
      for (const info of [archipelago.home, ...archipelago.islands]) {
        const heads = info.quays.filter((q) => archipelago.links[q.link]?.kind === "bridge")
        const docks = info.quays.filter((q) => archipelago.links[q.link]?.kind === "ferry")
        for (const head of heads)
          for (const dock of docks) {
            checked++
            expect(
              Math.hypot(head.local[0] - dock.local[0], head.local[1] - dock.local[1]),
            ).toBeGreaterThanOrEqual(BRIDGE_SPACING)
          }
      }
      expect(checked).toBeGreaterThan(0)
    },
    60_000 * SLOW,
  )

  test(
    "a dock's timber stands clear of every building on its island",
    async () => {
      const { archipelago, home } = await reactSplit()
      let docks = 0
      let crowded = 0
      for (const info of [archipelago.home, ...archipelago.islands]) {
        const world =
          info.id === archipelago.home.id ? home : archipelago.islands.find((i) => i.id === info.id)?.world
        if (!world) continue
        const buildings = islandObstacles(world).filter((o) => BUILDING.test(o.name))
        for (const quay of info.quays.filter((q) => archipelago.links[q.link]?.kind === "ferry")) {
          docks++
          const [ux, uz] = quay.facing
          let hit = false
          // From the deck's inland end out to the pier's end, across its landing stage.
          for (let s = -3; s <= PIER; s += 1)
            for (const side of [-STAGE_EDGE, 0, STAGE_EDGE]) {
              const at: Spot = [quay.local[0] + ux * s + uz * side, quay.local[1] + uz * s - ux * side]
              if (blocker(at, buildings, 0.2)) hit = true
            }
          if (hit) crowded++
        }
      }
      expect(docks).toBeGreaterThan(10)
      // A cramped coast may leave a dock no better place (a link is worth a tight landing).
      expect(crowded).toBeLessThanOrEqual(Math.floor(docks / 10))
    },
    60_000 * SLOW,
  )

  test(
    "no pier overlaps another, nor a bridge",
    async () => {
      const { ferries, bridgeBoxes } = await sea()
      const piers = ferries.flatMap((route) => route.quays.map((quay) => dockBoxes(quay)))
      expect(piers.length).toBeGreaterThan(2)
      for (const [i, pier] of piers.entries()) {
        for (const other of piers.slice(i + 1))
          for (const a of pier) for (const b of other) expect(overlap(a, b)).toBe(false)
        for (const span of bridgeBoxes) for (const a of pier) expect(overlap(a, span)).toBe(false)
      }
    },
    60_000 * SLOW,
  )

  test(
    "a ferry lying at a dock, even turning, never meets a pier or a bridge",
    async () => {
      const { ferries, bridgeBoxes } = await sea()
      const piers = ferries.flatMap((route) => route.quays.flatMap((quay) => dockBoxes(quay)))
      const state: FerryState = { x: 0, z: 0, heading: 0, moored: undefined, s: 0, speed: 0 }
      let moored = 0
      for (const route of ferries) {
        if (!route.table) continue
        for (let t = 0; t < route.table.period; t += DWELL_S / 24) {
          ferryAt(route.table, t, state)
          if (!state.moored) continue
          moored++
          const hull: Box = { at: [state.x, state.z], heading: state.heading, half: [HULL_BEAM, HULL_LENGTH] }
          for (const box of [...piers, ...bridgeBoxes]) expect(overlap(hull, box)).toBe(false)
        }
      }
      expect(moored).toBeGreaterThan(100)
    },
    60_000 * SLOW,
  )
})
