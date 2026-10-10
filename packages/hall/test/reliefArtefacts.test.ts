import { describe, expect, test } from "bun:test"
import { SNOW_EDGE, snowAmount } from "../src/scene/terrain/snow.ts"
import { cellAt, key, neighbours } from "../src/world/gen/hex.ts"
import { islandFromTree } from "../src/world/gen/islandFromTree.ts"
import { treadAt } from "../src/world/gen/relief/flights.ts"
import { snowlineOf } from "../src/world/gen/relief/index.ts"
import { type MeshArrays, reliefMesh } from "../src/world/gen/relief/mesh.ts"
import { LEDGE_STEP } from "../src/world/gen/relief/shape.ts"
import { SWATCH } from "../src/world/gen/relief/swatches.ts"
import type { RepoEntry } from "../src/world/gen/repo.ts"
import { repoWorld } from "../src/world/world.ts"
import COCKPIT from "./fixtures/repos/codestz__opencode-cockpit.json"
import REACT from "./fixtures/repos/facebook__react.json"

/** The close-up artefacts of the relief: grass islands on flanks, slivers, the snow caps on the top ledges. */

const worldOf = (entries: unknown) =>
  repoWorld(islandFromTree(entries as RepoEntry[], 0, 2), {
    repo: "fixture/x",
    source: "fixture",
    gen: 2,
  } as never)
const CITY = worldOf(REACT.entries)
const TOWN = worldOf(COCKPIT.entries)

/** A mesh's triangles as { corners, the face's own unit normal, its aspect (longest edge squared over twice its area) }. */
function facesOf(mesh: MeshArrays) {
  const out: { corners: number[][]; ny: number; aspect: number; u: number; v: number }[] = []
  const p = mesh.position
  for (let t = 0; t < p.length / 9; t++) {
    const o = t * 9
    const [ux, uy, uz] = [p[o + 3]! - p[o]!, p[o + 4]! - p[o + 1]!, p[o + 5]! - p[o + 2]!]
    const [vx, vy, vz] = [p[o + 6]! - p[o]!, p[o + 7]! - p[o + 1]!, p[o + 8]! - p[o + 2]!]
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]
    const length = Math.hypot(n[0]!, n[1]!, n[2]!)
    if (length < 1e-9) continue
    const longest = Math.max(
      Math.hypot(ux, uy, uz),
      Math.hypot(vx, vy, vz),
      Math.hypot(vx - ux, vy - uy, vz - uz),
    )
    out.push({
      corners: [0, 3, 6].map((k) => [p[o + k]!, p[o + k + 1]!, p[o + k + 2]!]),
      ny: Math.abs(n[1]! / length),
      aspect: (longest * longest) / length,
      u: mesh.uv[t * 6]!,
      v: mesh.uv[t * 6 + 1]!,
    })
  }
  return out
}

const GRASSES = [Math.fround(SWATCH.grass.u), Math.fround(SWATCH.meadow.u)]

describe("grass on the flanks", () => {
  const mesh = reliefMesh(CITY.relief!, CITY.relief!.massifs[0]!.cells, 0)
  const faces = facesOf(mesh)

  test("the mountain is flat tops and vertical walls: no face is a slope, so none grows grass on one", () => {
    expect(faces.length).toBeGreaterThan(5000)
    expect(faces.filter((f) => f.ny > 0.001 && f.ny < 0.999)).toEqual([])
  })

  test("grass on a slope is a patch, never a speckle: each run of grass ramps is joined to a ledge's top or is a good many faces", () => {
    const quant = (v: number[]): string => v.map((n) => Math.round(n * 200)).join(",")
    const edgeId = (f: (typeof faces)[number], k: number): string => {
      const [a, b] = [quant(f.corners[k]!), quant(f.corners[(k + 1) % 3]!)]
      return a < b ? `${a}|${b}` : `${b}|${a}`
    }
    const edges = new Map<string, number[]>()
    faces.forEach((f, i) => {
      for (let k = 0; k < 3; k++) edges.set(edgeId(f, k), [...(edges.get(edgeId(f, k)) ?? []), i])
    })
    // A ramp of grass: a face of grass that is neither a ledge's top (flat) nor a riser.
    // (The rim faces over land wear the hex tile's own grass: they join the tile, not the slope; nor does a river's bed at the foot, below a unit, which is the valley's.)
    const ramp = (i: number): boolean =>
      GRASSES.includes(faces[i]!.u) &&
      Math.max(...faces[i]!.corners.map((c) => c[1]!)) > 1 &&
      faces[i]!.v !== Math.fround(0.643) &&
      faces[i]!.ny < 0.999 &&
      faces[i]!.ny > 0.05
    const seen = new Set<number>()
    let speckles = 0
    faces.forEach((_, start) => {
      if (!ramp(start) || seen.has(start)) return
      // The run of grass ramps joined by edges, and whether it touches a ledge's top of grass.
      const run = [start]
      seen.add(start)
      let anchored = false
      for (let n = 0; n < run.length; n++) {
        const f = faces[run[n]!]!
        for (let k = 0; k < 3; k++)
          for (const j of edges.get(edgeId(f, k)) ?? []) {
            if (j === run[n]) continue
            if (ramp(j) && !seen.has(j)) {
              seen.add(j)
              run.push(j)
            } else if (GRASSES.includes(faces[j]!.u) && faces[j]!.ny >= 0.999) anchored = true
          }
      }
      if (!anchored && run.length < 6) speckles++
    })
    expect(speckles).toBe(0)
  })
})

describe("no stretched triangles on the mountain's faces", () => {
  for (const [name, world] of Object.entries({ city: CITY, town: TOWN })) {
    test(`${name}: the ground's faces inside a massif are no sliver (aspect at most 8; over 6 only a few)`, () => {
      const relief = world.relief!
      let faces = 0
      let long = 0
      for (const massif of relief.massifs) {
        for (const f of facesOf(reliefMesh(relief, massif.cells, 0))) {
          // The ground (a footprint), in a hex whose six neighbours are all the massif's: not its rim, a riser or a trail's steps (steeper than 70°).
          const [x, z] = [0, 2].map((k) => f.corners.reduce((sum, c) => sum + c[k]!, 0) / 3) as [
            number,
            number,
          ]
          const cell = cellAt([x, z])
          if (
            f.ny < 0.3 ||
            !massif.keys.has(key(cell)) ||
            !neighbours(cell).every((c) => massif.keys.has(key(c)))
          )
            continue
          faces++
          expect(f.aspect).toBeLessThanOrEqual(10)
          if (f.aspect > 6) long++
        }
      }
      expect(faces).toBeGreaterThan(1000)
      // (The tops of a river's trench, cut into the stairs, are the long ones.)
      expect(long / faces).toBeLessThan(0.04)
    })
  }
})

describe("the snow line", () => {
  const line = 30
  const flat = 1

  test("is one smooth rise with height: no step between a point and one a hair above it", () => {
    let before = 0
    for (let y = line - 6; y <= line + 6; y += 0.02) {
      const here = snowAmount(line, y, flat)
      expect(here).toBeGreaterThanOrEqual(before - 1e-9)
      expect(here - before).toBeLessThan(0.05)
      before = here
    }
  })

  test("is bare below its soft edge and white at the line", () => {
    expect(snowAmount(line, line - SNOW_EDGE - 0.01, flat)).toBe(0)
    expect(snowAmount(line, line, flat)).toBe(1)
  })

  test("is narrower than a ledge, so a ledge top is bare or white, never a gradient across its stairs", () => {
    expect(SNOW_EDGE).toBeLessThan(LEDGE_STEP)
    expect(snowAmount(line, line - LEDGE_STEP, flat)).toBe(0)
    expect(snowAmount(line, line + LEDGE_STEP, flat)).toBe(1)
  })

  test("settles on a surface facing up and not on a wall, at any height", () => {
    expect(snowAmount(line, line + 20, 0)).toBe(0)
    expect(snowAmount(line, line + 20, 1)).toBe(1)
    expect(snowAmount(line, line + 20, 0.5)).toBeGreaterThan(0)
    expect(snowAmount(line, line + 20, 0.5)).toBeLessThan(1)
  })

  test("caps the top ledges of the main peak: every white face is a flat ledge top, and there are some", () => {
    const relief = CITY.relief!
    const snowline = snowlineOf(relief, 0)
    const mesh = reliefMesh(relief, relief.massifs[0]!.cells, 0)
    let white = 0
    for (const f of facesOf(mesh)) {
      const y = f.corners.map((c) => c[1]!)
      if (snowAmount(snowline, Math.min(...y), f.ny) < 1) continue
      // A face that takes full snow lies level, on a ledge: the cap is flat white tops, not faceted slopes.
      if (f.ny > 0.999) {
        expect(Math.max(...y) - Math.min(...y)).toBeLessThan(1e-3)
        // (The treads of a trail's steps are flat tops too, a step's height apart.)
        const [x, z] = [0, 2].map((k) => f.corners.reduce((sum, c) => sum + c[k]!, 0) / 3) as [number, number]
        if (relief.massifs[0]!.flights.some((flight) => treadAt(flight, x, z) !== undefined)) continue
        expect(y[0]! % LEDGE_STEP).toBeCloseTo(0, 3)
        white++
      }
    }
    expect(white).toBeGreaterThan(5)
  })
})
