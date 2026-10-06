import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { ROUNDS } from "../src/scene/life/rounds.ts"
import { MODELS } from "../src/world/cast.ts"
import BOUNDS from "../src/world/graveyard.json"
import { castsShadow, GRAVEYARD, GRAVEYARD_REACH, type GravePlacement } from "../src/world/graveyard.ts"
import { cellToWorld, GRAVEYARD_PLOT, MAP_FOR_TESTS as MAP, toPlot } from "../src/world/lands.ts"
import type { Spot } from "../src/world/layout.ts"
import { toSegment } from "../src/world/lights.ts"

/** A placed piece's ground footprint: its model box, scaled, stretched and turned. */
function corners(p: GravePlacement): Spot[] {
  const { min, max } = BOUNDS[p.piece]
  const sx = (p.scale ?? 1) * (p.stretch ?? 1)
  const s = p.scale ?? 1
  const rot = p.rot ?? 0
  return [
    [min[0] ?? 0, min[2] ?? 0],
    [max[0] ?? 0, min[2] ?? 0],
    [max[0] ?? 0, max[2] ?? 0],
    [min[0] ?? 0, max[2] ?? 0],
  ].map(([lx = 0, lz = 0]) => {
    const x = lx * sx
    const z = lz * s
    return [p.x + x * Math.cos(rot) + z * Math.sin(rot), p.z - x * Math.sin(rot) + z * Math.cos(rot)]
  })
}
/** How far a ground point is from a piece's footprint (0 on it). */
function fromPiece(p: GravePlacement, x: number, z: number): number {
  const { min, max } = BOUNDS[p.piece]
  const rot = p.rot ?? 0
  const dx = x - p.x
  const dz = z - p.z
  // Into the piece's own frame (the inverse of the turn above).
  const lx = (dx * Math.cos(rot) - dz * Math.sin(rot)) / ((p.scale ?? 1) * (p.stretch ?? 1))
  const lz = (dx * Math.sin(rot) + dz * Math.cos(rot)) / (p.scale ?? 1)
  const ox = Math.max((min[0] ?? 0) - lx, 0, lx - (max[0] ?? 0)) * (p.scale ?? 1) * (p.stretch ?? 1)
  const oz = Math.max((min[2] ?? 0) - lz, 0, lz - (max[2] ?? 0)) * (p.scale ?? 1)
  return Math.hypot(ox, oz)
}
const inside = ([x, z]: Spot) =>
  x >= GRAVEYARD_REACH.x0 && x <= GRAVEYARD_REACH.x1 && z >= GRAVEYARD_REACH.z0 && z <= GRAVEYARD_REACH.z1

describe("the graveyard", () => {
  test("is a fenced yard: an arch gate on the avenue side, a crypt at the back, graves, a path", () => {
    const count = (piece: string) => GRAVEYARD.pieces.filter((p) => p.piece === piece).length
    const gate = GRAVEYARD.pieces.find((p) => p.piece === "arch_gate")
    const crypt = GRAVEYARD.pieces.find((p) => p.piece === "crypt")
    expect(gate?.x).toBe(GRAVEYARD_PLOT.x1)
    expect(crypt && gate && crypt.x < gate.x - 10).toBe(true)
    expect(count("fence") + count("fence_broken")).toBeGreaterThanOrEqual(14)
    expect(count("path_A") + count("path_B")).toBeGreaterThanOrEqual(5)
    expect(GRAVEYARD.graves.length).toBeGreaterThanOrEqual(8)
    for (const piece of ["tree_dead_large", "lantern_standing", "post_lantern", "shrine_candles", "skull"])
      expect(count(piece)).toBeGreaterThan(0)
  })

  test("everything stands inside its grounds, on level dry land", () => {
    for (const p of GRAVEYARD.pieces) {
      expect({ piece: p.piece, at: [p.x, p.z], inside: corners(p).every(inside) }).toEqual({
        piece: p.piece,
        at: [p.x, p.z],
        inside: true,
      })
      const cell = MAP.cellOf([p.x, p.z])
      expect(".f=").toContain(MAP.at(cell))
      expect(MAP.level(cell)).toBe(0)
    }
  })

  test("each grave's dirt is clear for a skeleton: no other piece stands on it", () => {
    for (const grave of GRAVEYARD.graves) {
      expect(toPlot(grave.x, grave.z)).toBe(0)
      for (const p of GRAVEYARD.pieces) {
        if (p.piece === "floor_dirt_grave") continue
        expect({ piece: p.piece, clear: fromPiece(p, grave.x, grave.z) > 0.45 }).toEqual({
          piece: p.piece,
          clear: true,
        })
      }
    }
  })

  test("no villager's round passes through it", () => {
    for (const round of ROUNDS) {
      const path: Spot[] = [round.door, ...round.stops, round.door].map((s) => [s.x, s.z])
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1] as Spot
        const b = path[i] as Spot
        for (let t = 0; t <= 1; t += 0.05)
          expect(toPlot(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)).toBeGreaterThan(1)
      }
    }
  })

  test("its gate path joins the avenue's verge, not the road surface", () => {
    const avenue: [Spot, Spot] = [cellToWorld([0, 8]), cellToWorld([0, 12])]
    for (const p of GRAVEYARD.pieces)
      for (const corner of corners(p)) expect(toSegment(corner, ...avenue)).toBeGreaterThan(2.6)
  })

  test("the low pieces stay out of the shadow map; the tall ones cast", () => {
    expect(castsShadow("crypt")).toBe(true)
    expect(castsShadow("fence")).toBe(true)
    expect(castsShadow("floor_dirt_grave")).toBe(false)
    expect(castsShadow("path_A")).toBe(false)
  })
})

describe("the undead load lazily", () => {
  test("no skeleton is among the adventurers' preloaded models", () => {
    for (const model of MODELS) expect(model).not.toContain("skeleton")
  })

  test("nothing preloads the skeletons or their clips: they load on first need, in scene/Undead", () => {
    const files: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) walk(path)
        else if (/\.tsx?$/.test(name)) files.push(path)
      }
    }
    walk(join(import.meta.dir, "../src"))
    const loads: string[] = []
    for (const file of files)
      for (const line of readFileSync(file, "utf8").split("\n")) {
        if (/preload\(/.test(line)) expect(line).not.toMatch(/undead|UNDEAD|skeleton/i)
        if (/useGLTF\((undeadUrl|UNDEAD_ANIMS_URL)/.test(line)) loads.push(file.split("/src/")[1] ?? file)
      }
    expect(new Set(loads)).toEqual(new Set(["scene/Undead.tsx"]))
  })
})
