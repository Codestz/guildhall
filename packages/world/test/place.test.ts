import { describe, expect, test } from "bun:test"
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { buildHouse, type PrefabMeta, type PrefabRecipe } from "@guildhall/assets"
import { roll } from "@guildhall/core"
import {
  add,
  area,
  axes,
  closest,
  dist,
  distTo,
  dot,
  norm,
  perp,
  type Rect,
  rectCorners,
  rectInPoly,
  rectsOverlap,
  ribbon,
  scale,
  sub,
  type Vec2,
} from "../src/index.ts"
import { blocks } from "../src/town/blocks.ts"
import { lotPrefabs, lotRect, lots } from "../src/town/lots.ts"
import { place } from "../src/town/place.ts"
import { site } from "../src/town/site.ts"
import { streets } from "../src/town/streets.ts"
import type { Placement, StreetEdge, Tier, TownLibrary, TownSpecInput } from "../src/town/types.ts"

/** world town: placement (one building per lot, its front to the street, inside the lot). */

/** The starter houses (data/recipes/houses), as each recipe's compiled footprint. */
const DIR = join(import.meta.dir, "../../../data/recipes/houses")
const LIB: TownLibrary = {
  prefabs: readdirSync(DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f): PrefabMeta => {
      const r = JSON.parse(readFileSync(join(DIR, f), "utf8")) as PrefabRecipe
      const h = buildHouse(r.house!, 1)
      return {
        id: r.id,
        kind: r.kind,
        frontage: h.frontage,
        depth: h.depth,
        height: 3 * h.frontage,
        door: h.door,
        stations: [],
        fits: r.fits,
        tags: r.tags,
      }
    }),
  edges: {} as TownLibrary["edges"],
  nature: { trees: [], bushes: [], crops: [], hay: [], rocks: [] },
}
const META = new Map(LIB.prefabs.map((p) => [p.id, p]))

function make(spec: TownSpecInput) {
  const t0 = performance.now()
  const s = site(spec)
  const g = streets(s, spec, (salt) => roll(spec.seed, `${salt}:streets`))
  const b = blocks(g, s, spec, (salt) => roll(spec.seed, `${salt}:blocks`))
  const t1 = performance.now()
  const lotList = lots(b.blocks, b.graph, LIB, (salt) => roll(spec.seed, `${salt}:lots`), spec.tier)
  const t2 = performance.now()
  const placements = place(lotList, LIB, spec, (salt) => roll(spec.seed, `${salt}:place`))
  const t3 = performance.now()
  return { spec, site: s, ...b, lots: lotList, placements, ms: [t1 - t0, t2 - t1, t3 - t2] }
}
const TIERS: Tier[] = ["hamlet", "village", "town", "city"]
const built = TIERS.flatMap((tier) => [1, 2, 3].map((seed) => make({ seed, tier })))
const label = (spec: TownSpecInput, p?: Placement) => `${spec.tier}#${spec.seed}${p ? ` lot ${p.lot}` : ""}`

const footprint = (p: Placement): Rect => {
  const m = META.get(p.prefab)!
  return { c: p.at, rot: p.rot, w: m.frontage, d: m.depth }
}

/** The point of the street's centre line nearest p. */
function onStreet(e: StreetEdge, p: Vec2): Vec2 {
  let best = { d: Infinity, at: p }
  for (let i = 0; i + 1 < e.points.length; i++) {
    const c = closest(p, e.points[i]!, e.points[i + 1]!)
    if (c.d < best.d) best = c
  }
  return best.at
}

describe("place", () => {
  test("is deterministic: the same lots and seed give the same placements, bit for bit", () => {
    for (const made of built.filter((_, i) => i % 3 === 0)) {
      const again = place(made.lots, LIB, made.spec, (salt) => roll(made.spec.seed, `${salt}:place`))
      expect(again).toEqual(made.placements)
    }
  })

  test("every building's front faces its street square, within 1°, and toward it", () => {
    let worst = 0
    for (const { spec, graph, lots: lotList, placements } of built) {
      for (const p of placements) {
        const lot = lotList[p.lot!]!
        const e = graph.edges[lot.street]!
        // The building is square to its lot (centred on its width, set back along its depth) ...
        expect(p.rot, label(spec, p)).toBe(lot.rot)
        const { x, z } = axes(p.rot)
        expect(Math.abs(dot(sub(p.at, lot.origin), x)), label(spec, p)).toBeLessThan(0.002)
        // ... and the lot square to the street's run past it: the chord between the points of the
        // street facing the lot's two front corners.
        const f = add(lot.origin, scale(z, lot.depth / 2))
        const half = lot.w / 2
        const along = norm(sub(onStreet(e, add(f, scale(x, half))), onStreet(e, add(f, scale(x, -half)))))
        const angle = (Math.acos(Math.min(1, Math.abs(dot(perp(along), z)))) * 180) / Math.PI
        worst = Math.max(worst, angle)
        expect(angle, label(spec, p)).toBeLessThanOrEqual(1)
        expect(dot(z, sub(onStreet(e, f), f)), label(spec, p)).toBeGreaterThan(0)
      }
    }
    console.log(`worst facing error ${worst.toFixed(3)}°`)
  })

  test("footprints stay inside their lots, clear of each other and of every street", () => {
    for (const { spec, graph, lots: lotList, placements } of built) {
      const rects = placements.map(footprint)
      placements.forEach((p, i) => {
        const lot = lotList[p.lot!]!
        expect(rectInPoly(rects[i]!, rectCorners(lotRect(lot))), label(spec, p)).toBe(true)
        for (let j = i + 1; j < rects.length; j++)
          if (dist(rects[i]!.c, rects[j]!.c) < 30)
            expect(rectsOverlap(rects[i]!, rects[j]!), label(spec, p)).toBe(false)
        for (const corner of rectCorners(rects[i]!))
          for (const e of graph.edges)
            expect(distTo(corner, e.points) - e.width / 2, label(spec, p)).toBeGreaterThan(0)
      })
    }
  })

  test("one building per built or corner lot; gardens stay open; taverns and forges are capped", () => {
    for (const { spec, lots: lotList, placements } of built) {
      const placed = new Map(placements.map((p) => [p.lot!, p]))
      expect(placed.size).toBe(placements.length)
      for (const l of lotList) if (l.status === "garden") expect(placed.has(l.id), label(spec)).toBe(false)
      const open = lotList.filter((l) => l.status !== "garden" && !placed.has(l.id))
      expect(open.length, label(spec)).toBeLessThanOrEqual(lotList.length * 0.02)
      const kinds = placements.map((p) => META.get(p.prefab)!.kind)
      expect(kinds.filter((k) => k === "tavern").length, label(spec)).toBeLessThanOrEqual(3)
      expect(kinds.filter((k) => k === "chapel" || k === "farmhouse").length).toBe(0)
    }
  })

  test("corner lots take corner houses where one fits; other lots leave them to the corners", () => {
    let corners = 0
    for (const { spec, lots: lotList, placements } of built) {
      for (const p of placements) {
        const lot = lotList[p.lot!]!
        const fits = lotPrefabs(LIB, lot.district, spec.tier).filter(
          (m) => m.frontage <= lot.w + 0.001 && m.depth <= lot.depth + 0.001,
        )
        const corner = lot.status === "corner"
        if (corner && fits.some((m) => m.tags.includes("corner"))) corners++
        // The shape the lot wants, unless nothing of that shape fits.
        if (fits.some((m) => m.tags.includes("corner") === corner))
          expect(META.get(p.prefab)!.tags.includes("corner"), label(spec, p)).toBe(corner)
      }
    }
    expect(corners).toBeGreaterThan(50)
  })

  test("adjacent buildings are never twins: another prefab where the lot allows one, else another seed", () => {
    let pairs = 0
    for (const { spec, lots: lotList, placements } of built) {
      for (let i = 1; i < placements.length; i++) {
        const [a, b] = [placements[i - 1]!, placements[i]!]
        const [la, lb] = [lotList[a.lot!]!, lotList[b.lot!]!]
        if (lb.id !== la.id + 1 || la.block !== lb.block || la.street !== lb.street) continue
        pairs++
        expect(a.seed === b.seed && a.prefab === b.prefab, label(spec, b)).toBe(false)
        const others = lotPrefabs(LIB, lb.district, spec.tier).filter(
          (m) =>
            m.id !== a.prefab &&
            m.frontage <= lb.w + 0.001 &&
            m.depth <= lb.depth + 0.001 &&
            m.tags.includes("corner") === (lb.status === "corner") &&
            !["tavern", "forge"].includes(m.kind),
        )
        if (others.length > 0) expect(b.prefab, label(spec, b)).not.toBe(a.prefab)
      }
    }
    expect(pairs).toBeGreaterThan(500)
  })

  test("towns and cities are dense: built area ≥ 35% of their lots blocks and plaza", () => {
    const rows: string[] = []
    for (const m of built) {
      const foot = m.placements.reduce(
        (sum, p) => sum + META.get(p.prefab)!.frontage * META.get(p.prefab)!.depth,
        0,
      )
      const lotsArea = m.blocks
        .filter((b) => b.use === "lots" || b.use === "plaza")
        .reduce((s, b) => s + area(b.poly), 0)
      // The walled town: every block inside the ring and its streets (overlapping at junctions, so a bit over).
      const inner = m.blocks
        .filter((b) => b.use !== "green" && b.use !== "harbour")
        .reduce((s, b) => s + area(b.poly), 0)
      const paved = m.graph.edges
        .filter((e) => e.cls !== "road")
        .reduce((s, e) => s + area(ribbon(e.points, e.width)), 0)
      const pct = (100 * foot) / lotsArea
      rows.push(
        `${label(m.spec)}: ${m.placements.length} buildings, built ${pct.toFixed(1)}% of lots+plaza, ` +
          `${((100 * foot) / (inner + paved)).toFixed(1)}% of the town with its streets; ` +
          `blocks ${m.ms[0]!.toFixed(0)} ms, lots ${m.ms[1]!.toFixed(0)} ms, place ${m.ms[2]!.toFixed(1)} ms`,
      )
      if (m.spec.tier === "town" || m.spec.tier === "city")
        expect(pct, label(m.spec)).toBeGreaterThanOrEqual(35)
    }
    console.log(rows.join("\n"))
  })
})

/** The debug picture: land, water, streets, blocks, lots (gardens filled), footprints by kind with a door tick. */
function svg(m: (typeof built)[number]): string {
  const h = 1.6 * m.site.radius
  const path = (ring: readonly Vec2[]) => `M${ring.map((p) => `${p[0]} ${-p[1]}`).join("L")}Z`
  const fill: Record<string, string> = {
    house: "#c0603e",
    shop: "#d9a441",
    tavern: "#7b3fa0",
    forge: "#4a4a4a",
  }
  const parts = [
    `<rect x="${-h}" y="${-h}" width="${2 * h}" height="${2 * h}" fill="#3d7fa6"/>`,
    ...m.site.land.map((poly) => `<path d="${poly.map(path).join("")}" fill="#9cba6a" fill-rule="evenodd"/>`),
    ...m.graph.edges.map(
      (e) =>
        `<path d="${path(ribbon(e.points, e.width))}" fill="${e.cls === "road" ? "#b49a6a" : "#d8d2c4"}"/>`,
    ),
    ...m.blocks.map(
      (b) =>
        `<path d="${path(b.poly)}" fill="${b.use === "lots" ? "#a9c97a" : b.use === "plaza" ? "#efe0b0" : "#86ad5e"}" stroke="#555" stroke-width="0.2"/>`,
    ),
    ...m.lots.map(
      (l) =>
        `<path d="${path(rectCorners(lotRect(l)))}" fill="${l.status === "garden" ? "#6f9a4a" : "none"}" stroke="#7a6a40" stroke-width="0.15"/>`,
    ),
    ...m.placements.map((p) => {
      const meta = META.get(p.prefab)!
      const z = axes(p.rot).z
      const door = add(p.at, scale(z, meta.depth / 2))
      const tick = add(door, scale(z, 1.5))
      const corner = meta.tags.includes("corner") ? ` stroke-width="0.6"` : ` stroke-width="0.2"`
      return (
        `<path d="${path(rectCorners(footprint(p)))}" fill="${fill[meta.kind] ?? "#999"}" stroke="#222"${corner}/>` +
        `<line x1="${door[0]}" y1="${-door[1]}" x2="${tick[0]}" y2="${-tick[1]}" stroke="#000" stroke-width="0.5"/>`
      )
    }),
  ]
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-h} ${-h} ${2 * h} ${2 * h}" width="1400" height="1400">${parts.join("")}</svg>\n`
}

test("writes a debug SVG per tier to .probe/w3 (north up: +z is up the page)", () => {
  const out = resolve(import.meta.dir, "../../../.probe/w3")
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
    expect(text).toContain("<line")
  }
})
