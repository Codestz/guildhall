import { describe, expect, test } from "bun:test"
import { roll } from "@guildhall/core"
import { distTo, intersect, length } from "../src/geom/line.ts"
import { clip, contains, shapeArea } from "../src/geom/poly.ts"
import { add, dist, scale, sub, type Vec2 } from "../src/geom/vec.ts"
import { generateTown } from "../src/index.ts"
import { disc, frameOf, landShare, toIsland, toLocal } from "../src/island/frame.ts"
import { mainRoads } from "../src/island/roads.ts"
import { APART, FARM_ROAD, GAP, type Settled, settle } from "../src/island/settle.ts"
import { islandSite, TOWN_CLEAR } from "../src/island/site.ts"
import { normalizeIslandSpec } from "../src/island/spec.ts"
import type {
  IslandSite,
  IslandSpecInput,
  NormalIslandSpec,
  RoadNetwork,
  Settlement,
} from "../src/island/types.ts"
import { groundAt } from "../src/land/ground.ts"
import { LIB } from "./town.fixture.ts"

/** world island satellites: growth step 3, the villages and hamlets that settle on the main roads. */

const CITY_SEEDS = [1, 2, 3]

interface Grown {
  spec: NormalIslandSpec
  site: IslandSite
  main: Settlement
  roads: RoadNetwork
  out: Settled
  ms: number
}

/** The island as growth step 2 leaves it (the main town framed at the origin, its main roads), then settled. */
function grow(input: IslandSpecInput): Grown {
  const spec = normalizeIslandSpec(input)
  const r = spec.town.radius
  const site = islandSite(spec, r)
  const bay = site.bays.find((b) => b.main)
  const frame = frameOf(site, [0, 0], TOWN_CLEAR * r, bay && add(bay.shore, scale(bay.out, 8)))
  const layout = generateTown(spec.town, LIB, undefined, frame)
  const main: Settlement = {
    id: "main",
    role: "main",
    tier: spec.town.tier,
    origin: [0, 0],
    frame,
    layout,
    exits: [],
    grown: 0,
  }
  const roads = mainRoads(site, main, spec, (salt) => roll(spec.seed, `${salt}:roads`))
  const t0 = performance.now()
  const out = settle(site, roads, spec, LIB, (salt) => roll(spec.seed, `${salt}:settle`))
  return { spec, site, main, roads, out, ms: performance.now() - t0 }
}

const cities = new Map<number, Grown>()
const city = (seed: number): Grown => {
  let g = cities.get(seed)
  if (!g) {
    g = grow({ seed, town: { seed: seed * 7 + 1, tier: "city" } })
    cities.set(seed, g)
  }
  return g
}
const role = (g: Grown, r: string) => g.out.settlements.find((s) => s.role === r) as Settlement

/** Metres along the roads from the town's nearest exit to each node. */
function fromTown(net: RoadNetwork): number[] {
  const d = net.nodes.map((n) => (n.kind === "exit" ? 0 : Number.POSITIVE_INFINITY))
  for (let changed = true; changed; ) {
    changed = false
    for (const e of net.edges) {
      const l = length(e.points)
      if (d[e.a]! + l < d[e.b]!) [d[e.b], changed] = [d[e.a]! + l, true]
      if (d[e.b]! + l < d[e.a]!) [d[e.a], changed] = [d[e.b]! + l, true]
    }
  }
  return d
}

/** Points every metre along a polyline. */
function along(line: readonly Vec2[]): { p: Vec2; s: number }[] {
  const out: { p: Vec2; s: number }[] = []
  let s0 = 0
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!
    const b = line[i]!
    const l = dist(a, b)
    for (let k = 0; k < Math.max(1, Math.ceil(l)); k++) {
      const t = l === 0 ? 0 : k / Math.ceil(l)
      out.push({ p: add(a, scale(sub(b, a), t)), s: s0 + t * l })
    }
    s0 += l
  }
  out.push({ p: line[line.length - 1]!, s: s0 })
  return out
}

describe("frameOf", () => {
  const site = city(1).site
  const bay = site.bays.find((b) => !b.main)!
  const centre = sub(bay.shore, scale(bay.out, 40))
  const harbour = add(bay.shore, scale(bay.out, 8))
  const frame = frameOf(site, centre, 98, harbour)

  test("is the island's land within the disc, in the settlement's local coordinates", () => {
    expect(frame.reach).toBe(98)
    for (const poly of frame.land)
      for (const ring of poly) for (const p of ring) expect(Math.hypot(...p)).toBeLessThanOrEqual(98.01)
    const island = shapeArea(clip(site.land, disc(centre, 98), "intersection"))
    expect(shapeArea(frame.land)).toBeCloseTo(island, -1)
    expect(landShare(frame)).toBeGreaterThan(0.3)
    expect(landShare(frame)).toBeLessThan(1)
  })

  test("its water holds the harbour's first, then the rest, every lake among them", () => {
    expect(contains(frame.water[0]!, toLocal({ origin: centre }, harbour))).toBe(true)
    expect(frame.water).toHaveLength(site.sea.length + site.lakes.length)
    const lake = site.lakes[0]!
    const local = lake.map((p) => toLocal({ origin: centre }, p))
    expect(frame.water.some((ring) => ring.every((p, i) => dist(p, local[i]!) < 0.01))).toBe(true)
  })

  test("toIsland and toLocal are each other's inverse", () => {
    const s = { origin: [120.5, -33.25] as Vec2 }
    for (const p of [
      [0, 0],
      [10, -4.5],
      [-80, 61],
    ] as Vec2[]) {
      expect(toIsland(s, p)).toEqual([p[0] + 120.5, p[1] - 33.25])
      expect(toLocal(s, toIsland(s, p))).toEqual(p)
    }
  })
})

describe("settle on the city preset", () => {
  test("gives a fishing village, a farming village and a mining camp, nothing dropped", () => {
    for (const seed of CITY_SEEDS) {
      const { out, spec } = city(seed)
      expect(out.dropped, `city#${seed}`).toEqual([])
      expect(out.settlements.map((s) => s.role)).toEqual(spec.satellites.map((s) => s.role))
      expect(out.settlements.map((s) => s.id)).toEqual(["fishing-0", "farming-0", "mining-0"])
      expect(role(city(seed), "mining").tier).toBe("hamlet")
    }
  }, 120_000)

  test("fishing: a harbour on a far bay or on a lake, not on the main town's bay", () => {
    for (const seed of CITY_SEEDS) {
      const g = city(seed)
      const s = role(g, "fishing")
      expect(s.layout.spec.harbour, `city#${seed}`).not.toBeNull()
      const water = s.frame.water[0]!.map((p) => toIsland(s, p))
      const lake = g.site.lakes.some(
        (ring) => ring.length === water.length && ring.every((p, i) => dist(p, water[i]!) < 0.01),
      )
      const quay = s.layout.streets.nodes.find((n) => n.kind === "quay")
      expect(quay, `city#${seed}`).toBeDefined()
      const at = toIsland(s, quay!.at)
      const home = g.site.bays.find((b) => b.main)!
      expect(dist(at, home.shore)).toBeGreaterThan(g.main.frame.reach)
      if (!lake) {
        const far = Math.min(...g.site.bays.filter((b) => !b.main).map((b) => dist(b.shore, at)))
        expect(far, `city#${seed}`).toBeLessThan(150)
      }
    }
  })

  test("farming: inland, on a main road 180–350 m of road out from the town", () => {
    for (const seed of CITY_SEEDS) {
      const g = city(seed)
      const s = role(g, "farming")
      const i =
        Math.floor((s.origin[1] - g.site.ground.origin[1]) / g.site.ground.cell) * g.site.ground.w +
        Math.floor((s.origin[0] - g.site.ground.origin[0]) / g.site.ground.cell)
      expect(groundAt(g.site.ground, s.origin)).toBe("land")
      expect(g.site.ground.coastDist[i]!).toBeGreaterThanOrEqual(60)
      const d = fromTown(g.roads)
      const onRoad = g.roads.edges.some((e) => {
        const total = length(e.points)
        return along(e.points).some(({ p, s: arc }) => {
          const road = Math.min(d[e.a]! + arc, d[e.b]! + total - arc)
          return dist(p, s.origin) <= 31 && road >= FARM_ROAD[0] && road <= FARM_ROAD[1]
        })
      })
      expect(onRoad, `city#${seed}`).toBe(true)
    }
  })

  test("mining: within 60 m of the rough ground, off it", () => {
    for (const seed of CITY_SEEDS) {
      const g = city(seed)
      const s = role(g, "mining")
      expect(g.site.rough.some((ring) => contains(ring, s.origin))).toBe(false)
      expect(
        Math.min(...g.site.rough.map((ring) => distTo(s.origin, ring, true))),
        `city#${seed}`,
      ).toBeLessThanOrEqual(60)
    }
  })

  test("frames are disjoint, the spacing kept, the main town's frame included", () => {
    for (const seed of CITY_SEEDS) {
      const g = city(seed)
      const discs = [g.main, ...g.out.settlements].map((s) => ({ c: s.origin, r: s.frame.reach }))
      for (let a = 0; a < discs.length; a++)
        for (let b = a + 1; b < discs.length; b++) {
          const gap = dist(discs[a]!.c, discs[b]!.c)
          expect(gap, `city#${seed} ${a}×${b}`).toBeGreaterThanOrEqual(APART)
          expect(gap - discs[a]!.r - discs[b]!.r, `city#${seed} ${a}×${b}`).toBeGreaterThanOrEqual(GAP)
        }
    }
  })

  test("the main town keeps 18–26% of the island's land (its gate circle over the land)", () => {
    for (const seed of CITY_SEEDS) {
      const { site, spec } = city(seed)
      const share = (Math.PI * spec.town.radius ** 2) / shapeArea(site.land)
      expect(share, `city#${seed}`).toBeGreaterThanOrEqual(0.18)
      expect(share, `city#${seed}`).toBeLessThanOrEqual(0.26)
    }
  })

  test("no satellite puts a street or a building on a lake", () => {
    for (const seed of CITY_SEEDS) {
      const g = city(seed)
      for (const s of g.out.settlements) {
        const points = [
          ...s.layout.streets.edges.flatMap((e) => e.points),
          ...s.layout.placements
            .filter((p) => !["pier", "boat", "cargo"].includes(p.role ?? ""))
            .map((p) => p.at),
        ].map((p) => toIsland(s, p))
        const wet = points.filter((p) =>
          g.site.lakes.some((ring) => contains(ring, p, 0) && distTo(p, ring, true) > 0.5),
        )
        expect(wet.slice(0, 2), `city#${seed} ${s.id}`).toEqual([])
      }
    }
  })
})

describe("settle's roads", () => {
  test("keep out of every satellite's frame, joining it at its exits", () => {
    for (const seed of CITY_SEEDS) {
      const { out } = city(seed)
      for (const e of out.net.edges)
        for (const { p } of along(e.points))
          for (const s of out.settlements)
            expect(dist(p, s.origin), `city#${seed} edge ${e.id} in ${s.id}`).toBeGreaterThanOrEqual(
              s.frame.reach - 1,
            )
    }
  })

  test("every satellite's exits are exit nodes of the network, and at least one is joined", () => {
    for (const seed of CITY_SEEDS) {
      const { out } = city(seed)
      for (const s of out.settlements) {
        const exits = s.layout.streets.nodes.filter((n) => n.tag === "exit")
        expect(s.exits).toHaveLength(exits.length)
        s.exits.forEach((id, k) => {
          const node = out.net.nodes[id]!
          expect(node.kind).toBe("exit")
          expect(node.ref).toBe(`${s.id}#${exits[k]!.id}`)
          expect(node.at).toEqual(toIsland(s, exits[k]!.at))
        })
        const used = new Set(out.net.edges.flatMap((e) => [e.a, e.b]))
        expect(
          s.exits.some((id) => used.has(id)),
          `city#${seed} ${s.id}`,
        ).toBe(true)
      }
    }
  })

  test("join everything: the network and the settlements' streets make one connected whole", () => {
    for (const seed of CITY_SEEDS) {
      const { out } = city(seed)
      const { nodes, edges } = out.net
      const parent = nodes.map((n) => n.id)
      const find = (i: number): number => (parent[i] === i ? i : find(parent[i]!))
      const join = (a: number, b: number) => {
        parent[find(a)] = find(b)
      }
      for (const e of edges) join(e.a, e.b)
      // A settlement's exits are joined by its own streets (its walk graph is connected).
      const groups = new Map<string, number[]>()
      for (const n of nodes)
        if (n.kind === "exit")
          groups.set(n.ref!.split("#")[0]!, [...(groups.get(n.ref!.split("#")[0]!) ?? []), n.id])
      for (const ids of groups.values()) for (const id of ids) join(ids[0]!, id)
      const roots = new Set(nodes.map((n) => find(n.id)))
      expect(roots.size, `city#${seed}`).toBe(1)
      for (const e of edges) {
        expect(e.points[0]).toEqual(nodes[e.a]!.at)
        expect(e.points.at(-1)).toEqual(nodes[e.b]!.at)
      }
    }
  })

  test("never cross water, nor each other except at junctions", () => {
    for (const seed of CITY_SEEDS) {
      const { out, site } = city(seed)
      const { nodes, edges } = out.net
      for (const e of edges)
        for (const { p } of along(e.points)) {
          const ground = groundAt(site.ground, p)
          expect(ground === "sea" || ground === "lake", `city#${seed} edge ${e.id} at ${p}`).toBe(false)
        }
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
                  `city#${seed} edges ${i}×${j}`,
                ).toBe(true)
            }
        }
    }
  })

  test("satellites grow after the roads, in spec order; their tracks with them", () => {
    for (const seed of CITY_SEEDS) {
      const { out, roads } = city(seed)
      const last = Math.max(...roads.edges.map((e) => e.grown))
      expect(out.settlements.map((s) => s.grown)).toEqual([last + 1, last + 2, last + 3])
      const ranks = new Set(out.settlements.map((s) => s.grown))
      for (const e of out.net.edges) if (e.cls === "track") expect(ranks.has(e.grown)).toBe(true)
    }
  })
})

describe("settle", () => {
  test("is deterministic, and a city's satellites take well under a second", () => {
    const g = city(2)
    const again = settle(g.site, g.roads, g.spec, LIB, (salt) => roll(g.spec.seed, `${salt}:settle`))
    expect(again).toEqual(g.out)
    expect(Math.max(...CITY_SEEDS.map((s) => city(s).ms))).toBeLessThan(1000)
  }, 60_000)

  test("reports a role the island cannot hold, and settles the rest", () => {
    const g = grow({ seed: 1, town: { seed: 8, tier: "city" }, rough: 0 })
    expect(g.out.dropped).toEqual([{ role: "mining", index: 2, why: "no site on the island" }])
    expect(g.out.settlements.map((s) => s.role)).toEqual(["fishing", "farming"])
  }, 60_000)

  test("with no satellites asked for, leaves the roads as they are", () => {
    const { site, roads, spec } = city(1)
    const out = settle(site, roads, { ...spec, satellites: [] }, LIB, (salt) => roll(1, salt))
    expect(out).toEqual({ settlements: [], net: roads, dropped: [] })
  })
})
