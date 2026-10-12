import { describe, expect, test } from "bun:test"
import { roll } from "@guildhall/core"
import {
  add,
  area,
  axes,
  contains,
  distTo,
  type Rect,
  rectCorners,
  rectsOverlap,
  scale,
  type Vec2,
} from "../src/index.ts"
import { blocks } from "../src/town/blocks.ts"
import { type HarbourLibrary, harbour, PIERS, ROOT } from "../src/town/harbour.ts"
import { site } from "../src/town/site.ts"
import { normalizeSpec } from "../src/town/spec.ts"
import { streets } from "../src/town/streets.ts"
import type { Placement, Tier, TownSpecInput } from "../src/town/types.ts"

/** world town: the harbour (quay, piers from it into the water, boats, cargo, the harbourmaster). */

const DECK = { id: "kenney-town/planks", w: 3.5, d: 3.5 }
const BOATS = [
  { id: "quaternius-ships/boat", w: 2.2, d: 4 },
  { id: "quaternius-ships/boat-w-sail", w: 2.4, d: 5.9 },
]
const LIB: HarbourLibrary = {
  prefabs: [],
  edges: {
    wall: { segment: "wall", length: 4 },
    hedge: { segment: "hedge", length: 3.5 },
    fence: { segment: "fence", length: 3.5 },
  },
  nature: { trees: [], bushes: [], crops: [], hay: [], rocks: [] },
  harbour: { deck: DECK, boats: BOATS, cargo: ["kenney-pirate/crate", "kenney-pirate/barrel"] },
}

function make(spec: TownSpecInput, lib: HarbourLibrary = LIB) {
  const s = site(spec)
  const g = streets(s, spec, (salt) => roll(spec.seed, `${salt}:streets`))
  const b = blocks(g, s, spec, (salt) => roll(spec.seed, `${salt}:blocks`))
  const plan = { spec: normalizeSpec(spec), streets: b.graph, blocks: b.blocks, water: s.water }
  return { plan, ...harbour(plan, lib, (salt) => roll(spec.seed, `${salt}:harbour`)) }
}

const TIERS: Tier[] = ["hamlet", "village", "town", "city"]
const built = TIERS.flatMap((tier) =>
  [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => {
    const spec: TownSpecInput = { seed, tier, harbour: { bearing: (seed * 2.3) % (2 * Math.PI) } }
    return { spec, ...make(spec) }
  }),
)
const label = (spec: TownSpecInput) => `${spec.tier}#${spec.seed}`

/** Each pier as its root (on the quay), its far end, and its deck rect, from its run of deck pieces. */
function piers(list: readonly Placement[]) {
  const by = new Map<number, Placement[]>()
  for (const p of list.filter((x) => x.role === "pier")) by.set(p.seed, [...(by.get(p.seed) ?? []), p])
  return [...by.values()].map((tiles) => {
    const first = tiles[0]!
    const last = tiles[tiles.length - 1]!
    const out = axes(first.rot).z
    const root = add(first.at, scale(out, -DECK.d / 2))
    const end = add(last.at, scale(out, DECK.d / 2))
    const c: Vec2 = [(root[0] + end[0]) / 2, (root[1] + end[1]) / 2]
    const rect: Rect = { c, rot: first.rot, w: DECK.w, d: tiles.length * DECK.d }
    return { root, end, rect, tiles }
  })
}
const wet = (water: readonly Vec2[][], p: Vec2) => water.some((w) => contains(w, p, 0))
const shoreDist = (water: readonly Vec2[][], p: Vec2) => Math.min(...water.map((w) => distTo(p, w, true)))

describe("harbour", () => {
  test("same plan, same harbour", () => {
    for (const m of built.filter((_, i) => i % 4 === 0)) {
      const again = make(m.spec)
      expect(again.placements).toEqual(m.placements)
      expect(again.stations).toEqual(m.stations)
      expect(again.quay).toEqual(m.quay)
    }
  })

  test("piers start on the quay at the shore and end in open water", () => {
    for (const { spec, plan, placements } of built) {
      const strips = plan.blocks.filter((b) => b.use === "harbour")
      for (const p of piers(placements)) {
        expect(wet(plan.water, p.root), `${label(spec)} root ${p.root}`).toBe(false)
        expect(
          strips.some((b) => contains(b.poly, p.root, 0.01)),
          `${label(spec)} root on the quay`,
        ).toBe(true)
        expect(shoreDist(plan.water, p.root), label(spec)).toBeLessThanOrEqual(ROOT + 0.1)
        expect(wet(plan.water, p.end), `${label(spec)} end ${p.end}`).toBe(true)
        expect(shoreDist(plan.water, p.end), label(spec)).toBeGreaterThanOrEqual(4)
        // Every deck piece but the one on the quay stands in the water.
        for (const t of p.tiles.slice(1)) expect(wet(plan.water, t.at), label(spec)).toBe(true)
      }
    }
  })

  test("piers per tier: 2–4, as many as the tier asks wherever the shore has room", () => {
    const counts = new Map<Tier, number[]>()
    for (const { spec, placements } of built) {
      const n = piers(placements).length
      expect(n, label(spec)).toBeLessThanOrEqual(PIERS[spec.tier])
      expect(n, label(spec)).toBeGreaterThanOrEqual(1)
      counts.set(spec.tier, [...(counts.get(spec.tier) ?? []), n])
    }
    for (const tier of TIERS) {
      const list = counts.get(tier)!
      const full = list.filter((n) => n === PIERS[tier]).length
      expect(full / list.length, tier).toBeGreaterThanOrEqual(0.75)
    }
  })

  test("piers keep apart; boats lie wholly in the water, alongside and clear of every pier", () => {
    for (const { spec, plan, placements } of built) {
      const ps = piers(placements)
      for (let i = 0; i < ps.length; i++)
        for (let j = i + 1; j < ps.length; j++)
          expect(rectsOverlap(ps[i]!.rect, ps[j]!.rect), label(spec)).toBe(false)
      const boats = placements.filter((p) => p.role === "boat")
      expect(boats.length, label(spec)).toBeGreaterThanOrEqual(ps.length)
      const rects = boats.map((b) => {
        const size = BOATS.find((x) => x.id === b.prefab)!
        return { c: b.at, rot: b.rot, w: size.w, d: size.d }
      })
      for (const r of rects) {
        for (const q of rectCorners(r))
          expect(wet(plan.water, q), `${label(spec)} boat corner ${q}`).toBe(true)
        for (const p of ps) expect(rectsOverlap(p.rect, r), label(spec)).toBe(false)
        expect(Math.min(...ps.map((p) => distTo(r.c, [p.root, p.end]))), label(spec)).toBeLessThan(4)
      }
      for (let i = 0; i < rects.length; i++)
        for (let j = i + 1; j < rects.length; j++) expect(rectsOverlap(rects[i]!, rects[j]!)).toBe(false)
    }
  })

  test("cargo stands on the quay, off the streets and the deck; the harbourmaster works the quay", () => {
    for (const { spec, plan, placements, stations, quay, overlays } of built) {
      const strips = plan.blocks.filter((b) => b.use === "harbour")
      const ps = piers(placements)
      for (const c of placements.filter((p) => p.role === "cargo")) {
        expect(
          strips.some((b) => contains(b.poly, c.at, 0)),
          `${label(spec)} cargo ${c.at}`,
        ).toBe(true)
        for (const e of plan.streets.edges) expect(distTo(c.at, e.points)).toBeGreaterThan(e.width / 2)
        for (const p of ps) expect(rectsOverlap(p.rect, { c: c.at, rot: 0, w: 0.5, d: 0.5 })).toBe(false)
      }
      expect(placements.filter((p) => p.role === "cargo").length, label(spec)).toBeGreaterThanOrEqual(
        ps.length,
      )
      const master = stations.find((s) => s.id === "dock:harbourmaster")
      expect(master, label(spec)).toBeDefined()
      expect(strips.some((b) => contains(b.poly, master!.at, 0.01))).toBe(true)
      expect(stations.filter((s) => s.kind === "dock").length).toBe(ps.length + 1)
      expect(
        quay.reduce((sum, ring) => sum + area(ring), 0),
        label(spec),
      ).toBeGreaterThan(50)
      // Every pier's root is on the quay.
      for (const p of ps)
        expect(
          quay.some((ring) => contains(ring, p.root, 0.01)),
          label(spec),
        ).toBe(true)
      expect(overlays.map((o) => o.poly)).toEqual(strips.map((b) => b.poly))
    }
  })

  test("no harbour, or no deck piece: no piers, boats or cargo", () => {
    for (const tier of TIERS) {
      const dry = make({ seed: 4, tier, harbour: null })
      expect(dry.placements).toEqual([])
      expect(dry.stations).toEqual([])
      expect(dry.quay).toEqual([])
    }
    const bare = make({ seed: 4, tier: "town", harbour: { bearing: 1 } }, { ...LIB, harbour: {} })
    expect(bare.placements).toEqual([])
    expect(bare.stations.map((s) => s.id)).toEqual(["dock:harbourmaster"])
  })
})
