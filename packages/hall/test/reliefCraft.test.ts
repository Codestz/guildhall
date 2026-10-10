import { describe, expect, test } from "bun:test"
import { cellAt, key } from "../src/world/gen/hex.ts"
import { islandFromTree } from "../src/world/gen/islandFromTree.ts"
import { curvatureAt } from "../src/world/gen/relief/curvature.ts"
import { dressingOf } from "../src/world/gen/relief/dressing.ts"
import { reliefOf } from "../src/world/gen/relief/index.ts"
import { reliefMesh } from "../src/world/gen/relief/mesh.ts"
import { riserZone, vOf, zoneOf } from "../src/world/gen/relief/paint.ts"
import { CREASE_DEGREES, smoothNormals } from "../src/world/gen/relief/smooth.ts"
import { curtainOf, onLine, profile, rampOf, stairsOf, triangulate } from "../src/world/gen/relief/strata.ts"
import { SWATCH } from "../src/world/gen/relief/swatches.ts"
import type { RepoEntry } from "../src/world/gen/repo.ts"
import { repoWorld } from "../src/world/world.ts"
import REACT from "./fixtures/repos/facebook__react.json"

/** The craft pass on the relief: smooth shading with creases, strip gradients, flat risers, conifers and nothing else. */

const CITY = islandFromTree(REACT.entries as RepoEntry[], 0, 2)
const RELIEF = reliefOf({ plan: CITY.plan, level: (cell) => CITY.levels.get(key(cell)) ?? 0 })
const massif = RELIEF.massifs[0]
if (!massif) throw new Error("no massif")
/** The same island with its rivers and trails carved: the only ground that is not stairs. */
const CARVED = repoWorld(CITY, { repo: "fixture/x", source: "fixture", gen: 2 } as never).relief
if (!CARVED?.massifs[0]) throw new Error("no carved massif")

/** A triangle's three vertices, flat-shaded: positions and per-vertex face normals. */
const tri = (a: number[], b: number[], c: number[]) => {
  const [ux, uy, uz] = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!]
  const [vx, vy, vz] = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!]
  let n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]
  if (n[1]! < 0) n = n.map((x) => -x)
  const l = Math.hypot(...(n as [number, number, number]))
  n = n.map((x) => x / l)
  return { position: [...a, ...b, ...c], face: [...n, ...n, ...n] }
}

describe("smooth shading with creases", () => {
  // Two triangles meeting along the edge (0,0,0)-(0,0,1), the second tilted by `degrees`.
  const pair = (degrees: number) => {
    const t = (degrees * Math.PI) / 180
    const a = tri([0, 0, 0], [0, 0, 1], [-1, 0, 0])
    const b = tri([0, 0, 0], [0, 0, 1], [Math.cos(t), Math.sin(t), 0])
    return smoothNormals([...a.position, ...b.position], [...a.face, ...b.face], new Uint8Array(2))
  }

  test("faces closer than the smoothing angle share a normal at their common vertex", () => {
    const normals = pair(CREASE_DEGREES - 15)
    // Vertex 0 of each triangle is the shared (0,0,0).
    expect(normals[0]).toBeCloseTo(normals[9] as number, 5)
    expect(normals[1]).toBeCloseTo(normals[10] as number, 5)
    expect(Math.hypot(normals[0] as number, normals[1] as number, normals[2] as number)).toBeCloseTo(1, 5)
  })

  test("faces further round than the angle keep their own normals: a crease", () => {
    const normals = pair(CREASE_DEGREES + 20)
    expect(Math.abs((normals[0] as number) - (normals[9] as number))).toBeGreaterThan(0.1)
  })

  test("a flat triangle (a skirt) keeps its face normal and joins nothing", () => {
    const a = tri([0, 0, 0], [0, 0, 1], [-1, 0, 0])
    const b = tri([0, 0, 0], [0, 0, 1], [1, 0.3, 0])
    const normals = smoothNormals(
      [...a.position, ...b.position],
      [...a.face, ...b.face],
      Uint8Array.from([0, 1]),
    )
    expect([normals[9], normals[10], normals[11]]).toEqual(
      [b.face[0] as number, b.face[1] as number, b.face[2] as number].map(Math.fround),
    )
  })

  test("the mesh's normals are unit vectors and the ramps (a river's banks, a trail's steps) are smoother than their faces", () => {
    const mesh = reliefMesh(CARVED, CARVED.massifs[0]?.cells ?? [], 0)
    let soft = 0
    let ground = 0
    for (let v = 0; v < mesh.normal.length; v += 3) {
      const [x, y, z] = [mesh.normal[v] as number, mesh.normal[v + 1] as number, mesh.normal[v + 2] as number]
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 4)
      if (y > 0.2 && y < 0.95) {
        ground++
        // Vertices of one face with normals that differ: the face is shaded round, not flat.
        const tri = Math.floor(v / 9) * 9
        if (
          Math.abs(y - (mesh.normal[tri + 1] as number)) > 1e-4 ||
          Math.abs(x - (mesh.normal[tri] as number)) > 1e-4
        )
          soft++
      }
    }
    expect(soft / ground).toBeGreaterThan(0.1)
  })

  test("two sets of one massif agree on the normals along their shared edge (no seam)", () => {
    const cells = massif.cells
    const left = cells.filter((_, k) => k % 2 === 0)
    const right = cells.filter((_, k) => k % 2 === 1)
    const whole = reliefMesh(RELIEF, cells, 0)
    const at = new Map<string, Set<string>>()
    const round = (n: number): string => n.toFixed(2)
    const idOf = (m: { position: Float32Array }, v: number): string =>
      `${round(m.position[v] as number)},${round(m.position[v + 1] as number)},${round(m.position[v + 2] as number)}`
    const normalOf = (m: { normal: Float32Array }, v: number): string =>
      `${round(m.normal[v] as number)},${round(m.normal[v + 1] as number)},${round(m.normal[v + 2] as number)}`
    for (let v = 0; v < whole.position.length; v += 3)
      if ((whole.normal[v + 1] as number) > 0.2)
        at.set(idOf(whole, v), (at.get(idOf(whole, v)) ?? new Set<string>()).add(normalOf(whole, v)))
    let checked = 0
    let agree = 0
    for (const part of [left, right]) {
      const mesh = reliefMesh(RELIEF, part, 0)
      for (let v = 0; v < mesh.position.length; v += 3) {
        if ((mesh.normal[v + 1] as number) <= 0.2) continue
        const wanted = at.get(idOf(mesh, v))
        if (wanted === undefined) continue
        checked++
        if (wanted.has(normalOf(mesh, v))) agree++
      }
    }
    expect(checked).toBeGreaterThan(1000)
    expect(agree / checked).toBeGreaterThan(0.98)
  })
})

describe("gradients and ambient occlusion", () => {
  const zone = riserZone(2)

  test("a vertex in a concavity sits at the dark end of its strip, on a convex lip at the light end", () => {
    const gully = vOf(zone, { rel: 0.5, curve: 3 })
    const flat = vOf(zone, { rel: 0.5, curve: 0 })
    const lip = vOf(zone, { rel: 0.5, curve: -3 })
    expect(gully).toBeGreaterThan(flat)
    expect(flat).toBeGreaterThan(lip)
  })

  test("rock grows lighter with height, the meadow deeper", () => {
    const rock = { swatch: SWATCH.rock, t: 0.4, rise: -0.4 }
    const meadow = { swatch: SWATCH.meadow, t: 0.3, rise: 0.4 }
    expect(vOf(rock, { rel: 0.9, curve: 0 })).toBeLessThan(vOf(rock, { rel: 0.1, curve: 0 }))
    expect(vOf(meadow, { rel: 0.9, curve: 0 })).toBeGreaterThan(vOf(meadow, { rel: 0.1, curve: 0 }))
  })

  test("every vertex's v stays inside the swatch strip it points at", () => {
    const mesh = reliefMesh(RELIEF, massif.cells, 0)
    const strips = Object.values(SWATCH)
    for (let v = 0; v < mesh.uv.length; v += 2) {
      const y = mesh.uv[v + 1] as number
      // A column holds several strips (rock and slate share one): the vertex is inside one of them.
      expect(
        strips.some(
          (s) =>
            Math.abs(s.u - (mesh.uv[v] as number)) < 1e-6 &&
            y >= Math.fround(s.light) - 1e-6 &&
            y <= Math.fround(s.dark) + 1e-6,
        ),
      ).toBe(true)
    }
  })

  test("a face's zone is a function of where it stands, so a flat ledge top is the same zone anywhere on its band", () => {
    const [p, q, r] = [
      [0, 10, 0],
      [1, 10, 0],
      [0, 10, 1],
    ]
    expect(zoneOf(p as number[], q as number[], r as number[], 40)).toEqual(
      zoneOf(p as number[], q as number[], r as number[], 40),
    )
  })

  test("the ground's concavity is negative on the main summit's crest", () => {
    const peak = massif.peaks[0]
    if (!peak) throw new Error("no peak")
    expect(curvatureAt(massif.grid, peak.at[0], peak.at[1])).toBeLessThan(0)
  })
})

describe("a riser is a flat wall", () => {
  // A triangle with one corner on a ledge, the other two a ledge up: one riser across it.
  const { walls, tops } = stairsOf([0, 0, 0, 0], [2, 5, 0, 0], [0, 5, 2, 0])
  const normalOf = ([a, b, c]: number[][]): number[] => {
    const [ux, uy, uz] = [b![0]! - a![0]!, b![1]! - a![1]!, b![2]! - a![2]!]
    const [vx, vy, vz] = [c![0]! - a![0]!, c![1]! - a![1]!, c![2]! - a![2]!]
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]
    const l = Math.hypot(n[0]!, n[1]!, n[2]!)
    return n.map((x) => x / l)
  }

  test("every triangle of a riser lies in one vertical plane: one normal, no pillow, no teeth", () => {
    expect(walls.length).toBeGreaterThan(0)
    const first = normalOf(walls[0]!.tri)
    for (const { tri } of walls) {
      const n = normalOf(tri)
      expect(Math.abs(n[1]!)).toBeLessThan(1e-9)
      // The same plane, either way round.
      expect(Math.abs(n[0]! * first[0]! + n[2]! * first[2]!)).toBeCloseTo(1, 9)
    }
  })

  test("a riser stands one ledge high between the flat tops of the two ledges, which are flat", () => {
    const ys = new Set(walls.flatMap(({ tri }) => tri.map((v) => v[1]!.toFixed(3))))
    expect([...ys].sort()).toEqual(["0.000", "2.500", "5.000"])
    for (const top of tops) expect(new Set(top.map((v) => v[1]!.toFixed(3))).size).toBe(1)
  })

  test("the profile of an edge is the same read from either end, so both triangles on it meet", () => {
    const [u, v] = [
      [0, 0, 0, 0],
      [3, 10, 1, 0],
    ]
    const forward = profile(u, v).map((n) => n.at.slice(0, 3))
    const back = profile(v, u).map((n) => n.at.slice(0, 3))
    expect(forward.length).toBeGreaterThan(0)
    expect(back).toEqual([...forward].reverse())
  })
})

describe("a ramp beside stairs", () => {
  const [p, a, b] = [
    [0, 8, 3, 0],
    [0, 0, 0, 0],
    [3, 5, 0, 0],
  ]
  const edge = onLine(profile(a, b))
  const sub = (u: number[], v: number[]): number[] => [u[0]! - v[0]!, u[1]! - v[1]!, u[2]! - v[2]!]
  const cross = (u: number[], v: number[]): number[] => [
    u[1]! * v[2]! - u[2]! * v[1]!,
    u[2]! * v[0]! - u[0]! * v[2]!,
    u[0]! * v[1]! - u[1]! * v[0]!,
  ]
  const area = (t: number[][]): number =>
    Math.hypot(...(cross(sub(t[1]!, t[0]!), sub(t[2]!, t[0]!)) as [number, number, number])) / 2

  test("takes the riser's mid-point on its edge, and its faces are the very surface of the bare triangle", () => {
    const bare = rampOf(p, a, b, [[], [], []])
    const cut = rampOf(p, a, b, [[], edge, []])
    expect(bare.length).toBe(1)
    expect(cut.length).toBe(2)
    expect(cut.reduce((sum, t) => sum + area(t), 0)).toBeCloseTo(area(bare[0]!), 9)
    // Coplanar with it, so nothing moves and the ground walkers read is unchanged.
    const normal = cross(sub(a, p), sub(b, p))
    for (const t of cut)
      for (const v of t)
        expect(
          normal[0]! * (v[0]! - p[0]!) + normal[1]! * (v[1]! - p[1]!) + normal[2]! * (v[2]! - p[2]!),
        ).toBeCloseTo(0, 9)
  })

  test("the curtain over the edge stands in the vertical plane over it and closes the gap to the profile", () => {
    const curtain = curtainOf(a, b, profile(a, b), p)
    // One triangle at the foot and one at the lip of the riser.
    expect(curtain.length).toBe(2)
    const along = sub(b, a)
    for (const { tri } of curtain)
      for (const v of tri) expect(along[0]! * (v[2]! - a[2]!) - along[2]! * (v[0]! - a[0]!)).toBeCloseTo(0, 9)
    // The ramp is the taller side along the foot (the curtain faces away from it) and the shorter along the lip (it faces it).
    const [foot, lip] = curtain.map((c) => c.outward)
    expect(foot![0]! * lip![0]! + foot![1]! * lip![1]!).toBeCloseTo(-1, 9)
  })
})

describe("the least stretched triangulation", () => {
  test("a polygon of collinear edge points is cut into round triangles, never a sliver from one corner", () => {
    // A tall thin wedge with a point in the middle of each long side.
    const ring = [
      [0, 0, 0],
      [1, 5, 0],
      [2, 10, 0],
      [1, 10, 1],
      [0, 10, 2],
      [0, 5, 1],
    ]
    const tris = triangulate(ring)
    expect(tris.length).toBe(4)
    for (const t of tris) {
      const [a, b, c] = t as [number[], number[], number[]]
      const [ux, uy, uz] = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!]
      const [vx, vy, vz] = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!]
      expect(Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx)).toBeGreaterThan(1e-9)
    }
  })
})

describe("the dressing on the mountain", () => {
  const dressing = dressingOf(RELIEF, 3)

  test("is conifers and nothing else: no kit rock, scree or crag stands on a massif", () => {
    expect(dressing.length).toBeGreaterThan(50)
    for (const piece of dressing) expect(piece.piece).toMatch(/^tree/)
  })

  test("the conifers stand on the grass ledges below the bare rock, each set on its ledge's flat top", () => {
    for (const piece of dressing) {
      const own = RELIEF.massifAt(cellAt([piece.x, piece.z]))
      const ground = RELIEF.heightAt(piece.x, piece.z)
      expect(own).toBeDefined()
      expect(ground as number).toBeLessThan(0.5 * (own?.height ?? 0))
      expect(Math.abs((piece.y ?? 0) - (ground as number) + 0.15)).toBeLessThan(0.02)
    }
  })

  test("it is seeded and keeps off the rivers' hexes", () => {
    expect(dressingOf(RELIEF, 5)).toEqual(dressingOf(RELIEF, 5))
    expect(dressingOf(RELIEF, 5)).not.toEqual(dressingOf(RELIEF, 6))
    expect(dressingOf(RELIEF, 5, RELIEF.keys)).toEqual([])
  })
})
