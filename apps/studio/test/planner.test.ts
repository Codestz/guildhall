import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { PALETTE, type PrefabRecipe } from "@guildhall/assets"
import type { Placement, TownPlan, Vec2 } from "@guildhall/world"
import * as world from "@guildhall/world"
import { derive, roofLook, solidRuns } from "../src/planner/derive.ts"
import { detectStages, generate } from "../src/planner/generate.ts"
import { runJob } from "../src/planner/job.ts"
import { buildLibrary } from "../src/planner/library.ts"
import {
  COMPASS,
  DEFAULT_LAYERS,
  LAYERS,
  neighbourSeeds,
  parsePlannerQuery,
  plannerParams,
  specOf,
} from "../src/planner/query.ts"
import { layerCounts, planStats } from "../src/planner/stats.ts"
import { fit, niceLength, toScreen, toWorld, zoomAt } from "../src/planner/view.ts"
import { GROUPS } from "../src/shell/directory.ts"
import { href, ROUTES, resolve } from "../src/shell/router.ts"

/** studio planner: the town planner's deep link, generator, map shapes, numbers and view. */

const HOUSES = join(import.meta.dir, "../../../data/recipes/houses")
const RECIPES = readdirSync(HOUSES)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => JSON.parse(readFileSync(join(HOUSES, f), "utf8")) as PrefabRecipe)
const LIB = buildLibrary(RECIPES, null)
const q = (s: string) => parsePlannerQuery(new URLSearchParams(s))

describe("deep link", () => {
  test("defaults: seed 1, a town, every layer but the walk graph, colour", () => {
    const p = q("")
    expect(p).toMatchObject({ seed: 1, tier: "town", harbour: "auto", walls: "auto", look: "colour" })
    expect(p.layers).toEqual([...DEFAULT_LAYERS])
    expect(p.layers).not.toContain("walk")
  })

  test("reads seed, tier, layers, harbour (compass or radians), walls and look; ignores junk", () => {
    const p = q("seed=42&tier=city&layers=streets,walls,bogus&harbour=SW&walls=off&look=parchment")
    expect(p).toMatchObject({ seed: 42, tier: "city", harbour: COMPASS.SW, walls: "off", look: "parchment" })
    expect(p.layers).toEqual(["streets", "walls"])
    expect(q("harbour=1.5").harbour).toBe(1.5)
    expect(q("harbour=none").harbour).toBe("none")
    expect(q("seed=-4&tier=metropolis").seed).toBe(0)
    expect(q("tier=metropolis").tier).toBe("town")
  })

  test("writes back what it reads, defaults left out", () => {
    for (const s of [
      "seed=7&tier=village",
      "seed=3&tier=city&harbour=N&walls=on&layers=streets,houses&look=parchment",
    ]) {
      const p = q(s)
      expect(q(plannerParams(p).toString())).toEqual(p)
    }
    expect(plannerParams(q("seed=7&tier=village")).toString()).toBe("seed=7&tier=village")
  })

  test("the spec leaves auto fields out so the tier decides them", () => {
    expect(specOf(q("seed=5&tier=hamlet"))).toEqual({ seed: 5, tier: "hamlet" })
    expect(specOf(q("seed=5&harbour=none&walls=on"))).toEqual({
      seed: 5,
      tier: "town",
      harbour: null,
      walls: true,
    })
    expect(specOf(q("harbour=E")).harbour).toEqual({ bearing: 0 })
  })

  test("the strip shows six other seeds round the current one, none below 0", () => {
    expect(neighbourSeeds(10)).toEqual([7, 8, 9, 11, 12, 13])
    expect(neighbourSeeds(0)).toEqual([1, 2, 3, 4, 5, 6])
    expect(neighbourSeeds(1)).toEqual([0, 2, 3, 4, 5, 6])
  })

  test("the planner has a route, a World entry, and is the last screen registered", () => {
    expect(ROUTES.filter((r) => r.screen === "planner")).toEqual([{ screen: "planner", path: "planner" }])
    expect(href("planner", "seed=3&tier=city")).toBe("/planner?seed=3&tier=city")
    expect(resolve("/planner", "?seed=3").screen).toBe("planner")
    expect(resolve("/", "?screen=planner&seed=3").screen).toBe("planner")
    const worldGroup = GROUPS.find((g) => g.id === "world")
    expect(worldGroup?.tools.find((t) => t.id === "planner")?.name).toBe("Town planner")
    const source = readFileSync(join(import.meta.dir, "../src/screens.ts"), "utf8")
    expect(/npc,\n {2}planner,\n\]/.test(source)).toBe(true)
  })
})

describe("generator", () => {
  test("runs every stage the world package exports, timing each", () => {
    const g = generate({ seed: 2, tier: "town" }, LIB.town)
    expect(g.problems).toEqual([])
    for (const stage of ["site", "streets", "blocks", "walls", "landmark"]) expect(g.stages).toContain(stage)
    const found = detectStages()
    for (const stage of ["lots", "place", "farms", "nature", "harbour"] as const)
      expect(g.stages.includes(stage)).toBe(found[stage] ?? false)
    expect(g.timings.every((t) => t.ms >= 0)).toBe(true)
    expect(g.plan.blocks.length).toBeGreaterThan(10)
  })

  test("without the later stages the map still grows streets, blocks and walls", () => {
    const bare: Record<string, unknown> = { ...world }
    for (const name of ["lots", "place", "farms", "nature", "harbour", "generateTown"]) delete bare[name]
    const g = generate({ seed: 2, tier: "town" }, LIB.town, bare)
    expect(g.stages).toEqual(["site", "streets", "blocks", "walls", "landmark"])
    const map = derive(g.plan, LIB.derive, g.overlays, g.edgeRoles)
    const counts = layerCounts(map)
    expect(counts.streets).toBeGreaterThan(0)
    expect(counts.walls).toBeGreaterThan(0)
    expect(counts.houses).toBe(0)
    expect(counts.farms).toBe(0)
    expect(planStats(map, g.timings).builtPct).toBeNull()
  })

  test("a stage that throws is reported, and the stages after it still run", () => {
    const broken: Record<string, unknown> = {
      ...world,
      lots: () => {
        throw new Error("boom")
      },
    }
    const g = generate({ seed: 3, tier: "village" }, LIB.town, broken)
    expect(g.problems).toEqual([{ stage: "lots", message: "boom" }])
    expect(g.stages).toContain("walls")
    expect(g.plan.lots).toEqual([])
  })

  test("a whole-town generator, once exported, is taken as the truth", () => {
    const plan = generate({ seed: 4, tier: "hamlet" }, LIB.town).plan
    const g = generate({ seed: 4, tier: "hamlet" }, LIB.town, { ...world, generateTown: () => plan })
    expect(g.stages).toEqual(["generateTown"])
    expect(g.plan).toBe(plan)
  })
})

describe("map shapes", () => {
  const job = runJob({ seed: 1, tier: "city" }, LIB)
  const swatches = new Set(PALETTE.swatches.map((s) => s.hex))

  test("a house recipe's roof is a palette ramp, picked by seed as the 3D build picks it", () => {
    const cottage = RECIPES.find((r) => r.id === "cottage") as PrefabRecipe
    const looks = [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => roofLook(cottage, seed))
    for (const look of looks) {
      expect(look).not.toBeNull()
      expect(swatches.has(look?.roof[1] as string)).toBe(true)
    }
    expect(new Set(looks.map((l) => l?.roof[1])).size).toBeGreaterThan(1)
    expect(roofLook(cottage, 3)).toEqual(roofLook(cottage, 3))
  })

  test("placed houses draw at their prefab's footprint, facing their street", () => {
    const placed = job.map.plan.placements.filter((p) => RECIPES.some((r) => r.id === p.prefab))
    expect(job.map.houses.length).toBe(placed.length)
    const meta = new Map(LIB.town.prefabs.map((m) => [m.id, m]))
    for (const h of job.map.houses.slice(0, 50)) {
      expect(h.w).toBe(meta.get(h.prefab)?.frontage as number)
      expect(h.d).toBe(meta.get(h.prefab)?.depth as number)
    }
  })

  test("the castle's curtain is told apart from the town wall", () => {
    const castle = job.map.edges.filter((e) => e.castle)
    const town = job.map.edges.filter((e) => !e.castle && !e.farm)
    expect(castle.length).toBe(1)
    expect(town.length).toBeGreaterThan(0)
    expect(job.map.rects.some((r) => r.kind === "keep")).toBe(true)
  })

  test("an edge is cut into solid runs at its gaps", () => {
    const square: Vec2[] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]
    const len = (run: Vec2[]) =>
      run
        .slice(1)
        .reduce((s, p, i) => s + Math.hypot(p[0] - (run[i] as Vec2)[0], p[1] - (run[i] as Vec2)[1]), 0)
    const runs = solidRuns({ points: square, closed: true, gaps: [{ s: 5, width: 2, kind: "gate" }] })
    expect(runs.length).toBe(1)
    expect(len(runs[0] as Vec2[])).toBeCloseTo(38, 6)
    const open = solidRuns({ points: square, closed: false, gaps: [{ s: 15, width: 4, kind: "gap" }] })
    expect(open.map(len).map((l) => Math.round(l))).toEqual([13, 13])
  })

  test("a layer fills in as soon as the plan carries its data", () => {
    const plan: TownPlan = { ...job.map.plan, fields: [], nature: [], placements: [], stations: [] }
    const empty = layerCounts(derive(plan, LIB.derive))
    expect([empty.farms > 0 ? 1 : 0, empty.nature, empty.houses, empty.pois]).toEqual([
      job.map.edges.some((e) => e.farm) ? 0 : 0,
      0,
      0,
      0,
    ])
    const tree: Placement = { prefab: "some-pack/oak", seed: 1, at: [0, 0], rot: 0, role: "tree" }
    const grown: TownPlan & { pois: unknown[]; paths: Vec2[][] } = {
      ...plan,
      fields: [
        {
          poly: [
            [0, 0],
            [20, 0],
            [20, 30],
            [0, 30],
          ],
          crop: "wheat",
          rows: 0,
        },
      ],
      nature: [tree],
      stations: [{ id: "w", kind: "well", at: [1, 1], facing: 0 }],
      pois: [{ kind: "shrine", at: [5, 5] }],
      paths: [
        [
          [0, 0],
          [30, 30],
        ],
      ],
    }
    const counts = layerCounts(derive(grown, LIB.derive))
    expect(counts.farms).toBeGreaterThan(0)
    expect(counts.nature).toBe(1)
    expect(counts.pois).toBe(2)
    expect(counts.walk).toBe(plan.streets.nodes.length + 1)
  })

  test("stats read the plan: built area against lots blocks plus squares, wall length, gates", () => {
    const st = job.stats
    expect(st.blocks).toBe(job.map.plan.blocks.length)
    expect(st.builtPct).not.toBeNull()
    expect(st.builtPct as number).toBeGreaterThan(0)
    expect(st.builtPct as number).toBeLessThan(1)
    expect(st.edgeKind).toBe("wall")
    expect(st.edgeLength).toBeGreaterThan(100)
    expect(st.gates).toBeGreaterThan(0)
    expect(st.towers).toBeGreaterThan(0)
    expect(st.timings.map((t) => t.stage)).toContain("map shapes")
  })

  test("every tier and harbour choice draws a map, even where a stage fails", () => {
    // (village #6 with water at 2.4 rad trips a polygon-clipping error in \`blocks\` today: the planner
    // reports it beside the map instead of going blank.)
    for (const tier of world.TIERS)
      for (const harbour of ["none", "auto", 2.4] as const) {
        const r = runJob(specOf({ seed: 6, tier, harbour, walls: "auto" }), LIB)
        for (const p of r.problems) expect(p.message.length, `${tier} ${harbour}`).toBeGreaterThan(0)
        expect(r.map.plan.streets.edges.length, `${tier} ${harbour}`).toBeGreaterThan(0)
        if (r.problems.length === 0) expect(r.map.houses.length, `${tier} ${harbour}`).toBeGreaterThan(0)
      }
  }, 60_000)
})

describe("view", () => {
  const box = [-100, -80, 100, 80] as const

  test("fit shows the whole sheet inside the part the panels leave free", () => {
    const insets = { left: 300, right: 260, top: 0, bottom: 150 }
    const v = fit(box, 1440, 860, 20, insets)
    const [x0, z0] = toScreen(v, 1440, 860, [box[0], box[1]])
    const [x1, z1] = toScreen(v, 1440, 860, [box[2], box[3]])
    expect(x0).toBeGreaterThanOrEqual(300 + 19.9)
    expect(x1).toBeLessThanOrEqual(1440 - 260 - 19.9)
    expect(z0).toBeGreaterThanOrEqual(19.9)
    expect(z1).toBeLessThanOrEqual(860 - 150 - 19.9)
  })

  test("zooming keeps the point under the cursor still; screen and world round-trip", () => {
    const v = fit(box, 800, 600)
    const at: Vec2 = [123, 456]
    const before = toWorld(v, 800, 600, at)
    const after = toWorld(zoomAt(v, 800, 600, at, 2.5), 800, 600, at)
    expect(after[0]).toBeCloseTo(before[0], 9)
    expect(after[1]).toBeCloseTo(before[1], 9)
    const p: Vec2 = [12, -7]
    const back = toWorld(v, 800, 600, toScreen(v, 800, 600, p))
    expect(back[0]).toBeCloseTo(12, 9)
  })

  test("the scale bar takes a round length", () => {
    for (const s of [0.3, 1, 2.7, 9])
      expect([1, 2, 2.5, 5]).toContain(niceLength(s) / 10 ** Math.floor(Math.log10(niceLength(s))))
  })
})

test("every layer the panel lists has a name and a count", () => {
  const counts = layerCounts(runJob({ seed: 2, tier: "village" }, LIB).map)
  for (const l of LAYERS) expect(typeof counts[l]).toBe("number")
})
