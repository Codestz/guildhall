import { describe, expect, test } from "bun:test"
import { cellAt, key } from "../src/world/gen/hex.ts"
import { islandFromTree } from "../src/world/gen/islandFromTree.ts"
import { LEDGE_STEP } from "../src/world/gen/relief/shape.ts"
import { onShelf } from "../src/world/gen/relief/trailCarve.ts"
import { SLOPE } from "../src/world/gen/relief/trailSearch.ts"
import type { RepoEntry } from "../src/world/gen/repo.ts"
import type { Spot } from "../src/world/layout.ts"
import { route } from "../src/world/paths.ts"
import { repoWorld, type World } from "../src/world/world.ts"
import HINDSIGHT from "./fixtures/repos/codestz__claude-hindsight.json"
import COCKPIT from "./fixtures/repos/codestz__opencode-cockpit.json"
import REACT from "./fixtures/repos/facebook__react.json"
import SELF from "./fixtures/repos/guildhall.json"

/**
 * Trails up the mountains (world/gen/relief/trails.ts, terrain 2c): from a road at a massif's foot
 * up to a lookout on its summit or a pass, carved into the relief as a shelf, joined to the walking
 * graph with costs by grade. They run on every gen 2 island that has a mountain worth climbing.
 */

const grow = (fixture: { entries: unknown[]; repo: string }, gen: 1 | 2): World =>
  repoWorld(islandFromTree(fixture.entries as RepoEntry[], 0, gen), {
    repo: fixture.repo,
    source: "fixture",
    ...(gen === 2 ? { gen } : {}),
  })

const react = grow(REACT, 2)
const FIXTURES: [string, World][] = [
  ["react", react],
  ["cockpit", grow(COCKPIT, 2)],
  ["hindsight", grow(HINDSIGHT, 2)],
  ["this repo", grow(SELF, 2)],
]
const distance = (a: Spot, b: Spot): number => Math.hypot(a[0] - b[0], a[1] - b[1])

/** Every node reachable from the harbour along the island's roads. */
function reachable(world: World): Set<string> {
  const seen = new Set(["HARBOUR"])
  for (let grew = true; grew; ) {
    grew = false
    for (const [a, b] of world.roads.edges)
      if (seen.has(a) !== seen.has(b)) {
        seen.add(a)
        seen.add(b)
        grew = true
      }
  }
  return seen
}

describe("trails exist where there is a mountain to climb", () => {
  test("a city's main range has two or three, and every massif of size one", () => {
    const trails = react.trails?.trails ?? []
    expect(trails.filter((t) => t.massif === 0).length).toBeGreaterThanOrEqual(2)
    expect(trails.filter((t) => t.massif === 0).length).toBeLessThanOrEqual(3)
    for (const world of FIXTURES.map(([, w]) => w)) expect(world.trails?.trails.length).toBeGreaterThan(0)
  })

  test("the first generator and the hand lands have none, and walk by length", () => {
    const first = grow(REACT, 1)
    expect(first.trails).toBeUndefined()
    expect(first.roads.costs).toBeUndefined()
  })
})

describe.each(FIXTURES)("a trail on %s", (_, world) => {
  const net = world.trails
  const relief = world.relief
  if (!net || !relief) throw new Error("no trails")

  test("is reachable from the road net, and the road reaches its lookout", () => {
    const seen = reachable(world)
    for (const trail of net.trails) for (const node of trail.nodes) expect(seen.has(node)).toBe(true)
    for (const lookout of net.lookouts) {
      const walk = route([0, 14], lookout.at, world.roads)
      // The walk ends at the lookout's node and passes along the trail to it.
      expect(walk[walk.length - 2]).toEqual(world.roads.nodes[lookout.node])
    }
  })

  test("leaves a road node at the foot, outside every massif, within a few units of its first node", () => {
    for (const trail of net.trails) {
      const [road, first] = trail.nodes as [string, string]
      const from = world.roads.nodes[road] as Spot
      expect(relief.keys.has(key(cellAt(from)))).toBe(false)
      expect(distance(from, world.roads.nodes[first] as Spot)).toBeLessThan(10)
    }
  })

  test("is flat across a ledge's top and a ramp up the one riser between two: no leg climbs more than a ledge", () => {
    let legs = 0
    let steps = 0
    for (const trail of net.trails)
      for (let k = 1; k + 1 < trail.nodes.length; k++) {
        const a = world.roads.nodes[trail.nodes[k] as string] as Spot
        const b = world.roads.nodes[trail.nodes[k + 1] as string] as Spot
        const rise = Math.abs(world.ground.heightAt(b[0], b[1]) - world.ground.heightAt(a[0], a[1]))
        expect(rise).toBeLessThanOrEqual(LEDGE_STEP + 0.02)
        legs++
        if (rise / distance(a, b) > SLOPE + 0.02) steps++
      }
    expect(legs).toBeGreaterThan(8)
    expect(steps / legs).toBeLessThan(0.4)
  })

  test("ends at its lookout, on the summit or a pass, on flat ground", () => {
    for (const lookout of net.lookouts) {
      const trail = net.trails.find((t) => `${t.id}#lookout` === lookout.id)
      expect(trail?.nodes[trail.nodes.length - 1]).toBe(lookout.node)
      expect(world.roads.nodes[lookout.node]).toEqual(lookout.at)
      expect(world.ground.heightAt(lookout.at[0], lookout.at[1])).toBeCloseTo(lookout.y, 1)
      const massif = relief.massifs[trail?.massif ?? 0]
      const target =
        lookout.kind === "summit" ? massif?.peaks.map((p) => p.at) : massif?.saddles.map((s) => s.at)
      expect(Math.min(...(target ?? []).map((spot) => distance(spot, lookout.at)))).toBeLessThan(25)
      // The pad: most of the ground round it stands at the lookout's height (the way up from it is lower).
      const level = [0, 1, 2, 3, 4, 5].filter((k) => {
        const a = (k * Math.PI) / 3
        const h = relief.heightAt(lookout.at[0] + 1.2 * Math.cos(a), lookout.at[1] + 1.2 * Math.sin(a))
        return Math.abs((h ?? Number.NaN) - lookout.y) < 0.6
      })
      expect(level.length).toBeGreaterThanOrEqual(2)
    }
  })

  test("climbs high: a summit lookout stands in the top third of the range's peak", () => {
    for (const lookout of net.lookouts.filter((l) => l.kind === "summit")) {
      const massif = relief.massifs[Number(lookout.id.slice(1).split(".")[0])]
      expect(lookout.y).toBeGreaterThan((massif?.height ?? 0) * 0.5)
    }
  })

  test("is carved into the relief as a shelf, and nothing grows on it", () => {
    for (const trail of net.trails) {
      const middle = world.roads.nodes[trail.nodes[Math.floor(trail.nodes.length / 2)] as string] as Spot
      const massif = relief.massifs[trail.massif]
      expect(massif && onShelf(massif, middle[0], middle[1])).toBe(true)
    }
    const wild = world.island.decor.filter(
      (d) => /^tree|^rock_single/.test(d.piece) && net.lookouts.every((l) => distance([d.x, d.z], l.at) > 5),
    )
    for (const piece of wild)
      for (const massif of relief.massifs)
        if (massif.grid.heightAt(piece.x, piece.z) !== undefined)
          expect(onShelf(massif, piece.x, piece.z)).toBe(false)
  })

  test("stands its lookout on the ground, a cairn and a flag", () => {
    for (const lookout of net.lookouts) {
      const parts = world.island.decor.filter((d) => distance([d.x, d.z], lookout.at) < 3)
      expect(parts.map((p) => p.piece)).toContain("flag_yellow")
      expect(Math.min(...parts.map((p) => p.y ?? 0))).toBeCloseTo(lookout.y, 1)
    }
  })
})

describe("trails are deterministic", () => {
  test("the same island grows the same trails, nodes and ground", () => {
    const again = grow(REACT, 2)
    expect(again.trails).toEqual(react.trails)
    expect(Array.from(again.relief?.massifs[0]?.grid.data ?? [])).toEqual(
      Array.from(react.relief?.massifs[0]?.grid.data ?? []),
    )
    expect(again.roads.costs).toEqual(react.roads.costs)
  })
})

describe("the walking graph over trails (world/paths.ts)", () => {
  // Far from the keep, so spots join the roads rather than the hall's aisles.
  const nodes = { A: [100, 0], B: [110, 0], C: [105, 8] } as const satisfies Record<string, Spot>
  const edges = [
    ["A", "B"],
    ["A", "C"],
    ["C", "B"],
  ] as const

  test("walks by an edge's cost, not its length, when it has one", () => {
    expect(route([100, 0], [110, 0], { nodes, edges })).not.toContainEqual([105, 8])
    expect(route([100, 0], [110, 0], { nodes, edges, costs: [100, 5, 5] })).toContainEqual([105, 8])
  })

  test("a spot on the mountain joins a trail's node; one a little way off it, the road", () => {
    const roads = {
      nodes: { R: [200, 0], A: [230, 0], "T0.0.0": [203, 4], "T0.0.1": [203, 9] } as Record<string, Spot>,
      edges: [
        ["R", "A"],
        ["R", "T0.0.0"],
        ["T0.0.0", "T0.0.1"],
      ] as const,
    }
    expect(route([230, 0], [203.5, 9], roads)).toContainEqual([203, 9])
    const off = route([230, 0], [207, 6], roads)
    expect(off).toContainEqual([200, 0])
    expect(off).not.toContainEqual([203, 4])
  })
})
