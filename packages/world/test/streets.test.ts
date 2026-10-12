import { describe, expect, test } from "bun:test"
import { roll } from "@guildhall/core"
import { centroid, contains, dist, distTo, intersect, type Vec2 } from "../src/index.ts"
import { site } from "../src/town/site.ts"
import { TIER_DEFAULTS } from "../src/town/spec.ts"
import { STREET_WIDTH, streets, townLand } from "../src/town/streets.ts"
import type { StreetGraph, Tier, TownSpecInput } from "../src/town/types.ts"

/**
 * world town: the street graph (wall street through the gates, the market square's frame, main
 * streets, partial rings, side streets and squares, harbour street, country roads and their forks;
 * a hamlet's street past its green).
 */

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

  test("gates sit on the wall line (radius r, on the wall street; a hamlet has none) and a road runs on out of each", () => {
    for (const { spec, site: s, graph } of built) {
      const gates = graph.nodes.filter((n) => n.kind === "gate")
      expect(gates.length, label(spec)).toBeGreaterThanOrEqual(2)
      expect(gates.length).toBeLessThanOrEqual(TIER_DEFAULTS[spec.tier].gates)
      const wall = TIER_DEFAULTS[spec.tier].walls ? "street" : "lane"
      const walls = spec.tier === "hamlet" ? 0 : 2
      for (const g of gates) {
        expect(Math.abs(Math.hypot(...g.at) - s.radius), label(spec)).toBeLessThanOrEqual(1)
        const classes = graph.edges.filter((e) => e.a === g.id || e.b === g.id).map((e) => e.cls)
        expect(classes.filter((c) => c === wall).length, label(spec)).toBe(walls)
        expect(classes).toContain("main")
        expect(classes).toContain("road")
      }
    }
  })

  test("main roads start on the street round the plaza (the square's frame or the hamlet's green, or the waterfront where it gives way)", () => {
    for (const { spec, site: s, graph } of built) {
      const plaza = graph.nodes.filter((n) => n.kind === "plaza")
      expect(plaza.length, label(spec)).toBeGreaterThanOrEqual(2)
      const c = centroid(s.plaza)
      const reach = Math.max(...s.plaza.map((p) => dist(p, c)))
      for (const n of plaza) {
        const classes = graph.edges.filter((e) => e.a === n.id || e.b === n.id).map((e) => e.cls)
        expect(classes, label(spec)).toContain("main")
        expect(classes.some((cls) => cls !== "main")).toBe(true)
        // The main gate's corner is drawn out, so its street widens into the square: half a plaza more.
        expect(dist(n.at, c), label(spec)).toBeLessThan(3 * reach + 12)
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

  test("each gate's road runs on out to the bounds (or the water), never back into the town", () => {
    for (const { spec, site: s, graph } of built) {
      const h = 1.3 * s.radius
      const atEdge = (p: Vec2) =>
        Math.abs(Math.max(Math.abs(p[0]), Math.abs(p[1])) - h) < 0.1 ||
        s.water.some((w) => distTo(p, w, true) < 0.1)
      for (const gate of graph.nodes.filter((n) => n.kind === "gate")) {
        // Walk the roads out of the gate: some end of them is on the bounds or the shore.
        const seen = new Set([gate.id])
        const stack = [gate.id]
        let out = false
        while (stack.length > 0) {
          const v = stack.pop()!
          for (const e of graph.edges.filter((x) => x.cls === "road" && (x.a === v || x.b === v))) {
            const w = e.a === v ? e.b : e.a
            if (seen.has(w)) continue
            seen.add(w)
            stack.push(w)
            const n = graph.nodes[w]!
            if (n.kind === "end" && atEdge(n.at)) out = true
            for (const p of e.points) expect(Math.hypot(...p), label(spec)).toBeGreaterThan(s.radius - 1)
          }
        }
        expect(out, `${label(spec)} gate ${gate.id}`).toBe(true)
      }
    }
  })

  test("a fork is where a footpath leaves a road; a road end is a footpath's dead end inside the bounds", () => {
    let forks = 0
    for (const { spec, site: s, graph } of built) {
      const h = 1.3 * s.radius
      for (const n of graph.nodes.filter((x) => x.tag)) {
        const classes = graph.edges.filter((e) => e.a === n.id || e.b === n.id).map((e) => e.cls)
        expect(
          classes.every((c) => c === "road"),
          label(spec),
        ).toBe(true)
        if (n.tag === "fork") {
          forks++
          expect(classes.length, label(spec)).toBe(3)
        } else {
          expect(n.kind, label(spec)).toBe("end")
          expect(Math.max(Math.abs(n.at[0]), Math.abs(n.at[1])), label(spec)).toBeLessThan(h - 1)
        }
      }
    }
    // Most roads out of a village or bigger have room for one (the bounds are close: see W1).
    const roads = built
      .filter((b) => b.spec.tier !== "hamlet")
      .reduce((sum, b) => sum + b.graph.nodes.filter((n) => n.kind === "gate").length, 0)
    expect(forks / roads).toBeGreaterThan(0.6)
  })

  test("a hamlet is a street past a green, not a ring: its only loop is the green's", () => {
    for (const { spec, graph } of built.filter((b) => b.spec.tier === "hamlet")) {
      // Connected, so the loops are edges − nodes + 1.
      expect(graph.edges.length - graph.nodes.length + 1, label(spec)).toBe(1)
      expect(graph.edges.some((e) => e.cls === "main")).toBe(true)
    }
  })

  test("towns grow side streets and partial rings, and forks round small squares", () => {
    for (const { spec, graph } of built.filter((b) => b.spec.tier === "town" || b.spec.tier === "city")) {
      expect(graph.squares?.length ?? 0, label(spec)).toBeGreaterThanOrEqual(1)
      for (const q of graph.squares ?? []) expect(["well", "inn", "chapel"]).toContain(q.kind)
      // More streets than the wall, the square's frame and the main streets alone would make.
      expect(graph.edges.filter((e) => e.cls === "street").length, label(spec)).toBeGreaterThan(8)
    }
  })
})
