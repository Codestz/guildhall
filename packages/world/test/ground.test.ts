import { describe, expect, test } from "bun:test"
import {
  area,
  CONTACT_MAX,
  CONTACT_REACH,
  contactShade,
  contains,
  dressTown,
  type GroundGeometry,
  groundGeometry,
  LEVELS,
  SKIRT_BOTTOM,
  type TownDraw,
  type TownSpecInput,
  type Vec2,
  waterGeometry,
} from "../src/index.ts"
import { COMPILED, PRESETS, town } from "./town.fixture.ts"

/** world town: the ground's and the water's meshes as typed arrays (ground.ts, water.ts). */

type GroundDraw = TownDraw["ground"]

const square = (x0: number, z0: number, x1: number, z1: number): Vec2[] => [
  [x0, z0],
  [x1, z0],
  [x1, z1],
  [x0, z1],
]

/** The flat (y = 0, facing up) triangles of a ground mesh as x,z corner triples. */
function topTriangles(m: GroundGeometry): [Vec2, Vec2, Vec2][] {
  const out: [Vec2, Vec2, Vec2][] = []
  for (let i = 0; i < m.index.length; i += 3) {
    const v = [0, 1, 2].map((k) => m.index[i + k] as number)
    if (v.some((j) => m.position[3 * j + 1] !== 0 || m.normal[3 * j + 1] !== 1)) continue
    out.push(
      v.map((j) => [m.position[3 * j] as number, m.position[3 * j + 2] as number]) as [Vec2, Vec2, Vec2],
    )
  }
  return out
}

/** Signed area in the x,z plane: positive when the triangle faces up (+y) in three's winding. */
const upArea = ([a, b, c]: [Vec2, Vec2, Vec2]) =>
  ((b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1])) / 2
const total = (m: GroundGeometry) => topTriangles(m).reduce((sum, t) => sum + upArea(t), 0)
/** Marching squares cuts a corner that falls inside a cell by up to half its square: so much is lost. */
const expectArea = (got: number, want: number) => expect(Math.abs(got - want)).toBeLessThan(1.5)

/** The green channel of the top vertex at x,z. */
function greenAt(m: GroundGeometry, x: number, z: number): number {
  for (let j = 0; j < m.position.length / 3; j++)
    if (m.position[3 * j] === x && m.position[3 * j + 1] === 0 && m.position[3 * j + 2] === z)
      return m.color[3 * j + 1] as number
  throw new Error(`no vertex at ${x},${z}`)
}

const LAND = square(-20, -20, 20, 20)
const LAKE = square(-5.5, -5.5, 4.5, 4.5)
const draw = (extra: Partial<GroundDraw> = {}): GroundDraw => ({
  land: LAND,
  holes: [LAKE],
  overlays: [],
  footprints: [],
  ...extra,
})

describe("contactShade", () => {
  test("is darkest at the wall, fades monotonically, gone at the reach", () => {
    expect(contactShade(0)).toBeCloseTo(CONTACT_MAX)
    expect(contactShade(-1)).toBeCloseTo(CONTACT_MAX)
    const steps = [0, 0.3, 0.6, 0.9, 1.2, 1.5].map(contactShade)
    for (let i = 1; i < steps.length; i++)
      expect(steps[i] as number).toBeLessThanOrEqual(steps[i - 1] as number)
    expect(contactShade(CONTACT_REACH)).toBe(0)
  })
})

describe("groundGeometry", () => {
  test("covers the land round its hole exactly: nothing in the hole, every triangle facing up", () => {
    const tris = topTriangles(groundGeometry(draw()))
    expectArea(
      tris.reduce((sum, t) => sum + upArea(t), 0),
      40 * 40 - 10 * 10,
    )
    for (const t of tris) {
      expect(upArea(t)).toBeGreaterThan(0)
      const centre: Vec2 = [(t[0][0] + t[1][0] + t[2][0]) / 3, (t[0][1] + t[1][1] + t[2][1]) / 3]
      // Half a cell in from the lake's shore (its corners are cut within a cell) is all water.
      expect(contains(square(-5, -5, 4, 4), centre, 0)).toBe(false)
    }
  })

  test("follows a coast off the grid: a slanted island's area, a hole given counter-clockwise", () => {
    const diamond: Vec2[] = [
      [0.3, -20.2],
      [20.1, 0.4],
      [0.3, 19.7],
      [-19.6, 0.4],
    ]
    expectArea(total(groundGeometry(draw({ land: diamond, holes: [] }))), Math.abs(area(diamond)))
    expectArea(total(groundGeometry(draw({ holes: [[...LAKE].reverse()] }))), 1500)
  })

  test("islets are land beside the main land", () => {
    const islet = square(30.5, 0.5, 34.5, 3.5)
    expectArea(total(groundGeometry(draw({ islets: [islet] }))), 1500 + 12)
  })

  test("overlays are painted, never cut: same area, the street's colour where it lies", () => {
    const overlays: GroundDraw["overlays"] = [
      { kind: "cobble", poly: square(6, -20, 12, 20) },
      { kind: "field", poly: square(-19, 8, -8, 18) },
      { kind: "plaza", poly: square(-18, -18, -10, -10) },
      // Partly off the land: only the part on it shows.
      { kind: "sand", poly: square(15, -30, 30, -10) },
      // Overlapping ribbons, as streets at a junction: no booleans to fail.
      { kind: "dirt", poly: square(-19, -4, -14, 4) },
      { kind: "dirt", poly: square(-17, -6, -12, 2) },
    ]
    const plain = groundGeometry(draw())
    const painted = groundGeometry(draw({ overlays }))
    expectArea(total(painted), 1500)
    expect(greenAt(painted, 9, 0)).not.toBeCloseTo(greenAt(plain, 9, 0), 3)
    // Grass well clear of every overlay keeps its colour.
    expect(greenAt(painted, 0, 15)).toBeCloseTo(greenAt(plain, 0, 15), 6)
  })

  test("darkens the ground at a footprint's foot and leaves it alone past the reach", () => {
    const shaded = groundGeometry(draw({ footprints: [square(10, 10, 14, 14)] }))
    const plain = groundGeometry(draw())
    expect(greenAt(shaded, 14, 12)).toBeCloseTo(greenAt(plain, 14, 12) * (1 - CONTACT_MAX), 5)
    expect(greenAt(shaded, 18, 12)).toBeCloseTo(greenAt(plain, 18, 12), 6)
  })

  test("runs a bank skirt down the whole coast, each quad facing out of the land", () => {
    const m = groundGeometry(draw())
    let length = 0
    for (let j = 0; j < m.position.length / 3; j++) {
      if (m.position[3 * j + 1] !== Math.fround(SKIRT_BOTTOM)) continue
      const p: Vec2 = [m.position[3 * j] as number, m.position[3 * j + 2] as number]
      const out: Vec2 = [
        p[0] + 0.1 * (m.normal[3 * j] as number),
        p[1] + 0.1 * (m.normal[3 * j + 2] as number),
      ]
      const onLand = contains(LAND, out, 0) && !contains(LAKE, out, 0)
      expect(onLand).toBe(false)
      length += 0.5
    }
    // Two bottom corners per 1 m segment: the outer coast (160 m) and the lake's (40 m).
    expect(length).toBeCloseTo(200, 0)
  })

  test("is empty without land", () => {
    expect(groundGeometry(draw({ land: [], holes: [] })).index).toHaveLength(0)
  })
})

describe("waterGeometry", () => {
  const LAKE_DRAW: TownDraw["water"] = {
    polys: [LAKE],
    level: LEVELS.water,
    shore: [[...LAKE, LAKE[0] as Vec2]],
  }

  test("covers the water at its level, the shore distance zero along the shore and growing off it", () => {
    const w = waterGeometry(LAKE_DRAW)
    const n = w.position.length / 3
    expect(n).toBeGreaterThan(0)
    for (let j = 0; j < n; j++) expect(w.position[3 * j + 1]).toBe(Math.fround(LEVELS.water))
    const covered = new Set<string>()
    for (let j = 0; j < n; j++) {
      const p: Vec2 = [w.position[3 * j] as number, w.position[3 * j + 2] as number]
      const d = w.shore[j] as number
      // Signed: positive over the water, negative under the land (which hides it).
      const inLake = contains(LAKE, p, 0)
      if (inLake) expect(d).toBeGreaterThanOrEqual(-1e-6)
      else expect(d).toBeLessThanOrEqual(1e-6)
      covered.add(`${p[0]},${p[1]}`)
    }
    // The cells reach past the shore on every side, so no gap opens along it.
    const [x0, z0] = LAKE[0] as Vec2
    const [x1, z1] = LAKE[2] as Vec2
    const xs = [...covered].map((k) => k.split(",").map(Number) as Vec2)
    expect(Math.min(...xs.map((p) => p[0]))).toBeLessThan(x0)
    expect(Math.max(...xs.map((p) => p[0]))).toBeGreaterThan(x1)
    expect(Math.min(...xs.map((p) => p[1]))).toBeLessThan(z0)
    expect(Math.max(...xs.map((p) => p[1]))).toBeGreaterThan(z1)
  })

  test("is empty without water", () => {
    expect(waterGeometry({ polys: [], level: LEVELS.water, shore: [] }).index).toHaveLength(0)
  })
})

describe("an island town's ground and water", () => {
  const spec = PRESETS[3] as TownSpecInput
  const plan = town(spec)
  const drawn = dressTown(plan, COMPILED)

  test("the land is the island: land and sea tile the bounds with no sea left in the land", () => {
    const g = drawn.ground
    const land =
      Math.abs(area(g.land)) -
      g.holes.reduce((s, h) => s + Math.abs(area(h)), 0) +
      (g.islets ?? []).reduce((s, r) => s + Math.abs(area(r)), 0)
    const sea = plan.water.reduce((s, r) => s + Math.abs(area(r)), 0)
    expect(land + sea).toBeCloseTo(Math.abs(area(plan.bounds)), -2)
    // Before the fix the land took a difference against all the sea at once and kept a triangle of it.
    expect(land).toBeLessThan(0.4 * Math.abs(area(plan.bounds)))
  })

  test("the shore is the land's outline: closed lines, none along a seam between sea pieces", () => {
    const g = drawn.ground
    expect(drawn.water.shore.length).toBe(1 + g.holes.length + (g.islets?.length ?? 0))
    for (const line of drawn.water.shore) expect(line.at(-1)).toEqual(line[0])
  })

  test("builds the ground, every street painted, in well under the old seconds", () => {
    const t0 = performance.now()
    const m = groundGeometry(drawn.ground, spec.seed)
    const ms = performance.now() - t0
    expect(total(m)).toBeCloseTo(
      Math.abs(area(drawn.ground.land)) +
        (drawn.ground.islets ?? []).reduce((s, r) => s + Math.abs(area(r)), 0),
      -2,
    )
    // The polygon booleans took 5–17 s (or failed) for a city; the raster takes a few hundred ms.
    expect(ms).toBeLessThan(1500)
  })
})
