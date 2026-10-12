import { describe, expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { roll } from "@guildhall/core"
import {
  area,
  bbox,
  centroid,
  contains,
  dist,
  distTo,
  intersect,
  lerp,
  obb,
  ribbon,
  type Vec2,
} from "../src/index.ts"
import { blocks, KERB, LOT_DEPTH } from "../src/town/blocks.ts"
import { site } from "../src/town/site.ts"
import { TIER_DEFAULTS } from "../src/town/spec.ts"
import { streets, townLand } from "../src/town/streets.ts"
import type { Block, StreetGraph, Tier, TownSpecInput } from "../src/town/types.ts"

/** world town: blocks (faces of the street graph, inset by the streets, cut by lanes until they fit). */

const SEEDS = Array.from({ length: 10 }, (_, i) => i + 1)
const TIERS: Tier[] = ["hamlet", "village", "town", "city"]

function make(spec: TownSpecInput) {
  const s = site(spec)
  const g = streets(s, spec, (salt) => roll(spec.seed, `${salt}:streets`))
  return { site: s, ...blocks(g, s, spec, (salt) => roll(spec.seed, `${salt}:blocks`)) }
}
const built = TIERS.flatMap((tier) =>
  SEEDS.map((seed) => {
    const spec: TownSpecInput = { seed, tier }
    return { spec, ...make(spec) }
  }),
)
const label = (spec: TownSpecInput) => `${spec.tier}#${spec.seed}`

/** Whether any two sides of the ring that are not neighbours cross or touch. */
function selfCrossing(ring: readonly Vec2[]): boolean {
  const n = ring.length
  for (let i = 0; i < n; i++)
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue
      if (intersect(ring[i]!, ring[(i + 1) % n]!, ring[j]!, ring[(j + 1) % n]!)) return true
    }
  return false
}

/** Points along the ring's sides, about `step` apart. */
function along(ring: readonly Vec2[], step: number): Vec2[] {
  return ring.flatMap((p, i) => {
    const q = ring[(i + 1) % ring.length]!
    const k = Math.max(1, Math.ceil(dist(p, q) / step))
    return Array.from({ length: k }, (_, j) => lerp(p, q, j / k))
  })
}

function connected(g: StreetGraph): boolean {
  const seen = new Set([0])
  const stack = [0]
  while (stack.length > 0) {
    const v = stack.pop()!
    for (const e of g.edges) {
      const w = e.a === v ? e.b : e.b === v ? e.a : -1
      if (w >= 0 && !seen.has(w)) {
        seen.add(w)
        stack.push(w)
      }
    }
  }
  return seen.size === g.nodes.length
}

describe("blocks", () => {
  test("is deterministic: the same spec gives the same blocks and graph, bit for bit", () => {
    for (const { spec, blocks: b, graph } of built.filter((_, i) => i % 4 === 0)) {
      const again = make(spec)
      expect(again.blocks).toEqual(b)
      expect(again.graph).toEqual(graph)
    }
  })

  test("every block is a simple counter-clockwise polygon on the town's land", () => {
    for (const { spec, site: s, blocks: list } of built) {
      const land = townLand(s)
      for (const b of list) {
        expect(b.poly.length, label(spec)).toBeGreaterThanOrEqual(3)
        expect(area(b.poly)).toBeGreaterThan(0)
        expect(selfCrossing(b.poly), `${label(spec)} block ${b.id}`).toBe(false)
        for (const p of b.poly) expect(contains(land, p, 0.01), `${label(spec)} ${p}`).toBe(true)
        // Nothing of the water reaches inside a block.
        for (const w of s.water)
          for (const p of w) expect(contains(b.poly, p, 0) && distTo(p, b.poly, true) > 0.01).toBe(false)
      }
    }
  })

  test.each(TIERS)("every block keeps clear of the street ribbons, by about the kerb (%s)", (tier) => {
    const bad: string[] = []
    const strictlyIn = (shape: Vec2[], p: Vec2) => contains(shape, p, 0) && distTo(p, shape, true) > 0.01
    for (const { spec, blocks: list, graph } of built.filter((x) => x.spec.tier === tier)) {
      // Half the kerb is allowed to go at junction corners, where ribbons end square.
      const ribbons = graph.edges.map((e) => ribbon(e.points, e.width + KERB))
      const boxes = ribbons.map((r) => bbox(r))
      for (const b of list) {
        const [min, max] = bbox(b.poly)
        const near = ribbons.filter((_, i) => {
          const [lo, hi] = boxes[i]!
          return lo[0] <= max[0] && hi[0] >= min[0] && lo[1] <= max[1] && hi[1] >= min[1]
        })
        const edge = along(b.poly, 1)
        for (const r of near) {
          for (const p of edge)
            if (strictlyIn(r, p)) bad.push(`${label(spec)} block ${b.id}: ${p} in a street`)
          for (const p of r)
            if (strictlyIn(b.poly, p)) bad.push(`${label(spec)} block ${b.id}: street at ${p}`)
        }
      }
    }
    expect(bad).toEqual([])
  })

  test.each(TIERS)("blocks tile the town's land: no overlaps, and every gap is street (%s)", (tier) => {
    for (const { spec, site: s, blocks: list, graph } of built.filter((x) => x.spec.tier === tier)) {
      const land = townLand(s)
      const [min, max] = bbox(land[0]!)
      const boxes = list.map((b) => bbox(b.poly))
      const within = (box: [Vec2, Vec2], p: Vec2, pad = 0) =>
        p[0] >= box[0][0] - pad &&
        p[0] <= box[1][0] + pad &&
        p[1] >= box[0][1] - pad &&
        p[1] <= box[1][1] + pad
      const streetBoxes = graph.edges.map((e) => bbox(e.points))
      let samples = 0
      let unexplained = 0
      const overlaps: string[] = []
      for (let x = min[0] + 0.5; x < max[0]; x += 3)
        for (let z = min[1] + 0.5; z < max[1]; z += 3) {
          const p: Vec2 = [x, z]
          if (!contains(land, p, 0)) continue
          samples++
          const inside = list.filter((b, i) => within(boxes[i]!, p) && contains(b.poly, p, 0))
          if (inside.length > 1) overlaps.push(`${p}: ${inside.map((b) => b.id)}`)
          if (inside.length >= 1) continue
          // A gap is street: within the kerbed ribbon (and a little for the corner discs) of a street.
          const street = graph.edges.some(
            (e, i) => within(streetBoxes[i]!, p, 5) && distTo(p, e.points) <= e.width / 2 + KERB + 0.6,
          )
          if (!street) unexplained++
        }
      expect(overlaps, label(spec)).toEqual([])
      expect(unexplained / samples, label(spec)).toBeLessThan(0.002)
    }
  })

  test("lots blocks respect the tier's street density: area ≤ amax, short side ≤ two lot depths", () => {
    for (const { spec, blocks: list } of built) {
      const amax = TIER_DEFAULTS[spec.tier].amax
      for (const b of list.filter((x) => x.use === "lots")) {
        expect(area(b.poly), `${label(spec)} block ${b.id}`).toBeLessThanOrEqual(amax)
        expect(obb(b.poly).d, `${label(spec)} block ${b.id}`).toBeLessThanOrEqual(2 * LOT_DEPTH)
      }
    }
  })

  test("the street graph with its lanes stays connected; towns and cities gain lanes", () => {
    for (const { spec, graph } of built) {
      expect(connected(graph), label(spec)).toBe(true)
      if (spec.tier === "town" || spec.tier === "city")
        expect(graph.edges.some((e) => e.cls === "lane")).toBe(true)
    }
  })

  test("one plaza block holds the plaza; a castle gets its block; harbour blocks only by water", () => {
    for (const { spec, site: s, blocks: list } of built) {
      const plaza = list.filter((b) => b.use === "plaza")
      expect(plaza.length, label(spec)).toBe(1)
      expect(contains(plaza[0]!.poly, centroid(s.plaza))).toBe(true)
      const castle = list.filter((b) => b.use === "castle")
      if (s.castleSite)
        expect(
          castle.some((b) => contains(b.poly, s.castleSite!.c)),
          label(spec),
        ).toBe(true)
      else expect(castle).toEqual([])
      if (s.water.length === 0)
        expect(list.some((b) => b.use === "harbour" || b.district === "harbour")).toBe(false)
      for (const b of list.filter((x) => x.use === "lots"))
        expect(["farm", "castle"]).not.toContain(b.district)
    }
  })

  test("a town has 20–60 blocks (plan: 25–60; see the W2 report)", () => {
    for (const { spec, blocks: list } of built.filter((x) => x.spec.tier === "town"))
      expect(list.length, label(spec)).toBeGreaterThanOrEqual(20)
    for (const { spec, blocks: list } of built.filter((x) => x.spec.tier === "town"))
      expect(list.length, label(spec)).toBeLessThanOrEqual(60)
  })
})

/** The debug picture: land, water, street ribbons, blocks by use and district, nodes by kind. */
function svg(made: ReturnType<typeof make>): string {
  const h = 1.3 * made.site.radius
  const path = (ring: readonly Vec2[]) => `M${ring.map((p) => `${p[0]} ${-p[1]}`).join("L")}Z`
  const fill = (b: Block) =>
    b.use === "plaza"
      ? "#efe0b0"
      : b.use === "green"
        ? "#86ad5e"
        : b.use === "castle"
          ? "#8a8a8a"
          : {
              market: "#e6b45c",
              residential: "#c97a5a",
              craft: "#8d72b3",
              harbour: "#5aa3ab",
              castle: "#8a8a8a",
              farm: "#86ad5e",
            }[b.district]
  const nodeFill = { gate: "#d22", plaza: "#f90", quay: "#13c", end: "#000", junction: "#444" } as const
  const parts = [
    `<rect x="${-h}" y="${-h}" width="${2 * h}" height="${2 * h}" fill="#3d7fa6"/>`,
    ...made.site.land.map(
      (poly) => `<path d="${poly.map(path).join("")}" fill="#9cba6a" fill-rule="evenodd"/>`,
    ),
    ...made.graph.edges.map(
      (e) =>
        `<path d="${path(ribbon(e.points, e.width))}" fill="${e.cls === "road" ? "#b49a6a" : "#d8d2c4"}"/>`,
    ),
    ...made.blocks.map(
      (b) => `<path d="${path(b.poly)}" fill="${fill(b)}" stroke="#333" stroke-width="0.3"/>`,
    ),
    ...made.graph.nodes.map(
      (n) =>
        `<circle cx="${n.at[0]}" cy="${-n.at[1]}" r="${n.kind === "junction" ? 0.8 : 2}" fill="${nodeFill[n.kind]}"/>`,
    ),
  ]
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-h} ${-h} ${2 * h} ${2 * h}" width="1000" height="1000">${parts.join("")}</svg>\n`
}

test("writes a debug SVG per tier to .probe/w2 (north up: +z is up the page)", () => {
  const out = resolve(import.meta.dir, "../../../.probe/w2")
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
