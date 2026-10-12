import { describe, expect, test } from "bun:test"
import type { PrefabMeta } from "@guildhall/assets"
import { roll } from "@guildhall/core"
import { distTo } from "../src/geom/line.ts"
import { contains, type Ring } from "../src/geom/poly.ts"
import type { Vec2 } from "../src/geom/vec.ts"
import { OCCUPANTS, type Occupancy } from "../src/island/cost.ts"
import { islandSite } from "../src/island/site.ts"
import { normalizeIslandSpec } from "../src/island/spec.ts"
import { type Countryside, GROUND_KINDS, type IslandSite, type RoadNetwork } from "../src/island/types.ts"
import { CLEARINGS, HABITS, WILDLIFE, wild, wildField, woodCover } from "../src/island/wild.ts"
import { type NatureLibrary, natureField } from "../src/town/nature.ts"

/** world island: growth step 7, the wild (nature over the free land) and the wildlife zones and herds. */

const meta = (id: string, frontage: number, depth: number): PrefabMeta => ({
  id,
  kind: "farmhouse",
  frontage,
  depth,
  height: 7,
  door: [0, depth / 2],
  stations: [],
  fits: {},
  tags: [],
})

const LIB: NatureLibrary = {
  prefabs: [meta("farmhouse-a", 9, 9)],
  edges: {
    wall: { segment: "kenney-castle/wall", length: 4 },
    hedge: { segment: "kenney-town/hedge", length: 3.5, gate: "kenney-town/hedge-gate" },
    fence: { segment: "kenney-town/fence", length: 3.5, gate: "kenney-town/fence-gate" },
  },
  nature: {
    trees: [
      "kaykit-forest/tree-1-c-color1",
      "quaternius-nature/common-tree-1",
      "quaternius-nature/pine-tree-2",
    ],
    bushes: ["quaternius-nature/bush-1"],
    crops: [],
    hay: [],
    rocks: ["quaternius-nature/rock-3"],
  },
  wild: {
    pines: ["quaternius-nature/pine-tree-2"],
    flowers: ["quaternius-nature/flowers"],
    grass: ["kenney-nature/grass-large"],
    logs: ["kenney-nature/log"],
    stumps: ["kenney-nature/stump-old"],
  },
}

const FRAME = OCCUPANTS.indexOf("frame")
const FIELD = OCCUPANTS.indexOf("field")
const PAD = OCCUPANTS.indexOf("pad")
const LAND = GROUND_KINDS.indexOf("land")

type Stub = {
  site: IslandSite
  occ: Occupancy
  net: RoadNetwork
  countryside: Countryside
  draw: (s: string) => number
  r: number
}

/**
 * A stand-in for the stages before the wild: the main town's frame (a disc on the land), two roads
 * running out of it, a field and a pasture by each road, and a POI pad in the far wood.
 */
function stub(seed: number, tier: "town" | "city"): Stub {
  const spec = normalizeIslandSpec({ seed, town: { seed: seed * 7 + 1, tier } })
  const r = spec.town.radius
  const site = islandSite(spec, r)
  const g = site.ground
  const draw = (s: string) => roll(seed, `${s}:wild`)
  const at = (i: number): Vec2 => [
    g.origin[0] + ((i % g.w) + 0.5) * g.cell,
    g.origin[1] + (Math.floor(i / g.w) + 0.5) * g.cell,
  ]
  const use = new Uint8Array(g.w * g.h)
  const ahead = (a: number, d: number): Vec2 => [d * Math.cos(a), d * Math.sin(a)]
  const back = spec.town.harbour.bearing + Math.PI
  const roads = [back - 0.8, back + 0.8].map((a) => [ahead(a, 1.3 * r), ahead(a, 1.9 * r)] as Vec2[])
  const net: RoadNetwork = {
    nodes: [],
    edges: roads.map((points, id) => ({
      id,
      a: 0,
      b: 0,
      cls: "road",
      points,
      width: 4,
      walk: "road",
      grown: 1,
    })),
  }
  const beside = (line: Vec2[], off: number, w: number, d: number): Ring => {
    const [a, b] = line as [Vec2, Vec2]
    const l = Math.hypot(b[0] - a[0], b[1] - a[1])
    const t: Vec2 = [(b[0] - a[0]) / l, (b[1] - a[1]) / l]
    const o: Vec2 = [-t[1], t[0]]
    const m: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    return [
      [0, off],
      [w, off],
      [w, off + d],
      [0, off + d],
    ].map(([x, z]) => [m[0] + t[0] * x! + o[0] * z!, m[1] + t[1] * x! + o[1] * z!] as Vec2)
  }
  const fields = roads.map((line) => ({ poly: beside(line, -40, 50, 30), crop: "wheat", rows: 0 }))
  const pastures = roads.map((line) => beside(line, 8, 40, 30))
  const pad = beside(roads[0]!, 60, 20, 20)
  for (let i = 0; i < use.length; i++) {
    const p = at(i)
    if ((g.kind[i] as number) >= LAND && Math.hypot(p[0], p[1]) < 1.25 * r) use[i] = FRAME
    else if (fields.some((f) => contains(f.poly, p))) use[i] = FIELD
    else if (contains(pad, p)) use[i] = PAD
  }
  const countryside: Countryside = {
    farmsteads: [],
    fields,
    pastures,
    edges: [],
    placements: [],
    stations: [],
    schedule: [],
  }
  return { site, occ: { use }, net, countryside, draw, r }
}

const STUBS = [
  [1, "city"],
  [2, "town"],
  [4, "town"],
  [7, "city"],
  [9, "town"],
  [12, "city"],
] as const
const RUNS = STUBS.map(([seed, tier]) => {
  const s = stub(seed, tier)
  const t = performance.now()
  const w = wild(s.site, s.occ, s.countryside, LIB, s.draw, { network: s.net, mainR: s.r, grown: 7 })
  return { ...s, w, ms: performance.now() - t }
})

describe("wild", () => {
  test("is deterministic", () => {
    const s = RUNS[0]!
    const again = wild(s.site, s.occ, s.countryside, LIB, s.draw, { network: s.net, mainR: s.r, grown: 7 })
    expect(again).toEqual(s.w)
  })

  test("plants the whole island's free land: woods beyond the town, open meadows between", () => {
    for (const { w, site } of RUNS) {
      const trees = w.nature.filter((p) => p.role === "tree")
      expect(trees.length).toBeGreaterThan(1000)
      expect(w.zones.some((z) => z.kind === "wood")).toBe(true)
      expect(w.zones.some((z) => z.kind === "meadow")).toBe(true)
      // Spread round the island, not bunched on one side: trees in at least three quadrants of it.
      const quads = new Set(
        trees.map((p) => `${p.at[0] > site.centre[0] ? 1 : 0}${p.at[1] > site.centre[1] ? 1 : 0}`),
      )
      expect(quads.size).toBeGreaterThanOrEqual(3)
    }
  })

  test("no tree on a road, a pad, a field, a frame or the water", () => {
    for (const { w, site, occ, net, countryside } of RUNS) {
      const g = site.ground
      for (const p of w.nature) {
        if (p.role !== "tree") continue
        const x = Math.floor((p.at[0] - g.origin[0]) / g.cell)
        const z = Math.floor((p.at[1] - g.origin[1]) / g.cell)
        const i = z * g.w + x
        expect(occ.use[i]).toBe(OCCUPANTS.indexOf("free"))
        expect(GROUND_KINDS[g.kind[i]!]).not.toBe("sea")
        expect(GROUND_KINDS[g.kind[i]!]).not.toBe("lake")
        for (const e of net.edges) expect(distTo(p.at, e.points)).toBeGreaterThan(e.width / 2)
        for (const f of countryside.fields) expect(contains(f.poly, p.at)).toBe(false)
        for (const ring of countryside.pastures) expect(contains(ring, p.at)).toBe(false)
      }
    }
  })

  test("every herd's home lies in its zone, and every deer waypoint in a glade", () => {
    for (const { w } of RUNS) {
      const zones = new Map(w.zones.map((z) => [z.id, z]))
      const glades = w.zones.filter((z) => z.kind === "glade")
      for (const h of w.herds) {
        const zone = zones.get(h.zone)
        expect(zone).toBeDefined()
        expect(contains(zone!.poly, h.home)).toBe(true)
        if (h.motion.model === "wander") {
          expect(zone!.kind).toBe("glade")
          for (const p of h.motion.waypoints) expect(glades.some((z) => contains(z.poly, p))).toBe(true)
        }
      }
    }
  })

  test("wildlife is sparse: herd counts fall in the agreed ranges", () => {
    const within = (n: number, [lo, hi]: readonly [number, number]) => {
      expect(n).toBeGreaterThanOrEqual(lo)
      expect(n).toBeLessThanOrEqual(hi)
    }
    for (const { w } of RUNS) {
      const of = (model: string) => w.herds.filter((h) => h.motion.model === model)
      within(of("graze").length, WILDLIFE.grazing)
      within(of("wander").length, WILDLIFE.deer)
      within(
        of("hop").reduce((n, h) => n + h.count, 0),
        WILDLIFE.rabbits,
      )
      within(of("circle").length, WILDLIFE.flocks)
      for (const h of of("graze")) {
        within(h.count, [4, 8])
        expect(["sheep", "cow", "horse"]).toContain(h.species)
      }
      for (const h of of("wander")) within(h.count, [2, 4])
      // Ids are unique; zones carry the growth rank they were given.
      expect(new Set(w.herds.map((h) => h.id)).size).toBe(w.herds.length)
      expect(new Set(w.zones.map((z) => z.id)).size).toBe(w.zones.length)
      expect(w.zones.every((z) => z.grown === 7)).toBe(true)
    }
  })

  test("grazers live in the pastures first", () => {
    for (const { w, countryside } of RUNS) {
      const graze = w.herds.filter((h) => h.motion.model === "graze")
      const inPasture = graze.filter((h) => h.zone.startsWith("pasture:")).length
      expect(inPasture).toBe(Math.min(graze.length, countryside.pastures.length))
    }
  })

  test("2–4 clearings are carved into the woods beyond the field's own glades; every glade is a clearing", () => {
    for (const { w, site, draw, r } of RUNS) {
      const field = wildField(site, draw, r)
      const own = natureField(
        { bounds: site.bounds, water: [...site.sea, ...site.lakes], rough: site.rough, radius: r },
        draw,
      )
      const carved = field.glades.length - own.glades.length
      expect(carved).toBeGreaterThanOrEqual(CLEARINGS[0])
      expect(carved).toBeLessThanOrEqual(CLEARINGS[1])
      expect(w.clearings).toHaveLength(field.glades.length)
      // A clearing is open: no tree at its heart.
      for (const gl of field.glades.slice(own.glades.length)) expect(field.cover(gl.at)).toBeLessThan(0.05)
    }
  })

  test("woodCover gives the router the field's woods: 0 on the water, the field's cover on land", () => {
    const { site, draw, r } = RUNS[1]!
    const field = wildField(site, draw, r)
    const g = site.ground
    const wood = woodCover(g, field)
    expect(wood).toHaveLength(g.w * g.h)
    let wooded = 0
    for (let i = 0; i < wood.length; i++) {
      const k = GROUND_KINDS[g.kind[i]!]
      if (k === "sea" || k === "lake") expect(wood[i]).toBe(0)
      if (wood[i]! > 0.6) wooded++
    }
    expect(wooded).toBeGreaterThan(100)
  })

  test("rock fields stay open: no wood core on them", () => {
    for (const { site, draw, r } of RUNS) {
      const field = wildField(site, draw, r)
      for (const ring of site.rough) for (const wd of field.woods) expect(contains(ring, wd.at)).toBe(false)
    }
  })

  test("species keep their hours: grazers by day, deer at dawn and dusk, birds roost at night", () => {
    const out = (hours: [number, number][], t: number) =>
      hours.some(([a, b]) => (a <= b ? t >= a && t < b : t >= a || t < b))
    expect(out(HABITS.sheep.active, 12)).toBe(true)
    expect(out(HABITS.deer.active, 6)).toBe(true)
    expect(out(HABITS.deer.active, 19)).toBe(true)
    expect(out(HABITS.deer.active, 13)).toBe(false)
    expect(out(HABITS.bird.active, 1)).toBe(false)
    expect(HABITS.bird.rest).toBe("roost")
  })

  test("is within budget: under 400 ms an island", () => {
    for (const { ms } of RUNS.slice(1)) expect(ms).toBeLessThan(400)
  })
})
