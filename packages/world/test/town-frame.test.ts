import { describe, expect, test } from "bun:test"
import { DMath } from "@guildhall/core"
import { distTo } from "../src/geom/line.ts"
import { clip, contains, type Polygon, type Ring } from "../src/geom/poly.ts"
import { add, dist, scale, snap, sub, type Vec2 } from "../src/geom/vec.ts"
import { generateTown, MERGE, normalizeSpec, site, type TownFrame, type TownLayout } from "../src/index.ts"
import { islandSite } from "../src/island/site.ts"
import { normalizeIslandSpec } from "../src/island/spec.ts"
import type { TownSpecInput } from "../src/town/types.ts"
import { LIB } from "./town.fixture.ts"

/** world town: frame mode (ADR 011), the town laid out on the ground an island hosts it on. */

const SEEDS = Array.from({ length: 10 }, (_, i) => i + 1)
/** Metres a drawn point may stray past the frame's land (a kerb's snap, a fence post on the line). */
const TOL = 1

/** A circle round c, counter-clockwise. */
function disc(c: Vec2, radius: number, n = 64): Ring {
  return Array.from({ length: n }, (_, i) => {
    const t = (2 * Math.PI * i) / n
    return snap([c[0] + radius * DMath.cos(t), c[1] + radius * DMath.sin(t)])
  })
}

/**
 * The frame a town would get on its own coast: the land within 1.6r of its centre (its fields belt),
 * the sea with the harbour's side first, and its roads leaving at the frame's edge.
 */
function ownFrame(spec: TownSpecInput): TownFrame {
  const ground = site(spec)
  const reach = 1.6 * normalizeSpec(spec).radius
  return { land: clip(ground.land, disc([0, 0], reach), "intersection"), water: ground.water, reach }
}

const translate = (ring: Ring, by: Vec2): Ring => ring.map((p) => snap(sub(p, by)))

/**
 * A fishing hamlet on an island's far bay: its centre just inland of the bay's innermost shore, its
 * harbour facing out of the bay, the island's land within 1.4r round it in its local frame, and the
 * sea ring holding the bay first.
 */
function bayHamlet(seed: number): { spec: TownSpecInput; frame: TownFrame } {
  const island = normalizeIslandSpec({ seed, town: { seed: seed * 7 + 1, tier: "town" } })
  const ground = islandSite(island, island.town.radius)
  const bay = ground.bays.find((b) => !b.main)
  if (!bay) throw new Error(`island ${seed} has no far bay`)
  const spec: TownSpecInput = {
    seed: seed * 31 + 5,
    tier: "hamlet",
    harbour: { bearing: DMath.atan2(bay.out[1], bay.out[0]) },
  }
  const r = normalizeSpec(spec).radius
  const centre = snap(add(bay.shore, scale(bay.out, -0.55 * r)))
  const reach = 1.4 * r
  const land = clip(
    ground.land.map((poly) => poly.map((ring) => translate(ring, centre))),
    disc([0, 0], reach),
    "intersection",
  )
  const water = ground.sea
    .map((ring) => translate(ring, centre))
    .sort((a, b) => distTo([0, 0], a, true) - distTo([0, 0], b, true))
  return { spec, frame: { land, water, reach } }
}

const onLand = (land: readonly Polygon[], p: Vec2) => land.some((poly) => contains(poly, p, TOL))
const inWater = (water: readonly Ring[], p: Vec2) => water.some((ring) => contains(ring, p, TOL))

/** Every point the layout draws on the ground, by what it is (water work kept apart). */
function groundPoints(plan: TownLayout): { what: string; p: Vec2; water: boolean }[] {
  const out: { what: string; p: Vec2; water: boolean }[] = []
  const add = (what: string, ps: readonly Vec2[], water = false) => {
    for (const p of ps) out.push({ what, p, water })
  }
  for (const e of plan.streets.edges) add(`street ${e.cls}`, e.points)
  for (const b of plan.blocks) add(`block ${b.use}`, b.poly)
  for (const f of plan.fields) add("field", f.poly)
  for (const e of plan.edges) add(`edge ${e.kind}`, e.points)
  for (const l of plan.lots) add("lot", [l.origin])
  for (const p of plan.plots) add(`plot ${p.kind}`, p.poly)
  const afloat = new Set(["pier", "boat", "cargo"])
  for (const p of plan.placements) add(`placement ${p.role ?? p.prefab}`, [p.at], afloat.has(p.role ?? ""))
  const wet = new Set<number>()
  for (const e of plan.walk.edges) if (e.kind === "pier" || e.kind === "boat-lane") wet.add(e.a).add(e.b)
  for (const n of plan.walk.nodes) add(`walk node ${n.station ?? n.id}`, [n.at], wet.has(n.id))
  return out
}

/** The walk graph's nodes reachable from its first. */
function reachable(plan: TownLayout): number {
  const next = plan.walk.nodes.map(() => [] as number[])
  for (const e of plan.walk.edges) {
    next[e.a]?.push(e.b)
    next[e.b]?.push(e.a)
  }
  const seen = new Set([0])
  const todo = [0]
  for (let v = todo.pop(); v !== undefined; v = todo.pop())
    for (const w of next[v] ?? []) if (!seen.has(w)) seen.add(w) && todo.push(w)
  return seen.size
}

/** For each gate, the exits its roads lead to (along road edges only). */
function exitsOf(plan: TownLayout): number[][] {
  const { nodes, edges } = plan.streets
  const roads = edges.filter((e) => e.cls === "road")
  return nodes
    .filter((n) => n.kind === "gate")
    .map((gate) => {
      const seen = new Set([gate.id])
      const todo = [gate.id]
      for (let v = todo.pop(); v !== undefined; v = todo.pop())
        for (const e of roads) {
          const w = e.a === v ? e.b : e.b === v ? e.a : -1
          if (w >= 0 && !seen.has(w) && nodes[w]?.kind !== "gate") seen.add(w) && todo.push(w)
        }
      return [...seen].filter((id) => nodes[id]?.tag === "exit")
    })
}

const CASES: { name: string; spec: TownSpecInput; frame: TownFrame }[] = (
  ["hamlet", "village", "city"] as const
).flatMap((tier) =>
  SEEDS.map((seed) => {
    const spec: TownSpecInput = { seed, tier }
    return { name: `${tier}#${seed}`, spec, frame: ownFrame(spec) }
  }),
)
const framed = new Map(CASES.map((c) => [c.name, generateTown(c.spec, LIB, undefined, c.frame)]))
const planOf = (name: string) => framed.get(name) as TownLayout

describe("generateTown in a frame", () => {
  test("is deterministic and differs from the town on its own island", () => {
    const { spec, frame } = CASES[12] as (typeof CASES)[number]
    const again = generateTown(spec, LIB, undefined, frame)
    expect(again).toEqual(planOf("village#3"))
    expect(again.hash).not.toBe(generateTown(spec, LIB).hash)
  })

  test("nothing lies outside the frame's land; piers, boats and boat lanes lie on its water", () => {
    for (const { name, frame } of CASES) {
      const stray = groundPoints(planOf(name)).filter(({ p, water }) =>
        water ? !inWater(frame.water, p) && !onLand(frame.land, p) : !onLand(frame.land, p),
      )
      expect(stray.slice(0, 3).map((s) => `${name} ${s.what} at ${s.p}`)).toEqual([])
    }
  })

  test("grows no nature (the island's), and its fields keep to the frame", () => {
    for (const { name } of CASES) expect(planOf(name).nature).toEqual([])
    const fields = CASES.reduce((n, c) => n + planOf(c.name).fields.length, 0)
    expect(fields).toBeGreaterThan(0)
  })

  test("every gate's road leaves by exactly one exit, at the frame's reach", () => {
    for (const { name, frame } of CASES) {
      const plan = planOf(name)
      const gates = plan.streets.nodes.filter((n) => n.kind === "gate")
      const exits = plan.streets.nodes.filter((n) => n.tag === "exit")
      expect(gates.length, name).toBeGreaterThan(0)
      expect(
        exitsOf(plan).map((list) => list.length),
        name,
      ).toEqual(gates.map(() => 1))
      expect(exits, name).toHaveLength(gates.length)
      for (const x of exits)
        expect(Math.abs(Math.hypot(x.at[0], x.at[1]) - frame.reach)).toBeLessThanOrEqual(MERGE)
    }
  })

  test("no footpath forks into the country (the island's trails do)", () => {
    for (const { name } of CASES)
      for (const n of planOf(name).streets.nodes)
        expect(n.tag === "fork" || n.tag === "road-end", name).toBe(false)
  })

  test("the walk graph is connected", () => {
    for (const { name } of CASES) {
      const plan = planOf(name)
      expect(reachable(plan), name).toBe(plan.walk.nodes.length)
    }
  })

  test("a fishing hamlet on a far bay (a frame barely wider than it): its quay on the frame's first water", () => {
    let quays = 0
    for (const seed of SEEDS) {
      const { spec, frame } = bayHamlet(seed)
      const plan = generateTown(spec, LIB, undefined, frame)
      const name = `hamlet on island ${seed}`
      // Its gates stand back from the water, not from the frame's edge, so it still has a way out.
      const gates = plan.streets.nodes.filter((n) => n.kind === "gate")
      expect(gates.length, name).toBeGreaterThan(0)
      expect(
        exitsOf(plan).map((list) => list.length),
        name,
      ).toEqual(gates.map(() => 1))
      expect(reachable(plan), name).toBe(plan.walk.nodes.length)
      const quay = plan.streets.nodes.find((n) => n.kind === "quay")
      if (!quay) continue
      quays++
      expect(distTo(quay.at, frame.water[0] as Ring, true), name).toBeLessThanOrEqual(TOL)
      expect(dist(quay.at, [0, 0])).toBeLessThan(frame.reach)
    }
    expect(quays).toBeGreaterThanOrEqual(8)
  })
})
