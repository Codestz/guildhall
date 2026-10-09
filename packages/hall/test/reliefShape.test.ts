import { describe, expect, test } from "bun:test"
import { cellAt, key } from "../src/world/gen/hex.ts"
import { islandFromTree } from "../src/world/gen/islandFromTree.ts"
import { dressingOf } from "../src/world/gen/relief/dressing.ts"
import { reliefOf } from "../src/world/gen/relief/index.ts"
import { reliefMesh } from "../src/world/gen/relief/mesh.ts"
import { LEDGE_STEP } from "../src/world/gen/relief/shape.ts"
import { SWATCH } from "../src/world/gen/relief/swatches.ts"
import type { RepoEntry } from "../src/world/gen/repo.ts"
import REACT from "./fixtures/repos/facebook__react.json"

/** The relief's shape (world/gen/relief/shape.ts): stairs below the top ledge, a faceted peak above, the kit's dressing. */

const CITY = islandFromTree(REACT.entries as RepoEntry[], 0, 2)
const RELIEF = reliefOf({ plan: CITY.plan, level: (cell) => CITY.levels.get(key(cell)) ?? 0 })
const massif = RELIEF.massifs[0]
if (!massif) throw new Error("no massif")

describe("the relief", () => {
  test("every top vertex of the mesh stands within half a ledge of the ground walkers read", () => {
    const mesh = reliefMesh(RELIEF, massif.cells, 0)
    let checked = 0
    for (let v = 0; v < mesh.position.length; v += 9) {
      // The first face's vertices of every triangle; skirts hang below the ground and are skipped.
      if ((mesh.normal[v + 1] as number) <= 0.01) continue
      for (let k = 0; k < 9; k += 3) {
        const ground = RELIEF.heightAt(mesh.position[v + k] as number, mesh.position[v + k + 2] as number)
        if (ground === undefined) continue
        expect(Math.abs((mesh.position[v + k + 1] as number) - ground)).toBeLessThanOrEqual(
          LEDGE_STEP / 2 + 1e-3,
        )
        checked++
      }
    }
    expect(checked).toBeGreaterThan(100)
  })

  test("the seam with the hex ground is the tile's own grass (rim faces and skirts)", () => {
    const mesh = reliefMesh(RELIEF, massif.cells, 0)
    let grass = 0
    for (let v = 0; v < mesh.uv.length; v += 2)
      if (mesh.uv[v] === Math.fround(SWATCH.grass.u) && mesh.uv[v + 1] === Math.fround(0.643)) grass++
    expect(grass).toBeGreaterThan(30)
  })
})

describe("the stairs and the peak", () => {
  const heightsOf = (mesh: { position: Float32Array }, v: number): number[] =>
    [1, 4, 7].map((k) => mesh.position[v + k] as number)

  test("a top ledge, with the faceted peak standing above it", () => {
    expect(massif.ledgeTop).toBeGreaterThanOrEqual(LEDGE_STEP)
    expect(massif.ledgeTop % LEDGE_STEP).toBe(0)
    expect(RELIEF.massifs.every((m) => m.height > m.ledgeTop)).toBe(true)
  })

  test("the ledges are stairs: flat tops on ledge heights and vertical risers one ledge high", () => {
    const mesh = reliefMesh(RELIEF, massif.cells, 0)
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

  test("a riser is one swatch for its ledge band, dark at its foot and light along its lip", () => {
    const mesh = reliefMesh(RELIEF, massif.cells, 0)
    const swatches = new Map<number, Set<number>>()
    const foot: number[] = []
    const lip: number[] = []
    let n = 0
    for (let v = 0; v < mesh.normal.length; v += 9) {
      if (Math.abs(mesh.normal[v + 1] as number) > 1e-6) continue
      const ys = heightsOf(mesh, v)
      if (Math.abs(Math.max(...ys) - Math.min(...ys) - LEDGE_STEP) > 1e-3) continue
      // Rock and warm stone only: the skirts at the rim, as high as a riser, wear the tile's grass.
      const u = mesh.uv[(v / 3) * 2] as number
      if (u !== Math.fround(SWATCH.rock.u) && u !== Math.fround(SWATCH.warm.u)) continue
      const band = Math.round(Math.min(...ys) / LEDGE_STEP)
      swatches.set(band, (swatches.get(band) ?? new Set<number>()).add(u))
      // The strip's v grows towards its dark end.
      const low = Math.min(...ys)
      for (let k = 0; k < 3; k++) {
        const along = (ys[k] as number) - low
        if (along < 1e-3) foot.push(mesh.uv[(v / 3 + k) * 2 + 1] as number)
        if (along > LEDGE_STEP - 1e-3) lip.push(mesh.uv[(v / 3 + k) * 2 + 1] as number)
      }
      n++
    }
    expect(swatches.size).toBeGreaterThan(2)
    for (const us of swatches.values()) expect(us.size).toBe(1)
    const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length
    expect(mean(foot)).toBeGreaterThan(mean(lip))
    expect(n).toBeGreaterThan(100)
  })

  test("trees below the top ledge stand on flat ledge tops, so they sit exactly on the stairs", () => {
    let low = 0
    for (const piece of dressingOf(RELIEF, 3)) {
      if (!piece.piece.startsWith("tree")) continue
      const ground = RELIEF.heightAt(piece.x, piece.z)
      const own = RELIEF.massifAt(cellAt([piece.x, piece.z]))
      if (ground === undefined || !own || ground > own.ledgeTop + 0.01) continue
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const)
        expect(Math.abs((RELIEF.heightAt(piece.x + dx, piece.z + dz) ?? ground) - ground)).toBeLessThan(0.15)
      low++
    }
    expect(low).toBeGreaterThan(20)
  })

  test("it carries boulders and conifer clumps", () => {
    const dressing = dressingOf(RELIEF, 3)
    expect(dressing.filter((p) => p.piece.startsWith("rock_single")).length).toBeGreaterThan(5)
    expect(dressing.some((p) => p.piece.startsWith("tree"))).toBe(true)
  })
})
