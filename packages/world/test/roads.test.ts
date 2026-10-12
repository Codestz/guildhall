import { describe, expect, test } from "bun:test"
import { DMath, roll } from "@guildhall/core"
import { distTo, intersect, length } from "../src/geom/line.ts"
import { clip, type Ring } from "../src/geom/poly.ts"
import { dist, snap, type Vec2 } from "../src/geom/vec.ts"
import { generateTown } from "../src/index.ts"
import { mainRoads, reasons } from "../src/island/roads.ts"
import { islandSite } from "../src/island/site.ts"
import { normalizeIslandSpec } from "../src/island/spec.ts"
import type { IslandSite, NormalIslandSpec, RoadNetwork, Settlement } from "../src/island/types.ts"
import { groundAt } from "../src/land/ground.ts"
import type { Tier } from "../src/town/types.ts"
import { LIB } from "./town.fixture.ts"

/** world island roads: growth step 2, the main roads out from the harbour town to the island's reasons. */

const SEEDS = [1, 2, 3, 4, 5, 6]
const TIERS: Tier[] = ["town", "city"]

function disc(radius: number, n = 64): Ring {
  return Array.from({ length: n }, (_, i) => {
    const t = (2 * Math.PI * i) / n
    return snap([radius * DMath.cos(t), radius * DMath.sin(t)])
  })
}

/**
 * The island and its main town as growth step 1 leaves them: the town at the island's origin, framed
 * by the land within 1.6r of its centre, its water the sea (the harbour's nearest first) and the lakes.
 */
function grown(seed: number, tier: Tier): { spec: NormalIslandSpec; site: IslandSite; main: Settlement } {
  const spec = normalizeIslandSpec({ seed, town: { seed: seed * 7 + 1, tier } })
  const r = spec.town.radius
  const site = islandSite(spec, r)
  const reach = 1.6 * r
  const water = [...site.sea].sort((a, b) => distTo([0, 0], a, true) - distTo([0, 0], b, true))
  const frame = {
    land: clip(site.land, disc(reach), "intersection"),
    water: [...water, ...site.lakes],
    reach,
  }
  const layout = generateTown(spec.town, LIB, undefined, frame)
  const main: Settlement = {
    id: "main",
    role: "main",
    tier,
    origin: [0, 0],
    frame,
    layout,
    exits: [],
    grown: 0,
  }
  return { spec, site, main }
}

const cases = TIERS.flatMap((tier) => SEEDS.map((seed) => ({ tier, seed })))
const built = new Map<string, ReturnType<typeof grown> & { net: RoadNetwork; ms: number }>()
function island(tier: Tier, seed: number) {
  const key = `${tier}#${seed}`
  let b = built.get(key)
  if (!b) {
    const g = grown(seed, tier)
    const t0 = performance.now()
    const net = mainRoads(g.site, g.main, g.spec, (salt) => roll(seed, `${salt}:roads`))
    b = { ...g, net, ms: performance.now() - t0 }
    built.set(key, b)
  }
  return b
}

describe("reasons", () => {
  test("lead somewhere distinct, outside the town, in story order", () => {
    for (const { tier, seed } of cases) {
      const { site, main } = island(tier, seed)
      const rs = reasons(site, main)
      expect(rs.length).toBeGreaterThanOrEqual(2)
      const order = ["bay", "lake", "rough", "headland"]
      const ranks = rs.map((r) => order.indexOf(r.kind))
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b))
      for (const r of rs) {
        expect(groundAt(site.ground, r.at)).toBe("land")
        expect(dist(r.at, main.origin)).toBeGreaterThan(main.frame.reach)
        expect(dist(r.at, r.toward)).toBeLessThan(80)
      }
      for (let i = 0; i < rs.length; i++)
        for (let j = i + 1; j < rs.length; j++) expect(dist(rs[i]!.at, rs[j]!.at)).toBeGreaterThan(30)
    }
  }, 60_000)

  test("a far bay is a reason only when it lies well round the coast from the harbour", () => {
    for (const { tier, seed } of cases) {
      const { site, main } = island(tier, seed)
      const bay = reasons(site, main).find((r) => r.kind === "bay")
      if (!bay) continue
      const harbour = site.bays.find((b) => b.main)!
      expect(dist(bay.toward, harbour.shore)).toBeGreaterThan(main.frame.reach)
    }
  })
})

describe("mainRoads", () => {
  test("every reason is reached: an end node, or a node on the network, carries its id", () => {
    for (const { tier, seed } of cases) {
      const { site, main, net } = island(tier, seed)
      for (const r of reasons(site, main)) {
        const node = net.nodes.find((n) => n.ref === r.id)
        expect(node, `${tier}#${seed} ${r.id}`).toBeDefined()
        expect(dist(node!.at, r.at)).toBeLessThan(6)
      }
    }
  })

  test("roads start at the town's exits and are a connected network of 4 m roads", () => {
    for (const { tier, seed } of cases) {
      const { main, net } = island(tier, seed)
      const exits = main.layout.streets.nodes.filter((n) => n.tag === "exit").map((n) => n.at)
      const starts = net.nodes.filter((n) => n.kind === "exit")
      expect(starts.length).toBeGreaterThan(0)
      for (const s of starts) expect(exits.some((p) => dist(p, s.at) < 0.01)).toBe(true)
      for (const e of net.edges) {
        expect([e.cls, e.walk, e.width]).toEqual(["road", "road", 4])
        expect(e.points[0]).toEqual(net.nodes[e.a]!.at)
        expect(e.points.at(-1)).toEqual(net.nodes[e.b]!.at)
        expect(e.grown).toBeGreaterThanOrEqual(1)
      }
      // Connected from the exits.
      const seen = new Set(starts.map((n) => n.id))
      for (let grew = true; grew; ) {
        grew = false
        for (const e of net.edges)
          if (seen.has(e.a) !== seen.has(e.b)) {
            seen.add(e.a).add(e.b)
            grew = true
          }
      }
      expect(seen.size).toBe(net.nodes.length)
    }
  })

  test("roads never cross water", () => {
    for (const { tier, seed } of cases) {
      const { site, net } = island(tier, seed)
      for (const e of net.edges)
        for (let i = 1; i < e.points.length; i++) {
          const a = e.points[i - 1]!
          const b = e.points[i]!
          const n = Math.ceil(dist(a, b))
          for (let k = 0; k <= n; k++) {
            const p: Vec2 = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]
            const ground = groundAt(site.ground, p)
            expect(ground === "sea" || ground === "lake", `${tier}#${seed} edge ${e.id} at ${p}`).toBe(false)
          }
        }
    }
  })

  test("no two road edges cross except at junctions", () => {
    for (const { tier, seed } of cases) {
      const { net } = island(tier, seed)
      const { edges, nodes } = net
      for (let i = 0; i < edges.length; i++)
        for (let j = i + 1; j < edges.length; j++) {
          const e = edges[i]!
          const f = edges[j]!
          const shared = [e.a, e.b].filter((n) => n === f.a || n === f.b).map((n) => nodes[n]!.at)
          for (let s = 1; s < e.points.length; s++)
            for (let t = 1; t < f.points.length; t++) {
              const x = intersect(e.points[s - 1]!, e.points[s]!, f.points[t - 1]!, f.points[t]!)
              if (x)
                expect(
                  shared.some((p) => dist(p, x.at) < 0.01),
                  `${tier}#${seed} edges ${i}×${j}`,
                ).toBe(true)
            }
        }
    }
  })

  test("every edge's road length is at most 1.6× its straight distance", () => {
    for (const { tier, seed } of cases) {
      const { net } = island(tier, seed)
      for (const e of net.edges) {
        const straight = dist(e.points[0]!, e.points.at(-1)!)
        expect(length(e.points), `${tier}#${seed} edge ${e.id}`).toBeLessThanOrEqual(1.6 * straight)
      }
    }
  })

  test("later roads share the earlier ones: junctions, and grown ranks in reason order", () => {
    let junctions = 0
    for (const { tier, seed } of cases) {
      const { site, main, net } = island(tier, seed)
      junctions += net.nodes.filter((n) => n.kind === "junction").length
      const order = reasons(site, main).map((r) => r.id)
      for (const e of net.edges) expect(e.grown).toBe(1 + order.indexOf(e.reason!))
    }
    expect(junctions).toBeGreaterThan(cases.length / 2)
  })

  test("is deterministic, and a city island's main roads take about 100 ms at most", () => {
    const a = island("city", 3)
    const again = mainRoads(a.site, a.main, a.spec, (salt) => roll(3, `${salt}:roads`))
    expect(again).toEqual(a.net)
    const worst = Math.max(...SEEDS.map((s) => island("city", s).ms))
    expect(worst).toBeLessThan(100)
  })
})
