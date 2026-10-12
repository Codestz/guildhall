import { describe, expect, test } from "bun:test"
import {
  closest,
  contains,
  LAMPS,
  type TownLayout,
  type TownLights,
  townLights,
  type Vec2,
  WINDOW_OPENINGS,
} from "../src/index.ts"
import { COMPILED, LIB, PRESETS, town } from "./town.fixture.ts"

/** world town lights: lamps along streets, at gates and doors, on piers; windows per house. */

const lit = new Map<string, { plan: TownLayout; lights: TownLights }>()
function lightsOf(i: number) {
  const spec = PRESETS[i] as (typeof PRESETS)[number]
  const key = `${spec.tier}#${spec.seed}`
  let got = lit.get(key)
  if (!got) {
    const plan = town(spec)
    got = { plan, lights: townLights(plan, COMPILED, LIB) }
    lit.set(key, got)
  }
  return got
}
const xz = (p: readonly [number, number, number]): Vec2 => [p[0], p[2]]

describe("townLights", () => {
  test("a town gets street lamps, market posts, gate torches and door lanterns", () => {
    const { lights } = lightsOf(2)
    const kinds = new Set(lights.points.map((p) => p.kind))
    for (const kind of ["street", "market", "torch", "door"] as const)
      expect(kinds.has(kind), kind).toBe(true)
    expect(lights.points.length).toBeGreaterThan(40)
  })

  test("every light has its lamp piece, the flame above it", () => {
    const { lights } = lightsOf(2)
    expect(lights.pieces.length).toBe(lights.points.length)
    lights.points.forEach((p, i) => {
      const piece = lights.pieces[i]
      expect(piece?.piece).toBe(LAMPS[p.kind].piece)
      expect(p.at[1]).toBeCloseTo((piece?.y ?? 0) + LAMPS[p.kind].up, 2)
    })
  })

  test("no standing lamp is on a street or in the water (torches hang on walls)", () => {
    for (const i of [1, 2, 3]) {
      const { plan, lights } = lightsOf(i)
      const standing = lights.pieces.filter((_, k) =>
        ["street", "market", "door"].includes(lights.points[k]?.kind ?? ""),
      )
      expect(standing.length).toBeGreaterThan(10)
      for (const piece of standing) {
        const at: Vec2 = [piece.x, piece.z]
        expect(plan.water.some((ring) => contains(ring, at))).toBe(false)
        for (const e of plan.streets.edges)
          for (let k = 0; k + 1 < e.points.length; k++)
            expect(closest(at, e.points[k] as Vec2, e.points[k + 1] as Vec2).d).toBeGreaterThan(e.width / 2)
      }
    }
  })

  test("lamps of a kind keep apart", () => {
    const { lights } = lightsOf(3)
    const pts = lights.points
    for (let a = 0; a < pts.length; a++)
      for (let b = a + 1; b < pts.length; b++) {
        const p = pts[a] as (typeof pts)[number]
        const q = pts[b] as (typeof pts)[number]
        if (p.kind !== q.kind) continue
        const d = Math.hypot(p.at[0] - q.at[0], p.at[2] - q.at[2])
        expect(d).toBeGreaterThan(5)
      }
  })

  test("a house's windows share its rank; every window is a known opening", () => {
    const { plan, lights } = lightsOf(2)
    expect(lights.windows.length).toBeGreaterThan(100)
    const ranks = new Set(lights.windows.map((w) => w.house))
    // Many houses, and every rank in [0, 1).
    expect(ranks.size).toBeGreaterThan(20)
    for (const w of lights.windows) {
      expect(w.house).toBeGreaterThanOrEqual(0)
      expect(w.house).toBeLessThan(1)
      expect(w.h).toBeGreaterThan(1)
      expect(w.at[1]).toBeGreaterThan(0.5)
    }
    const widths = new Set(Object.values(WINDOW_OPENINGS).map((o) => Math.round(o.half * 2000)))
    for (const w of lights.windows) expect(widths.has(Math.round(w.w * 1000))).toBe(true)
    expect(plan.placements.length).toBeGreaterThan(0)
  })

  test("piers end in a lamp when the town has a harbour", () => {
    const { plan, lights } = lightsOf(2)
    const piers = plan.stations.filter((s) => s.kind === "dock" && s.id !== "dock:harbourmaster")
    const lamps = lights.points.filter((p) => p.kind === "pier")
    expect(lamps.length).toBe(piers.length)
    for (const s of piers)
      expect(lamps.some((p) => Math.hypot(...[0, 1].map((k) => xz(p.at)[k]! - s.at[k]!)) < 2)).toBe(true)
  })

  test("the same plan gives the same lights", () => {
    const { plan, lights } = lightsOf(1)
    expect(townLights(plan, COMPILED, LIB)).toEqual(lights)
  })
})
