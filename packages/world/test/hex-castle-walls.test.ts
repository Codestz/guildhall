/**
 * The Guildhall's curtain wall meets what it abuts (decisions.md "castle walls meet, doors are
 * dynamic"): on seeds 1–3 at every tier, each wall piece's two ends touch another wall piece or a
 * building (the keep, the great hall, the barracks, a tower), with no gap; a wall ends in a building's
 * face and runs no further into it; the gatehouse stands on the gate's side, its fillers fitted.
 * Plus the doors: every building has a door from its mesh, life goes in and out through it, and its
 * passes come in pairs.
 */
import { afterAll, describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { MIN_WIDTH } from "../src/hex/roads.ts"
import {
  DOOR_HALF,
  DOOR_RUN,
  DOORWAYS,
  doorPasses,
  GATE_OPENING,
  hexIsland,
  hexWalk,
  hexWorld,
  hexZones,
  installTilePrefabs,
  lifePlaces,
  parseTilePrefabs,
  pieceSolids,
  planFolk,
  solidDistance,
  useOf,
  WALL_SCALE,
  workTiles,
} from "../src/index.ts"
import { isWall, siteReport, wallLine } from "./site-checks.ts"

const DIR = join(import.meta.dir, "../../../data/tiles")
const data = Object.fromEntries(
  readdirSync(DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => [f.slice(0, -5), JSON.parse(readFileSync(join(DIR, f), "utf8")) as unknown]),
)
installTilePrefabs(parseTilePrefabs(data).prefabs)
afterAll(() => installTilePrefabs(null))

/** A repo size for each tier (zones.ts castleTier with three agents). */
const TIERS: [number, number][] = [
  [1, 500],
  [2, 2000],
  [3, 4000],
  [4, 12000],
]

describe("the curtain wall meets what it abuts", () => {
  for (const seed of [1, 2, 3])
    test(`seed ${seed}, tiers 1–4`, () => {
      for (const [tier, files] of TIERS) {
        const h = hexIsland({ seed, files })
        const z = hexZones(h)
        expect(z.tier).toBe(tier)
        const w = hexWorld(h, z)
        const walls = w.pieces.filter((p) => isWall(p.piece))
        if (tier === 1) {
          expect(walls).toEqual([])
          continue
        }
        expect(walls.length).toBeGreaterThan(6)
        // one gatehouse, at its own size drawn out to its opening's width (GATE_OPENING between its posts)
        const gates = walls.filter((p) => p.piece === "kaykit-hexagon/wall-straight-gate")
        expect(gates.length).toBe(1)
        expect(gates[0]!.scale).toBe(WALL_SCALE)
        expect(4 * WALL_SCALE * gates[0]!.stretch!).toBeCloseTo(GATE_OPENING, 5)
        // every piece fitted to its run, never drawn out past a third (a stub against a building is short)
        for (const p of walls) if (p.stretch !== undefined) expect(p.stretch).toBeLessThan(1.31)
        const r = siteReport(h, z, w, hexWalk(h, z, w, { reach: workTiles(h, z) }))
        expect(r.notes.filter((n) => n.startsWith("gap") || n.includes("wall /"))).toEqual([])
        expect(r.gap).toBe(0)
        // no two pieces on one line overlap (no seams fighting): along a line, pieces end to end
        const lines = walls.map(wallLine)
        for (const [k, a] of lines.entries())
          for (const [j, b] of lines.entries()) {
            if (j <= k || Math.abs(Math.sin(walls[k]!.rot - walls[j]!.rot)) > 1e-3) continue
            const ux = a[1][0] - a[0][0]
            const uz = a[1][1] - a[0][1]
            const len = Math.hypot(ux, uz)
            // on one line?
            const off = Math.abs(((b[0][0] - a[0][0]) * uz - (b[0][1] - a[0][1]) * ux) / len)
            if (off > 0.05) continue
            const t = (p: [number, number]) => ((p[0] - a[0][0]) * ux + (p[1] - a[0][1]) * uz) / len
            const [b0, b1] = [t(b[0]), t(b[1])].sort((p, q) => p - q) as [number, number]
            const overlap = Math.min(len, b1) - Math.max(0, b0)
            expect(overlap).toBeLessThan(0.02)
          }
      }
    }, 60_000)
})

describe("the castle's doors and gate have clear approaches", () => {
  for (const seed of [1, 2, 3])
    test(`seed ${seed}, tiers 2–4`, () => {
      for (const [, files] of TIERS.slice(1)) {
        const h = hexIsland({ seed, files })
        const z = hexZones(h)
        const w = hexWorld(h, z)
        const plan = z.castle!
        const castle = new Set(plan.tiles)
        // the strip out from a door (or through the gate, both ways): DOOR_RUN long, DOOR_HALF either side
        const strip = (
          x: number,
          zz: number,
          facing: number,
          from: number,
          to: number,
          half = DOOR_HALF,
        ): [number, number][] => {
          const ux = Math.sin(facing)
          const uz = Math.cos(facing)
          const out: [number, number][] = []
          for (let a = from; a <= to + 1e-9; a += 0.2)
            for (const b of [-half, 0, half]) out.push([x + ux * a - uz * b, zz + uz * a + ux * b])
          return out
        }
        const near = w.pieces.filter((p) => {
          const t = w.tiles.find((u) => Math.hypot(u.x - p.x, u.z - p.z) < 3.2)
          return t !== undefined && castle.has(t.i)
        })
        const blocked = (pts: [number, number][], skip: (piece: string) => boolean) =>
          near
            .filter((p) => !skip(p.piece))
            .flatMap((p) => pieceSolids(p))
            .filter((sol) => pts.some(([x, zz]) => solidDistance(sol, x, zz) < 0))
            .map((sol) => sol.piece)
        for (const d of w.doorways.filter((q) => castle.has(q.tile))) {
          // (the building's own steps and porch are its way in)
          const own = w.tiles.find((u) => u.i === d.tile)!
          const mine = (q: string, at?: { x: number; z: number }) =>
            q.startsWith("kaykit-hexagon/building-") && !!at && Math.hypot(at.x - own.x, at.z - own.z) < 1.5
          // nothing in the strip a doorway and a shoulder wide (checks.ts), the curtain wall included:
          // where the site turns at a door's side the wall stands out over the castle's foot (curtain.ts)
          const pts = strip(d.x, d.z, d.facing, 0.15, DOOR_RUN)
          const hit = near
            .filter((p) => !mine(p.piece, p))
            .flatMap((p) => pieceSolids(p))
            .filter((sol) => pts.some(([x, zz]) => solidDistance(sol, x, zz) < 0))
            .map((sol) => sol.piece)
          expect([seed, files, d.tile, hit]).toEqual([seed, files, d.tile, []])
        }
        const gate = w.pieces.find((p) => p.piece === "kaykit-hexagon/wall-straight-gate")!
        // through the gate, a metre and more either side of its wall (its own sides and the walls aside)
        const pts = strip(gate.x, gate.z, gate.rot, -1.8, 1.8).filter(([x, zz]) => {
          const [ox, oz] = [x - gate.x, zz - gate.z]
          return Math.abs(ox * Math.sin(gate.rot) + oz * Math.cos(gate.rot)) > 0.75
        })
        expect([seed, files, blocked(pts, (q) => q.includes("/wall-"))]).toEqual([seed, files, []])
        // and the opening itself, its leaves swung back: nothing (its posts, the walls) within MIN_WIDTH/2 of
        // its middle line, from a metre out to a metre in
        const through = strip(gate.x, gate.z, gate.rot, -1, 1, MIN_WIDTH / 2)
        expect([seed, files, blocked(through, () => false)]).toEqual([seed, files, []])
      }
    }, 60_000)
})

describe("the gate lets the road through", () => {
  test("walks cross the gatehouse's line only through its opening, the leaves swung back", () => {
    const h = hexIsland({ seed: 2, files: 4000 })
    const z = hexZones(h)
    const w = hexWorld(h, z)
    const walk = hexWalk(h, z, w, { reach: workTiles(h, z) })
    const folk = planFolk(h, z, w, walk, { seed: 2, pace: 144, places: lifePlaces(h, z, w, walk) })
    const gate = w.pieces.find((p) => p.piece === "kaykit-hexagon/wall-straight-gate")!
    const ux = Math.cos(gate.rot)
    const uz = -Math.sin(gate.rot)
    const half = (8.4 / 2) * gate.scale * gate.stretch!
    let through = 0
    for (const f of folk)
      for (const s of f.day) {
        if (s.kind !== "walk") continue
        for (let k = 1; k < s.pts.length; k++) {
          const [a, b] = [s.pts[k - 1]!, s.pts[k]!]
          const da = (a[0] - gate.x) * -uz + (a[2] - gate.z) * ux
          const db = (b[0] - gate.x) * -uz + (b[2] - gate.z) * ux
          if (da * db > 0 || da === db) continue
          const t = da / (da - db)
          const along = (a[0] + (b[0] - a[0]) * t - gate.x) * ux + (a[2] + (b[2] - a[2]) * t - gate.z) * uz
          if (Math.abs(along) > half) continue
          // through the opening, a shoulder clear of its posts
          expect(Math.abs(along)).toBeLessThan(GATE_OPENING / 2 - 0.2)
          through++
        }
      }
    expect(through).toBeGreaterThan(3)
  }, 60_000)
})

describe("doors", () => {
  test("every KayKit hex building but the mine has a door from its mesh, at its foot, on its front", () => {
    for (const [id, d] of Object.entries(DOORWAYS)) {
      expect(id).not.toContain("mine")
      expect(d.w).toBeGreaterThan(1)
      expect(d.h).toBeGreaterThan(2)
      expect(d.y).toBeLessThan(2)
    }
    expect(Object.keys(DOORWAYS).length).toBeGreaterThanOrEqual(15)
  })

  test("buildings have doorways; people go home through them, in and out in pairs", () => {
    const h = hexIsland({ seed: 1, files: 4000 })
    const z = hexZones(h)
    const w = hexWorld(h, z)
    const built = w.tiles.filter((t) => useOf(z, t.i) === "building" && t.door !== undefined)
    const doors = new Set(w.doorways.map((d) => d.tile))
    // nearly every building tile has one (a mine or a ruin has none)
    expect(built.filter((t) => doors.has(t.i)).length / built.length).toBeGreaterThan(0.9)
    // the castle's keep and great hall too
    const castle = z.castle!
    expect(doors.has(castle.keep)).toBe(true)
    if (castle.hall >= 0) expect(doors.has(castle.hall)).toBe(true)
    const walk = hexWalk(h, z, w, { reach: workTiles(h, z) })
    const folk = planFolk(h, z, w, walk, { seed: 1, pace: 144, places: lifePlaces(h, z, w, walk) })
    let ins = 0
    let outs = 0
    let through = 0
    for (const f of folk) {
      const passes = doorPasses(f.day)
      // in and out alternate over the day (a loop: as many in as out)
      expect(passes.filter((p) => p.enter).length).toBe(passes.filter((p) => !p.enter).length)
      for (const p of passes) {
        // each through a doorway: at most a stride inside one
        if (w.doorways.some((d) => Math.hypot(d.x - p.at[0], d.z - p.at[2]) < 0.4)) through++
        if (p.enter) ins++
        else outs++
      }
    }
    expect(ins).toBeGreaterThan(50)
    expect(outs).toBe(ins)
    // nearly all through a building's own door (a few homes are a mine's or a ruin's, with none)
    expect(through / (ins + outs)).toBeGreaterThan(0.85)
  }, 60_000)
})
