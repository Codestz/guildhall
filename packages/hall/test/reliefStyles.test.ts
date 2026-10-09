import { describe, expect, test } from "bun:test"
import { key } from "../src/world/gen/hex.ts"
import { islandFromTree } from "../src/world/gen/islandFromTree.ts"
import { dressingOf } from "../src/world/gen/relief/dressing.ts"
import { isFaceted } from "../src/world/gen/relief/facets.ts"
import { forestOf } from "../src/world/gen/relief/forest.ts"
import { type Relief, type ReliefStyle, reliefOf, reliefStyleOf } from "../src/world/gen/relief/index.ts"
import { reliefMesh } from "../src/world/gen/relief/mesh.ts"
import { LEDGE_STEP, strideOf } from "../src/world/gen/relief/style.ts"
import { SWATCH } from "../src/world/gen/relief/swatches.ts"
import type { RepoEntry } from "../src/world/gen/repo.ts"
import REACT from "./fixtures/repos/facebook__react.json"

/** The relief's art directions (`?relief=a|b|c`, world/gen/relief/style.ts) on a City. */

const CITY = islandFromTree(REACT.entries as RepoEntry[], 0, 2)
const reliefIn = (style?: ReliefStyle): Relief =>
  reliefOf({ plan: CITY.plan, level: (cell) => CITY.levels.get(key(cell)) ?? 0, ...(style ? { style } : {}) })
const BASE = reliefIn()
const STYLES = { a: reliefIn("a"), b: reliefIn("b"), c: reliefIn("c"), d: reliefIn("d") }
const trianglesOf = (relief: Relief): number =>
  relief.massifs.reduce((sum, m) => sum + reliefMesh(relief, m.cells, 0).position.length / 9, 0)

describe("the style a link asks for", () => {
  test("a, b, c, d and current are understood; anything else is the hybrid, the default", () => {
    expect(
      ["?relief=a", "?relief=b", "?relief=c", "?relief=d", "?relief=current"].map(reliefStyleOf),
    ).toEqual(["a", "b", "c", "d", "current"])
    expect(["", "?relief=e", "?relief=A", "?relief="].map(reliefStyleOf)).toEqual(["d", "d", "d", "d"])
  })

  test("the default relief is the current one", () => {
    expect(BASE.style).toBe("current")
    expect(reliefIn("current").massifs[0]?.height).toBe(BASE.massifs[0]?.height)
  })
})

describe("every style", () => {
  for (const [name, relief] of Object.entries(STYLES)) {
    test(`${name}: stands on the same footprint with at most the current triangles`, () => {
      expect([...relief.keys].sort()).toEqual([...BASE.keys].sort())
      expect(trianglesOf(relief)).toBeLessThanOrEqual(trianglesOf(BASE))
    })

    test(`${name}: every top vertex of the mesh stands on the ground walkers read`, () => {
      const massif = relief.massifs[0]
      if (!massif) throw new Error("no massif")
      const mesh = reliefMesh(relief, massif.cells, 0)
      let checked = 0
      for (let v = 0; v < mesh.position.length; v += 9) {
        // The first face's vertices of every triangle; skirts hang below the ground and are skipped.
        if ((mesh.normal[v + 1] as number) <= 0.01) continue
        for (let k = 0; k < 9; k += 3) {
          const x = mesh.position[v + k] as number
          const z = mesh.position[v + k + 2] as number
          const ground = relief.heightAt(x, z)
          if (ground === undefined) continue
          // The hybrid's stairs cut a ramp at the half-way height: up to half a ledge off there.
          if (name === "d")
            expect(Math.abs((mesh.position[v + k + 1] as number) - ground)).toBeLessThanOrEqual(
              LEDGE_STEP / 2 + 1e-3,
            )
          else expect(mesh.position[v + k + 1] as number).toBeCloseTo(ground, 3)
          checked++
        }
      }
      expect(checked).toBeGreaterThan(100)
    })

    test(`${name}: the seam with the hex ground is the tile's own grass (rim faces and skirts)`, () => {
      const massif = relief.massifs[0]
      if (!massif) throw new Error("no massif")
      const mesh = reliefMesh(relief, massif.cells, 0)
      let grass = 0
      for (let v = 0; v < mesh.uv.length; v += 2)
        if (mesh.uv[v] === Math.fround(SWATCH.grass.u) && mesh.uv[v + 1] === Math.fround(0.643)) grass++
      expect(grass).toBeGreaterThan(30)
    })
  }
})

describe("a and c: chunky facets", () => {
  test("every hex lies on its coarse planes, so the faces are big and the ground agrees with them", () => {
    for (const relief of [STYLES.a, STYLES.c])
      for (const massif of relief.massifs)
        for (const cell of massif.cells) expect(isFaceted(massif.grid, cell, strideOf("a"))).toBe(true)
  })
})

describe("b: strata", () => {
  test("the vertices stand on ledges, five units apart, except along the rim", () => {
    const massif = STYLES.b.massifs[0]
    if (!massif) throw new Error("no massif")
    let onLedge = 0
    let total = 0
    for (const cell of massif.cells) {
      const mesh = reliefMesh(STYLES.b, [cell], 0)
      for (let v = 0; v < mesh.position.length; v += 3) {
        if ((mesh.normal[v + 1] as number) <= 0.01) continue
        total++
        if (
          Math.abs(
            (mesh.position[v + 1] as number) / LEDGE_STEP -
              Math.round((mesh.position[v + 1] as number) / LEDGE_STEP),
          ) < 1e-3
        )
          onLedge++
      }
    }
    expect(onLedge / total).toBeGreaterThan(0.7)
  })
})

describe("c and d: sculpted peaks and kit dressing", () => {
  test("the main peak stands taller than the current one", () => {
    expect(STYLES.c.massifs[0]?.height).toBeGreaterThan((BASE.massifs[0]?.height ?? 0) * 1.1)
  })

  test("the flanks carry the kit's rocks and conifer clumps instead of a tree carpet", () => {
    const dressing = forestOf(STYLES.c, 1)
    expect(dressing).toEqual(dressingOf(STYLES.c, 1))
    expect(dressing.some((p) => p.piece.startsWith("rock_single"))).toBe(true)
    expect(dressing.some((p) => p.piece.startsWith("tree"))).toBe(true)
    expect(dressing.length).toBeLessThan(forestOf(STYLES.a, 1).length)
  })

  test("it is seeded and keeps off the rivers' hexes", () => {
    expect(dressingOf(STYLES.c, 5)).toEqual(dressingOf(STYLES.c, 5))
    expect(dressingOf(STYLES.c, 5)).not.toEqual(dressingOf(STYLES.c, 6))
    const all = new Set(STYLES.c.massifs.flatMap((m) => [...m.keys]))
    expect(dressingOf(STYLES.c, 5, all)).toEqual([])
  })
})

describe("d: the hybrid", () => {
  const massif = STYLES.d.massifs[0]
  if (!massif) throw new Error("no massif")
  const heightsOf = (mesh: { position: Float32Array }, v: number): number[] =>
    [1, 4, 7].map((k) => mesh.position[v + k] as number)

  test("a top ledge, with the faceted peak standing above it", () => {
    expect(massif.ledgeTop).toBeGreaterThanOrEqual(LEDGE_STEP)
    expect(massif.ledgeTop % LEDGE_STEP).toBe(0)
    expect(STYLES.d.massifs.every((m) => m.height > m.ledgeTop)).toBe(true)
  })

  test("the ledges are stairs: flat tops on ledge heights and vertical risers one ledge high", () => {
    const mesh = reliefMesh(STYLES.d, massif.cells, 0)
    let risers = 0
    let flat = 0
    for (let v = 0; v < mesh.normal.length; v += 9) {
      const up = mesh.normal[v + 1] as number
      const ys = heightsOf(mesh, v)
      const rise = Math.max(...ys) - Math.min(...ys)
      if (Math.abs(up) < 1e-6 && Math.abs(rise - LEDGE_STEP) < 1e-3) risers++
      const y = ys[0] as number
      if (up > 0.999 && rise < 1e-3 && Math.abs(y / LEDGE_STEP - Math.round(y / LEDGE_STEP)) < 1e-3) flat++
    }
    expect(risers).toBeGreaterThan(100)
    expect(flat).toBeGreaterThan(100)
  })

  test("a riser is one flat colour for its whole ledge band", () => {
    const mesh = reliefMesh(STYLES.d, massif.cells, 0)
    const byBand = new Map<number, Set<string>>()
    for (let v = 0; v < mesh.normal.length; v += 9) {
      if (Math.abs(mesh.normal[v + 1] as number) > 1e-6) continue
      const ys = heightsOf(mesh, v)
      if (Math.abs(Math.max(...ys) - Math.min(...ys) - LEDGE_STEP) > 1e-3) continue
      // Rock and warm stone only: the skirts at the rim, as high as a riser, wear the tile's grass.
      const u = mesh.uv[(v / 3) * 2] as number
      if (u !== Math.fround(SWATCH.rock.u) && u !== Math.fround(SWATCH.warm.u)) continue
      const band = Math.round(Math.min(...ys) / LEDGE_STEP)
      const texel = `${u},${mesh.uv[(v / 3) * 2 + 1]}`
      byBand.set(band, (byBand.get(band) ?? new Set<string>()).add(texel))
    }
    expect(byBand.size).toBeGreaterThan(2)
    for (const colours of byBand.values()) expect(colours.size).toBe(1)
  })

  test("trees below the top ledge stand on flat ledge tops, so they sit exactly on the stairs", () => {
    let low = 0
    for (const piece of dressingOf(STYLES.d, 3)) {
      if (!piece.piece.startsWith("tree")) continue
      const ground = STYLES.d.heightAt(piece.x, piece.z)
      if (ground === undefined || ground > massif.ledgeTop + 0.01) continue
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const)
        expect(Math.abs((STYLES.d.heightAt(piece.x + dx, piece.z + dz) ?? ground) - ground)).toBeLessThan(
          0.15,
        )
      low++
    }
    expect(low).toBeGreaterThan(20)
  })

  test("it carries boulders and conifer clumps", () => {
    const dressing = dressingOf(STYLES.d, 3)
    expect(dressing.filter((p) => p.piece.startsWith("rock_single")).length).toBeGreaterThan(5)
    expect(dressing.some((p) => p.piece.startsWith("tree"))).toBe(true)
  })
})
