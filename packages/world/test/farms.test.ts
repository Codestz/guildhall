import { describe, expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import type { PrefabMeta } from "@guildhall/assets"
import { roll } from "@guildhall/core"
import {
  axes,
  bbox,
  contains,
  distTo,
  dot,
  poissonIn,
  type Rect,
  rectCorners,
  rectInPoly,
  rectsOverlap,
  ribbon,
  sub,
  type Vec2,
} from "../src/index.ts"
import { blocks } from "../src/town/blocks.ts"
import { beltReserve, type FarmLibrary, farms, SHORE } from "../src/town/farms.ts"
import { type HarbourLibrary, harbour } from "../src/town/harbour.ts"
import { BELT, type NatureLibrary, nature } from "../src/town/nature.ts"
import { site } from "../src/town/site.ts"
import { normalizeSpec } from "../src/town/spec.ts"
import { streets } from "../src/town/streets.ts"
import type { Placement, Tier, TownSpecInput } from "../src/town/types.ts"

/** world town: farms (fields, farmsteads, orchards) and nature (belt, woods, meadows). */

const meta = (id: string, kind: PrefabMeta["kind"], frontage: number, depth: number): PrefabMeta => ({
  id,
  kind,
  frontage,
  depth,
  height: 7,
  door: [0, depth / 2],
  stations: [],
  fits: {},
  tags: [],
})

/** A library as W6 would build it from the catalog: real ids, the sizes measured there. */
export const LIB: FarmLibrary & NatureLibrary & HarbourLibrary = {
  prefabs: [
    meta("farmhouse-a", "farmhouse", 9, 9),
    meta("barn-a", "shed", 8, 9),
    meta("house-a", "house", 9, 9),
  ],
  edges: {
    wall: { segment: "kenney-castle/wall", length: 4 },
    hedge: { segment: "kenney-town/hedge", length: 3.5, gate: "kenney-town/hedge-gate" },
    fence: { segment: "kenney-town/fence", length: 3.5, gate: "kenney-town/fence-gate" },
  },
  nature: {
    trees: [
      "kaykit-forest/tree-1-c-color1",
      "kaykit-forest/tree-2-d-color1",
      "quaternius-nature/common-tree-1",
      "quaternius-nature/birch-tree-2",
      "quaternius-nature/pine-tree-2",
      "quaternius-nature/pine-tree-3",
    ],
    bushes: ["kaykit-forest/bush-2-e-color1", "quaternius-nature/bush-1", "quaternius-nature/bush-berries-2"],
    crops: ["quaternius-crops/wheat-4"],
    hay: ["kenney-graveyard/hay-bale", "kenney-graveyard/hay-bale-bundled"],
    rocks: ["kaykit-forest/rock-2-c-color1", "kaykit-forest/rock-3-g-color1", "quaternius-nature/rock-3"],
  },
  farm: {
    crops: ["wheat", "corn", "carrot", "pumpkin", "lettuce", "tomato"].map((c) =>
      [2, 3, 4].map((k) => `quaternius-crops/${c}-${k}`),
    ),
    animals: ["quaternius-farm-animals/cow", "quaternius-farm-animals/sheep", "quaternius-farm-animals/pig"],
    orchard: ["quaternius-crops/apple-4", "quaternius-crops/orange-4"],
  },
  wild: {
    pines: ["quaternius-nature/pine-tree-2", "quaternius-nature/pine-tree-3"],
    flowers: ["quaternius-nature/flowers", "kenney-platformer/flowers"],
  },
  harbour: {
    deck: { id: "kenney-town/planks", w: 3.5, d: 3.5 },
    boats: [
      { id: "quaternius-ships/boat", w: 2.2, d: 4 },
      { id: "quaternius-ships/boat-w-sail", w: 2.4, d: 5.9 },
    ],
    cargo: [
      "kenney-pirate/crate",
      "kenney-pirate/barrel",
      "quaternius-props/crate-wooden",
      "kaykit-tools/rope-bundle-a",
    ],
  },
}

const BUILDING = meta("house-a", "house", 9, 9)

/** Stand-in for W3's placements outside the wall: a few houses on the green, wherever one fits. */
function buildings(green: readonly Vec2[][], seed: number): Placement[] {
  const out: Placement[] = []
  green.forEach((poly, i) => {
    for (const p of poissonIn(poly, 40, (salt) => roll(seed, `${i}:${salt}:houses`))) {
      const rect: Rect = { c: p, rot: 0.3, w: BUILDING.frontage, d: BUILDING.depth }
      if (out.length < 4 && rectInPoly(rect, poly))
        out.push({ prefab: BUILDING.id, seed: 1, at: p, rot: 0.3 })
    }
  })
  return out
}

export function make(spec: TownSpecInput) {
  const s = site(spec)
  const g = streets(s, spec, (salt) => roll(spec.seed, `${salt}:streets`))
  const b = blocks(g, s, spec, (salt) => roll(spec.seed, `${salt}:blocks`))
  const houses = buildings(
    b.blocks.filter((x) => x.use === "green").map((x) => x.poly),
    spec.seed,
  )
  const base = {
    spec: normalizeSpec(spec),
    bounds: s.bounds,
    water: s.water,
    streets: b.graph,
    blocks: b.blocks,
  }
  const f = farms({ ...base, placements: houses }, spec, LIB, (salt) => roll(spec.seed, `${salt}:farms`))
  const h = harbour(base, LIB, (salt) => roll(spec.seed, `${salt}:harbour`))
  const placements = [...houses, ...f.placements, ...h.placements]
  const n = nature({ ...base, placements, edges: f.edges, fields: f.fields }, LIB, (salt) =>
    roll(spec.seed, `${salt}:nature`),
  )
  return { site: s, ...base, houses, farms: f, harbour: h, nature: n }
}

const SEEDS = [1, 2, 3, 4, 5, 6]
const TIERS: Tier[] = ["hamlet", "village", "town", "city"]
const built = TIERS.flatMap((tier) =>
  SEEDS.map((seed) => {
    const spec: TownSpecInput = { seed, tier }
    return { spec, ...make(spec) }
  }),
)
const label = (spec: TownSpecInput) => `${spec.tier}#${spec.seed}`
const rectOf = (p: Placement): Rect => ({ c: p.at, rot: p.rot, w: BUILDING.frontage, d: BUILDING.depth })
const inRect = (r: Rect, p: Vec2, pad = 0) => {
  const { x, z } = axes(r.rot)
  const d = sub(p, r.c)
  return Math.abs(dot(d, x)) < r.w / 2 + pad && Math.abs(dot(d, z)) < r.d / 2 + pad
}
const wet = (water: readonly Vec2[][], p: Vec2) => water.some((w) => contains(w, p, 0))
/** Whether p is on a street's ribbon (its kerbed width). */
const onStreet = (m: ReturnType<typeof make>, p: Vec2, pad = 0) =>
  m.streets.edges.some(
    (e) => near(bbox(e.points), p, e.width / 2 + pad) && distTo(p, e.points) < e.width / 2 + pad,
  )
/** Whether p is within `pad` of the box (a cheap test before the exact one). */
const near = ([lo, hi]: [Vec2, Vec2], p: Vec2, pad = 0) =>
  p[0] >= lo[0] - pad && p[0] <= hi[0] + pad && p[1] >= lo[1] - pad && p[1] <= hi[1] + pad

describe("farms", () => {
  test("same spec, same farms", () => {
    for (const m of built.filter((_, i) => i % 5 === 0)) expect(make(m.spec).farms).toEqual(m.farms)
  })

  test("every field is closed by a fence or hedge round its outline, with a gate on its outline", () => {
    for (const { spec, farms: f } of built) {
      for (const field of f.fields) {
        const edge = f.edges.find((e) => e.closed && JSON.stringify(e.points) === JSON.stringify(field.poly))
        expect(edge, label(spec)).toBeDefined()
        expect(["fence", "hedge"]).toContain(edge!.kind)
        const perimeter = field.poly.reduce(
          (sum, p, i) => sum + Math.hypot(...sub(field.poly[(i + 1) % 4]!, p)),
          0,
        )
        for (const g of edge!.gaps) expect(g.s + g.width).toBeLessThanOrEqual(perimeter + 1e-6)
      }
      // Paddocks, yards and orchards are closed too: every farm edge is a closed loop.
      for (const e of f.edges) expect(e.closed).toBe(true)
    }
  })

  test("crops stand in straight rows along the field's long axis, one crop per field", () => {
    for (const { spec, farms: f } of built) {
      for (const field of f.fields) {
        const plants = f.placements.filter((p) => p.role === "crop" && contains(field.poly, p.at, 0))
        expect(plants.length, label(spec)).toBeGreaterThan(20)
        expect(new Set(plants.map((p) => p.prefab))).toEqual(new Set([field.crop]))
        const { x, z } = axes(field.rows)
        // Rows run along local x of `rows`, which is the field's long side.
        const sides = [0, 1].map((i) => Math.hypot(...sub(field.poly[i + 1]!, field.poly[i]!)))
        const long = sub(
          field.poly[sides[0]! >= sides[1]! ? 1 : 2]!,
          field.poly[sides[0]! >= sides[1]! ? 0 : 1]!,
        )
        expect(Math.abs(dot(long, x)) / Math.hypot(...long)).toBeCloseTo(1, 3)
        for (const p of plants) expect(p.rot).toBe(field.rows)
        // Every plant lies on one of a few lines across the field: its offset across the rows repeats.
        const offsets = plants.map((p) => dot(p.at, z)).sort((a, b) => a - b)
        const rows: number[][] = []
        for (const o of offsets) {
          const row = rows[rows.length - 1]
          if (row && o - row[row.length - 1]! < 0.05) row.push(o)
          else rows.push([o])
        }
        expect(rows.length, label(spec)).toBeLessThan(plants.length / 5)
        expect(Math.min(...rows.map((r) => r.length)), label(spec)).toBeGreaterThan(5)
        // The rows lie an even gap apart.
        for (let i = 1; i < rows.length; i++) expect(rows[i]![0]! - rows[i - 1]![0]!).toBeCloseTo(1.6, 1)
      }
    }
  })

  test("nothing of the farms is on a street, in the water, on a building, or in the forest belt", () => {
    const bad: string[] = []
    for (const m of built) {
      const { spec, farms: f, houses } = m
      // The shore band and the belt's reserve inland of it are the woods' ground: the coast is the
      // land's edge (the map is an island in the sea).
      const inland = SHORE[1] + beltReserve(normalizeSpec(spec).radius)
      const inset = (p: Vec2) => m.water.every((w) => distTo(p, w, true) >= inland - 0.01)
      for (const e of f.edges)
        for (let i = 0; i < e.points.length; i++) {
          const a = e.points[i]!
          const b = e.points[(i + 1) % e.points.length]!
          for (let t = 0; t <= 1; t += 0.1) {
            const p: Vec2 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
            if (onStreet(m, p, 0.5)) bad.push(`${label(spec)} edge ${e.id} on a street at ${p}`)
            if (wet(m.water, p)) bad.push(`${label(spec)} edge ${e.id} in water at ${p}`)
            if (!inset(p)) bad.push(`${label(spec)} edge ${e.id} in the belt at ${p}`)
          }
          for (const h of houses)
            if (rectsOverlap(rectOf(h), { c: e.points[0]!, rot: 0, w: 0, d: 0 }) || inRect(rectOf(h), a))
              bad.push(`${label(spec)} edge ${e.id} on a house`)
        }
      for (const p of f.placements) {
        if (onStreet(m, p.at, 0.5) || wet(m.water, p.at)) bad.push(`${label(spec)} ${p.role} at ${p.at}`)
        for (const h of houses) if (inRect(rectOf(h), p.at)) bad.push(`${label(spec)} ${p.role} on a house`)
      }
      // A field never covers a house.
      for (const field of f.fields)
        for (const h of houses)
          for (const c of rectCorners(rectOf(h)))
            if (contains(field.poly, c, 0)) bad.push(`${label(spec)} field over a house`)
    }
    expect(bad).toEqual([])
  })

  test("farmsteads: a farmhouse facing the road with a barn, hay and a paddock of animals", () => {
    for (const { spec, farms: f } of built.filter((x) => x.spec.tier === "town" || x.spec.tier === "city")) {
      const roles = (r: string) => f.placements.filter((p) => p.role === r).length
      expect(roles("farmhouse"), label(spec)).toBeGreaterThanOrEqual(1)
      expect(roles("barn"), label(spec)).toBeGreaterThanOrEqual(1)
      expect(roles("hay"), label(spec)).toBeGreaterThanOrEqual(2)
      expect(roles("animal"), label(spec)).toBeGreaterThanOrEqual(3)
      expect(
        f.stations.some((s) => s.id.startsWith("paddock:")),
        label(spec),
      ).toBe(true)
    }
  })

  test("fields per tier: up to the spec's count, and at least a few once there is farmland", () => {
    const least: Record<Tier, number> = { hamlet: 0, village: 1, town: 6, city: 8, capital: 8 }
    for (const { spec, farms: f } of built) {
      const want = normalizeSpec(spec).farms
      const orchards = f.stations.filter((s) => s.id.startsWith("orchard:")).length
      expect(f.fields.length + orchards, label(spec)).toBeLessThanOrEqual(want)
      expect(f.fields.length + orchards, label(spec)).toBeGreaterThanOrEqual(least[spec.tier])
      expect(f.stations.filter((s) => s.id.startsWith("field:")).length).toBe(f.fields.length)
    }
  })
})

describe("nature", () => {
  test("same plan, same nature", () => {
    for (const m of built.filter((_, i) => i % 5 === 0)) expect(make(m.spec).nature).toEqual(m.nature)
  })

  test("nothing grows on a street, in the water, on a building, in a field or inside a fence", () => {
    const bad: string[] = []
    for (const m of built) {
      const placed = [
        ...m.houses,
        ...m.farms.placements.filter((p) => p.role === "farmhouse" || p.role === "barn"),
      ]
      const boxed = <T>(list: readonly T[], ring: (t: T) => Vec2[]) =>
        list.map((t) => ({ t, box: bbox(ring(t)) }))
      const fields = boxed(m.farms.fields, (f) => f.poly)
      const fences = boxed(m.farms.edges, (e) => e.points)
      const town = boxed(
        m.blocks.filter((b) => b.use !== "green"),
        (b) => b.poly,
      )
      for (const p of m.nature) {
        const where = `${label(m.spec)} ${p.role} ${p.prefab} at ${p.at}`
        if (onStreet(m, p.at, 0.5)) bad.push(`${where}: on a street`)
        if (wet(m.water, p.at)) bad.push(`${where}: in water`)
        for (const h of placed)
          if (inRect({ c: h.at, rot: h.rot, w: 9, d: 9 }, p.at, 0.5)) bad.push(`${where}: on a building`)
        for (const { t: f, box } of fields)
          if (near(box, p.at) && contains(f.poly, p.at, 0)) bad.push(`${where}: in a field`)
        for (const { t: e, box } of fences)
          if (near(box, p.at) && contains(e.points, p.at, 0)) bad.push(`${where}: inside a fence`)
        if (town.some(({ t: b, box }) => near(box, p.at) && contains(b.poly, p.at, 0)))
          bad.push(`${where}: in a town block`)
      }
    }
    expect(bad).toEqual([])
  })

  test("trees per tier: the larger the town, the more woods round it", () => {
    const least: Record<Tier, number> = { hamlet: 60, village: 150, town: 300, city: 500, capital: 500 }
    for (const m of built)
      expect(m.nature.filter((p) => p.role === "tree").length, label(m.spec)).toBeGreaterThanOrEqual(
        least[m.spec.tier],
      )
  })

  test("the coast closes the land: an open shore band of rocks, then a forest belt inland of it", () => {
    for (const m of built.filter((x) => x.spec.tier !== "hamlet")) {
      const fromCoast = (p: Vec2) => Math.min(...m.water.map((w) => distTo(p, w, true)))
      const trees = m.nature.filter((p) => p.role === "tree")
      // No tree on the shore itself; rocks along it.
      for (const t of trees) expect(fromCoast(t.at), label(m.spec)).toBeGreaterThan(SHORE[0])
      expect(m.nature.some((p) => p.role === "rock" && fromCoast(p.at) < SHORE[1])).toBe(true)
      // A good share of the trees stand in the belt along the coast.
      const belt = trees.filter((p) => fromCoast(p.at) < SHORE[1] + BELT[1]).length
      expect(belt / trees.length, label(m.spec)).toBeGreaterThan(0.25)
      // Every role turns up.
      for (const role of ["tree", "bush", "rock", "flower"])
        expect(
          m.nature.some((p) => p.role === role),
          `${label(m.spec)} ${role}`,
        ).toBe(true)
      // Woods mix species: pines and broadleaf both.
      const pines = new Set(LIB.wild!.pines)
      expect(trees.some((p) => pines.has(p.prefab))).toBe(true)
      expect(trees.some((p) => !pines.has(p.prefab))).toBe(true)
    }
  })
})

/** The debug picture: the whole map (the island in its sea), then farms, harbour and nature on top. */
function svg(m: ReturnType<typeof make>): string {
  const [lo, hi] = bbox(m.bounds)
  const box = `${lo[0]} ${-hi[1]} ${hi[0] - lo[0]} ${hi[1] - lo[1]}`
  const path = (ring: readonly Vec2[], close = true) =>
    `M${ring.map((p) => `${p[0]} ${-p[1]}`).join("L")}${close ? "Z" : ""}`
  const poly = (ring: readonly Vec2[], fill: string, extra = "") =>
    `<path d="${path(ring)}" fill="${fill}" ${extra}/>`
  const dot2 = (p: Vec2, r: number, fill: string) =>
    `<circle cx="${p[0]}" cy="${-p[1]}" r="${r}" fill="${fill}"/>`
  const rect = (r: Rect, fill: string, extra = "") => poly(rectCorners(r), fill, extra)
  const cropColour = (id: string) =>
    ({
      wheat: "#d9b84a",
      corn: "#b9c24a",
      carrot: "#e08a3c",
      pumpkin: "#d8742c",
      lettuce: "#8cc55a",
      tomato: "#c8483a",
    })[id.split("/")[1]!.replace(/-\d$/, "")] ?? "#c9a"
  const pines = new Set(LIB.wild!.pines)
  const parts: string[] = [
    `<rect x="${lo[0]}" y="${-hi[1]}" width="${hi[0] - lo[0]}" height="${hi[1] - lo[1]}" fill="#3d7fa6"/>`,
    ...m.site.land.map(
      (p) => `<path d="${p.map((r) => path(r)).join("")}" fill="#9cba6a" fill-rule="evenodd"/>`,
    ),
    ...m.blocks
      .filter((b) => b.use !== "green")
      .map((b) => poly(b.poly, b.use === "harbour" ? "#d8c58e" : "#c9b9a0")),
    ...m.harbour.quay.map((q) => poly(q, "#b8956a")),
    ...m.streets.edges.map((e) => poly(ribbon(e.points, e.width), e.cls === "road" ? "#b49a6a" : "#d8d2c4")),
    ...m.farms.fields.map((f) => poly(f.poly, "#8a6a42")),
    ...m.farms.placements.filter((p) => p.role === "crop").map((p) => dot2(p.at, 0.45, cropColour(p.prefab))),
    ...m.farms.edges.map(
      (e) =>
        `<path d="${path(e.points)}" fill="none" stroke="${e.kind === "hedge" ? "#2f6b2a" : "#6b4a2a"}" stroke-width="${e.kind === "hedge" ? 1.2 : 0.5}"/>`,
    ),
    ...m.houses.map((p) => rect(rectOf(p), "#7a2", 'stroke="#000" stroke-width="0.3"')),
    ...m.farms.placements
      .filter((p) => p.role === "farmhouse" || p.role === "barn")
      .map((p) =>
        rect(
          { c: p.at, rot: p.rot, w: p.role === "barn" ? 8 : 9, d: 9 },
          p.role === "barn" ? "#a33" : "#c96",
          'stroke="#000" stroke-width="0.3"',
        ),
      ),
    ...m.farms.placements.filter((p) => p.role === "hay").map((p) => dot2(p.at, 0.7, "#f2d24a")),
    ...m.farms.placements.filter((p) => p.role === "animal").map((p) => dot2(p.at, 0.8, "#fff")),
    ...m.farms.placements.filter((p) => p.role === "orchard").map((p) => dot2(p.at, 1.8, "#5f9e3a")),
    ...m.harbour.placements
      .filter((p) => p.role === "pier")
      .map((p) =>
        rect({ c: p.at, rot: p.rot, w: 3.5, d: 3.5 }, "#9b6b3a", 'stroke="#5a3a1a" stroke-width="0.2"'),
      ),
    ...m.harbour.placements
      .filter((p) => p.role === "boat")
      .map((p) => {
        const b = LIB.harbour!.boats!.find((x) => x.id === p.prefab)!
        return rect({ c: p.at, rot: p.rot, w: b.w, d: b.d }, "#6b3f1f", 'stroke="#fff" stroke-width="0.2"')
      }),
    ...m.harbour.placements.filter((p) => p.role === "cargo").map((p) => dot2(p.at, 0.5, "#4a2a10")),
    ...m.nature.map((p) =>
      p.role === "tree"
        ? dot2(p.at, pines.has(p.prefab) ? 1.5 : 2.1, pines.has(p.prefab) ? "#1f5a2c" : "#3f8a32")
        : p.role === "bush"
          ? dot2(p.at, 0.9, "#4f7f2a")
          : p.role === "rock"
            ? dot2(p.at, 0.8, "#888")
            : dot2(p.at, 0.5, "#e57ab8"),
    ),
    ...[...m.farms.stations, ...m.harbour.stations].map((s) => dot2(s.at, 0.9, "#e00")),
  ]
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}" width="1600" height="1600">${parts.join("")}</svg>\n`
}

test("writes a debug SVG per tier to .probe/w5 (north up: +z is up the page)", () => {
  const out = resolve(import.meta.dir, "../../../.probe/w5")
  mkdirSync(out, { recursive: true })
  const presets: TownSpecInput[] = [
    { seed: 3, tier: "hamlet", harbour: null },
    { seed: 13, tier: "village" },
    { seed: 2, tier: "town" },
    { seed: 1, tier: "city" },
  ]
  for (const spec of presets) {
    const m = make(spec)
    const text = svg(m)
    writeFileSync(join(out, `${spec.tier}.svg`), text)
    expect(text).toContain("<path")
  }
})
