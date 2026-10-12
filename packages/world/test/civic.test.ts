import { describe, expect, test } from "bun:test"
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { PALETTE, type PrefabMeta, validatePrefab } from "@guildhall/assets"
import {
  axes,
  bbox,
  centroid,
  dist,
  distTo,
  lotRect,
  rectCorners,
  rectInPoly,
  ribbon,
  site,
  type TownLayout,
  type TownSpecInput,
  type Vec2,
} from "../src/index.ts"
import { civicKind } from "../src/town/civic.ts"
import { KEEP_RECIPE } from "../src/town/landmark.ts"
import { lotPrefabs } from "../src/town/lots.ts"
import { LIB, label, PRESETS, town } from "./town.fixture.ts"

/** world town: civic, working and open-space buildings, claimed before the houses (civic.ts). */

const META = new Map(LIB.prefabs.map((m) => [m.id, m]))
const kindOf = (prefab: string) => {
  const m = META.get(prefab)
  return m ? civicKind(m) : null
}
const civicOf = (plan: TownLayout) =>
  plan.placements.filter((p) => kindOf(p.prefab) !== null).map((p) => ({ p, kind: kindOf(p.prefab) }))
const houses = (plan: TownLayout) =>
  plan.placements.filter((p) => p.lot !== undefined && kindOf(p.prefab) === null && META.has(p.prefab))
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0
const [HAMLET, VILLAGE, TOWN, CITY] = PRESETS as [TownSpecInput, TownSpecInput, TownSpecInput, TownSpecInput]

describe("civic recipes (data/recipes/landmarks)", () => {
  const dir = join(import.meta.dir, "../../../data/recipes/landmarks")
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"))

  test("each validates against the palette, is named for its file and saved as the composer writes", () => {
    expect(files.length).toBeGreaterThanOrEqual(15)
    for (const f of files) {
      const text = readFileSync(join(dir, f), "utf8")
      const json = JSON.parse(text)
      expect(validatePrefab(json, PALETTE), f).toEqual([])
      expect(json.id, f).toBe(f.slice(0, -5))
      const sorted = (_k: string, v: unknown) =>
        v && typeof v === "object" && !Array.isArray(v)
          ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)))
          : v
      expect(text, f).toBe(`${JSON.stringify(json, sorted, 2)}\n`)
    }
  })

  test("the keep the castle asks for exists, and every civic kind has a recipe", () => {
    expect(META.get(KEEP_RECIPE)?.tags).toContain("keep")
    const kinds = new Set(LIB.prefabs.map((m) => civicKind(m)).filter((k) => k !== null))
    for (const k of [
      "guildhall",
      "market-hall",
      "chapel",
      "inn",
      "warehouse",
      "stables",
      "works-yard",
      "bakery",
      "tower",
      "windmill",
      "watermill",
      "open",
    ])
      expect(kinds.has(k as never), k).toBe(true)
  })

  test("are never drawn for an ordinary lot", () => {
    for (const d of ["market", "residential", "craft", "harbour", "farm"] as const)
      for (const p of lotPrefabs(LIB, d, "city")) expect(p.tags, p.id).not.toContain("civic")
  })
})

describe("claimCivic, through generateTown", () => {
  test("each tier gets its civic buildings: more and grander as the town grows", () => {
    const has = (s: TownSpecInput) => new Set(civicOf(town(s)).map((c) => c.kind))
    expect([...has(HAMLET)]).toContain("open")
    for (const k of ["chapel", "inn", "bakery", "windmill", "open"]) expect([...has(VILLAGE)], k).toContain(k)
    for (const k of ["guildhall", "market-hall", "chapel", "inn", "stables", "bakery", "tower", "open"])
      expect([...has(TOWN)], k).toContain(k)
    for (const k of ["guildhall", "market-hall", "chapel", "inn", "warehouse", "tower", "works-yard"])
      expect([...has(CITY)], k).toContain(k)
    const count = (s: TownSpecInput) => civicOf(town(s)).length
    expect(count(HAMLET)).toBeLessThan(count(VILLAGE))
    expect(count(VILLAGE)).toBeLessThan(count(TOWN))
    expect(count(TOWN)).toBeLessThan(count(CITY))
    expect(town(CITY).placements.some((p) => p.prefab === KEEP_RECIPE)).toBe(true)
  })

  test("each civic building stands on one lot of its own, inside it, its front on the street", () => {
    for (const s of PRESETS) {
      const plan = town(s)
      const lots = new Map(plan.lots.map((l) => [l.id, l]))
      for (const { p } of civicOf(plan)) {
        const lot = lots.get(p.lot ?? -1)
        expect(lot, `${label(s)} ${p.prefab}`).toBeDefined()
        if (!lot) continue
        expect(lot.prefab).toBe(p.prefab)
        expect(p.rot).toBe(lot.rot)
        const m = META.get(p.prefab) as PrefabMeta
        expect(
          rectInPoly({ c: p.at, rot: p.rot, w: m.frontage, d: m.depth }, rectCorners(lotRect(lot)), 0.05),
        ).toBe(true)
        // Its front is the lot's front.
        const front = dist(p.at, lot.origin) - (lot.depth - m.depth) / 2
        expect(Math.abs(front), `${label(s)} ${p.prefab}`).toBeLessThan(0.01)
        const block = plan.blocks.find((b) => b.id === lot.block)
        expect(block && rectInPoly(lotRect(lot), block.poly, 0.05), `${label(s)} ${p.prefab}`).toBe(true)
      }
    }
  })

  test("site rules: the guildhall on the market, the inn by a gate, warehouses on the water, squares apart", () => {
    for (const s of [TOWN, CITY]) {
      const plan = town(s)
      const c = centroid(plan.plazas[0] as Vec2[])
      const r = plan.spec.radius ?? 100
      const civic = civicOf(plan)
      const at = (k: string) => civic.filter((x) => x.kind === k).map((x) => x.p.at)
      // The guildhall and the market hall stand on the market square or a block back from it (the blocks
      // round it are small wedges between the streets that leave it, so a wide hall often stands behind).
      const plaza = plan.plazas[0] as Vec2[]
      for (const k of ["guildhall", "market-hall"]) {
        const p = civic.find((x) => x.kind === k)?.p as (typeof civic)[number]["p"]
        const m = META.get(p.prefab) as PrefabMeta
        expect(distTo(p.at, plaza, true) - m.depth / 2, `${label(s)} ${k}`).toBeLessThan(0.3 * r)
      }
      const gates = plan.streets.nodes.filter((n) => n.kind === "gate").map((n) => n.at)
      const inn = at("inn")[0] as Vec2
      expect(Math.min(...gates.map((g) => dist(g, inn))), label(s)).toBeLessThan(0.45 * r)
      const open = at("open")
      for (const [i, a] of open.entries())
        for (const b of open.slice(i + 1)) expect(dist(a, b), label(s)).toBeGreaterThanOrEqual(45)
    }
    const city = town(CITY)
    const shore = city.blocks.filter((b) => b.use === "harbour")
    const quays = city.streets.nodes.filter((n) => n.kind === "quay").map((n) => n.at)
    for (const w of civicOf(city).filter((x) => x.kind === "warehouse")) {
      const d = Math.min(
        ...quays.map((q) => dist(q, w.p.at)),
        ...shore.map((b) => distTo(w.p.at, b.poly, true)),
      )
      expect(d).toBeLessThanOrEqual(35)
    }
  })

  test("skyline: the keep, spire and towers stand well above the houses' roofline", () => {
    for (const s of [VILLAGE, TOWN, CITY]) {
      const plan = town(s)
      const roofline = median(houses(plan).map((p) => META.get(p.prefab)?.height ?? 0))
      const tall = civicOf(plan)
        .filter((x) => META.get(x.p.prefab)?.tags.includes("skyline"))
        .map((x) => META.get(x.p.prefab)?.height ?? 0)
      expect(tall.length, label(s)).toBeGreaterThanOrEqual(s.tier === "village" ? 2 : 4)
      expect(Math.max(...tall), label(s)).toBeGreaterThanOrEqual(1.6 * roofline)
    }
    const city = town(CITY)
    const roofline = median(houses(city).map((p) => META.get(p.prefab)?.height ?? 0))
    expect(META.get(KEEP_RECIPE)?.height ?? 0).toBeGreaterThanOrEqual(2 * roofline)
  })

  test("house heights lean: taller houses near the market, lower ones out by the walls", () => {
    for (const s of [TOWN, CITY]) {
      const plan = town(s)
      const c = centroid(plan.plazas[0] as Vec2[])
      const r = plan.spec.radius ?? 100
      const h = (p: { prefab: string }) => META.get(p.prefab)?.height ?? 0
      const inner = houses(plan).filter((p) => dist(p.at, c) < 0.5 * r)
      const outer = houses(plan).filter((p) => dist(p.at, c) > 0.7 * r)
      const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
      expect(mean(inner.map(h)), label(s)).toBeGreaterThan(mean(outer.map(h)) + 0.5)
    }
  })
})

/** The plan with its civic buildings labelled: everything else grey, civic footprints coloured by kind. */
function svg(plan: TownLayout): string {
  const c = centroid(plan.plazas[0] as Vec2[])
  const h = 1.15 * (plan.spec.radius ?? 100)
  const [lo, hi]: Vec2[] = [
    [c[0] - h, c[1] - h],
    [c[0] + h, c[1] + h],
  ]
  const path = (ring: readonly Vec2[]) => `M${ring.map((p) => `${p[0]} ${-p[1]}`).join("L")}Z`
  const land = site(plan.spec).land
  const colour: Record<string, string> = {
    keep: "#3b5ba5",
    guildhall: "#e0a800",
    "market-hall": "#f07c2a",
    chapel: "#ffffff",
    inn: "#a0302a",
    warehouse: "#7a5230",
    stables: "#b08850",
    "works-yard": "#333",
    bakery: "#e8b080",
    tower: "#6a3fa0",
    windmill: "#2a9d8f",
    watermill: "#1d6fa5",
    open: "#5fbf4a",
  }
  const parts = [
    `<rect x="${lo[0]}" y="${-hi[1]}" width="${2 * h}" height="${2 * h}" fill="#3d7fa6"/>`,
    ...land.map((p) => `<path d="${p.map(path).join("")}" fill="#9cba6a" fill-rule="evenodd"/>`),
    ...plan.blocks.map(
      (b) => `<path d="${path(b.poly)}" fill="${b.use === "plaza" ? "#efe0b0" : "#c9c0a8"}"/>`,
    ),
    ...plan.streets.edges.map((e) => `<path d="${path(ribbon(e.points, e.width))}" fill="#e2dccd"/>`),
    ...plan.placements.flatMap((p) => {
      const size = plan.sizes[p.prefab]
      if (!size || p.lot === undefined) {
        if (p.prefab !== KEEP_RECIPE || !size) return []
      }
      const kind = p.prefab === KEEP_RECIPE ? "keep" : kindOf(p.prefab)
      const [w, d] = size as [number, number]
      const fill = kind ? (colour[kind] ?? "#f0f") : "#a8a29a"
      const stroke = kind ? `stroke="#000" stroke-width="0.6"` : `stroke="#777" stroke-width="0.15"`
      const tick = kind
        ? (() => {
            const z = axes(p.rot).z
            const a = [p.at[0] + z[0] * (d / 2), p.at[1] + z[1] * (d / 2)]
            const b = [a[0] + z[0] * 3, a[1] + z[1] * 3]
            return `<line x1="${a[0]}" y1="${-a[1]}" x2="${b[0]}" y2="${-b[1]}" stroke="#000" stroke-width="0.8"/>`
          })()
        : ""
      return [
        `<path d="${path(rectCorners({ c: p.at, rot: p.rot, w, d }))}" fill="${fill}" ${stroke}/>${tick}`,
      ]
    }),
    ...plan.edges
      .filter((e) => e.kind === "wall")
      .map(
        (e) =>
          `<path d="M${e.points.map((p) => `${p[0]} ${-p[1]}`).join("L")}${e.closed ? "Z" : ""}" fill="none" stroke="#5d5a56" stroke-width="2.4"/>`,
      ),
    ...civicOf(plan).map(
      ({ p, kind }) =>
        `<text x="${p.at[0]}" y="${-p.at[1]}" font-size="5" font-family="sans-serif" text-anchor="middle" fill="#000" stroke="#fff" stroke-width="0.6" paint-order="stroke">${kind}</text>`,
    ),
  ]
  const [bl, bh] = bbox([lo, hi])
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bl[0]} ${-bh[1]} ${2 * h} ${2 * h}" width="1600" height="1600">${parts.join("")}</svg>\n`
}

test("writes a civic debug SVG per tier to .probe/variety (north up: +z is up the page)", () => {
  const out = resolve(import.meta.dir, "../../../.probe/variety")
  mkdirSync(out, { recursive: true })
  for (const s of PRESETS) {
    const text = svg(town(s))
    writeFileSync(join(out, `${s.tier}.svg`), text)
    expect(text).toContain("<path")
  }
})
