import { describe, expect, test } from "bun:test"
import { key } from "../src/world/gen/hex.ts"
import { islandFromTree } from "../src/world/gen/islandFromTree.ts"
import { curvatureAt } from "../src/world/gen/relief/curvature.ts"
import { dressingOf } from "../src/world/gen/relief/dressing.ts"
import { reliefOf } from "../src/world/gen/relief/index.ts"
import { reliefMesh } from "../src/world/gen/relief/mesh.ts"
import { riserZone, vOf, zoneOf } from "../src/world/gen/relief/paint.ts"
import { CREASE_DEGREES, smoothNormals } from "../src/world/gen/relief/smooth.ts"
import { chisel, seamOf, stairsOf } from "../src/world/gen/relief/strata.ts"
import { SWATCH } from "../src/world/gen/relief/swatches.ts"
import type { RepoEntry } from "../src/world/gen/repo.ts"
import REACT from "./fixtures/repos/facebook__react.json"

/** The craft pass on the relief: smooth shading with creases, strip gradients, the kit's rocks. */

const CITY = islandFromTree(REACT.entries as RepoEntry[], 0, 2)
const RELIEF = reliefOf({ plan: CITY.plan, level: (cell) => CITY.levels.get(key(cell)) ?? 0 })
const massif = RELIEF.massifs[0]
if (!massif) throw new Error("no massif")

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

  test("the mesh's normals are unit vectors and open slopes are smoother than their faces", () => {
    const mesh = reliefMesh(RELIEF, massif.cells, 0)
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

describe("chiselled risers", () => {
  const walls = stairsOf([0, 0, 0, 0], [2, 5, 0, 0], [0, 5, 2, 0]).walls

  test("a wall's two triangles become four round a centre, and its corners stay where they were", () => {
    const four = chisel(walls)
    expect(four.length).toBe(walls.length * 2)
    const corners = (list: typeof walls): Set<string> =>
      new Set(
        list.flatMap((w) =>
          w.tri.slice(0, 2).map((v) =>
            v
              .slice(0, 3)
              .map((n) => n.toFixed(4))
              .join(),
          ),
        ),
      )
    for (const corner of corners(walls)) expect(corners(four).has(corner)).toBe(true)
  })
})

describe("the seam beside a ramp", () => {
  test("closes exactly the gap between the ramp's line and the stairs' profile, in the plane over the edge", () => {
    const seams = seamOf([0, 0, 0, 0], [2, 5, 0, 0])
    let area = 0
    for (const { tri } of seams) {
      for (const v of tri) expect(v[2]).toBeCloseTo(0, 9)
      const [a, b, c] = tri
      area +=
        Math.abs(
          ((b[0] as number) - (a[0] as number)) * ((c[1] as number) - (a[1] as number)) -
            ((c[0] as number) - (a[0] as number)) * ((b[1] as number) - (a[1] as number)),
        ) / 2
    }
    // A half-height cut midway: two right triangles of 1 by 2.5 each.
    expect(area).toBeCloseTo(2.5, 6)
  })

  test("a ramp between the same ledge has no gap to close", () => {
    expect(seamOf([0, 5, 0, 0], [2, 5, 0, 0])).toEqual([])
  })
})

describe("the kit's rocks on the mountain", () => {
  const dressing = dressingOf(RELIEF, 3)

  test("rocks and crags are the kit's own, bigger than a pebble", () => {
    const rocks = dressing.filter((p) => p.piece.startsWith("rock_single") || p.piece.startsWith("mountain_"))
    expect(rocks.length).toBeGreaterThan(15)
    for (const rock of rocks) expect(rock.scale ?? 1).toBeGreaterThan(0.4)
  })

  test("none floats: every rock stands no higher than the ground at its centre, sunk into the slope", () => {
    for (const rock of dressing) {
      if (!rock.piece.startsWith("rock_single") && !rock.piece.startsWith("mountain_")) continue
      const ground = RELIEF.heightAt(rock.x, rock.z)
      if (ground !== undefined) expect(rock.y ?? 0).toBeLessThanOrEqual(ground + 1e-6)
    }
  })

  test("the steep ground above the top ledge carries rocks", () => {
    const high = dressing.filter(
      (p) => (RELIEF.heightAt(p.x, p.z) ?? 0) > massif.ledgeTop && p.piece.startsWith("rock_single"),
    )
    expect(high.length).toBeGreaterThan(5)
  })

  test("it is seeded and keeps off the rivers' hexes", () => {
    expect(dressingOf(RELIEF, 5)).toEqual(dressingOf(RELIEF, 5))
    expect(dressingOf(RELIEF, 5)).not.toEqual(dressingOf(RELIEF, 6))
    expect(dressingOf(RELIEF, 5, RELIEF.keys)).toEqual([])
  })
})
