import { describe, expect, test } from "bun:test"
import { contains, type Vec2 } from "@guildhall/world"
import {
  CONTACT_MAX,
  CONTACT_REACH,
  contactShade,
  footprintDistance,
  type GroundDraw,
  gridMesh,
  groundMesh,
} from "../src/ground.ts"
import { GOLDEN_HOUR, lightAt } from "../src/light.ts"

const square = (x0: number, z0: number, x1: number, z1: number): Vec2[] => [
  [x0, z0],
  [x1, z0],
  [x1, z1],
  [x0, z1],
]

/** The top (y = 0, facing up) triangles of a ground mesh as x,z corner triples. */
function topTriangles(m: ReturnType<typeof groundMesh>): [Vec2, Vec2, Vec2][] {
  const out: [Vec2, Vec2, Vec2][] = []
  for (let i = 0; i < m.index.length; i += 3) {
    const v = [0, 1, 2].map((k) => m.index[i + k]!)
    if (v.some((j) => m.position[3 * j + 1] !== 0 || m.normal[3 * j + 1] !== 1)) continue
    out.push(v.map((j) => [m.position[3 * j]!, m.position[3 * j + 2]!]) as [Vec2, Vec2, Vec2])
  }
  return out
}

/** Signed area in the x,z plane: positive when the triangle faces up (+y) in three's winding. */
const upArea = ([a, b, c]: [Vec2, Vec2, Vec2]) =>
  ((b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1])) / 2

const LAND = square(-20, -20, 20, 20)
const LAKE = square(-5, -5, 5, 5)
const draw = (extra: Partial<GroundDraw> = {}): GroundDraw => ({
  land: LAND,
  holes: [LAKE],
  overlays: [],
  footprints: [],
  ...extra,
})

describe("contactShade", () => {
  test("is darkest at the wall and gone at the reach", () => {
    expect(contactShade(0)).toBeCloseTo(CONTACT_MAX)
    expect(contactShade(CONTACT_REACH)).toBe(0)
    expect(contactShade(5)).toBe(0)
  })

  test("fades monotonically between them, never above the cap", () => {
    const steps = [0, 0.3, 0.6, 0.9, 1.2, 1.5].map(contactShade)
    for (let i = 1; i < steps.length; i++) expect(steps[i]!).toBeLessThanOrEqual(steps[i - 1]!)
    expect(contactShade(-1)).toBeCloseTo(CONTACT_MAX)
  })
})

describe("footprintDistance", () => {
  const near = footprintDistance([square(0, 0, 4, 4)])

  test("is 0 inside a footprint and the gap outside it", () => {
    expect(near([2, 2])).toBe(0)
    expect(near([5, 2])).toBeCloseTo(1)
  })

  test("caps at the reach far from every footprint", () => {
    expect(near([40, 40])).toBe(CONTACT_REACH)
  })
})

describe("gridMesh", () => {
  test("refines a shape to the grid pitch and covers exactly its area", () => {
    const mesh = gridMesh([[square(0, 0, 9, 5)]], 2)
    let area = 0
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const [a, b, c] = [0, 1, 2].map((k) => {
        const j = mesh.indices[i + k]!
        return [mesh.points[2 * j]!, mesh.points[2 * j + 1]!] as Vec2
      }) as [Vec2, Vec2, Vec2]
      area += upArea([a, b, c])
    }
    expect(area).toBeCloseTo(45, 6)
    // A 9 × 5 shape on a 2 m grid has a vertex at least every 2 m: 6 columns × 4 rows of corners at least.
    expect(mesh.points.length / 2).toBeGreaterThanOrEqual(6 * 4)
  })

  test("is empty for an empty shape", () => {
    expect(gridMesh([], 2).indices).toHaveLength(0)
  })
})

describe("groundMesh", () => {
  test("triangulates the land round a hole: its area, nothing inside the hole, every triangle up", () => {
    const tris = topTriangles(groundMesh(draw()))
    const total = tris.reduce((sum, t) => sum + upArea(t), 0)
    expect(total).toBeCloseTo(40 * 40 - 10 * 10, 3)
    for (const t of tris) {
      expect(upArea(t)).toBeGreaterThan(0)
      const centre: Vec2 = [(t[0][0] + t[1][0] + t[2][0]) / 3, (t[0][1] + t[1][1] + t[2][1]) / 3]
      expect(contains(LAKE, centre, 0)).toBe(false)
    }
  })

  test("accepts a hole given counter-clockwise, as the land itself", () => {
    const tris = topTriangles(groundMesh(draw({ holes: [[...LAKE].reverse()] })))
    expect(tris.reduce((sum, t) => sum + upArea(t), 0)).toBeCloseTo(1500, 3)
  })

  test("overlays replace the grass under them without adding area", () => {
    const overlays: GroundDraw["overlays"] = [
      { kind: "cobble", poly: square(6, -20, 9, 20) },
      { kind: "field", poly: square(-19, 8, -8, 18) },
      { kind: "plaza", poly: square(-18, -18, -10, -10) },
      { kind: "dirt", poly: square(-19, -4, -14, 4) },
      { kind: "garden", poly: square(10, 10, 14, 14) },
      // Partly off the land: only the part on it counts.
      { kind: "sand", poly: square(15, -30, 30, -10) },
    ]
    const tris = topTriangles(groundMesh(draw({ overlays })))
    expect(tris.reduce((sum, t) => sum + upArea(t), 0)).toBeCloseTo(1500, 3)
  })

  test("darkens the ground at a footprint's foot and leaves it alone past the reach", () => {
    const fp = square(10, 10, 14, 14)
    const plain = groundMesh(draw())
    const shaded = groundMesh(draw({ footprints: [fp] }))
    const at = (m: ReturnType<typeof groundMesh>, x: number, z: number) => {
      for (let j = 0; j < m.position.length / 3; j++)
        if (m.position[3 * j] === x && m.position[3 * j + 1] === 0 && m.position[3 * j + 2] === z)
          return m.color[3 * j + 1]!
      throw new Error(`no vertex at ${x},${z}`)
    }
    expect(at(shaded, 14, 12)).toBeCloseTo(at(plain, 14, 12) * (1 - CONTACT_MAX), 5)
    expect(at(shaded, 18, 12)).toBeCloseTo(at(plain, 18, 12), 6)
  })

  test("runs a bank skirt down every land edge, facing out of the land", () => {
    const m = groundMesh(draw())
    let below = 0
    for (let j = 0; j < m.position.length / 3; j++) if (m.position[3 * j + 1]! < -0.6) below++
    // Two bottom corners per edge: 4 outer + 4 hole edges.
    expect(below).toBe(16)
  })
})

describe("lightAt", () => {
  test("golden hour is a low warm sun, about 24° up (plan §5)", () => {
    const light = lightAt(GOLDEN_HOUR)
    expect(light.elevation).toBeGreaterThan(20)
    expect(light.elevation).toBeLessThan(28)
    expect(light.sun.r).toBeGreaterThan(light.sun.b)
    expect(light.golden).toBeGreaterThan(0.5)
  })

  test("the sun is down at 20:00 and up at 10:00", () => {
    expect(lightAt(20).sunIntensity).toBe(0)
    expect(lightAt(10).elevation).toBeGreaterThan(40)
    expect(lightAt(34).hour).toBe(10)
  })
})
