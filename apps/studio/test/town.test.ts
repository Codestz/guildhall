import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { poseToCamera } from "@guildhall/render"
import { area, type TownDraw, type Vec2, validateTownSpec } from "@guildhall/world"
import { COMPASS } from "../src/planner/query.ts"
import { href, resolve } from "../src/shell/router.ts"
import { along, heroAzimuth, mapPose, sheet, streetPose } from "../src/town/camera.ts"
import { landOf, PLANT_CELL, plantClusters, withSea } from "../src/town/dress.ts"
import { paintGround, SNAPS, snapOverlays } from "../src/town/ground.ts"
import { DEFAULT_TOWN, parseTownQuery, townParams, townSpec } from "../src/town/query.ts"
import { sumLod } from "../src/town/scene.ts"

/** studio town: the deep link, the camera presets, clustering, the sea and the ground's fallbacks. */

const q = (s: string) => parseTownQuery(new URLSearchParams(s))
const square = (x0: number, z0: number, x1: number, z1: number): Vec2[] => [
  [x0, z0],
  [x1, z0],
  [x1, z1],
  [x0, z1],
]

describe("deep link", () => {
  test("defaults: seed 1, a town, golden hour, the hero camera, no compare", () => {
    expect(q("")).toEqual({ ...DEFAULT_TOWN })
    expect(DEFAULT_TOWN.hour).toBe(17.5)
  })

  test("the path's id is a seed when numeric, a preset otherwise", () => {
    const seeded = resolve("/town/42", "?tier=city&cam=map&hour=19.25&compare=1", "/")
    expect(seeded.screen).toBe("town")
    expect(parseTownQuery(seeded.query)).toMatchObject({
      seed: 42,
      tier: "city",
      cam: "map",
      hour: 19.25,
      compare: true,
      preset: null,
    })
    expect(parseTownQuery(resolve("/town/concept", "", "/").query)).toMatchObject({ preset: "concept" })
  })

  test("junk falls back to the defaults; the hour wraps into a day", () => {
    expect(q("town=-3&tier=metropolis&cam=drone&hour=x")).toMatchObject({
      seed: 1,
      tier: "town",
      cam: "hero",
      hour: 17.5,
      preset: null,
    })
    expect(q("hour=26").hour).toBe(2)
  })

  test("params round-trip and leave defaults out; href puts the seed in the path", () => {
    const t = q("town=7&tier=city&harbour=SW&walls=off&hour=8&cam=street&compare=1")
    expect(q(townParams(t).toString())).toEqual(t)
    expect(townParams(DEFAULT_TOWN).toString()).toBe("town=1")
    expect(href("town", townParams({ ...DEFAULT_TOWN, seed: 2 }), "/")).toBe("/town/2")
  })

  test("the spec leaves auto fields to the tier, as the planner's", () => {
    expect(townSpec(q("town=3&tier=city"))).toEqual({ seed: 3, tier: "city" })
    expect(townSpec(q("town=3&harbour=none&walls=on"))).toEqual({
      seed: 3,
      tier: "town",
      harbour: null,
      walls: true,
    })
    expect(townSpec(q("harbour=W")).harbour).toEqual({ bearing: COMPASS.W })
  })

  test("the concept preset is a valid town spec", () => {
    const json = JSON.parse(readFileSync(join(import.meta.dir, "../../../data/towns/concept.json"), "utf8"))
    expect(validateTownSpec(json)).toEqual([])
  })
})

describe("cameras", () => {
  test("hero: the concept's azimuth with no water; water turned lower-left inside the lit arc", () => {
    expect(heroAzimuth(null)).toBe(40)
    // Water due south (+z, bearing 90°) sits lower-left from azimuth 45°.
    expect(heroAzimuth(Math.PI / 2)).toBeCloseTo(45)
    // Water to the west would need the camera in the sun's glare: held at the arc's end.
    expect(heroAzimuth(Math.PI)).toBe(0)
  })

  test("map: straight down on the sheet's centre, far enough to hold the whole sheet", () => {
    const plan = { bounds: square(100, -50, 300, 150) }
    const pose = mapPose(plan, { aspect: 1.6 })
    expect(pose.target).toEqual([200, 0, 50])
    expect(pose.elevation).toBeGreaterThan(88)
    expect(sheet(plan).half).toBe(100)
    const eye = poseToCamera(pose)
    // The half side fits the vertical half-angle (24° lens) with room to spare.
    expect(Math.atan(100 / eye[1]) * (180 / Math.PI)).toBeLessThan(12)
  })

  test("street: eye and look point on the centreline of the main street nearest the square", () => {
    const plan = {
      plazas: [square(-10, -10, 10, 10)],
      streets: {
        nodes: [],
        edges: [
          { id: 0, a: 0, b: 1, cls: "street" as const, width: 5, points: [[0, 0] as Vec2, [0, 80] as Vec2] },
          {
            id: 1,
            a: 1,
            b: 2,
            cls: "main" as const,
            width: 7,
            points: [[200, 0] as Vec2, [100, 0] as Vec2, [12, 0] as Vec2],
          },
        ],
      },
    }
    const pose = streetPose(plan)
    const eye = poseToCamera(pose)
    expect(pose.target[2]).toBeCloseTo(0)
    expect(pose.target[0]).toBeCloseTo(20)
    expect(eye[2]).toBeCloseTo(0)
    expect(eye[0]).toBeCloseTo(54)
    expect(eye[1]).toBeCloseTo(6)
  })

  test("along walks a polyline and clamps at its ends", () => {
    const line: Vec2[] = [
      [0, 0],
      [10, 0],
      [10, 10],
    ]
    expect(along(line, 15)).toEqual([10, 5])
    expect(along(line, -3)).toEqual([0, 0])
    expect(along(line, 99)).toEqual([10, 10])
  })
})

describe("draw", () => {
  test("plants cluster per grid cell, parts relative to the cell's centre, every plant kept", () => {
    const at = (x: number, z: number) => ({ prefab: "tree", seed: 0, at: [x, z] as Vec2, rot: 0.5 })
    const clusters = plantClusters([at(1, 1), at(15, 2), at(17, 1), at(-1, -1)])
    expect(clusters.map((c) => c.key).sort()).toEqual(["plants:-1,-1", "plants:0,0", "plants:1,0"])
    expect(clusters.reduce((n, c) => n + c.parts.length, 0)).toBe(4)
    const home = clusters.find((c) => c.key === "plants:0,0")
    expect(home?.parts.map((p) => [p.x + (home?.x ?? 0), p.z + (home?.z ?? 0)])).toEqual([
      [1, 1],
      [15, 2],
    ])
    expect(home?.x).toBe(PLANT_CELL / 2)
  })

  test("land: overlapping sea pieces are unioned before the difference", () => {
    const bounds = square(0, 0, 100, 100)
    // Two sea pieces overlapping in the middle, leaving land only in the top-right corner.
    const water = [square(0, 0, 100, 60), square(0, 40, 60, 100)]
    const { land, holes } = landOf(bounds, water)
    expect(Math.abs(area(land))).toBeCloseTo(40 * 40)
    expect(holes).toEqual([])
    expect(landOf(bounds, []).land).toEqual(bounds)
  })

  test("the sea: bands round the bounds that do not overlap, foam on the land's outline only", () => {
    const water: TownDraw["water"] = { polys: [square(0, 0, 50, 100)], level: -0.6, shore: [[[50, 0]]] }
    const ground = { land: square(50, 0, 100, 100), holes: [square(60, 10, 70, 20)] }
    const out = withSea(water, square(0, 0, 100, 100), ground)
    expect(out.polys.length).toBe(5)
    const bands = out.polys.slice(1).map((r) => Math.abs(area(r)))
    // 3 × the half side (50) out, all round: the four bands tile the frame round the 100 m square.
    expect(bands.reduce((a, b) => a + b, 0)).toBeCloseTo(400 * 400 - 100 * 100)
    expect(out.shore.length).toBe(2)
    expect(out.shore[0]?.[0]).toEqual(out.shore[0]?.at(-1))
  })
})

describe("ground", () => {
  const g: TownDraw["ground"] = {
    land: square(0, 0, 10, 10),
    holes: [],
    overlays: [{ kind: "cobble", poly: square(1.13, 1.13, 4.4, 4.4) }],
    footprints: [square(5, 5, 6, 6)],
  }

  test("snaps overlay corners to the step", () => {
    expect(snapOverlays(g, 0.25).overlays[0]?.poly[0]).toEqual([1.25, 1.25])
    expect(snapOverlays(g, 1).footprints).toBe(g.footprints)
  })

  test("paints at the first snap that goes through", () => {
    const tried: number[] = []
    const out = paintGround(g, (d) => {
      const x = d.overlays[0]?.poly[0]?.[0] ?? 0
      tried.push(x)
      if (tried.length < 2) throw new Error("Unable to complete output ring")
      return x
    })
    expect(out.snap).toBe(SNAPS[1] as number)
    expect(out.failures.length).toBe(1)
    expect(out.failures[0]).toContain("Unable to complete")
  })

  test("falls back to bare land, footprints kept, when no snap goes through", () => {
    const out = paintGround(g, (d) => {
      if (d.overlays.length > 0) throw new RangeError("Maximum call stack size exceeded")
      return d
    })
    expect(out.snap).toBeNull()
    expect(out.built.footprints).toBe(g.footprints)
    expect(out.failures.length).toBe(SNAPS.length)
  })
})

test("LOD counts of the two batches add up tier by tier", () => {
  expect(sumLod({ tiers: [1, 2, 3], near: 4, shells: 5 }, { tiers: [10, 20], near: 1, shells: 1 })).toEqual({
    tiers: [11, 22, 3],
    near: 5,
    shells: 6,
  })
})
