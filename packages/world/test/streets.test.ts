import { describe, expect, test } from "bun:test"
import { roll } from "@guildhall/core"
import { centroid, contains, dist, intersect, type Vec2 } from "../src/index.ts"
import { site } from "../src/town/site.ts"
import { TIER_DEFAULTS } from "../src/town/spec.ts"
import { STREET_WIDTH, streets, townLand } from "../src/town/streets.ts"
import type { StreetGraph, Tier, TownSpecInput } from "../src/town/types.ts"

/** world town: the street graph (wall street through the gates, market oval, main roads, harbour street, ring). */

const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1)
const TIERS: Tier[] = ["hamlet", "village", "town", "city"]
const draw = (seed: number) => (salt: string) => roll(seed, `${salt}:streets`)

function make(spec: TownSpecInput) {
  const s = site(spec)
  return { site: s, graph: streets(s, spec, draw(spec.seed)) }
}
const cases = TIERS.flatMap((tier) => SEEDS.map((seed) => ({ seed, tier }) as TownSpecInput))
const built = cases.map((spec) => ({ spec, ...make(spec) }))
const label = (spec: TownSpecInput) => `${spec.tier}#${spec.seed}`

/** Every pair of edges whose polylines cross or touch anywhere but at a node they share. */
export function crossings(g: StreetGraph): string[] {
  const out: string[] = []
  const box = g.edges.map((e) => {
    const xs = e.points.map((p) => p[0])
    const zs = e.points.map((p) => p[1])
    return [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)] as const
  })
  const isNode = (p: Vec2) => g.nodes.some((n) => dist(n.at, p) < 0.01)
  for (let i = 0; i < g.edges.length; i++)
    for (let j = i + 1; j < g.edges.length; j++) {
      const [a, b] = [box[i]!, box[j]!]
      if (a[0] > b[2] || b[0] > a[2] || a[1] > b[3] || b[1] > a[3]) continue
      const p = g.edges[i]!.points
      const q = g.edges[j]!.points
      for (let k = 0; k + 1 < p.length; k++)
        for (let m = 0; m + 1 < q.length; m++) {
          const hit = intersect(p[k]!, p[k + 1]!, q[m]!, q[m + 1]!)
          if (hit && !isNode(hit.at)) out.push(`${i}×${j} at ${hit.at}`)
        }
    }
  return out
}

/** Whether every node can be reached from node 0 along the edges. */
export function connected(g: StreetGraph): boolean {
  const seen = new Set([0])
  const stack = [0]
  while (stack.length > 0) {
    const v = stack.pop()!
    for (const e of g.edges) {
      const w = e.a === v ? e.b : e.b === v ? e.a : -1
      if (w >= 0 && !seen.has(w)) {
        seen.add(w)
        stack.push(w)
      }
    }
  }
  return seen.size === g.nodes.length
}

describe("streets", () => {
  test("is deterministic: the same spec gives the same graph, bit for bit", () => {
    for (const { spec, graph } of built.filter((_, i) => i % 5 === 0)) expect(make(spec).graph).toEqual(graph)
  })

  test("is planar: edges meet only at nodes", () => {
    for (const { spec, graph } of built) expect(crossings(graph), label(spec)).toEqual([])
  })

  test("is connected", () => {
    for (const { spec, graph } of built) expect(connected(graph), label(spec)).toBe(true)
  })

  test("edges join their nodes, carry a polyline and the width of their class", () => {
    for (const { graph } of built)
      for (const e of graph.edges) {
        expect(e.points.length).toBeGreaterThanOrEqual(2)
        expect(dist(e.points[0]!, graph.nodes[e.a]!.at)).toBeLessThan(0.01)
        expect(dist(e.points[e.points.length - 1]!, graph.nodes[e.b]!.at)).toBeLessThan(0.01)
        expect(e.width).toBe(STREET_WIDTH[e.cls])
      }
  })

  test("every street lies on the town's land", () => {
    for (const { spec, site: s, graph } of built) {
      const land = townLand(s)
      for (const e of graph.edges)
        for (const p of e.points) expect(contains(land, p, 0.01), `${label(spec)} ${p}`).toBe(true)
    }
  })

  test("gates sit on the wall line (radius r, on the wall street) and a road runs on out of each", () => {
    for (const { spec, site: s, graph } of built) {
      const gates = graph.nodes.filter((n) => n.kind === "gate")
      expect(gates.length, label(spec)).toBeGreaterThanOrEqual(2)
      expect(gates.length).toBeLessThanOrEqual(TIER_DEFAULTS[spec.tier].gates)
      const wall = TIER_DEFAULTS[spec.tier].walls ? "street" : "lane"
      for (const g of gates) {
        expect(Math.abs(Math.hypot(...g.at) - s.radius), label(spec)).toBeLessThanOrEqual(1)
        const classes = graph.edges.filter((e) => e.a === g.id || e.b === g.id).map((e) => e.cls)
        expect(classes.filter((c) => c === wall).length, label(spec)).toBe(2)
        expect(classes).toContain("main")
        expect(classes).toContain("road")
      }
    }
  })

  test("main roads start on the street round the plaza (the oval, or the waterfront where it gives way)", () => {
    for (const { spec, site: s, graph } of built) {
      const plaza = graph.nodes.filter((n) => n.kind === "plaza")
      expect(plaza.length, label(spec)).toBeGreaterThanOrEqual(2)
      const c = centroid(s.plaza)
      const reach = Math.max(...s.plaza.map((p) => dist(p, c)))
      for (const n of plaza) {
        const classes = graph.edges.filter((e) => e.a === n.id || e.b === n.id).map((e) => e.cls)
        expect(classes, label(spec)).toContain("main")
        expect(classes.some((cls) => cls !== "main")).toBe(true)
        expect(dist(n.at, c)).toBeLessThan(2 * reach + 12)
      }
    }
  })

  test("a harbour gets one quay at the water's edge; no harbour, no quay", () => {
    for (const { spec, site: s, graph } of built) {
      const quays = graph.nodes.filter((n) => n.kind === "quay")
      if (s.water.length === 0) {
        expect(quays).toEqual([])
        continue
      }
      expect(quays.length, label(spec)).toBe(1)
      const q = quays[0]!.at
      expect(
        s.water.some((w) => contains(w, q, 0.01)),
        `${label(spec)} ${q}`,
      ).toBe(true)
    }
  })

  test("roads run from the gates out to the bounds", () => {
    for (const { spec, site: s, graph } of built) {
      const roads = graph.edges.filter((e) => e.cls === "road")
      expect(roads.length, label(spec)).toBe(graph.nodes.filter((n) => n.kind === "gate").length)
      const h = 1.3 * s.radius
      for (const e of roads) {
        const ends = [graph.nodes[e.a]!, graph.nodes[e.b]!]
        expect(ends.some((n) => n.kind === "gate")).toBe(true)
        const far = ends.find((n) => n.kind === "end")
        expect(far, label(spec)).toBeDefined()
        expect(Math.max(Math.abs(far!.at[0]), Math.abs(far!.at[1]))).toBeCloseTo(h, 1)
      }
    }
  })
})
