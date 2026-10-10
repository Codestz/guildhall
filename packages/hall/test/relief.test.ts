import { describe, expect, test } from "bun:test"
import { cellAt, key, neighbours, step, unkey } from "../src/world/gen/hex.ts"
import { islandFromTree } from "../src/world/gen/islandFromTree.ts"
import {
  CAP,
  peakHeight,
  type Relief,
  reliefOf,
  SEA_RIM,
  snowlineOf,
  tierOf,
} from "../src/world/gen/relief/index.ts"
import { CIRCUM, CORNERS, centreOf, pointOf, RES } from "../src/world/gen/relief/lattice.ts"
import { SITE_REACH } from "../src/world/gen/relief/massifs.ts"
import { reliefMesh } from "../src/world/gen/relief/mesh.ts"
import { LEDGE_STEP } from "../src/world/gen/relief/shape.ts"
import { SWATCH } from "../src/world/gen/relief/swatches.ts"
import type { RepoEntry } from "../src/world/gen/repo.ts"
import { cellToWorld } from "../src/world/lands.ts"
import { TERRACE } from "../src/world/waterways.ts"
import { handWorld, repoWorld } from "../src/world/world.ts"
import COCKPIT from "./fixtures/repos/codestz__opencode-cockpit.json"
import REACT from "./fixtures/repos/facebook__react.json"
import SELF from "./fixtures/repos/guildhall.json"
import IS_ODD from "./fixtures/repos/jonschlinkert__is-odd.json"

/** The relief generator (world/gen/relief): terrain v2 slice 2a, on a City, a Town, a Village and a Hamlet. */

const made = (entries: unknown) => islandFromTree(entries as RepoEntry[], 0, 2)
const reliefFor = (island: ReturnType<typeof made>): Relief =>
  reliefOf({ plan: island.plan, level: (cell) => island.levels.get(key(cell)) ?? 0 })

const CITY = made(REACT.entries)
const TOWN = made(COCKPIT.entries)
const VILLAGE = made(SELF.entries)
const HAMLET = made(IS_ODD.entries)
const ISLANDS = { city: CITY, town: TOWN, village: VILLAGE }
const RELIEFS = { city: reliefFor(CITY), town: reliefFor(TOWN), village: reliefFor(VILLAGE) }
const [CITY_RELIEF, TOWN_RELIEF] = [RELIEFS.city, RELIEFS.town]

describe("tiers and peak heights", () => {
  test("a repo's tier follows its files, and caps its peak at 60 / 40 / 22 (a hamlet has hills only)", () => {
    expect([10, 49, 50, 499, 500, 2999, 3000].map(tierOf)).toEqual([
      "hamlet",
      "hamlet",
      "village",
      "village",
      "town",
      "town",
      "city",
    ])
    expect(CAP).toEqual({ hamlet: 0, village: 22, town: 40, city: 60 })
    expect(RELIEFS.city.tier).toBe("city")
    expect(RELIEFS.town.tier).toBe("town")
    expect(RELIEFS.village.tier).toBe("village")
  })

  test("a peak grows with its files and its years, never past its tier's cap", () => {
    expect(peakHeight("city", 50, 0)).toBeCloseTo(16, 5)
    expect(peakHeight("city", 2000, 13)).toBeGreaterThan(peakHeight("city", 2000, 0))
    expect(peakHeight("city", 2000, 13)).toBeGreaterThan(peakHeight("city", 200, 13))
    expect(peakHeight("city", 1e9, 100)).toBe(60)
    expect(peakHeight("town", 1e9, 100)).toBe(40)
    expect(peakHeight("village", 1e9, 100)).toBe(22)
  })

  test("a hamlet grows no massif", () => {
    expect(reliefFor(HAMLET).massifs).toHaveLength(0)
  })
})

describe("massifs", () => {
  test("every size has its range, and a City's main range is a real mountain", () => {
    for (const relief of Object.values(RELIEFS)) expect(relief.massifs.length).toBeGreaterThan(0)
    const main = CITY_RELIEF.massifs[0]
    expect(main?.height).toBeGreaterThanOrEqual(7 * LEDGE_STEP)
    expect(main?.height).toBeLessThanOrEqual(CAP.city)
    expect(main?.cells.length).toBeGreaterThan(100)
  })

  test("no peak is taller than its tier's cap", () => {
    for (const relief of Object.values(RELIEFS))
      for (const massif of relief.massifs) expect(massif.height).toBeLessThanOrEqual(CAP[relief.tier] + 1.3)
  })

  test("the same plan grows the same mountains, bit for bit", () => {
    const again = reliefFor(CITY)
    expect(again.massifs.map((m) => m.cells)).toEqual(CITY_RELIEF.massifs.map((m) => m.cells))
    expect(again.massifs.map((m) => [...m.grid.data])).toEqual(
      CITY_RELIEF.massifs.map((m) => [...m.grid.data]),
    )
  })

  test("they never take the keep, a road, a lot, a site or a field, and stay clear of the keep", () => {
    for (const [name, island] of Object.entries(ISLANDS)) {
      const relief = RELIEFS[name as keyof typeof RELIEFS]
      const extent = Math.max(
        ...[...island.plan.land.keys()].map((id) => Math.hypot(...cellToWorld(unkey(id)))),
      )
      for (const id of relief.keys) {
        const hex = island.plan.land.get(id)
        expect(hex).toBeDefined()
        expect("=KVvswd").not.toContain(hex?.char ?? "=")
        const [x, z] = cellToWorld(unkey(id))
        expect(Math.hypot(x, z)).toBeGreaterThanOrEqual(Math.min(SITE_REACH, 0.4 * extent) - 1e-6)
      }
    }
  })

  test("every district keeps at least 40% of its hexes off the massifs", () => {
    for (const [name, island] of Object.entries(ISLANDS)) {
      const relief = RELIEFS[name as keyof typeof RELIEFS]
      island.plan.districts.forEach((district, i) => {
        let held = 0
        for (const id of relief.keys) if (island.plan.land.get(id)?.district === i) held++
        expect(held).toBeLessThanOrEqual(Math.ceil(district.hexes * 0.6) + 1)
      })
    }
  })

  test("two massifs never touch", () => {
    for (const relief of Object.values(RELIEFS))
      for (const massif of relief.massifs)
        for (const cell of massif.cells)
          for (const next of neighbours(cell)) {
            const other = relief.massifAt(next)
            expect(other === undefined || other === massif).toBe(true)
          }
  })

  test("a City's main range has ridges, passes and more than one peak", () => {
    const main = CITY_RELIEF.massifs[0]
    expect(main?.peaks.length).toBeGreaterThan(1)
    expect(main?.ridges.length).toBeGreaterThanOrEqual(main?.peaks.length ?? 99)
    expect(main?.saddles.length).toBeGreaterThanOrEqual(2)
  })

  test("every saddle lies lower than both peaks it joins (a pass between two summits)", () => {
    for (const relief of Object.values(RELIEFS))
      for (const massif of relief.massifs)
        for (const saddle of massif.saddles) {
          const [a, b] = saddle.between
          expect(saddle.height).toBeLessThan(
            Math.min(massif.peaks[a]?.height ?? 0, massif.peaks[b]?.height ?? 0),
          )
        }
  })

  test("the main peak stands where the ground says it does", () => {
    for (const relief of Object.values(RELIEFS)) {
      const main = relief.massifs[0]
      const peak = main?.peaks[0]
      expect(peak).toBeDefined()
      expect(relief.heightAt(peak?.at[0] ?? 0, peak?.at[1] ?? 0)).toBeGreaterThan((main?.height ?? 0) - 2.5)
    }
  })
})

describe("the ground", () => {
  test("a massif's rim meets its neighbours exactly: their top, or the sea cliff's below the waterline", () => {
    for (const [name, island] of Object.entries(ISLANDS)) {
      const relief = RELIEFS[name as keyof typeof RELIEFS]
      for (const massif of relief.massifs)
        for (const cell of massif.cells)
          for (let d = 0; d < 6; d++) {
            const next = step(cell, d)
            if (massif.keys.has(key(next))) continue
            const top = island.plan.land.has(key(next))
              ? (island.levels.get(key(next)) ?? 0) * TERRACE
              : SEA_RIM
            const [ci, cj] = centreOf(cell)
            const [ai, aj] = CORNERS[d] as readonly [number, number]
            const [bi, bj] = CORNERS[(d + 1) % 6] as readonly [number, number]
            for (let a = 0; a <= RES; a++) {
              const h = massif.grid.get(ci + (RES - a) * ai + a * bi, cj + (RES - a) * aj + a * bj)
              // Along the edge it is the neighbour's top; a corner shared with a lower hex takes that one.
              if (a > 0 && a < RES) expect(h).toBeCloseTo(top, 4)
              else expect(h).toBeLessThanOrEqual(top + 1e-4)
            }
          }
    }
  })

  test("heightAt is exact at a lattice vertex and blends linearly inside its triangle", () => {
    const massif = CITY_RELIEF.massifs[0]
    if (!massif) throw new Error("no massif")
    const cell = massif.cells[Math.floor(massif.cells.length / 2)] as readonly [number, number]
    const [ci, cj] = centreOf(cell)
    const h = (i: number, j: number) => massif.grid.get(i, j)
    const [x, z] = pointOf(ci, cj)
    expect(massif.grid.heightAt(x, z)).toBeCloseTo(h(ci, cj), 4)
    // The centroid of the up triangle (ci, cj), (ci + 1, cj), (ci, cj + 1).
    const [x1, z1] = pointOf(ci + 1, cj)
    const [x2, z2] = pointOf(ci, cj + 1)
    expect(massif.grid.heightAt((x + x1 + x2) / 3, (z + z1 + z2) / 3)).toBeCloseTo(
      (h(ci, cj) + h(ci + 1, cj) + h(ci, cj + 1)) / 3,
      4,
    )
    // The other triangle of the rhombus: (ci + 1, cj + 1), (ci + 1, cj), (ci, cj + 1).
    const [x3, z3] = pointOf(ci + 1, cj + 1)
    expect(massif.grid.heightAt((x3 + x1 + x2) / 3, (z3 + z1 + z2) / 3)).toBeCloseTo(
      (h(ci + 1, cj + 1) + h(ci + 1, cj) + h(ci, cj + 1)) / 3,
      4,
    )
  })

  test("heightAt answers nothing off the massifs, where the hex terrace holds the ground", () => {
    expect(CITY_RELIEF.heightAt(0, 0)).toBeUndefined()
    expect(CITY_RELIEF.heightAt(1e5, 1e5)).toBeUndefined()
  })

  test("no flank is steeper than a climbable crag (65°), so a trail can follow it", () => {
    const pitch = CIRCUM / RES
    for (const relief of Object.values(RELIEFS))
      for (const { grid } of relief.massifs)
        for (let j = grid.j0; j < grid.j0 + grid.height - 1; j++)
          for (let i = grid.i0; i < grid.i0 + grid.width - 1; i++) {
            const here = grid.get(i, j)
            for (const next of [grid.get(i + 1, j), grid.get(i, j + 1)])
              if (!Number.isNaN(here) && !Number.isNaN(next))
                // The rim's own step to the hex beside it (up to 5 units of terrace) is the one cliff.
                expect(Math.abs(here - next) / pitch).toBeLessThan(5 / pitch + 1e-6)
          }
  })

  test("the strata pull interior heights onto TERRACE ledges: gentle ground sits near one more often than chance", () => {
    const massif = CITY_RELIEF.massifs[0]
    if (!massif) throw new Error("no massif")
    let near = 0
    let total = 0
    for (const h of massif.grid.data) {
      if (Number.isNaN(h) || h < TERRACE) continue
      total++
      const off = Math.abs(h - Math.round(h / TERRACE) * TERRACE)
      if (off < TERRACE * 0.2) near++
    }
    // Chance would put 40% within 0.2 of a ledge.
    expect(near / total).toBeGreaterThan(0.45)
  })
})

describe("the mesh", () => {
  const massif = CITY_RELIEF.massifs[0]
  if (!massif) throw new Error("no massif")
  const cells = massif.cells
  const boundary = (cs: readonly (readonly [number, number])[]): number => {
    const set = new Set(cs.map(key))
    let edges = 0
    for (const cell of cs) for (let d = 0; d < 6; d++) if (!set.has(key(step(cell, d)))) edges++
    return edges
  }

  test("each tier has its triangles: a hex at least 6·n² at its tier (24 at the finest, 24, 6) plus the skirts, and fewer the further", () => {
    const counts = ([0, 1, 2] as const).map((tier) => {
      const n = Math.min(RES >> tier, RES / 2)
      const mesh = reliefMesh(CITY_RELIEF, cells, tier)
      // The stairs cut a ledge's ramps into tops and risers, which only adds faces (a carved hex keeps its lattice at every tier).
      expect(mesh.position.length / 9).toBeGreaterThanOrEqual(
        cells.length * 6 * n * n + boundary(cells) * 2 * n,
      )
      expect(mesh.normal.length).toBe(mesh.position.length)
      expect(mesh.uv.length / 2).toBe(mesh.position.length / 3)
      return mesh.position.length / 9
    })
    expect(counts[1]).toBeLessThanOrEqual((counts[0] as number) * 1.05)
    expect(counts[1]).toBeGreaterThan(counts[2] as number)
  })

  test("the faces cover every hex's footprint once: projected top area is the hexes' area", () => {
    const mesh = reliefMesh(CITY_RELIEF, cells, 0)
    let area = 0
    for (let t = 0; t < mesh.position.length; t += 9) {
      // (A riser's pillow, pushed out of its plane, tilts up a little: not ground.)
      if ((mesh.normal[t + 1] as number) <= 0.2) continue
      const p = mesh.position
      area +=
        Math.abs(
          ((p[t + 3] as number) - (p[t] as number)) * ((p[t + 8] as number) - (p[t + 2] as number)) -
            ((p[t + 6] as number) - (p[t] as number)) * ((p[t + 5] as number) - (p[t + 2] as number)),
        ) / 2
    }
    const hex = (3 * Math.sqrt(3) * CIRCUM * CIRCUM) / 2
    expect(area / (cells.length * hex)).toBeGreaterThan(0.999)
    expect(area / (cells.length * hex)).toBeLessThan(1.001)
  })

  test("the coarser tiers stand on the ground: their top faces are within two ledges of the finest tier's", () => {
    for (const tier of [1, 2] as const) {
      const mesh = reliefMesh(CITY_RELIEF, cells.slice(0, 40), tier)
      for (let v = 0; v < mesh.position.length; v += 3) {
        if ((mesh.normal[v + 1] as number) <= 0.2) continue
        const [x, y] = [mesh.position[v] as number, mesh.position[v + 1] as number]
        const ground = CITY_RELIEF.heightAt(x, mesh.position[v + 2] as number)
        if (ground !== undefined) expect(Math.abs(y - ground)).toBeLessThanOrEqual(2 * LEDGE_STEP + 1e-3)
      }
    }
  })

  test("a face's UV points into a palette swatch the kit itself uses, and its normal is a unit vector", () => {
    const mesh = reliefMesh(CITY_RELIEF, cells, 0)
    const columns = Object.values(SWATCH).map((swatch) => swatch.u)
    for (let v = 0; v < mesh.uv.length; v += 2) {
      expect(columns.some((u) => Math.abs(u - (mesh.uv[v] as number)) < 1e-6)).toBe(true)
      expect(mesh.uv[v + 1] as number).toBeGreaterThan(0)
      expect(mesh.uv[v + 1] as number).toBeLessThan(0.76)
    }
    for (let v = 0; v < mesh.normal.length; v += 3)
      expect(
        Math.hypot(mesh.normal[v] as number, mesh.normal[v + 1] as number, mesh.normal[v + 2] as number),
      ).toBeCloseTo(1, 4)
  })

  test("a hex set that is not on a massif draws nothing", () => {
    const mesh = reliefMesh(CITY_RELIEF, [[0, 0]], 0)
    expect(mesh.position.length).toBe(0)
  })

  test("two sets of one massif meet exactly along their seam: no skirt hangs there, as the same faces would be drawn, and none is needed", () => {
    const half = cells.slice(0, Math.floor(cells.length / 2))
    const rest = cells.slice(Math.floor(cells.length / 2))
    const both =
      reliefMesh(CITY_RELIEF, half, 0).position.length + reliefMesh(CITY_RELIEF, rest, 0).position.length
    expect(both).toBe(reliefMesh(CITY_RELIEF, cells, 0).position.length)
  })
})

describe("the snow line", () => {
  test("it is the top fifth of the main peak, and winter brings it down", () => {
    const main = CITY_RELIEF.massifs[0]?.height ?? 0
    expect(snowlineOf(CITY_RELIEF, 0)).toBeCloseTo(main * 0.8, 5)
    expect(snowlineOf(CITY_RELIEF, 1)).toBeLessThan(snowlineOf(CITY_RELIEF, 0))
    expect(snowlineOf(CITY_RELIEF, 5)).toBe(snowlineOf(CITY_RELIEF, 1))
  })
})

describe("the world with a relief", () => {
  const world = repoWorld(CITY, { repo: "facebook/react", source: "fixture", gen: 2 })

  test("a gen 2 island has its mountains; a gen 1 island, and the hand lands, have none", () => {
    expect(world.relief?.massifs.length).toBeGreaterThan(0)
    expect(repoWorld(CITY, { repo: "facebook/react", source: "fixture" }).relief).toBeUndefined()
    expect(handWorld().relief).toBeUndefined()
  })

  test("the hexes a massif covers are not tiled, and the per-hex mountain cones are gone (its forest stands on it)", () => {
    const keys = world.relief?.keys ?? new Set<string>()
    for (const tile of world.island.tiles) expect(keys.has(key(cellAt([tile.x, tile.z])))).toBe(false)
    for (const piece of world.island.decor) {
      // Its conifers, and the cairn and flag of a trail's lookout (test/trails.test.ts): no rock, no cone, no crag.
      if (keys.has(key(cellAt([piece.x, piece.z])))) expect(piece.piece).toMatch(/^(trees?_|flag_)/)
    }
    expect(CITY.island.decor.some((d) => d.piece.startsWith("mountain_"))).toBe(true)
  })

  test("ground.heightAt is the massif's height on it and the terrace's top elsewhere", () => {
    const main = world.relief?.massifs[0]
    const peak = main?.peaks[0]
    expect(world.ground.heightAt(peak?.at[0] ?? 0, peak?.at[1] ?? 0)).toBeGreaterThan(30)
    expect(world.ground.heightAt(0, 0)).toBe(0)
    expect(handWorld().ground.heightAt(0, 0)).toBe(0)
  })

  test("a hex under a massif is raised for wilds and walkers", () => {
    for (const id of world.relief?.keys ?? []) expect(world.terrain.level(unkey(id))).toBeGreaterThan(0)
  })
})

describe("a Town's massifs", () => {
  test("stand lower than a City's and lie inside the cap", () => {
    expect(TOWN_RELIEF.massifs.length).toBeGreaterThan(0)
    expect(TOWN_RELIEF.massifs[0]?.height ?? 0).toBeLessThan(CITY_RELIEF.massifs[0]?.height ?? 0)
  })
})
