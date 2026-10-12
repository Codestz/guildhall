import { describe, expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { roll } from "@guildhall/core"
import {
  axes,
  closest,
  contains,
  dist,
  distTo,
  intersect,
  lerp,
  rectCorners,
  ribbon,
  type Vec2,
} from "../src/index.ts"
import { blocks } from "../src/town/blocks.ts"
import {
  EDGE_KITS,
  type EdgeKitProfile,
  type EdgeLayout,
  edgeKits,
  layoutEdge,
  SHARP,
  walls,
} from "../src/town/edges.ts"
import { KEEP_FALLBACK, KEEP_RECIPE, landmark } from "../src/town/landmark.ts"
import { site } from "../src/town/site.ts"
import { normalizeSpec } from "../src/town/spec.ts"
import { streets } from "../src/town/streets.ts"
import type { Edge, PieceInstance, Tier, TownLibrary, TownPlan, TownSpecInput } from "../src/town/types.ts"

/** world town: the town's edge (walls, hedges, fences) and the castle's curtain and keep. */

const LIB: TownLibrary = {
  prefabs: [],
  edges: edgeKits("town"),
  nature: { trees: [], bushes: [], crops: [], hay: [], rocks: [] },
}

function make(spec: TownSpecInput, lib: TownLibrary = LIB) {
  const s = site(spec)
  const g = streets(s, spec, (salt) => roll(spec.seed, `${salt}:streets`))
  const b = blocks(g, s, spec, (salt) => roll(spec.seed, `${salt}:blocks`))
  const plan: TownPlan = {
    spec: normalizeSpec(spec),
    bounds: s.bounds,
    water: s.water,
    plazas: [s.plaza],
    streets: b.graph,
    blocks: b.blocks,
    lots: [],
    placements: [],
    edges: [],
    fields: [],
    nature: [],
    stations: [],
    hash: "",
  }
  plan.edges = walls(plan, spec, (salt) => roll(spec.seed, `${salt}:walls`))
  const castle = landmark(plan, spec, lib, (salt) => roll(spec.seed, `${salt}:landmark`))
  const kits = edgeKits(spec.tier)
  const all = [...plan.edges, ...castle.edges]
  const layouts = all.map((e) => ({ edge: e, kit: kits[e.kind], layout: layoutEdge(e, kits[e.kind]) }))
  return { site: s, plan, castle, layouts }
}

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8]
const TIERS: Tier[] = ["hamlet", "village", "town", "city"]
const built = TIERS.flatMap((tier) => SEEDS.map((seed) => ({ spec: { seed, tier } as TownSpecInput }))).map(
  ({ spec }) => ({ spec, ...make(spec) }),
)
const label = (spec: TownSpecInput, e?: Edge) => `${spec.tier}#${spec.seed}${e ? ` edge ${e.id}` : ""}`

/** The arc length along the edge's line of its nearest point to p. */
function arcOf(edge: Edge, p: Vec2): number {
  const pts = edge.closed ? [...edge.points, edge.points[0]!] : edge.points
  let s = 0
  let best = { d: Infinity, s: 0 }
  for (let i = 0; i + 1 < pts.length; i++) {
    const c = closest(p, pts[i]!, pts[i + 1]!)
    const l = dist(pts[i]!, pts[i + 1]!)
    if (c.d < best.d) best = { d: c.d, s: s + c.t * l }
    s += l
  }
  return best.s
}

/** A segment piece's two ends on the ground, from its frame, run axis and scaled length. */
function ends(p: PieceInstance, kit: EdgeKitProfile): [Vec2, Vec2] {
  const { x, z } = axes(p.rot)
  const run = kit.along === "x" ? x : z
  const side = kit.along === "x" ? z : x
  const half = (kit.length * p.scale) / 2
  const c: Vec2 = [p.x + side[0] * kit.across * p.scale, p.z + side[1] * kit.across * p.scale]
  return [
    [c[0] - run[0] * half, c[1] - run[1] * half],
    [c[0] + run[0] * half, c[1] + run[1] * half],
  ]
}

const length = (e: Edge) => {
  const pts = e.closed ? [...e.points, e.points[0]!] : e.points
  let l = 0
  for (let i = 0; i + 1 < pts.length; i++) l += dist(pts[i]!, pts[i + 1]!)
  return l
}

/**
 * The stretches of the edge (arc intervals) no piece covers: segments by their ends, towers by half
 * their width either side, gate pieces by their scaled length, plain gaps counted as covered.
 */
function holes(edge: Edge, kit: EdgeKitProfile, l: EdgeLayout): [number, number][] {
  const total = length(edge)
  const iv: [number, number][] = []
  const push = (a: number, b: number) => {
    if (!edge.closed) return void iv.push([Math.min(a, b), Math.max(a, b)])
    // A closed edge's interval may wrap past the start.
    let [lo, hi] = [a, b]
    if (hi < lo) hi += total
    if (hi - lo > total / 2) [lo, hi] = [hi, lo + total]
    iv.push([lo, hi], [lo - total, hi - total], [lo + total, hi + total])
  }
  for (const p of l.segments) {
    const [a, b] = ends(p, kit)
    push(arcOf(edge, a), arcOf(edge, b))
  }
  const r = (kit.towerSize ?? 0) / 2
  for (const t of l.towers) {
    const s = arcOf(edge, [t.x, t.z])
    push(s - r, s + r)
  }
  for (const g of edge.gaps) push(g.s - g.width / 2, g.s + g.width / 2)
  iv.sort((a, b) => a[0] - b[0])
  const out: [number, number][] = []
  let reach = 0
  for (const [a, b] of iv) {
    if (b < 0 || a > total) continue
    if (a > reach) out.push([reach, a])
    reach = Math.max(reach, b)
  }
  if (reach < total) out.push([reach, total])
  return out
}

describe("walls", () => {
  test("is deterministic: the same spec gives the same edges and pieces, bit for bit", () => {
    for (const { spec, plan, castle, layouts } of built.filter((_, i) => i % 3 === 0)) {
      const again = make(spec)
      expect(again.plan.edges, label(spec)).toEqual(plan.edges)
      expect(again.castle, label(spec)).toEqual(castle)
      expect(
        again.layouts.map((x) => x.layout),
        label(spec),
      ).toEqual(layouts.map((x) => x.layout))
    }
  })

  test("a walled town gets a wall; a village a hedge; a hamlet a fence; walls: false takes the hedge", () => {
    for (const { spec, plan } of built) {
      const want = { hamlet: "fence", village: "hedge", town: "wall", city: "wall" }[spec.tier as "town"]
      expect(plan.edges.length, label(spec)).toBeGreaterThan(0)
      for (const e of plan.edges) expect(e.kind, label(spec, e)).toBe(want)
    }
    const open = make({ seed: 4, tier: "town", walls: false })
    expect(open.plan.edges.every((e) => e.kind === "hedge")).toBe(true)
  })

  test("kits by tier: a city's wall is KayKit stone, a town's Quaternius", () => {
    expect(edgeKits("city").wall.segment).toBe(EDGE_KITS.stone.segment)
    expect(edgeKits("capital").wall.segment).toBe(EDGE_KITS.stone.segment)
    expect(edgeKits("town").wall.segment).toBe(EDGE_KITS.curtain.segment)
  })

  test("pieces form a continuous line: no uncovered stretch over 0.3 m, segments never overlap", () => {
    for (const { spec, layouts } of built)
      for (const { edge, kit, layout } of layouts) {
        const big = holes(edge, kit, layout).filter(([a, b]) => b - a > 0.3)
        expect(big, label(spec, edge)).toEqual([])
        const spans = layout.segments
          .map((p) => ends(p, kit).map((q) => arcOf(edge, q)) as [number, number])
          .map(([a, b]) => [Math.min(a, b), Math.max(a, b)] as [number, number])
          .filter(([a, b]) => b - a < length(edge) / 2) // a closed edge's wrap segment is checked by ends
          .sort((a, b) => a[0] - b[0])
        for (let i = 0; i + 1 < spans.length; i++)
          expect(spans[i]![1] - spans[i + 1]![0], label(spec, edge)).toBeLessThan(0.05)
      }
  })

  test("neighbouring segments meet end to end", () => {
    for (const { spec, layouts } of built)
      for (const { edge, kit, layout } of layouts) {
        const tips = layout.segments.flatMap((p) => ends(p, kit))
        // Every segment end is either shared with another segment's end or covered by a tower/gate/gap.
        for (const p of layout.segments)
          for (const q of ends(p, kit)) {
            const shared = tips.filter((t) => dist(t, q) <= 0.3).length >= 2
            const r = (kit.towerSize ?? 0) / 2
            const towered = layout.towers.some((t) => dist([t.x, t.z], q) <= r + 0.05)
            const s = arcOf(edge, q)
            const total = length(edge)
            const off = (g: Edge["gaps"][number]) => {
              const d = Math.abs(s - g.s)
              return edge.closed ? Math.min(d, total - d) : d
            }
            const gapped = edge.gaps.some((g) => off(g) <= g.width / 2 + r + 0.05)
            const end = !edge.closed && (s <= 0.3 || s >= length(edge) - 0.3)
            expect(shared || towered || gapped || end, `${label(spec, edge)} at ${q}`).toBe(true)
          }
      }
  })

  test("gates are open where streets cross: no segment or tower stands on a street", () => {
    for (const { spec, plan, layouts } of built)
      for (const { edge, kit, layout } of layouts) {
        for (const p of layout.segments) {
          const [a, b] = ends(p, kit)
          for (const e of plan.streets.edges)
            for (let j = 0; j + 1 < e.points.length; j++)
              expect(intersect(a, b, e.points[j]!, e.points[j + 1]!), label(spec, edge)).toBeNull()
        }
        const r = (kit.towerSize ?? 0) / 2
        for (const t of layout.towers)
          for (const e of plan.streets.edges)
            expect(distTo([t.x, t.z], e.points), label(spec, edge)).toBeGreaterThan(r * 0.5)
      }
  })

  test("every gate node's road passes through a gate gap with a gate piece in it", () => {
    for (const { spec, plan, layouts } of built.filter(
      (x) => x.spec.tier === "town" || x.spec.tier === "city",
    )) {
      const town = layouts.filter((l) => plan.edges.includes(l.edge))
      const gates = town.flatMap((l) => l.edge.gaps.filter((g) => g.kind === "gate"))
      const pieces = town.flatMap((l) => l.layout.gates)
      const roads = plan.streets.edges.filter(
        (e) => e.cls === "road" && plan.streets.nodes[e.a]!.kind === "gate",
      )
      expect(gates.length, label(spec)).toBeGreaterThanOrEqual(roads.length)
      expect(pieces.length, label(spec)).toBe(gates.length)
      for (const g of pieces) expect(g.scale, label(spec)).toBeGreaterThanOrEqual(1)
    }
  })

  test("nothing stands on water: lines stay on land, towers keep their reach off it", () => {
    const wet = built.filter((x) => x.plan.water.length > 0)
    expect(wet.length).toBeGreaterThan(4)
    for (const { spec, plan, layouts } of wet)
      for (const { edge, kit, layout } of layouts) {
        const pts = edge.closed ? [...edge.points, edge.points[0]!] : edge.points
        for (let i = 0; i + 1 < pts.length; i++)
          for (let k = 0; k <= 8; k++) {
            const p = lerp(pts[i]!, pts[i + 1]!, k / 8)
            for (const w of plan.water) expect(contains(w, p, 0), label(spec, edge)).toBe(false)
          }
        const r = (kit.towerSize ?? 0) / 2
        for (const t of [...layout.towers, ...layout.segments, ...layout.gates])
          for (const w of plan.water) {
            expect(contains(w, [t.x, t.z], 0), label(spec, edge)).toBe(false)
            if (layout.towers.includes(t))
              expect(distTo([t.x, t.z], w, true), label(spec, edge)).toBeGreaterThan(r)
          }
      }
  })

  test("a wall cut by the water ends at the shore with a tower", () => {
    const cut = built.filter((x) => x.plan.edges.some((e) => e.kind === "wall" && !e.closed))
    expect(cut.length).toBeGreaterThan(0)
    for (const { spec, plan, layouts } of cut)
      for (const { edge, kit, layout } of layouts.filter(
        (l) => plan.edges.includes(l.edge) && !l.edge.closed,
      )) {
        const r = (kit.towerSize ?? 0) / 2
        for (const end of [edge.points[0]!, edge.points[edge.points.length - 1]!]) {
          const shore = Math.min(...plan.water.map((w) => distTo(end, w, true)))
          expect(shore, label(spec, edge)).toBeLessThan(r + 3)
          expect(
            layout.towers.some((t) => dist([t.x, t.z], end) < 0.01),
            label(spec, edge),
          ).toBe(true)
        }
      }
  })

  test("towers stand at sharp turns and no more than ~1.5 spacings apart", () => {
    for (const { spec, layouts } of built.filter((x) => x.spec.tier === "town" || x.spec.tier === "city"))
      for (const { edge, kit, layout } of layouts) {
        const r = (kit.towerSize ?? 0) / 2
        const n = edge.points.length
        const total = length(edge)
        for (let i = edge.closed ? 0 : 1; i < (edge.closed ? n : n - 1); i++) {
          const a = edge.points[(i - 1 + n) % n]!
          const p = edge.points[i]!
          const b = edge.points[(i + 1) % n]!
          const u: Vec2 = [p[0] - a[0], p[1] - a[1]]
          const v: Vec2 = [b[0] - p[0], b[1] - p[1]]
          const turn = Math.atan2(Math.abs(u[0] * v[1] - u[1] * v[0]), u[0] * v[0] + u[1] * v[1])
          if (turn <= SHARP) continue
          const s = arcOf(edge, p)
          if (edge.gaps.some((g) => Math.abs(s - g.s) < g.width / 2 + 2 * r)) continue
          const near = layout.towers.some((t) => dist([t.x, t.z], p) <= 2 * r + 0.05)
          expect(near, `${label(spec, edge)} turn at ${p}`).toBe(true)
        }
        const at = layout.towers.map((t) => arcOf(edge, [t.x, t.z])).sort((x, y) => x - y)
        const spacing = edge.towers?.spacing ?? 0
        const wide = Math.max(...edge.gaps.map((g) => g.width), 0) + 2 * r
        for (let i = 0; i + 1 < at.length; i++)
          expect(at[i + 1]! - at[i]!, label(spec, edge)).toBeLessThanOrEqual(1.5 * spacing + wide)
        if (edge.closed && at.length > 1)
          expect(at[0]! + total - at[at.length - 1]!, label(spec, edge)).toBeLessThanOrEqual(
            1.5 * spacing + wide,
          )
      }
  })

  test("hedges and fences have no towers or gate pieces, only gaps for the streets", () => {
    for (const { spec, layouts } of built.filter(
      (x) => x.spec.tier === "hamlet" || x.spec.tier === "village",
    ))
      for (const { edge, layout } of layouts.filter((l) => l.edge.kind !== "wall")) {
        expect(layout.towers, label(spec, edge)).toEqual([])
        expect(layout.gates, label(spec, edge)).toEqual([])
        expect(edge.gaps.length, label(spec, edge)).toBeGreaterThan(0)
      }
  })
})

describe("landmark", () => {
  const castles = built.filter((x) => x.spec.tier === "city")

  test("a castle gets a closed curtain with corner towers, one gate facing the plaza, and a keep", () => {
    for (const { spec, plan, castle, layouts } of castles) {
      expect(castle.edges.length, label(spec)).toBe(1)
      const curtain = castle.edges[0]!
      expect(curtain.closed && curtain.kind === "wall", label(spec)).toBe(true)
      expect(
        plan.edges.some((e) => e.id === curtain.id),
        label(spec),
      ).toBe(false)
      expect(
        curtain.gaps.map((g) => g.kind),
        label(spec),
      ).toEqual(["gate"])
      const l = layouts.find((x) => x.edge === curtain)!.layout
      expect(l.towers.length, label(spec)).toBeGreaterThanOrEqual(4)
      expect(l.gates.length, label(spec)).toBe(1)
      // The gate is on the plaza's side: nearer the plaza than any tower is.
      const plazaC = plan.plazas[0]!.reduce<Vec2>(
        (a, p) => [a[0] + p[0] / plan.plazas[0]!.length, a[1] + p[1] / plan.plazas[0]!.length],
        [0, 0],
      )
      const g = l.gates[0]!
      const gd = dist([g.x, g.z], plazaC)
      for (const t of l.towers) expect(gd, label(spec)).toBeLessThan(dist([t.x, t.z], plazaC) + 1)

      expect(castle.placements.length, label(spec)).toBe(1)
      const keep = castle.placements[0]!
      expect(keep.role).toBe("keep")
      expect(keep.prefab, label(spec)).toBe(KEEP_FALLBACK.piece)
      // The keep's footprint stands inside the curtain, its front (+z) toward the gate.
      const foot = rectCorners({ c: keep.at, rot: keep.rot, w: KEEP_FALLBACK.w, d: KEEP_FALLBACK.d })
      for (const c of foot) expect(contains(curtain.points, c, 0), label(spec)).toBe(true)
      const { z } = axes(keep.rot)
      const toGate: Vec2 = [g.x - keep.at[0], g.z - keep.at[1]]
      expect(z[0] * toGate[0] + z[1] * toGate[1], label(spec)).toBeGreaterThan(0)
    }
  })

  test("the keep is the authored recipe once the library has it", () => {
    const meta = {
      id: KEEP_RECIPE,
      kind: "landmark",
      frontage: 20,
      depth: 20,
      height: 20,
      door: [0, 0],
      stations: [],
      fits: {},
      tags: [],
    }
    const lib = { ...LIB, prefabs: [meta] } as unknown as TownLibrary
    const { castle } = make({ seed: 2, tier: "city" }, lib)
    expect(castle.placements[0]?.prefab).toBe(KEEP_RECIPE)
  })

  test("no castle landmark, no castle", () => {
    const { castle } = make({ seed: 2, tier: "town" })
    expect(castle).toEqual({ placements: [], edges: [] })
  })
})

/** The debug picture: land, water, streets, blocks, then the edges' pieces as their footprints. */
function svg(made: ReturnType<typeof make>): string {
  const h = 1.6 * made.site.radius
  const path = (ring: readonly Vec2[], close = true) =>
    `M${ring.map((p) => `${p[0]} ${-p[1]}`).join("L")}${close ? "Z" : ""}`
  const parts = [
    `<rect x="${-h}" y="${-h}" width="${2 * h}" height="${2 * h}" fill="#3d7fa6"/>`,
    ...made.site.land.map(
      (poly) => `<path d="${poly.map((r) => path(r)).join("")}" fill="#9cba6a" fill-rule="evenodd"/>`,
    ),
    ...made.plan.streets.edges.map(
      (e) =>
        `<path d="${path(ribbon(e.points, e.width))}" fill="${e.cls === "road" ? "#b49a6a" : "#d8d2c4"}"/>`,
    ),
    ...made.plan.blocks.map((b) => {
      const fill = {
        castle: "#b9b9a8",
        plaza: "#efe0b0",
        lots: "#d9a679",
        green: "#86ad5e",
        harbour: "#5aa3ab",
      }[b.use]
      return `<path d="${path(b.poly)}" fill="${fill}" stroke="#7a6a50" stroke-width="0.3"/>`
    }),
  ]
  const fill = { wall: "#6d6a66", hedge: "#2f6b34", fence: "#8a5a2b" } as const
  for (const { edge, kit, layout } of made.layouts) {
    parts.push(`<path d="${path(edge.points, edge.closed)}" fill="none" stroke="#f0f" stroke-width="0.25"/>`)
    for (const p of layout.segments) {
      const [a, b] = ends(p, kit)
      parts.push(
        `<line x1="${a[0]}" y1="${-a[1]}" x2="${b[0]}" y2="${-b[1]}" stroke="${fill[edge.kind]}" stroke-width="${Math.max(0.6, kit.thickness * p.scale)}" opacity="0.9"/>`,
      )
    }
    for (const g of layout.gates) {
      const w = (kit.gateLength ?? 0) * g.scale
      const foot = rectCorners({ c: [g.x, g.z], rot: g.rot, w, d: kit.thickness + 1 })
      parts.push(`<path d="${path(foot)}" fill="#c0392b"/>`)
    }
    for (const t of layout.towers)
      parts.push(
        `<circle cx="${t.x}" cy="${-t.z}" r="${(kit.towerSize ?? 0) / 2}" fill="#2c4f8c" stroke="#111" stroke-width="0.3"/>`,
      )
  }
  for (const k of made.castle.placements) {
    const foot = rectCorners({ c: k.at, rot: k.rot, w: KEEP_FALLBACK.w, d: KEEP_FALLBACK.d })
    const { z } = axes(k.rot)
    parts.push(`<path d="${path(foot)}" fill="#4a6fb5" stroke="#111" stroke-width="0.4"/>`)
    parts.push(
      `<line x1="${k.at[0]}" y1="${-k.at[1]}" x2="${k.at[0] + z[0] * 12}" y2="${-(k.at[1] + z[1] * 12)}" stroke="#fff" stroke-width="0.8"/>`,
    )
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-h} ${-h} ${2 * h} ${2 * h}" width="1000" height="1000">${parts.join("")}</svg>\n`
}

test("writes a debug SVG per tier to .probe/w4 (north up: +z is up the page)", () => {
  const out = resolve(import.meta.dir, "../../../.probe/w4")
  mkdirSync(out, { recursive: true })
  const presets: TownSpecInput[] = [
    { seed: 3, tier: "hamlet", harbour: null },
    { seed: 13, tier: "village" },
    { seed: 2, tier: "town" },
    { seed: 1, tier: "city" },
  ]
  for (const spec of presets) {
    const text = svg(make(spec))
    writeFileSync(join(out, `${spec.tier}.svg`), text)
    expect(text).toContain("<path")
  }
})
