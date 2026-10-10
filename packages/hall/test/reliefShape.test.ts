import { describe, expect, test } from "bun:test"
import { cellAt, key, neighbours } from "../src/world/gen/hex.ts"
import { islandFromTree } from "../src/world/gen/islandFromTree.ts"
import { dressingOf } from "../src/world/gen/relief/dressing.ts"
import { limitLevels, stairAt } from "../src/world/gen/relief/facets.ts"
import { reliefOf } from "../src/world/gen/relief/index.ts"
import { CORNERS, centreOf, HeightGrid, RES } from "../src/world/gen/relief/lattice.ts"
import { reliefMesh } from "../src/world/gen/relief/mesh.ts"
import { LEDGE_STEP, TRAIL_STRIDE } from "../src/world/gen/relief/shape.ts"
import { SWATCH } from "../src/world/gen/relief/swatches.ts"
import type { RepoEntry } from "../src/world/gen/repo.ts"
import REACT from "./fixtures/repos/facebook__react.json"

/** The relief's shape (world/gen/relief/shape.ts): stairs from the foot to the summit, each ledge narrower than the one below, conifers on the grass ledges. */

const CITY = islandFromTree(REACT.entries as RepoEntry[], 0, 2)
const RELIEF = reliefOf({ plan: CITY.plan, level: (cell) => CITY.levels.get(key(cell)) ?? 0 })
const massif = RELIEF.massifs[0]
if (!massif) throw new Error("no massif")

describe("the relief", () => {
  test("every top vertex of the mesh stands within a ledge of the ground walkers read, and most exactly on it", () => {
    const mesh = reliefMesh(RELIEF, massif.cells, 0)
    let checked = 0
    let exact = 0
    for (let v = 0; v < mesh.position.length; v += 9) {
      // The first face's vertices of every triangle; skirts hang below the ground and are skipped.
      if ((mesh.normal[v + 1] as number) <= 0.01) continue
      for (let k = 0; k < 9; k += 3) {
        const ground = RELIEF.heightAt(mesh.position[v + k] as number, mesh.position[v + k + 2] as number)
        if (ground === undefined) continue
        const off = Math.abs((mesh.position[v + k + 1] as number) - ground)
        // Only on a riser's line, where the two ledges meet, does the grid stand on the other one.
        expect(off).toBeLessThanOrEqual(LEDGE_STEP + 1e-3)
        if (off < 1e-3) exact++
        checked++
      }
    }
    expect(checked).toBeGreaterThan(100)
    expect(exact / checked).toBeGreaterThan(0.7)
  })

  test("the seam with the hex ground is the tile's own grass (rim faces and skirts)", () => {
    const mesh = reliefMesh(RELIEF, massif.cells, 0)
    let grass = 0
    for (let v = 0; v < mesh.uv.length; v += 2)
      if (mesh.uv[v] === Math.fround(SWATCH.grass.u) && mesh.uv[v + 1] === Math.fround(0.643)) grass++
    expect(grass).toBeGreaterThan(30)
  })
})

describe("the stairs to the summit", () => {
  const heightsOf = (mesh: { position: Float32Array }, v: number): number[] =>
    [1, 4, 7].map((k) => mesh.position[v + k] as number)

  /** A massif's coarse vertices off its rim (every neighbour a vertex of the massif too), by lattice position. */
  const interior = (m: (typeof RELIEF.massifs)[number]): { i: number; j: number; h: number }[] => {
    const out: { i: number; j: number; h: number }[] = []
    for (const cell of m.cells) {
      const [ci, cj] = centreOf(cell)
      for (let a = -RES; a <= RES; a += TRAIL_STRIDE)
        for (let b = -RES; b <= RES; b += TRAIL_STRIDE) {
          const [i, j] = [ci + a, cj + b]
          if (Number.isNaN(m.grid.get(i, j)) || !neighbours(cell).every((n) => m.keys.has(key(n)))) continue
          const near = CORNERS.map(([di, dj]) => m.grid.get(i + di * TRAIL_STRIDE, j + dj * TRAIL_STRIDE))
          if (near.every((h) => !Number.isNaN(h))) out.push({ i, j, h: m.grid.get(i, j) })
        }
    }
    return [...new Map(out.map((v) => [`${v.i},${v.j}`, v])).values()]
  }

  test("a ledge all the way up: every peak, every pass and every vertex of the ground between stands on a ledge", () => {
    for (const m of RELIEF.massifs) {
      for (const peak of m.peaks) expect(peak.height % LEDGE_STEP).toBe(0)
      for (const { h } of interior(m)) expect(h % LEDGE_STEP).toBe(0)
    }
  })

  test("a riser is one ledge high: no two neighbouring vertices stand more than a ledge apart", () => {
    for (const m of RELIEF.massifs) {
      const held = new Map(interior(m).map((v) => [`${v.i},${v.j}`, v.h]))
      for (const { i, j, h } of interior(m))
        for (const [di, dj] of CORNERS) {
          const near = held.get(`${i + di * TRAIL_STRIDE},${j + dj * TRAIL_STRIDE}`)
          if (near !== undefined) expect(Math.abs(h - near)).toBeLessThanOrEqual(LEDGE_STEP)
        }
    }
  })

  test("each ledge is smaller than the one below: the mass narrows to a stepped top, whose ledge is a coarse triangle at least", () => {
    for (const m of RELIEF.massifs) {
      const tops = interior(m).map((v) => v.h)
      const summit = Math.max(...tops)
      expect(summit).toBeGreaterThanOrEqual(2 * LEDGE_STEP)
      // No ledge is skipped on the way up, and each holds fewer vertices at or above it than the one below.
      let below = Number.POSITIVE_INFINITY
      for (let level = LEDGE_STEP; level <= summit; level += LEDGE_STEP) {
        const held = tops.filter((h) => h >= level).length
        expect(held).toBeGreaterThan(0)
        expect(held).toBeLessThan(below)
        below = held
      }
      expect(tops.filter((h) => h === summit).length).toBeGreaterThanOrEqual(3)
    }
  })

  test("a range of several peaks is several stepped tops, the passes between them lower ledges", () => {
    expect(massif.peaks.length).toBeGreaterThan(1)
    for (const peak of massif.peaks)
      expect(RELIEF.heightAt(peak.at[0], peak.at[1])).toBeCloseTo(peak.height, 5)
    for (const saddle of massif.saddles) {
      const [a, b] = saddle.between.map((k) => massif.peaks[k]?.height ?? 0) as [number, number]
      expect(saddle.height).toBeLessThanOrEqual(Math.min(a, b) - LEDGE_STEP / 2)
    }
  })

  test("no face of the mountain slopes: inside a massif every triangle is a flat top or a vertical riser", () => {
    for (const m of RELIEF.massifs) {
      const mesh = reliefMesh(RELIEF, m.cells, 0)
      let faces = 0
      for (let t = 0; t < mesh.position.length; t += 9) {
        const p = mesh.position
        const [x, z] = [(p[t]! + p[t + 3]! + p[t + 6]!) / 3, (p[t + 2]! + p[t + 5]! + p[t + 8]!) / 3]
        const cell = cellAt([x, z])
        if (!m.keys.has(key(cell)) || !neighbours(cell).every((n) => m.keys.has(key(n)))) continue
        faces++
        const [ys, ny] = [heightsOf(mesh, t), faceUp(mesh, t)]
        // Level, or standing straight up.
        expect(Math.max(...ys) - Math.min(...ys) < 1e-3 || ny < 1e-3).toBe(true)
      }
      expect(faces).toBeGreaterThan(1000)
    }
  })

  /** A face's own normal y (from its corners, whatever its smoothed vertex normals say). */
  const faceUp = (mesh: { position: Float32Array }, v: number): number => {
    const p = mesh.position
    const [ux, uz] = [(p[v + 3] as number) - (p[v] as number), (p[v + 5] as number) - (p[v + 2] as number)]
    const [vx, vz] = [(p[v + 6] as number) - (p[v] as number), (p[v + 8] as number) - (p[v + 2] as number)]
    return Math.abs(uz * vx - ux * vz)
  }

  test("the ledges are stairs: flat tops on ledge heights and vertical risers between two ledges", () => {
    const mesh = reliefMesh(RELIEF, massif.cells, 0)
    let risers = 0
    let flat = 0
    for (let v = 0; v < mesh.normal.length; v += 9) {
      const ys = heightsOf(mesh, v)
      const rise = Math.max(...ys) - Math.min(...ys)
      // A riser's face stands straight up (it has no footprint) on a ledge's height and half way to the next.
      const half = (y: number): boolean =>
        Math.abs(y / (LEDGE_STEP / 2) - Math.round(y / (LEDGE_STEP / 2))) < 1e-3
      if (faceUp(mesh, v) < 1e-6 && rise > 1 && ys.every(half)) risers++
      const y = ys[0] as number
      if (
        faceUp(mesh, v) > 1e-3 &&
        rise < 1e-3 &&
        Math.abs(y / LEDGE_STEP - Math.round(y / LEDGE_STEP)) < 1e-3
      )
        flat++
    }
    expect(risers).toBeGreaterThan(100)
    expect(flat).toBeGreaterThan(100)
  })

  test("a riser is one flat colour for its ledge band: one swatch, one place on its strip, from foot to lip", () => {
    const mesh = reliefMesh(RELIEF, massif.cells, 0)
    const bands = new Map<number, Set<string>>()
    let n = 0
    for (let v = 0; v < mesh.normal.length; v += 9) {
      if (faceUp(mesh, v) > 1e-6) continue
      // A riser's normal is horizontal; a curtain over a ramp's edge is shaded as the ramp is (its normal leans up).
      if (Math.abs(mesh.normal[v + 1] as number) > 1e-3) continue
      const ys = heightsOf(mesh, v)
      if (Math.max(...ys) - Math.min(...ys) < 1) continue
      // Rock and warm stone only: the skirts at the rim, as high as a riser, wear the tile's grass.
      const u = mesh.uv[(v / 3) * 2] as number
      if (u !== Math.fround(SWATCH.rock.u) && u !== Math.fround(SWATCH.warm.u)) continue
      const band = Math.floor(Math.min(...ys) / LEDGE_STEP + 1e-3)
      for (let k = 0; k < 3; k++)
        bands.set(
          band,
          (bands.get(band) ?? new Set<string>()).add(
            `${mesh.uv[(v / 3 + k) * 2]},${mesh.uv[(v / 3 + k) * 2 + 1]}`,
          ),
        )
      n++
    }
    expect(bands.size).toBeGreaterThan(2)
    for (const colours of bands.values()) expect(colours.size).toBe(1)
    expect(n).toBeGreaterThan(100)
  })

  test("trees stand on flat ledge tops, so they sit exactly on the stairs", () => {
    let trees = 0
    for (const piece of dressingOf(RELIEF, 3)) {
      const ground = RELIEF.heightAt(piece.x, piece.z) as number
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const)
        expect(Math.abs((RELIEF.heightAt(piece.x + dx, piece.z + dz) ?? ground) - ground)).toBeLessThan(0.15)
      trees++
    }
    expect(trees).toBeGreaterThan(50)
  })
})

describe("the ledge rules", () => {
  /** A flat grid at 0 with the coarse vertices `raised` stood on `height`. */
  const gridWith = (raised: readonly (readonly [number, number])[], height: number): HeightGrid => {
    const grid = new HeightGrid(0, 0, 13, 13)
    grid.data.fill(0)
    for (const [i, j] of raised) grid.set(i, j, height)
    return grid
  }
  const around = (i: number, j: number): [number, number][] => [
    [i, j],
    ...CORNERS.map(([di, dj]): [number, number] => [i + di * TRAIL_STRIDE, j + dj * TRAIL_STRIDE]),
  ]

  test("a lone pillar comes down: a ledge is a coarse triangle at least, never a chimney", () => {
    const grid = gridWith([[6, 6]], 2 * LEDGE_STEP)
    expect([...limitLevels(grid, () => false)]).toEqual([grid.index(6, 6)])
    expect(grid.get(6, 6)).toBe(0)
  })

  test("a ledge of two vertices comes down too, one of a triangle stays", () => {
    const pair = gridWith(
      [
        [6, 6],
        [8, 6],
      ],
      LEDGE_STEP,
    )
    limitLevels(pair, () => false)
    expect([pair.get(6, 6), pair.get(8, 6)]).toEqual([0, 0])
    const triangle = gridWith(
      [
        [6, 6],
        [8, 6],
        [6, 8],
      ],
      LEDGE_STEP,
    )
    expect(limitLevels(triangle, () => false).size).toBe(0)
    expect([triangle.get(6, 6), triangle.get(8, 6), triangle.get(6, 8)]).toEqual([5, 5, 5])
  })

  test("a riser is one ledge: a pillar of three ledges over a ring of one comes down to the ring's", () => {
    const grid = gridWith(around(6, 6), LEDGE_STEP)
    grid.set(6, 6, 3 * LEDGE_STEP)
    limitLevels(grid, () => false)
    expect(grid.get(6, 6)).toBe(LEDGE_STEP)
    for (const [i, j] of around(6, 6)) expect(grid.get(i, j)).toBe(LEDGE_STEP)
  })

  test("a skipped vertex (the rim, a trail's shelf) is never lowered", () => {
    const grid = gridWith([[6, 6]], 2 * LEDGE_STEP)
    limitLevels(grid, (at) => at === grid.index(6, 6))
    expect(grid.get(6, 6)).toBe(2 * LEDGE_STEP)
  })

  test("the stairs between the coarse vertices stand on the ledges: never between two", () => {
    const grid = gridWith(
      [
        [4, 4],
        [4, 6],
        [2, 6],
      ],
      LEDGE_STEP,
    )
    for (let j = 2; j <= 8; j++)
      for (let i = 2; i <= 8; i++) {
        const h = stairAt(grid, i, j, TRAIL_STRIDE)
        expect(Math.abs(h / LEDGE_STEP - Math.round(h / LEDGE_STEP))).toBeLessThan(1e-9)
      }
  })
})
