import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { buildHouse, type PrefabMeta, type PrefabRecipe } from "@guildhall/assets"
import { roll } from "@guildhall/core"
import {
  add,
  axes,
  closest,
  distTo,
  dot,
  lerp,
  rectCorners,
  rectInPoly,
  rectsOverlap,
  scale,
  sub,
  type Vec2,
} from "../src/index.ts"
import { blocks } from "../src/town/blocks.ts"
import { lotPrefabs, lotRect, lots, type TownLot } from "../src/town/lots.ts"
import { site } from "../src/town/site.ts"
import { streets } from "../src/town/streets.ts"
import type { Block, StreetGraph, Tier, TownLibrary, TownSpecInput } from "../src/town/types.ts"

/** world town: lots (frontage runs packed with oriented lots, corners to the busier street). */

const meta = (id: string, kind: PrefabMeta["kind"], w: number, d: number) =>
  ({
    id,
    kind,
    frontage: w,
    depth: d,
    height: 6,
    door: [0, d / 2],
    stations: [],
    fits: {},
    tags: [],
  }) satisfies PrefabMeta

/** The starter houses as the generator sees them: each recipe's compiled footprint (kit units, not 3 m). */
const DIR = join(import.meta.dir, "../../../data/recipes/houses")
const LIB: TownLibrary = {
  prefabs: readdirSync(DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      const r = JSON.parse(readFileSync(join(DIR, f), "utf8")) as PrefabRecipe
      const h = buildHouse(r.house!, 1)
      return { ...meta(r.id, r.kind, h.frontage, h.depth), door: h.door, fits: r.fits, tags: r.tags }
    }),
  edges: {} as TownLibrary["edges"],
  nature: { trees: [], bushes: [], crops: [], hay: [], rocks: [] },
}

function make(spec: TownSpecInput) {
  const s = site(spec)
  const g = streets(s, spec, (salt) => roll(spec.seed, `${salt}:streets`))
  const b = blocks(g, s, spec, (salt) => roll(spec.seed, `${salt}:blocks`))
  const list = lots(b.blocks, b.graph, LIB, (salt) => roll(spec.seed, salt), spec.tier)
  return { ...b, lots: list }
}
const TIERS: Tier[] = ["hamlet", "village", "town", "city"]
const built = TIERS.flatMap((tier) =>
  [1, 2, 3].map((seed) => ({ spec: { seed, tier }, ...make({ seed, tier }) })),
)
const label = (spec: TownSpecInput, l?: TownLot) => `${spec.tier}#${spec.seed}${l ? ` lot ${l.id}` : ""}`

/** The middle of the lot's front edge, and the lot's +z (toward its street). */
function front(l: TownLot) {
  const z = axes(l.rot).z
  return { at: add(l.origin, scale(z, l.depth / 2)), z }
}

/** The point of the street's centre line nearest p. */
function onStreet(g: StreetGraph, id: number, p: Vec2): Vec2 {
  const pts = g.edges[id]!.points
  let best = { d: Infinity, at: p }
  for (let i = 0; i + 1 < pts.length; i++) {
    const c = closest(p, pts[i]!, pts[i + 1]!)
    if (c.d < best.d) best = c
  }
  return best.at
}

describe("lots", () => {
  test("the starter houses are on disk and measured in kit units", () => {
    expect(LIB.prefabs.length).toBeGreaterThanOrEqual(10)
    for (const p of LIB.prefabs) expect(p.frontage % 3, p.id).not.toBe(0)
  })

  test("is deterministic: the same blocks and seed give the same lots, bit for bit", () => {
    for (const { spec, blocks: b, graph, lots: list } of built.filter((_, i) => i % 3 === 0))
      expect(lots(b, graph, LIB, (salt) => roll(spec.seed, salt), spec.tier)).toEqual(list)
  })

  test("lots lie inside their blocks and never overlap one another", () => {
    for (const { spec, blocks: b, lots: list } of built) {
      expect(list.length, label(spec)).toBeGreaterThan(0)
      const byBlock = new Map<number, TownLot[]>()
      for (const l of list) byBlock.set(l.block, [...(byBlock.get(l.block) ?? []), l])
      for (const [id, group] of byBlock) {
        const block = b[id] as Block
        expect(block.use).toBe("lots")
        for (const l of group) expect(rectInPoly(lotRect(l), block.poly), label(spec, l)).toBe(true)
        for (let i = 0; i < group.length; i++)
          for (let j = i + 1; j < group.length; j++)
            expect(rectsOverlap(lotRect(group[i]!), lotRect(group[j]!)), label(spec, group[i])).toBe(false)
      }
    }
  })

  test("every lot fronts its street: its front edge sits on the kerb and its +z points across it", () => {
    for (const { spec, graph, lots: list } of built) {
      for (const l of list) {
        const e = graph.edges[l.street]!
        const f = front(l)
        // The kerb (0.5 m), a bowed side (≤ 1.5 m) and a nudge (≤ 1 m) at most lie between them.
        expect(distTo(f.at, e.points) - e.width / 2, label(spec, l)).toBeLessThan(3)
        expect(dot(f.z, sub(onStreet(graph, l.street, f.at), f.at)), label(spec, l)).toBeGreaterThan(0)
      }
    }
  })

  test("no lot reaches into a street's ribbon, its own street's or any other's", () => {
    for (const { spec, graph, lots: list } of built)
      for (const l of list)
        for (const e of graph.edges) {
          const ring = rectCorners(lotRect(l))
          // Corners, and the street's own line where it passes the lot's sides.
          for (const c of ring) expect(distTo(c, e.points) - e.width / 2, label(spec, l)).toBeGreaterThan(0)
          for (const p of e.points)
            expect(distTo(p, ring, true) - e.width / 2, label(spec, l)).toBeGreaterThan(0)
        }
  })

  test("a lot is as wide as a building its district builds there, and deep enough for one", () => {
    for (const { spec, lots: list } of built) {
      list.forEach((l, i) => {
        expect(l.id).toBe(i)
        const fits = lotPrefabs(LIB, l.district, spec.tier)
        expect(
          fits.some((p) => Math.abs(p.frontage - l.w) < 0.001),
          label(spec, l),
        ).toBe(true)
        expect(
          fits.some((p) => p.depth <= l.depth + 0.001),
          label(spec, l),
        ).toBe(true)
      })
    }
  })

  test("convex block corners get corner lots, and villages leave gardens", () => {
    for (const { spec, lots: list } of built.filter((x) => x.spec.tier === "town" || x.spec.tier === "city"))
      expect(list.filter((l) => l.status === "corner").length, label(spec)).toBeGreaterThan(10)
    const village = built.filter((x) => x.spec.tier === "village").flatMap((x) => x.lots)
    expect(village.filter((l) => l.status === "garden").length).toBeGreaterThan(0)
  })

  test("a town's frontages are mostly lots (≥ 70% of the block edges on a street have a lot behind them)", () => {
    // A block edge point counts as fronted when a lot covers it (its kerb, bow and nudge allowed), by
    // its front or, at a corner, by its side. Only edges on a street's kerb count: a suburb block's
    // back, set off from the road, faces no street.
    const covered = (p: Vec2, group: readonly TownLot[]) =>
      group.some((l) => {
        const { x, z } = axes(l.rot)
        const q = sub(p, l.origin)
        return Math.abs(dot(q, x)) <= l.w / 2 + 1 && Math.abs(dot(q, z)) <= l.depth / 2 + 2
      })
    const fills: [string, number][] = []
    for (const { spec, blocks: b, graph, lots: list } of built.filter((x) => x.spec.tier !== "hamlet")) {
      const onKerb = (p: Vec2) => graph.edges.some((e) => distTo(p, e.points) - e.width / 2 < 3)
      let all = 0
      let hit = 0
      for (const block of b.filter((x) => x.use === "lots")) {
        const group = list.filter((l) => l.block === block.id)
        block.poly.forEach((p, i) => {
          const q = block.poly[(i + 1) % block.poly.length]!
          const n = Math.ceil(Math.hypot(...sub(q, p)))
          for (let k = 0; k < n; k++) {
            const at = lerp(p, q, (k + 0.5) / n)
            if (!onKerb(at)) continue
            all++
            if (covered(at, group)) hit++
          }
        })
      }
      console.log(`${label(spec)} frontage fill ${((100 * hit) / all).toFixed(1)}%`)
      if (spec.tier !== "village") fills.push([label(spec), hit / all])
    }
    for (const [name, fill] of fills) expect(fill, name).toBeGreaterThanOrEqual(0.7)
  })

  test("no lots without a lots block or a building to put on them", () => {
    const { blocks: b, graph } = built[0]!
    expect(
      lots(
        b.filter((x) => x.use !== "lots"),
        graph,
        LIB,
        () => 0.5,
      ),
    ).toEqual([])
    expect(lots(b, graph, { ...LIB, prefabs: [meta("well", "well", 3, 3)] }, () => 0.5)).toEqual([])
  })
})
