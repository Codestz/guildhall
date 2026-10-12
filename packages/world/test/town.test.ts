import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { createCatalog, type PrefabRecipe } from "@guildhall/assets"
import {
  contains,
  distTo,
  generateTown,
  intersect,
  lotRect,
  PLANT_ROLES,
  prefabLibrary,
  type Rect,
  rectCorners,
  rectsOverlap,
  STATION_PAD,
  type Tier,
  type TownLayout,
  type TownSpecInput,
  townMetrics,
  type Vec2,
  WALK_KINDS,
  WALK_RULES,
  walkGraph,
} from "../src/index.ts"
import { built, CATALOG, entry, INDEX, LIB, label, PRESETS, RECIPES, town } from "./town.fixture.ts"

/** world town: the whole generator (spec → TownLayout), its library, stations and metrics. */

/** Footprints of everything placed that is not a plant. */
function solids(plan: TownLayout): { role: string; r: Rect }[] {
  return plan.placements.flatMap((p) => {
    const size = plan.sizes[p.prefab]
    if (!size || PLANT_ROLES.has(p.role ?? "")) return []
    return [{ role: p.role ?? "?", r: { c: p.at, rot: p.rot, w: size[0], d: size[1] } }]
  })
}
const near = (a: Rect, b: Rect, d: number) => Math.abs(a.c[0] - b.c[0]) < d && Math.abs(a.c[1] - b.c[1]) < d

describe("prefabLibrary", () => {
  test("compiles every authored recipe to a prefab with its footprint", () => {
    expect(LIB.prefabs.map((p) => p.id)).toEqual(RECIPES.map((r) => r.id))
    for (const p of LIB.prefabs) expect(LIB.sizes[p.id]).toEqual([p.frontage, p.depth])
  })

  test("names only catalog pieces, each with its size", () => {
    const ids = [
      ...Object.values(LIB.nature).flat(),
      ...(LIB.farm?.crops?.flat() ?? []),
      ...(LIB.farm?.animals ?? []),
      ...(LIB.farm?.orchard ?? []),
      ...(LIB.wild?.pines ?? []),
      ...(LIB.wild?.flowers ?? []),
      ...(LIB.harbour?.boats ?? []).map((b) => b.id),
      ...(LIB.harbour?.cargo ?? []),
      ...Object.values(LIB.props).flatMap((list) => list.map((p) => p.id)),
    ]
    expect(ids.length).toBeGreaterThan(30)
    for (const id of ids) {
      expect(CATALOG.get(id), id).toBeDefined()
      expect(LIB.sizes[id], id).toBeDefined()
    }
    expect(LIB.harbour?.deck?.id).toBe("kenney-pirate/platform-planks")
    expect(LIB.props.stalls.map((s) => s.id)).toEqual(["kenney-town/stall-red"])
  })

  test("falls back to the catalog's categories and tags when a preferred piece is missing", () => {
    const catalog = createCatalog(INDEX, [
      [
        entry("other/oak", "tree", [3, 6, 3]),
        entry("other/oak-snow", "tree", [3, 6, 3]),
        entry("other/market-stand", "prop", [3, 3, 3], ["market"]),
      ],
    ])
    const lib = prefabLibrary([], catalog)
    expect(lib.nature.trees).toEqual(["other/oak"])
    expect(lib.props.stalls.map((s) => s.id)).toEqual(["other/market-stand"])
    expect(lib.props.anvils).toEqual([])
    expect(lib.harbour?.deck).toBeUndefined()
  })

  test("leaves out a recipe that names a piece the catalog lacks", () => {
    const broken: PrefabRecipe = {
      ...(RECIPES[0] as PrefabRecipe),
      id: "broken",
      dressing: [{ piece: "nowhere/thing", x: 0, y: 0, z: 0, rot: 0, scale: 1 }],
    }
    const lib = prefabLibrary([broken, ...RECIPES], CATALOG)
    expect(lib.prefabs.some((p) => p.id === "broken")).toBe(false)
    expect(lib.prefabs).toHaveLength(RECIPES.length)
  })
})

describe("generateTown", () => {
  test("is deterministic: the same spec gives the same plan, another seed another", () => {
    const spec: TownSpecInput = { seed: 7, tier: "village" }
    const a = generateTown(spec, LIB)
    const b = generateTown(spec, LIB)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect(a.hash).toMatch(/^[0-9a-f]{8}$/)
    expect(generateTown({ ...spec, seed: 8 }, LIB).hash).not.toBe(a.hash)
  })

  test("the plan survives JSON (a worker can post it)", () => {
    const plan = town(PRESETS[1] as TownSpecInput)
    expect(JSON.parse(JSON.stringify(plan))).toEqual(plan)
  })

  test("golden hashes for three presets (UPDATE_GOLDEN=1 rewrites them)", () => {
    const file = join(import.meta.dir, "golden/towns.json")
    const now = Object.fromEntries(PRESETS.slice(1).map((s) => [label(s), town(s).hash]))
    if (process.env.UPDATE_GOLDEN || !existsSync(file)) {
      mkdirSync(join(import.meta.dir, "golden"), { recursive: true })
      writeFileSync(file, `${JSON.stringify(now, null, 2)}\n`)
    }
    expect(now).toEqual(JSON.parse(readFileSync(file, "utf8")))
  })

  test("edges are numbered 0..n-1 in order", () => {
    for (const s of PRESETS) expect(town(s).edges.map((e) => e.id)).toEqual(town(s).edges.map((_, i) => i))
  })

  test("no two footprints overlap (buildings, props, the keep, piers, boats, cargo)", () => {
    for (const s of PRESETS) {
      const list = solids(town(s))
      expect(list.length).toBeGreaterThan(20)
      for (let i = 0; i < list.length; i++)
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i] as (typeof list)[number]
          const b = list[j] as (typeof list)[number]
          if (near(a.r, b.r, 40) && rectsOverlap(a.r, b.r, 0.02))
            throw new Error(`${label(s)}: ${a.role} at ${a.r.c} overlaps ${b.role} at ${b.r.c}`)
        }
    }
  })

  test("no edge runs through a footprint", () => {
    for (const s of PRESETS) {
      const plan = town(s)
      const list = solids(plan)
      for (const e of plan.edges) {
        const pts = e.closed ? [...e.points, e.points[0] as Vec2] : e.points
        for (const { role, r } of list) {
          const c = rectCorners({ ...r, w: Math.max(0, r.w - 0.2), d: Math.max(0, r.d - 0.2) })
          for (let i = 0; i + 1 < pts.length; i++)
            for (let k = 0; k < 4; k++)
              if (intersect(pts[i] as Vec2, pts[i + 1] as Vec2, c[k] as Vec2, c[(k + 1) % 4] as Vec2))
                throw new Error(`${label(s)}: ${e.kind} ${e.id} crosses ${role} at ${r.c}`)
        }
      }
    }
  })

  test("nothing stands on a street or in the water (piers and boats aside)", () => {
    for (const s of PRESETS) {
      const plan = town(s)
      for (const p of [...plan.placements, ...plan.nature]) {
        for (const e of plan.streets.edges)
          if (distTo(p.at, e.points) < e.width / 2)
            throw new Error(`${label(s)}: ${p.role} ${p.prefab} on street ${e.id}`)
        if (p.role !== "pier" && p.role !== "boat" && plan.water.some((w) => contains(w, p.at, 0)))
          throw new Error(`${label(s)}: ${p.role} ${p.prefab} in the water`)
      }
      for (const { role, r } of solids(plan))
        for (const c of rectCorners({ ...r, w: r.w - 0.1, d: r.d - 0.1 }))
          if (plan.streets.edges.some((e) => distTo(c, e.points) < e.width / 2))
            throw new Error(`${label(s)}: ${role} at ${r.c} reaches onto a street`)
    }
  })

  test("plants never grow inside a building or prop", () => {
    for (const s of PRESETS) {
      const plan = town(s)
      const list = solids(plan)
      for (const p of [...plan.placements, ...plan.nature]) {
        if (!PLANT_ROLES.has(p.role ?? "")) continue
        const hit = list.find(
          ({ r }) => near(r, { c: p.at, rot: 0, w: 0, d: 0 }, 30) && contains(rectCorners(r), p.at, 0),
        )
        if (hit) throw new Error(`${label(s)}: ${p.role} at ${p.at} inside ${hit.role}`)
      }
    }
  })

  test("every lot is built on or dressed as a garden", () => {
    for (const s of PRESETS) {
      const plan = town(s)
      const builtOn = new Set(plan.placements.map((p) => p.lot))
      const gardens = plan.plots.filter((p) => p.kind === "garden")
      for (const lot of plan.lots) {
        const c = lotRect(lot).c
        const dressed =
          builtOn.has(lot.id) || gardens.some((g) => g.block === lot.block && contains(g.poly, c, 0))
        expect(dressed, `${label(s)} lot ${lot.id}`).toBe(true)
      }
    }
  })

  test("plots lie in their block, clear of every lot and of each other", () => {
    for (const s of PRESETS) {
      const plan = town(s)
      const plots = plan.plots.filter((p) => !plan.lots.some((l) => contains(p.poly, lotRect(l).c, 0)))
      for (const p of plots) {
        const block = plan.blocks.find((b) => b.id === p.block)
        expect(block?.use).toBe("lots")
        for (const c of p.poly)
          expect(contains(block?.poly ?? [], c, 0.01), `${label(s)} plot in block ${p.block}`).toBe(true)
        for (const l of plan.lots)
          if (l.block === p.block) {
            const r = lotRect(l)
            const box: Rect = { c: p.poly[0] as Vec2, rot: 0, w: 0, d: 0 }
            if (near(r, box, 30) && p.poly.some((c) => contains(rectCorners(r), c, -0.01)))
              throw new Error(`${label(s)}: ${p.kind} plot overlaps lot ${l.id}`)
          }
      }
    }
  })

  test("stations: each kind of work is there, and every station is near a street and outside buildings", () => {
    const want: Record<Tier, string[]> = {
      hamlet: ["field"],
      village: ["field", "well", "market"],
      town: ["field", "well", "market", "gate", "hall", "tavern", "forge"],
      city: ["field", "well", "market", "gate", "hall", "dock", "tavern", "forge"],
      capital: [],
    }
    for (const s of PRESETS) {
      const plan = town(s)
      const kinds = new Set(plan.stations.map((st) => st.kind))
      for (const k of want[s.tier]) expect(kinds.has(k as never), `${label(s)} has a ${k} station`).toBe(true)
      expect(new Set(plan.stations.map((st) => st.id)).size).toBe(plan.stations.length)
      const buildings = solids(plan).filter(({ role }) =>
        ["house", "shop", "tavern", "forge", "chapel", "hall", "keep"].includes(role),
      )
      for (const st of plan.stations) {
        const street = Math.min(...plan.streets.edges.map((e) => distTo(st.at, e.points) - e.width / 2))
        expect(street, `${label(s)} ${st.id} reaches a street`).toBeLessThan(45)
        const inside = buildings.find(({ r }) =>
          contains(rectCorners({ ...r, w: r.w - 0.2, d: r.d - 0.2 }), st.at, 0),
        )
        expect(inside, `${label(s)} ${st.id} inside a ${inside?.role}`).toBeUndefined()
      }
    }
  })
})

describe("walk graph", () => {
  test("splits a street where a station joins it and links the station on its pad", () => {
    const streets = {
      nodes: [
        { id: 0, at: [0, 0] as Vec2, kind: "junction" as const },
        { id: 1, at: [20, 0] as Vec2, kind: "junction" as const },
      ],
      edges: [
        {
          id: 0,
          a: 0,
          b: 1,
          points: [
            [0, 0],
            [20, 0],
          ] as Vec2[],
          cls: "street" as const,
          width: 5,
        },
      ],
    }
    const g = walkGraph(streets, [{ id: "well:0", kind: "well", at: [8, 6], facing: 0 }])
    expect(g.edges.map((e) => [e.a, e.b, e.kind])).toEqual([
      [0, 2, "street"],
      [2, 1, "street"],
      [3, 2, "path"],
    ])
    expect(g.nodes[2]?.at).toEqual([8, 0])
    expect(g.nodes[3]).toMatchObject({ station: "well:0", pad: STATION_PAD, y: 0 })
  })

  test("one connected graph: every station reachable, heights on every point, grades within each type", () => {
    for (const s of PRESETS) {
      const { walk, stations } = town(s)
      const adj = new Map<number, number[]>()
      for (const e of walk.edges) {
        expect(WALK_KINDS).toContain(e.kind)
        adj.set(e.a, [...(adj.get(e.a) ?? []), e.b])
        adj.set(e.b, [...(adj.get(e.b) ?? []), e.a])
        for (let i = 0; i + 1 < e.points.length; i++) {
          const [x0, y0, z0] = e.points[i] as [number, number, number]
          const [x1, y1, z1] = e.points[i + 1] as [number, number, number]
          const run = Math.hypot(x1 - x0, z1 - z0)
          if (run > 0) expect(Math.abs(y1 - y0) / run).toBeLessThanOrEqual(WALK_RULES[e.kind].maxGrade)
        }
      }
      const seen = new Set([0])
      const stack = [0]
      while (stack.length > 0)
        for (const n of adj.get(stack.pop() as number) ?? []) if (!seen.has(n) && seen.add(n)) stack.push(n)
      for (const st of stations) {
        const n = walk.nodes.find((w) => w.station === st.id)
        expect(n?.pad, `${label(s)} ${st.id}`).toBe(STATION_PAD)
        expect(seen.has(n?.id ?? -1), `${label(s)} ${st.id} reachable`).toBe(true)
      }
      expect(walk.nodes.every((n) => n.y === 0)).toBe(true)
    }
  })
})

describe("townMetrics", () => {
  test("per tier: dense towns and cities, dressed ground, no big bare patch; timings logged", () => {
    const rows: string[] = []
    for (const s of PRESETS) {
      const plan = town(s)
      const ms = built.get(label(s))?.ms ?? {}
      const m = townMetrics(plan, { ms })
      rows.push(
        `${label(s)}: built ${(100 * m.builtPct).toFixed(0)}% (walled ${(100 * m.walledBuiltPct).toFixed(0)}%), ` +
          `dressed ${(100 * m.dressedPct).toFixed(0)}%, max bare ${m.maxBare} m², ${m.houses} houses, ` +
          `${m.placements} placements, ${m.stations} stations, ${m.totalMs?.toFixed(0)} ms ` +
          `(${Object.entries(ms)
            .map(([k, v]) => `${k} ${v.toFixed(0)}`)
            .join(", ")})`,
      )
      if (s.tier === "town" || s.tier === "city") expect(m.builtPct, label(s)).toBeGreaterThanOrEqual(0.35)
      expect(m.builtPct, label(s)).toBeGreaterThan(0.2)
      expect(m.dressedPct, label(s)).toBeGreaterThanOrEqual(0.85)
      expect(m.maxBare, label(s)).toBeLessThanOrEqual(150)
      expect(m.frontageFill, label(s)).toBeGreaterThan(0.6)
      expect(m.houses).toBe(plan.placements.filter((p) => p.lot !== undefined).length)
      // Generation runs in a worker; this only guards against a stage gone quadratic.
      expect(m.totalMs ?? 0, label(s)).toBeLessThan(3000)
    }
    console.log(rows.join("\n"))
  })

  test("is deterministic and counts a draw's pieces and triangles when given one", () => {
    const plan = town(PRESETS[0] as TownSpecInput)
    expect(townMetrics(plan)).toEqual(townMetrics(plan))
    expect(townMetrics(plan).pieces).toBe(0)
    const draw = { pieces: [{ piece: "kenney-pirate/crate", x: 0, y: 0, z: 0, rot: 0, scale: 1 }] }
    const m = townMetrics(plan, { draw: draw as never, tris: { "kenney-pirate/crate": 76 } })
    expect([m.pieces, m.estTris]).toEqual([1, 76])
  })
})
