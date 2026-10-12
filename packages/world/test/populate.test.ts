import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { NpcRecipe } from "@guildhall/assets"
import {
  contains,
  distTo,
  intersect,
  LANE_ROOM,
  POPULATION,
  populate,
  poseAt,
  rectCorners,
  simulate,
  type Townsperson,
  type Vec2,
  WALK_RULES,
} from "../src/index.ts"
import { PRESETS, town } from "./town.fixture.ts"

/** world populate: townsfolk with a day on the walk graph. */

const dir = join(import.meta.dir, "../../../data/npcs")
const NPCS: NpcRecipe[] = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as NpcRecipe)
const BY_ID = new Map(NPCS.map((r) => [r.id, r]))

const folk = new Map<number, Townsperson[]>()
/** The townsfolk of preset `i` (hamlet, village, town, city). */
function folkOf(i: number): Townsperson[] {
  let got = folk.get(i)
  if (!got) {
    const plan = town(PRESETS[i] as (typeof PRESETS)[number])
    got = populate(plan, NPCS, plan.spec.seed)
    folk.set(i, got)
  }
  return got
}
const TOWNS = [0, 1, 2, 3] as const
const xz = (p: readonly number[]): Vec2 => [p[0] as number, p[2] as number]
const near = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0]! - b[0]!, a[2]! - b[2]!) < 1e-3

describe("populate", () => {
  test("village 15, town 30, city 45; the count is tunable", () => {
    expect(folkOf(1).length).toBe(POPULATION.village)
    expect(folkOf(2).length).toBe(POPULATION.town)
    expect(folkOf(3).length).toBe(POPULATION.city)
    const plan = town(PRESETS[2]!)
    expect(populate(plan, NPCS, 2, { count: 12 }).length).toBe(12)
  })

  test("is deterministic by seed, and another seed makes another town's folk", () => {
    const plan = town(PRESETS[2]!)
    const a = JSON.stringify(populate(plan, NPCS, 7))
    expect(JSON.stringify(populate(plan, NPCS, 7))).toBe(a)
    expect(JSON.stringify(populate(plan, NPCS, 8))).not.toBe(a)
  })

  test("one worker per staffed station, of the role its kind needs", () => {
    const plan = town(PRESETS[3]!)
    const kinds = new Map(plan.stations.map((s) => [s.id, s.kind]))
    const workers = folkOf(3).filter((a) => a.kind === "worker")
    expect(new Set(workers.map((a) => a.work)).size).toBe(workers.length)
    const want: Record<string, string[]> = {
      forge: ["smith"],
      tavern: ["tavern-keeper"],
      gate: ["guard"],
      field: ["farmer"],
      market: ["merchant"],
      dock: ["fisher", "merchant"],
      hall: ["monk", "mage", "guard"],
    }
    for (const a of workers) expect(want[kinds.get(a.work as string) as string], a.id).toContain(a.role)
    // The town's characters come before its many stalls.
    const roles = new Set(workers.map((a) => a.role))
    for (const r of ["tavern-keeper", "smith", "guard", "monk", "fisher", "farmer", "merchant"])
      expect(roles.has(r), r).toBe(true)
    expect(folkOf(3).some((a) => a.kind === "watch")).toBe(true)
    expect(folkOf(3).some((a) => a.kind === "wanderer")).toBe(true)
  })

  test("every day covers 00:00–24:00 without a gap and ends where it began", () => {
    for (const i of TOWNS)
      for (const a of folkOf(i)) {
        const d = a.day
        expect(d[0]?.from, a.id).toBe(0)
        expect(d[d.length - 1]?.to, a.id).toBe(24)
        for (let k = 0; k < d.length; k++) {
          const s = d[k]!
          expect(s.to, a.id).toBeGreaterThanOrEqual(s.from)
          if (k > 0) expect(Math.abs(s.from - d[k - 1]!.to), `${a.id} step ${k}`).toBeLessThan(1e-9)
        }
        const first = d[0]!
        const last = d[d.length - 1]!
        expect(first.kind === "stay" && last.kind === "stay" && first.place === last.place, a.id).toBe(true)
      }
  })

  test("every leg is reachable: it runs from one stay to the next", () => {
    for (const i of TOWNS)
      for (const a of folkOf(i))
        a.day.forEach((s, k) => {
          if (s.kind !== "walk") return
          const before = a.day[k - 1]
          const after = a.day[k + 1]
          expect(before?.kind === "stay" && near(before.at, s.pts[0]!), `${a.id} leg ${k} start`).toBe(true)
          expect(
            after?.kind === "stay" && near(after.at, s.pts[s.pts.length - 1]!),
            `${a.id} leg ${k} end`,
          ).toBe(true)
          expect(s.times.length).toBe(s.pts.length)
          expect(s.clips.length).toBe(s.pts.length - 1)
          for (let j = 1; j < s.times.length; j++) expect(s.times[j]!).toBeGreaterThanOrEqual(s.times[j - 1]!)
        })
  })

  test("legs follow walk edges, each walker on their own side of the way, with the edge's clip", () => {
    for (const i of TOWNS) {
      const plan = town(PRESETS[i]!)
      for (const a of folkOf(i)) {
        const walk = BY_ID.get(a.role)?.activity.walk
        for (const s of a.day) {
          if (s.kind !== "walk") continue
          s.edges.forEach((e, j) => {
            const clip = s.clips[j]!
            if (e < 0) {
              // A step off the way (to a door or a place by a station) only at a leg's ends.
              expect(j === 0 || j === s.edges.length - 1, `${a.id} step mid-leg`).toBe(true)
              expect(clip).toBe(walk as string)
              return
            }
            const edge = plan.walk.edges[e]!
            expect(edge.kind).not.toBe("boat-lane")
            const line = edge.points.map(xz)
            const room = LANE_ROOM[edge.kind] * 2 + 0.01
            expect(distTo(xz(s.pts[j]!), line), `${a.id} on edge ${e}`).toBeLessThan(room)
            expect(distTo(xz(s.pts[j + 1]!), line), `${a.id} on edge ${e}`).toBeLessThan(room)
            const rule = WALK_RULES[edge.kind].clip
            expect(clip).toBe(rule === "Walking_A" ? (walk as string) : (rule as string))
          })
        }
      }
    }
  })

  test("no two people stand on one spot at the same time", () => {
    for (const i of TOWNS) {
      const at = new Map<string, { a: number; b: number; who: string }[]>()
      for (const a of folkOf(i))
        for (const s of a.day) {
          if (s.kind !== "stay" || s.place.startsWith("home:") || s.to <= s.from) continue
          const list = at.get(s.place) ?? []
          for (const o of list)
            if (o.who !== a.id)
              expect(o.a < s.to - 1e-6 && s.from < o.b - 1e-6, `${s.place}: ${o.who} and ${a.id}`).toBe(false)
          list.push({ a: s.from, b: s.to, who: a.id })
          at.set(s.place, list)
        }
    }
  })

  test("the town is out by day and asleep at night, but for the watch", () => {
    const people = folkOf(2)
    const outAt = (h: number) => simulate(people, h).filter((p) => !p.indoors).length
    expect(outAt(12)).toBeGreaterThan(people.length * 0.6)
    const night = simulate(people, 3)
    for (const [k, a] of people.entries()) expect(night[k]?.indoors, a.id).toBe(a.kind !== "watch")
    // Workers are at work mid-morning, playing their work clip.
    for (const a of people.filter((x) => x.kind === "worker" && x.role !== "guard")) {
      const r = BY_ID.get(a.role)!
      const busy = [9.5, 10, 10.5, 15, 15.5].some((h) => poseAt(a, h).clip === r.activity.work)
      expect(busy, a.id).toBe(true)
    }
  })

  test("a walking pose lies on its leg, facing along it", () => {
    for (const a of folkOf(2)) {
      const leg = a.day.find((s) => s.kind === "walk" && s.to - s.from > 0.005)
      if (leg?.kind !== "walk") continue
      const p = poseAt(a, (leg.from + leg.to) / 2)
      expect(p.walking).toBe(true)
      expect(distTo(xz(p.at), leg.pts.map(xz))).toBeLessThan(1e-6)
    }
  })

  test("a step off the street never cuts through a stall, well or fountain", () => {
    for (const t of TOWNS) {
      const plan = town(PRESETS[t]!)
      const rings = plan.placements
        .filter((p) => ["stall", "well", "fountain"].includes(p.role ?? ""))
        .map((p) => {
          const [w, d] = plan.sizes[p.prefab] ?? [1.6, 1.6]
          return rectCorners({ c: p.at, rot: p.rot, w, d })
        })
      let steps = 0
      for (const a of folkOf(t))
        for (const s of a.day) {
          if (s.kind !== "walk") continue
          s.edges.forEach((e, i) => {
            if (e !== -1) return
            steps++
            const [p, q] = [xz(s.pts[i]!), xz(s.pts[i + 1]!)]
            // Through: in one side and out the other (a spot on a garden or a way over one is fine).
            for (const r of rings.filter((r) => !contains(r, p) && !contains(r, q)))
              for (let k = 0; k < r.length; k++)
                expect(intersect(p, q, r[k]!, r[(k + 1) % r.length]!)).toBeNull()
          })
        }
      expect(steps).toBeGreaterThan(0)
    }
  })

  test("the pinned Actor fields are the pose at the chosen hour", () => {
    const plan = town(PRESETS[2]!)
    for (const a of populate(plan, NPCS, 2, { hour: 12 })) {
      const p = poseAt(a, 12)
      expect(a.at).toEqual(xz(p.at))
      expect(a.facing).toBe(p.facing)
      expect(a.recipe).toBe(a.role)
    }
  })
})

describe("populate at a crowd", () => {
  // Regression: 300 in a city or capital means more night watchmen than round stops; a watchman with
  // an empty round crashed `populate` (patrol read `.key` of an undefined stop).
  const SPECS = [
    { seed: 1, tier: "city" },
    { seed: 4, tier: "city" },
    { seed: 2, tier: "capital" },
    { seed: 9, tier: "capital" },
  ] as const
  for (const spec of SPECS)
    test(`${spec.tier}#${spec.seed} takes 300, every watchman on a round, every day whole`, () => {
      const plan = town(spec)
      const folk = populate(plan, NPCS, spec.seed, { count: 300 })
      const watch = folk.filter((p) => p.kind === "watch")
      expect(watch.length).toBe(20)
      for (const p of folk) {
        expect(p.day[0]?.from).toBe(0)
        expect(p.day[p.day.length - 1]?.to).toBe(24)
      }
      // Out at midnight, not indoors.
      for (const w of watch) expect(poseAt(w, 0.1).indoors).toBe(false)
    })
})
