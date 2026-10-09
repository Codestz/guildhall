import { describe, expect, test } from "bun:test"
import { SNOW_EDGE, SNOW_WARP, snowAmount, snowWarp } from "../src/scene/terrain/snow.ts"
import { cellAt, key, neighbours } from "../src/world/gen/hex.ts"
import { islandFromTree } from "../src/world/gen/islandFromTree.ts"
import { dressingOf } from "../src/world/gen/relief/dressing.ts"
import { type MeshArrays, reliefMesh } from "../src/world/gen/relief/mesh.ts"
import { MOST_ROCK } from "../src/world/gen/relief/rockSize.ts"
import { SWATCH } from "../src/world/gen/relief/swatches.ts"
import type { RepoEntry } from "../src/world/gen/repo.ts"
import { HEX_SCALE, type LandPiece, PIECES } from "../src/world/lands.ts"
import { repoWorld } from "../src/world/world.ts"
import COCKPIT from "./fixtures/repos/codestz__opencode-cockpit.json"
import REACT from "./fixtures/repos/facebook__react.json"

/** The close-up artefacts of the relief (style d): grass islands on flanks, slivers, the snow line's edge, oversized rocks. */

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

  test("none grows on a steep face: a flank steeper than a gentle slope is rock", () => {
    // 0.05: a face with a footprint (not a riser or a curtain); 0.88: steeper than about 28 degrees.
    const steep = faces.filter((f) => f.ny > 0.05 && f.ny < 0.88)
    expect(steep.length).toBeGreaterThan(500)
    // (A rim face over land wears the hex tile's own grass to join it, whatever its slope.)
    expect(steep.filter((f) => GRASSES.includes(f.u) && f.v !== Math.fround(0.643))).toEqual([])
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
    // (The rim faces over land wear the hex tile's own grass: they join the tile, not the slope.)
    const ramp = (i: number): boolean =>
      GRASSES.includes(faces[i]!.u) &&
      faces[i]!.v !== Math.fround(0.643) &&
      faces[i]!.ny < 0.999 &&
      faces[i]!.ny > 0.05
    const seen = new Set<number>()
    let patches = 0
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
      patches++
      if (!anchored && run.length < 6) speckles++
    })
    expect(patches).toBeGreaterThan(5)
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
          // The ground (a footprint), in a hex whose six neighbours are all the massif's: not its rim or a riser.
          const [x, z] = [0, 2].map((k) => f.corners.reduce((sum, c) => sum + c[k]!, 0) / 3) as [
            number,
            number,
          ]
          const cell = cellAt([x, z])
          if (
            f.ny < 0.02 ||
            !massif.keys.has(key(cell)) ||
            !neighbours(cell).every((c) => massif.keys.has(key(c)))
          )
            continue
          faces++
          expect(f.aspect).toBeLessThanOrEqual(8)
          if (f.aspect > 6) long++
        }
      }
      expect(faces).toBeGreaterThan(1000)
      expect(long / faces).toBeLessThan(0.002)
    })
  }
})

describe("the snow line", () => {
  const line = 30
  const flat = 1

  test("is one smooth rise with height: no step between a point and one a hair above it", () => {
    let before = 0
    for (let y = line - 6; y <= line + 6; y += 0.05) {
      const here = snowAmount(line, 10, y, 20, flat)
      expect(here).toBeGreaterThanOrEqual(before - 1e-9)
      expect(here - before).toBeLessThan(0.05)
      before = here
    }
  })

  test("is bare below its soft edge and white above the line, a band of its edge's width in between", () => {
    expect(snowAmount(line, 3, line - SNOW_EDGE - SNOW_WARP - 0.01, 8, flat)).toBe(0)
    expect(snowAmount(line, 3, line + SNOW_WARP + 0.01, 8, flat)).toBe(1)
  })

  test("is warped by a slow wave, within the warp, so the line is a natural edge rather than a level cut", () => {
    const pushes = Array.from({ length: 200 }, (_, k) => snowWarp(k * 1.7, k * 0.9))
    expect(Math.max(...pushes)).toBeLessThanOrEqual(SNOW_WARP)
    expect(Math.min(...pushes)).toBeGreaterThanOrEqual(-SNOW_WARP)
    expect(Math.max(...pushes) - Math.min(...pushes)).toBeGreaterThan(SNOW_WARP)
    // Slow: two points a unit apart are pushed alike.
    expect(Math.abs(snowWarp(5, 5) - snowWarp(6, 5))).toBeLessThan(0.7)
  })

  test("settles on a surface facing up and not on a wall, at any height", () => {
    expect(snowAmount(line, 0, line + 20, 0, 0)).toBe(0)
    expect(snowAmount(line, 0, line + 20, 0, 1)).toBe(1)
    expect(snowAmount(line, 0, line + 20, 0, 0.5)).toBeGreaterThan(0)
    expect(snowAmount(line, 0, line + 20, 0, 0.5)).toBeLessThan(1)
  })
})

describe("the rocks on the mountain stand no bigger than a house and a half", () => {
  for (const [name, world] of Object.entries({ city: CITY, town: TOWN })) {
    test(`${name}: every rock and crag is at most ${MOST_ROCK} units across, and none is a pebble`, () => {
      const relief = world.relief!
      const rocks = dressingOf(relief, 3).filter(
        (p) => p.piece.startsWith("rock_single") || p.piece.startsWith("mountain_"),
      )
      expect(rocks.length).toBeGreaterThan(10)
      for (const rock of rocks) {
        const [width, , depth] = PIECES[rock.piece as LandPiece].size as [number, number, number]
        expect(Math.max(width, depth) * HEX_SCALE * (rock.scale ?? 1)).toBeLessThanOrEqual(MOST_ROCK + 1e-6)
        expect(rock.scale ?? 1).toBeGreaterThan(0.4)
      }
    })
  }
})
