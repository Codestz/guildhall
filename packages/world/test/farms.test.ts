import { describe, expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import type { PrefabMeta } from "@guildhall/assets"
import { roll } from "@guildhall/core"
import {
  axes,
  bbox,
  contains,
  dist,
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
import { BELT, type NatureLibrary, nature, natureField, SLOTS, VIGNETTES } from "../src/town/nature.ts"
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
    birches: ["quaternius-nature/birch-tree-1", "quaternius-nature/birch-tree-3"],
    willows: ["quaternius-nature/willow-2", "quaternius-nature/willow-4"],
    grass: ["kenney-nature/grass-large", "quaternius-nature/grass-2"],
    reeds: ["kenney-nature/grass-leafs-large"],
    mushrooms: ["kenney-nature/mushroom-red-group", "kenney-nature/mushroom-tan-group"],
    logs: ["quaternius-nature/wood-log-moss", "kenney-nature/log"],
    stumps: ["kenney-nature/stump-old", "quaternius-nature/tree-stump-moss"],
    boulders: ["kenney-nature/rock-large-b", "kaykit-forest/rock-3-k-color1"],
    stones: ["kenney-nature/stone-small-flat-a", "kenney-nature/rock-small-flat-b"],
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
  const input = { ...base, placements, edges: f.edges, fields: f.fields }
  const draw = (salt: string) => roll(spec.seed, `${salt}:nature`)
  const field = natureField(input, draw)
  const n = nature(input, LIB, draw, field)
  return { site: s, ...base, houses, farms: f, harbour: h, nature: n, field }
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
  }, 30_000)

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

describe("nature: composed, not scattered", () => {
  const big = built.filter((x) => x.spec.tier === "town" || x.spec.tier === "city")
  const trees = (m: (typeof built)[number]) => m.nature.filter((p) => p.role === "tree")
  const pines = new Set(LIB.wild!.pines)
  const odd = new Set([...LIB.wild!.pines!, ...LIB.wild!.birches!, ...LIB.wild!.willows!])

  test("woods are clusters with open meadow between, not an even scatter", () => {
    for (const m of big) {
      // 20 m cells of the inland green: many hold no tree at all, many hold a closed stand.
      const counts = new Map<string, number>()
      for (const t of trees(m)) {
        const k = `${Math.floor(t.at[0] / 20)},${Math.floor(t.at[1] / 20)}`
        counts.set(k, (counts.get(k) ?? 0) + 1)
      }
      const green = m.blocks.filter((b) => b.use === "green")
      let open = 0
      let dense = 0
      let all = 0
      const [lo, hi] = bbox(green.flatMap((b) => b.poly))
      for (let i = Math.floor(lo[0] / 20); i * 20 < hi[0]; i++)
        for (let j = Math.floor(lo[1] / 20); j * 20 < hi[1]; j++) {
          const c: Vec2 = [(i + 0.5) * 20, (j + 0.5) * 20]
          if (!green.some((b) => contains(b.poly, c, 0)) || m.field.coast(c) < 40) continue
          all++
          const n = counts.get(`${i},${j}`) ?? 0
          if (n === 0) open++
          if (n >= 10) dense++
        }
      expect(open / all, label(m.spec)).toBeGreaterThan(0.25)
      expect(dense / all, label(m.spec)).toBeGreaterThan(0.1)
    }
  })

  test("no pattern repeats across the map (the old 48 m tiles did)", () => {
    for (const m of big) {
      const seen = new Map<string, number>()
      for (const p of m.nature) {
        const k = `${(((p.at[0] % 48) + 48) % 48).toFixed(3)},${(((p.at[1] % 48) + 48) % 48).toFixed(3)}`
        seen.set(k, (seen.get(k) ?? 0) + 1)
      }
      const repeats = [...seen.values()].filter((n) => n > 1).length
      expect(repeats / m.nature.length, label(m.spec)).toBeLessThan(0.002)
    }
  })

  test("trees are sized by age: young at a wood's edge, full grown in its core, old alone", () => {
    for (const m of big) {
      const mean = (list: Placement[]) => list.reduce((s, p) => s + (p.scale ?? 1), 0) / list.length
      const broad = trees(m).filter((t) => !odd.has(t.prefab))
      const core = broad.filter((t) => m.field.cover(t.at) >= 0.7)
      const edge = broad.filter((t) => m.field.cover(t.at) >= 0.3 && m.field.cover(t.at) < 0.5)
      expect(mean(edge), label(m.spec)).toBeLessThan(mean(core) - 0.1)
      const scales = trees(m).map((t) => t.scale ?? 1)
      expect(Math.max(...scales) - Math.min(...scales)).toBeGreaterThan(0.5)
    }
  })

  test("species zone into stands: neighbours share a species far more than chance", () => {
    for (const m of big) {
      const list = trees(m)
      const share = new Map<string, number>()
      for (const t of list) share.set(t.prefab, (share.get(t.prefab) ?? 0) + 1 / list.length)
      const chance = [...share.values()].reduce((s, f) => s + f * f, 0)
      let same = 0
      let pairs = 0
      const cells = new Map<string, Placement[]>()
      for (const t of list) {
        const k = `${Math.floor(t.at[0] / 8)},${Math.floor(t.at[1] / 8)}`
        cells.set(k, [...(cells.get(k) ?? []), t])
      }
      for (const group of cells.values())
        for (let a = 0; a < group.length; a++)
          for (let b = a + 1; b < group.length; b++) {
            pairs++
            if (group[a]!.prefab === group[b]!.prefab) same++
          }
      expect(same / pairs, label(m.spec)).toBeGreaterThan(1.5 * chance)
      // Pines lead somewhere, broadleaf elsewhere.
      expect(list.some((t) => pines.has(t.prefab))).toBe(true)
      expect(list.some((t) => !odd.has(t.prefab))).toBe(true)
    }
  })

  test("woods and glades are exposed for W8, and a glade stays open", () => {
    for (const m of built.filter((x) => x.spec.tier === "city")) {
      expect(m.field.woods.length, label(m.spec)).toBeGreaterThan(2)
      for (const g of m.field.glades) {
        expect(m.field.woods[g.wood]).toBeDefined()
        for (const t of trees(m)) expect(dist(t.at, g.at), label(m.spec)).toBeGreaterThan(0.6 * g.r)
      }
    }
    expect(built.some((m) => m.field.glades.length > 0)).toBe(true)
  })

  test("rocks never stand alone in the open meadow: they come in groups", () => {
    for (const m of big) {
      for (const r of m.nature.filter((p) => p.role === "rock")) {
        if (m.field.cover(r.at) >= 0.08 || m.field.coast(r.at) < SHORE[1] + 2) continue
        const company = m.nature.filter((p) => p !== r && dist(p.at, r.at) < 4.5)
        expect(company.length, `${label(m.spec)} rock at ${r.at}`).toBeGreaterThan(0)
      }
    }
  })

  test("the woods' floor is composed: deadfall, mushrooms, stumps, grass and reeds turn up", () => {
    for (const m of built.filter((x) => x.spec.tier === "city")) {
      const slots = new Set(m.nature.map((p) => slotOf(p.prefab)))
      for (const s of ["logs", "mushrooms", "stumps", "grass", "boulders", "stones", "birches"])
        expect(slots.has(s), `${label(m.spec)} ${s}`).toBe(true)
    }
  })

  test("every plant carries its LOD cluster (its wood or the wild, and a 24 m cell); trees vary in tone", () => {
    for (const m of big) {
      for (const p of m.nature) {
        const got = /^(wood(\d+)|wild):(-?\d+),(-?\d+)$/.exec(p.cluster ?? "")
        expect(got, `${label(m.spec)} ${p.cluster}`).not.toBeNull()
        expect(Number(got![3])).toBe(Math.floor(p.at[0] / 24))
        expect(Number(got![4])).toBe(Math.floor(p.at[1] / 24))
        if (got![2] !== undefined) expect(Number(got![2])).toBeLessThan(m.field.woods.length)
      }
      const toned = trees(m).filter((t) => t.swatchMap)
      expect(toned.length / trees(m).length).toBeGreaterThan(0.1)
      expect(toned.length / trees(m).length).toBeLessThan(0.6)
    }
  })

  test("groundTint: weights in [0, 1], shaded under woods, trodden along roads, same every time", () => {
    for (const m of big) {
      const again = natureField(
        { bounds: m.bounds, water: m.water, spec: m.spec, streets: m.streets },
        (salt) => roll(m.spec.seed, `${salt}:nature`),
      )
      const core = trees(m).filter((t) => m.field.cover(t.at) > 0.8)
      const meadow = m.nature.filter((p) => p.role === "flower" && m.field.cover(p.at) === 0)
      const mean = (list: Placement[], k: "shade" | "light") =>
        list.reduce((s, p) => s + m.field.groundTint(p.at[0], p.at[1])[k], 0) / Math.max(1, list.length)
      expect(mean(core, "shade"), label(m.spec)).toBeGreaterThan(0.5)
      expect(mean(meadow, "shade"), label(m.spec)).toBeLessThan(0.1)
      for (const p of m.nature.slice(0, 400)) {
        const g = m.field.groundTint(p.at[0], p.at[1])
        expect(again.groundTint(p.at[0], p.at[1])).toEqual(g)
        for (const v of Object.values(g)) expect(v >= 0 && v <= 1).toBe(true)
      }
      // Worn at a road's kerb, untouched three metres past every street.
      const kerb = (p: Vec2) => Math.min(...m.streets.edges.map((e) => distTo(p, e.points) - e.width / 2))
      for (const p of m.nature.slice(0, 300)) {
        const d = kerb(p.at)
        if (d > 3.05) expect(m.field.groundTint(p.at[0], p.at[1]).worn).toBe(0)
      }
      const road = m.streets.edges.find((e) => e.cls === "road")
      if (!road) continue
      const [a, b] = [road.points[0]!, road.points[1]!]
      const l = dist(a, b)
      const side: Vec2 = [-(b[1] - a[1]) / l, (b[0] - a[0]) / l]
      const mid: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
      const d = road.width / 2 + 0.5
      expect(m.field.groundTint(mid[0] + side[0] * d, mid[1] + side[1] * d).worn).toBeGreaterThan(0.4)
    }
  })

  test("vignettes: authored scenes, each two or more pieces, chances per setting within one", () => {
    expect(VIGNETTES.length).toBeGreaterThanOrEqual(8)
    expect(new Set(VIGNETTES.map((v) => v.id)).size).toBe(VIGNETTES.length)
    for (const v of VIGNETTES) {
      expect(v.pieces.length, v.id).toBeGreaterThanOrEqual(2)
      for (const p of v.pieces) expect(SLOTS).toContain(p.slot)
    }
    const settings = new Set(VIGNETTES.flatMap((v) => Object.keys(v.where)))
    for (const s of settings) {
      const sum = VIGNETTES.reduce((t, v) => t + (v.where[s as keyof typeof v.where] ?? 0), 0)
      expect(sum, s).toBeLessThanOrEqual(1)
    }
  })

  test("a library without the ground cover still grows woods (slots it lacks are left out)", () => {
    const bare = { ...LIB, wild: { pines: LIB.wild!.pines, flowers: LIB.wild!.flowers } }
    const m = built.find((x) => x.spec.tier === "town")!
    const input = {
      ...m,
      placements: [...m.houses, ...m.farms.placements, ...m.harbour.placements],
      edges: m.farms.edges,
      fields: m.farms.fields,
    }
    const got = nature(input, bare, (salt) => roll(m.spec.seed, `${salt}:nature`))
    expect(got.filter((p) => p.role === "tree").length).toBeGreaterThan(300)
    const known = new Set([...Object.values(LIB.nature).flat(), ...LIB.wild!.pines!, ...LIB.wild!.flowers!])
    for (const p of got) expect(known.has(p.prefab), p.prefab).toBe(true)
  })
})

/** What a nature placement is, by its id (the test library's lists). */
const slotOf = (id: string): string => {
  for (const [slot, ids] of Object.entries(LIB.wild ?? {})) if ((ids as string[]).includes(id)) return slot
  for (const [slot, ids] of Object.entries(LIB.nature)) if (ids.includes(id)) return slot
  return "?"
}
const rank = (p: Placement) => ({ flower: 0, rock: 1, bush: 2, tree: 3 })[p.role as string] ?? 0
const FLOWER = ["#f0d24a", "#e57ab8", "#f4f1ea", "#b48ae0"]
const round = (x: number) => Math.round(x * 100) / 100
/** A plant on the map: trees as crowns by species, size and tone; the rest as small marks. */
function plant(p: Placement): string {
  const s = p.scale ?? 1
  const c = (r: number, fill: string, extra = "") =>
    `<circle cx="${p.at[0]}" cy="${-p.at[1]}" r="${round(r)}" fill="${fill}" ${extra}/>`
  // A darker swatch map sends a tone down its ramp (to a lower id), a lighter one up.
  const shift = p.swatchMap ? (Object.entries(p.swatchMap).some(([a, b]) => b < Number(a)) ? 0.78 : 1.22) : 1
  const tone = (rgb: number[]) => `rgb(${rgb.map((v) => Math.min(255, Math.round(v * shift))).join(",")})`
  const slot = slotOf(p.prefab)
  const crown = 'stroke="#0b2a12" stroke-opacity="0.35" stroke-width="0.25"'
  if (p.role === "tree") {
    if (slot === "pines") return c(1.5 * s, tone([31, 92, 50]), crown)
    if (slot === "birches") return c(1.7 * s, tone([150, 190, 80]), crown)
    if (slot === "willows") return c(2.3 * s, tone([110, 160, 90]), crown)
    const shades = [
      [63, 138, 50],
      [78, 150, 60],
      [55, 120, 45],
      [90, 140, 55],
    ]
    return c(2.2 * s, tone(shades[LIB.nature.trees.indexOf(p.prefab) % shades.length]!), crown)
  }
  if (p.role === "bush")
    return slot === "bushes"
      ? c(0.9 * s, tone([70, 120, 40]))
      : c(0.45 * s, slot === "reeds" ? "#6f8f3a" : "#a8cf5a")
  if (p.role === "flower")
    return slot === "mushrooms" ? c(0.35, "#c0392b") : c(0.35, FLOWER[p.prefab.length % FLOWER.length]!)
  if (slot === "logs") return c(0.9 * s, "#7a5534")
  if (slot === "stumps") return c(0.6 * s, "#8a6544")
  const big = slot === "boulders"
  return c((big ? 1.4 : 0.7) * s, big ? "#8d8f8a" : "#a6a7a2", 'stroke="#555" stroke-width="0.15"')
}

/** The ground's tone on 4 m tiles: shade, light, dry and worn blended on the grass, as R3 might paint it. */
function groundTiles(m: ReturnType<typeof make>, lo: Vec2, hi: Vec2): string[] {
  const out: string[] = []
  const T = 4
  const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i]! - v) * t)
  for (let x = Math.floor(lo[0] / T) * T; x < hi[0]; x += T)
    for (let z = Math.floor(lo[1] / T) * T; z < hi[1]; z += T) {
      const g = m.field.groundTint(x + T / 2, z + T / 2)
      let c = [97, 169, 61]
      c = mix(c, [143, 205, 73], 0.6 * g.light)
      c = mix(c, [200, 180, 98], 0.55 * g.dry)
      c = mix(c, [42, 132, 57], 0.8 * g.shade)
      c = mix(c, [160, 125, 91], 0.7 * g.worn)
      out.push(
        `<rect x="${x}" y="${-z - T}" width="${T}" height="${T}" fill="rgb(${c.map(Math.round).join(",")})"/>`,
      )
    }
  return out
}

/** The debug picture: the whole map (the island in its sea), then farms, harbour and nature on top. */
function svg(m: ReturnType<typeof make>): string {
  const [lo, hi] = bbox(m.bounds)
  // Cropped to the land (and a little sea round it).
  const [llo, lhi] = bbox(m.site.land.flat(2))
  const pad = 15
  const box = `${llo[0] - pad} ${-lhi[1] - pad} ${lhi[0] - llo[0] + 2 * pad} ${lhi[1] - llo[1] + 2 * pad}`
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
  const parts: string[] = [
    `<rect x="${lo[0]}" y="${-hi[1]}" width="${hi[0] - lo[0]}" height="${hi[1] - lo[1]}" fill="#3d7fa6"/>`,
    `<clipPath id="land">${m.site.land.map((p) => `<path d="${p.map((r) => path(r)).join("")}" clip-rule="evenodd"/>`).join("")}</clipPath>`,
    ...m.site.land.map(
      (p) => `<path d="${p.map((r) => path(r)).join("")}" fill="#7fb04a" fill-rule="evenodd"/>`,
    ),
    `<g clip-path="url(#land)">${groundTiles(m, llo, lhi).join("")}</g>`,
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
    ...m.field.glades.map(
      (g) =>
        `<circle cx="${g.at[0]}" cy="${-g.at[1]}" r="${g.r}" fill="none" stroke="#f5e27a" stroke-width="0.6" stroke-dasharray="2 2"/>`,
    ),
    // Small things under big ones: flowers, grass, rocks, bushes, then trees by size.
    ...[...m.nature]
      .sort((a, b) => rank(a) - rank(b) || (a.scale ?? 1) - (b.scale ?? 1))
      .map((p) => plant(p)),
    ...[...m.farms.stations, ...m.harbour.stations].map((s) => dot2(s.at, 0.9, "#e00")),
  ]
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}" width="2000" height="${Math.round((2000 * (lhi[1] - llo[1] + 2 * pad)) / (lhi[0] - llo[0] + 2 * pad))}">${parts.join("")}</svg>\n`
}

test("writes a debug SVG per tier to .probe/nature-v2 (north up: +z is up the page)", () => {
  const out = resolve(import.meta.dir, "../../../.probe/nature-v2")
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
