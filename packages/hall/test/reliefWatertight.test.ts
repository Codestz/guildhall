import { describe, expect, test } from "bun:test"
import { chunksOf } from "../src/world/chunks.ts"
import { cellAt, key } from "../src/world/gen/hex.ts"
import { islandFromTree } from "../src/world/gen/islandFromTree.ts"
import type { MeshArrays } from "../src/world/gen/relief/mesh.ts"
import { reliefMesh } from "../src/world/gen/relief/mesh.ts"
import type { RepoEntry } from "../src/world/gen/repo.ts"
import { reliefCells } from "../src/world/reliefChunks.ts"
import { repoWorld } from "../src/world/world.ts"
import COCKPIT from "./fixtures/repos/codestz__opencode-cockpit.json"
import REACT from "./fixtures/repos/facebook__react.json"
import SELF from "./fixtures/repos/guildhall.json"

/**
 * The relief's mesh is watertight inside a massif: stairs, ramps, trails, rivers' hexes and the
 * lattice changes between hexes all meet along shared edges, so no crack shows the sky through a
 * cliff face. Only the rim of a hex set may have open edges (the skirts hang there).
 */

const worldOf = (entries: unknown) =>
  repoWorld(islandFromTree(entries as RepoEntry[], 0, 2), {
    repo: "fixture/x",
    source: "fixture",
    gen: 2,
  } as never)
const WORLDS = {
  city: worldOf(REACT.entries),
  town: worldOf(COCKPIT.entries),
  village: worldOf(SELF.entries),
}

const quant = (n: number): number => Math.round(n * 200)
const id = (m: MeshArrays, t: number, k: number): string =>
  `${quant(m.position[t * 9 + k * 3] as number)},${quant(m.position[t * 9 + k * 3 + 1] as number)},${quant(m.position[t * 9 + k * 3 + 2] as number)}`

/** How many triangles use each edge (keyed by its two quantised endpoints). */
function edgeUses(mesh: MeshArrays): Map<string, number> {
  const uses = new Map<string, number>()
  for (let t = 0; t < mesh.position.length / 9; t++)
    for (let k = 0; k < 3; k++) {
      const [a, b] = [id(mesh, t, k), id(mesh, t, (k + 1) % 3)]
      if (a === b) continue
      const edge = a < b ? `${a}|${b}` : `${b}|${a}`
      uses.set(edge, (uses.get(edge) ?? 0) + 1)
    }
  return uses
}

/**
 * Whether an edge lies on the rim of the hex set: its two sides, a hair off, are a hex in the set and one outside.
 * With `beyond`, only where the hex outside is one of those (a seam with another set, not the massif's own rim).
 */
function onRim(edge: string, set: ReadonlySet<string>, beyond?: ReadonlySet<string>): boolean {
  const [a, b] = edge.split("|").map((p) => p.split(",").map((n) => Number(n) / 200)) as [number[], number[]]
  const [dx, dz] = [(b[0] as number) - (a[0] as number), (b[2] as number) - (a[2] as number)]
  const length = Math.hypot(dx, dz)
  const [mx, mz] = [((a[0] as number) + (b[0] as number)) / 2, ((a[2] as number) + (b[2] as number)) / 2]
  // A vertical edge stands on the rim when hexes on both sides of its foot differ.
  if (length < 1e-6) {
    const around = [0, 1, 2, 3, 4, 5].map((k) =>
      set.has(
        key(cellAt([mx + 0.05 * Math.cos((k * Math.PI) / 3), mz + 0.05 * Math.sin((k * Math.PI) / 3)])),
      ),
    )
    return around.some(Boolean) && !around.every(Boolean)
  }
  const [nx, nz] = [(-dz / length) * 0.05, (dx / length) * 0.05]
  const [one, two] = [key(cellAt([mx + nx, mz + nz])), key(cellAt([mx - nx, mz - nz]))]
  if (set.has(one) === set.has(two)) return false
  return !beyond || beyond.has(set.has(one) ? two : one)
}

/** The edges inside the set that one triangle uses (a crack) and the ones three or more use (a fold). */
function defects(
  mesh: MeshArrays,
  cells: readonly (readonly [number, number])[],
): { open: string[]; folded: string[] } {
  const set = new Set(cells.map(key))
  const open: string[] = []
  const folded: string[] = []
  for (const [edge, n] of edgeUses(mesh)) {
    if (n === 1 && !onRim(edge, set)) open.push(edge)
    if (n > 2) folded.push(edge)
  }
  return { open, folded }
}

describe("the relief mesh is watertight inside a massif", () => {
  for (const [name, world] of Object.entries(WORLDS)) {
    const relief = world.relief
    if (!relief) throw new Error(`${name} has no relief`)
    test(`${name}: every massif at the finest tier, with its rivers and trails carved`, () => {
      for (const massif of relief.massifs) {
        const { open, folded } = defects(reliefMesh(relief, massif.cells, 0), massif.cells)
        expect(open.slice(0, 5)).toEqual([])
        expect(folded.slice(0, 5)).toEqual([])
      }
    })

    test(`${name}: a massif cut across its regions, each region on its own`, () => {
      const chunks = chunksOf(world)
      for (const cells of reliefCells(relief, chunks)) {
        if (cells.length === 0) continue
        const { open, folded } = defects(reliefMesh(relief, cells, 0), cells)
        expect(open.slice(0, 5)).toEqual([])
        expect(folded.slice(0, 5)).toEqual([])
      }
    })

    test(`${name}: the far tier, whole`, () => {
      for (const massif of relief.massifs) {
        const { open, folded } = defects(reliefMesh(relief, massif.cells, 2), massif.cells)
        expect(open.slice(0, 5)).toEqual([])
        expect(folded.slice(0, 5)).toEqual([])
      }
    })
  }

  test("two regions of one massif agree along their shared edge: the very same edges, so no crack and no skirt is needed", () => {
    const relief = WORLDS.city.relief
    if (!relief) throw new Error("no relief")
    const cut = reliefCells(relief, chunksOf(WORLDS.city)).filter((cells) => cells.length > 0)
    const whole = new Set<string>()
    for (const massif of relief.massifs)
      for (const e of edgeUses(reliefMesh(relief, massif.cells, 0)).keys()) whole.add(e)
    let checked = 0
    for (const cells of cut) {
      const set = new Set(cells.map(key))
      const uses = edgeUses(reliefMesh(relief, cells, 0))
      // A skirt's bottom edge is its top edge dropped a few units.
      const dropped = (edge: string, by: number): string =>
        edge
          .split("|")
          .map((p) => p.split(",").map(Number))
          .map(([x, y, z]) => [x, (y as number) + by * 200, z].join(","))
          .sort()
          .join("|")
      for (const [edge, n] of uses) {
        // The set's edge with the next region beyond it (not the massif's own rim, where a skirt hangs).
        if (n !== 1 || !onRim(edge, set, relief.keys)) continue
        const [a, b] = edge.split("|").map((p) => p.split(",")) as [string[], string[]]
        if (a[0] === b[0] && a[2] === b[2]) continue
        if (uses.has(dropped(edge, 3)) || uses.has(dropped(edge, 5))) continue
        checked++
        expect(whole.has(edge)).toBe(true)
      }
    }
    expect(checked).toBeGreaterThan(100)
  })
})
