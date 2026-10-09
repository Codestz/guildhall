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
const STYLES = { a: reliefIn("a"), b: reliefIn("b"), c: reliefIn("c") }
const trianglesOf = (relief: Relief): number =>
  relief.massifs.reduce((sum, m) => sum + reliefMesh(relief, m.cells, 0).position.length / 9, 0)

describe("the style a link asks for", () => {
  test("a, b and c are understood; anything else is the default", () => {
    expect(["?relief=a", "?relief=b", "?relief=c"].map(reliefStyleOf)).toEqual(["a", "b", "c"])
    expect(["", "?relief=d", "?relief=A", "?relief="].map(reliefStyleOf)).toEqual([
      "current",
      "current",
      "current",
      "current",
    ])
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
          expect(mesh.position[v + k + 1] as number).toBeCloseTo(ground, 3)
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

describe("c: sculpted peaks and kit dressing", () => {
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
