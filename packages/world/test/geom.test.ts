import { describe, expect, test } from "bun:test"
import { DMath, roll } from "@guildhall/core"
import {
  area,
  chaikin,
  clip,
  contains,
  cross,
  dist,
  distTo,
  faces,
  frontRect,
  intersect,
  length,
  type MultiPolygon,
  obb,
  offset,
  offsetLine,
  orient,
  planarize,
  poissonIn,
  type Rect,
  type Ring,
  rectCorners,
  rectInPoly,
  rectsOverlap,
  resample,
  ribbon,
  shapeArea,
  snap,
  splitByLine,
  sub,
  type Vec2,
} from "../src/index.ts"

/** world geom: the polygon and graph kernel the town generator builds on. */

const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1)
const rand = (seed: number, salt: string) => roll(seed, salt)
const SQUARE_CUT = Math.sqrt(5)

/** A star-shaped (usually concave) ring on the 1e-3 grid: radius jittered round a circle. */
function star(seed: number, n = 12, r = 20): Ring {
  return Array.from({ length: n }, (_, i) => {
    const a = (2 * Math.PI * i) / n
    const k = r * (0.45 + 0.55 * rand(seed, `${i}:star`))
    return snap([k * DMath.cos(a), k * DMath.sin(a)])
  })
}

/** A convex ring on the 1e-3 grid, every interior angle at least ~110°: points on a circle, angles jittered. */
function convex(seed: number, n = 7, r = 30): Ring {
  return Array.from({ length: n }, (_, i) => {
    const a = (2 * Math.PI * (i + 0.25 * (rand(seed, `${i}:convex`) - 0.5))) / n
    return snap([r * DMath.cos(a), r * DMath.sin(a)])
  })
}

/** Distance from p to the nearest edge of the closed ring. */
const toBoundary = (p: Vec2, ring: Ring) => distTo(p, ring, true)

const vertices = (m: MultiPolygon) => m.flat(2)
const onGrid = (m: MultiPolygon) =>
  vertices(m).every((p) => p.every((x) => Math.abs(x * 1000 - Math.round(x * 1000)) < 1e-6))

const L: Ring = [
  [0, 0],
  [10, 0],
  [10, 4],
  [4, 4],
  [4, 10],
  [0, 10],
]
const square = (x: number, z: number, s: number): Ring => [
  [x, z],
  [x + s, z],
  [x + s, z + s],
  [x, z + s],
]

describe("polylines", () => {
  test("intersect finds a crossing and its parameters, and misses parallels and near misses", () => {
    expect(intersect([0, 0], [4, 0], [1, -1], [1, 3])).toEqual({ at: [1, 0], t: 0.25, u: 0.25 })
    expect(intersect([0, 0], [4, 0], [0, 1], [4, 1])).toBeNull()
    expect(intersect([0, 0], [4, 0], [5, -1], [5, 1])).toBeNull()
  })

  test("chaikin keeps an open line's ends and cuts every corner; closed it cuts them all", () => {
    const line: Vec2[] = [
      [0, 0],
      [10, 0],
      [10, 10],
    ]
    const once = chaikin(line)
    expect(once).toEqual([
      [0, 0],
      [7.5, 0],
      [10, 2.5],
      [10, 10],
    ])
    expect(chaikin(line, 1, true)).toHaveLength(6)
    expect(length(chaikin(line, 3))).toBeLessThan(length(line))
  })

  test("resample spaces points evenly along a curve and keeps both ends", () => {
    const curve = chaikin(
      [
        [0, 0],
        [30, 10],
        [60, -5],
        [90, 20],
      ],
      3,
    )
    const pts = resample(curve, 5)
    expect(pts[0]).toEqual([0, 0])
    expect(pts[pts.length - 1]).toEqual(curve[curve.length - 1]!)
    const gaps = pts.slice(1).map((p, i) => dist(p, pts[i]!))
    // Chords of a curve are a shade shorter than the arc they span.
    for (const g of gaps) expect(Math.abs(g - gaps[0]!)).toBeLessThan(0.05)
  })

  test("a curved street's offset edges stay at the offset distance from its centreline", () => {
    for (const seed of SEEDS) {
      const rough = Array.from(
        { length: 6 },
        (_, i) => [i * 25, 12 * (rand(seed, `${i}:street`) - 0.5)] as Vec2,
      )
      const centre = chaikin(rough, 3)
      for (const d of [3.5, -3.5, 2, -2.5]) {
        const edge = offsetLine(centre, d)
        for (const p of resample(edge, 0.5))
          expect(Math.abs(distTo(p, centre) - Math.abs(d))).toBeLessThan(0.01)
        // The left edge is on the left of the centreline.
        const side = cross(sub(centre[1]!, centre[0]!), sub(edge[0]!, centre[0]!))
        expect(Math.sign(side)).toBe(Math.sign(d))
      }
    }
  })

  test("a closed curve (the ring road) offsets at constant distance all round", () => {
    const ring = chaikin(star(3, 10, 60), 3, true)
    const outer = offsetLine(ring, -2.5, true)
    for (const p of resample(outer, 1, true)) expect(Math.abs(distTo(p, ring, true) - 2.5)).toBeLessThan(0.01)
  })

  test("a hairpin is bevelled: no offset point reaches past twice the distance", () => {
    const hairpin: Vec2[] = [
      [0, 0],
      [20, 0],
      [0, 2],
    ]
    const edge = offsetLine(hairpin, -3)
    expect(edge).toHaveLength(4)
    for (const p of edge) expect(distTo(p, hairpin)).toBeLessThanOrEqual(6 + 1e-3)
  })

  test("a straight street's ribbon is its length times its width, counter-clockwise", () => {
    const strip = ribbon(
      [
        [0, 0],
        [40, 0],
      ],
      5,
    )
    expect(area(strip)).toBeCloseTo(200, 6)
  })
})

describe("polygons", () => {
  test("area is signed by winding and orient makes it counter-clockwise", () => {
    expect(area(L)).toBe(64)
    expect(area([...L].reverse())).toBe(-64)
    expect(area(orient([...L].reverse()))).toBe(64)
    expect(area(orient(L, false))).toBe(-64)
  })

  test("contains counts the boundary as inside and holes as outside", () => {
    expect(contains(L, [2, 2])).toBe(true)
    expect(contains(L, [7, 7])).toBe(false)
    expect(contains(L, [10, 2])).toBe(true)
    expect(contains(L, [4, 7])).toBe(true)
    const holed = [square(0, 0, 10), orient(square(4, 4, 2), false)]
    expect(contains(holed, [1, 1])).toBe(true)
    expect(contains(holed, [5, 5])).toBe(false)
  })

  test("offset of a concave L is exact: mitred out, mitred in at the reflex corner", () => {
    expect(offset(L, -1)).toEqual([
      [
        [
          [1, 1],
          [9, 1],
          [9, 3],
          [3, 3],
          [3, 9],
          [1, 9],
        ],
      ],
    ])
    expect(shapeArea(offset(L, 1))).toBe(108)
    expect(offset(L, 0)).toEqual([[orient(L)]])
  })

  test("offset ignores the input winding", () => {
    expect(offset([...L].reverse(), -1)).toEqual(offset(L, -1))
  })

  test("offsets of convex polygons sit at the distance, inset inside and outset round", () => {
    for (const seed of SEEDS) {
      const poly = convex(seed)
      for (const d of [1, 2.5, 4]) {
        const inner = offset(poly, -d)
        const outer = offset(poly, d)
        expect(inner).toHaveLength(1)
        expect(outer).toHaveLength(1)
        // Every inset corner lies on the bisector, exactly d from both of its edges.
        for (const p of vertices(inner)) {
          expect(contains(poly, p)).toBe(true)
          expect(Math.abs(toBoundary(p, poly) - d)).toBeLessThan(2e-3)
        }
        for (const p of vertices(outer)) {
          expect(toBoundary(p, poly)).toBeGreaterThan(d - 2e-3)
          expect(toBoundary(p, poly)).toBeLessThan(2 * d + 2e-3)
        }
        for (const p of poly) expect(contains(outer[0]![0]!, p)).toBe(true)
        // Shrinking then growing a convex polygon back gives the polygon (no edge collapsed at these d).
        expect(shapeArea(offset(inner, d))).toBeCloseTo(Math.abs(area(poly)), 1)
      }
    }
  })

  test("offsets of concave polygons stay between d and the square cut from the boundary", () => {
    // A spike's corner is cut square 2d out along its bisector; the cut's ends are at most √5·d away.
    for (const seed of SEEDS) {
      const poly = star(seed)
      const a = Math.abs(area(poly))
      for (const d of [0.5, 1.5]) {
        const inner = offset(poly, -d)
        const outer = offset(poly, d)
        expect(shapeArea(inner)).toBeLessThan(a)
        expect(shapeArea(outer)).toBeGreaterThan(a)
        for (const p of vertices(inner)) {
          expect(contains(poly, p)).toBe(true)
          expect(toBoundary(p, poly)).toBeGreaterThan(d - 2e-3)
          expect(toBoundary(p, poly)).toBeLessThan(SQUARE_CUT * d + 2e-3)
        }
        for (const p of vertices(outer)) {
          expect(contains(poly, p, 0)).toBe(false)
          expect(toBoundary(p, poly)).toBeGreaterThan(d - 2e-3)
          expect(toBoundary(p, poly)).toBeLessThan(SQUARE_CUT * d + 2e-3)
        }
        expect(onGrid(inner) && onGrid(outer)).toBe(true)
      }
    }
  })

  test("an inset splits a dumbbell into its two ends", () => {
    const dumbbell: Ring = [
      [0, 0],
      [10, 0],
      [10, 4],
      [14, 4],
      [14, 0],
      [24, 0],
      [24, 10],
      [14, 10],
      [14, 6],
      [10, 6],
      [10, 10],
      [0, 10],
    ]
    const pieces = offset(dumbbell, -1.5)
    expect(pieces).toHaveLength(2)
    expect(shapeArea(pieces)).toBeCloseTo(2 * 7 * 7, 6)
  })

  test("an outset closes a courtyard's mouth into a hole", () => {
    // A 10 m courtyard open to the street through a 2 m mouth.
    const court: Ring = [
      [0, 0],
      [20, 0],
      [20, 20],
      [11, 20],
      [11, 15],
      [15, 15],
      [15, 5],
      [5, 5],
      [5, 15],
      [9, 15],
      [9, 20],
      [0, 20],
    ]
    const grown = offset(court, 1.5)
    expect(grown).toHaveLength(1)
    expect(grown[0]).toHaveLength(2)
    const hole = grown[0]![1]!
    expect(area(hole)).toBeLessThan(0)
    // The courtyard shrunk 1.5 m all round: the mouth's walls met and sealed it.
    expect(-area(hole)).toBe(49)
  })

  test("clip: union, intersection, difference and xor add up", () => {
    const a = square(0, 0, 10)
    const b = square(5, 5, 10)
    const i = shapeArea(clip(a, b, "intersection"))
    expect(i).toBe(25)
    expect(shapeArea(clip(a, b, "union"))).toBe(175)
    expect(shapeArea(clip(a, b, "difference"))).toBe(75)
    expect(shapeArea(clip(a, b, "xor"))).toBe(150)
    expect(clip(a, square(20, 20, 1), "intersection")).toEqual([])
    expect(clip([], a, "union")).toEqual([[a]])
    expect(clip([], a, "difference")).toEqual([])
  })

  test("splitting by a line keeps the total area, each side on its side", () => {
    for (const seed of SEEDS) {
      const poly = star(seed)
      const p: Vec2 = [10 * (rand(seed, "px") - 0.5), 10 * (rand(seed, "pz") - 0.5)]
      const a = 2 * Math.PI * rand(seed, "dir")
      const dir: Vec2 = [DMath.cos(a), DMath.sin(a)]
      const { left, right } = splitByLine(poly, p, dir)
      expect(shapeArea(left) + shapeArea(right)).toBeCloseTo(Math.abs(area(poly)), 2)
      for (const q of vertices(left)) expect(cross(dir, sub(q, p))).toBeGreaterThan(-2e-3)
      for (const q of vertices(right)) expect(cross(dir, sub(q, p))).toBeLessThan(2e-3)
    }
  })

  test("a concave block cut across its notch comes apart in more than two pieces", () => {
    const { left, right } = splitByLine(
      [
        [0, 0],
        [30, 0],
        [30, 10],
        [20, 10],
        [20, 2],
        [10, 2],
        [10, 10],
        [0, 10],
      ],
      [0, 5],
      [1, 0],
    )
    expect(left).toHaveLength(2)
    expect(right).toHaveLength(1)
  })

  test("booleans and offsets are deterministic", () => {
    for (const seed of SEEDS.slice(0, 5)) {
      const poly = star(seed)
      expect(JSON.stringify(offset(poly, -1.25))).toBe(JSON.stringify(offset(star(seed), -1.25)))
      expect(JSON.stringify(clip(poly, convex(seed, 7, 15), "difference"))).toBe(
        JSON.stringify(clip(star(seed), convex(seed, 7, 15), "difference")),
      )
    }
  })
})

describe("planar graphs", () => {
  const grid = (cells: number, size: number): Vec2[][] =>
    Array.from({ length: cells + 1 }, (_, i) => [
      [
        [0, i * size],
        [cells * size, i * size],
      ] as Vec2[],
      [
        [i * size, 0],
        [i * size, cells * size],
      ] as Vec2[],
    ]).flat()

  test("a 3×3 street grid has 16 nodes, 24 edges and 9 faces of one cell each", () => {
    const g = planarize(grid(3, 40))
    expect(g.nodes).toHaveLength(16)
    expect(g.edges).toHaveLength(24)
    const f = faces(g)
    expect(f).toHaveLength(9)
    for (const face of f) {
      expect(area(face.ring)).toBe(1600)
      face.edges.forEach((e, i) => {
        const ends = [g.edges[e]!.a, g.edges[e]!.b].sort()
        expect(ends).toEqual([face.nodes[i]!, face.nodes[(i + 1) % face.nodes.length]!].sort())
      })
    }
  })

  test("a crossing becomes a node; a tree has no faces", () => {
    const g = planarize([
      [
        [-10, 0],
        [10, 0],
      ],
      [
        [0, -10],
        [0, 10],
      ],
    ])
    expect(g.nodes).toHaveLength(5)
    expect(g.edges).toHaveLength(4)
    expect(faces(g)).toEqual([])
  })

  test("an end near a street joins it, and near nodes merge, within the tolerance", () => {
    const g = planarize(
      [
        [
          [0, 0],
          [20, 0],
        ],
        [
          [10, 0.5],
          [10, 10],
        ],
        [
          [21.5, 0],
          [30, 0],
        ],
      ],
      2,
    )
    expect(g.nodes).toEqual([
      [0, 0],
      [10, 0],
      [20, 0],
      [10, 10],
      [30, 0],
    ])
    expect(g.edges.map((e) => e.src)).toEqual([0, 0, 1, 2])
  })

  test("a curved ring cut by spokes gives one face per sector, covering the ring", () => {
    for (const seed of SEEDS.slice(0, 8)) {
      const ring = chaikin(star(seed, 10, 60), 2, true)
      const spokes = [0, 1, 2, 3].map((k) => {
        const a = (Math.PI / 2) * k + 0.3
        return [
          [0, 0],
          [90 * DMath.cos(a), 90 * DMath.sin(a)],
        ] as Vec2[]
      })
      const g = planarize([[...ring, ring[0]!], ...spokes], 0.01)
      const f = faces(g)
      expect(f).toHaveLength(4)
      const total = f.reduce((s, face) => s + area(face.ring), 0)
      expect(total).toBeCloseTo(area(ring), 0)
    }
  })
})

describe("sampling", () => {
  test("poissonIn keeps its points inside, r apart, out of holes, and fills the space", () => {
    const outer = square(0, 0, 60)
    const hole = orient(square(20, 20, 20), false)
    for (const seed of SEEDS.slice(0, 5)) {
      const pts = poissonIn([outer, hole], 4, (salt) => roll(seed, salt))
      for (const p of pts) {
        expect(contains(outer, p)).toBe(true)
        expect(contains(square(20.01, 20.01, 19.98), p, 0)).toBe(false)
      }
      for (let i = 0; i < pts.length; i++)
        for (let j = i + 1; j < pts.length; j++) expect(dist(pts[i]!, pts[j]!)).toBeGreaterThan(4 - 2e-3)
      expect(pts.length).toBeGreaterThan((3200 / 16) * 0.5)
    }
  })

  test("poissonIn is a function of the roll", () => {
    const shape = star(5, 12, 40)
    const at = (seed: number) => poissonIn(shape, 3, (salt) => roll(seed, salt))
    expect(at(1)).toEqual(at(1))
    expect(at(1)).not.toEqual(at(2))
  })
})

describe("oriented rectangles", () => {
  test("obb recovers a rotated rectangle, long side on local x", () => {
    const r: Rect = { c: [3, -2], rot: 0.6, w: 30, d: 12 }
    const box = obb(rectCorners(r))
    expect(box.c).toEqual([3, -2])
    expect(box.w).toBe(30)
    expect(box.d).toBe(12)
    // The same axis, either way round.
    expect(Math.abs(DMath.sin(box.rot - 0.6))).toBeLessThan(1e-9)
  })

  test("obb of a point cloud holds every point and beats the axis-aligned box", () => {
    for (const seed of SEEDS) {
      const pts = Array.from(
        { length: 30 },
        (_, i) =>
          [40 * rand(seed, `${i}:ox`), 15 * rand(seed, `${i}:oz`) + 0.8 * 40 * rand(seed, `${i}:ox`)] as Vec2,
      )
      const box = obb(pts)
      expect(box.w).toBeGreaterThanOrEqual(box.d)
      const corners = rectCorners(box)
      for (const p of pts) expect(contains(corners, p, 2e-3)).toBe(true)
      const xs = pts.map((p) => p[0])
      const zs = pts.map((p) => p[1])
      const aabb = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...zs) - Math.min(...zs))
      expect(box.w * box.d).toBeLessThanOrEqual(aabb + 1e-2)
    }
  })

  test("rectsOverlap: overlap counts, touching does not, nor a diagonal miss", () => {
    const a: Rect = { c: [0, 0], rot: 0, w: 10, d: 4 }
    expect(rectsOverlap(a, { c: [9, 0], rot: 0, w: 10, d: 4 })).toBe(true)
    expect(rectsOverlap(a, { c: [10, 0], rot: 0, w: 10, d: 4 })).toBe(false)
    // Its bounding box overlaps a's, the rect itself does not.
    expect(rectsOverlap(a, { c: [7.5, 5.5], rot: Math.PI / 4, w: 6, d: 1 })).toBe(false)
    expect(rectsOverlap(a, { c: [5, 2], rot: Math.PI / 4, w: 2, d: 2 })).toBe(true)
  })

  test("rectInPoly: sides may lie on the boundary; a notch through the rect fails it", () => {
    const r: Rect = { c: [5, 2], rot: 0, w: 10, d: 4 }
    expect(rectInPoly(r, square(0, 0, 10))).toBe(true)
    expect(rectInPoly({ ...r, c: [5, 7] }, L)).toBe(false)
    const notched: Ring = [
      [0, 0],
      [4.9, 0],
      [4.9, 8],
      [5.1, 8],
      [5.1, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]
    expect(rectCorners(r).every((p) => contains(notched, p))).toBe(true)
    expect(rectInPoly(r, notched)).toBe(false)
  })

  test("frontRect faces out across its edge and reaches inward", () => {
    const r = frontRect([0, 0], [20, 0], 4, 6, 8)
    expect(r.c).toEqual([7, 4])
    // Local +z, (sin rot, cos rot), points out of the block across the edge: −z here.
    expect(DMath.sin(r.rot)).toBeCloseTo(0, 12)
    expect(DMath.cos(r.rot)).toBeCloseTo(-1, 12)
  })

  test("rectangles packed along a block's edges are disjoint and inside the block", () => {
    const widths = [6, 9, 12]
    const depth = 7
    for (const seed of SEEDS) {
      const block = convex(seed, 7, 45)
      const lots: Rect[] = []
      block.forEach((a, i) => {
        const b = block[(i + 1) % block.length]!
        const end = dist(a, b) - depth
        let s = depth
        for (let k = 0; ; k++) {
          const w = widths[Math.floor(rand(seed, `${i}:${k}:lot`) * widths.length)]!
          if (s + w > end) break
          lots.push(frontRect(a, b, s, w, depth))
          s += w
        }
      })
      expect(lots.length).toBeGreaterThan(10)
      for (const lot of lots) expect(rectInPoly(lot, block)).toBe(true)
      for (let i = 0; i < lots.length; i++)
        for (let j = i + 1; j < lots.length; j++) {
          expect(rectsOverlap(lots[i]!, lots[j]!)).toBe(false)
        }
      // Neighbours on one edge touch: no gaps were asked for.
      expect(rectsOverlap(lots[0]!, lots[1]!, -1e-3)).toBe(true)
    }
  })
})
