/**
 * Site-aware places (decisions.md "site-aware procedural buildings"), swept over seeds and the hex map's
 * knob extremes (rain 0.3–3, coast 0–2, hills 0–9) at four repo sizes, the authored tiles installed:
 *
 *   no building or wall piece stands over water, no two building pieces cut into each other, every
 *   place's heart and every door is on the road network, and the castle's keep and great hall open onto
 *   a yard its gate reaches (site-checks.ts);
 *   roads are sacred (roads.ts): no solid over a road, street, path, stair or bridge strip but a door's
 *   threshold and a gate's opening (covered), no road ending in a solid (ends), none under MIN_WIDTH
 *   clear (narrow), none routed through a building's tile (through); the castle's courts the same inside
 *   its curtain wall (courtCovered, courtNarrow), the gate's opening a way as wide, and nothing before
 *   a castle building's door (doorSqueeze); every road tile on a road zones.ts registered (loose);
 *   the castle's site and the town's square stay where they are as the island grows, and no river or
 *   lake lies inside them.
 *
 * The full sweep (seeds 1–20 × 9 knob sets × files 500/1500/4000/12000, 720 islands, five to six minutes
 * on a busy machine) runs with FUZZ=full; by default each seed and knob set is built at one of the four sizes in turn.
 */
import { afterAll, describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { roadReport } from "../src/hex/roads.ts"
import {
  hexIsland,
  hexWalk,
  hexWorld,
  hexZones,
  installTilePrefabs,
  kindOf,
  parseTilePrefabs,
  useOf,
  workTiles,
} from "../src/index.ts"
import { siteReport } from "./site-checks.ts"

const DIR = join(import.meta.dir, "../../../data/tiles")
const data = Object.fromEntries(
  readdirSync(DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => [f.slice(0, -5), JSON.parse(readFileSync(join(DIR, f), "utf8")) as unknown]),
)
installTilePrefabs(parseTilePrefabs(data).prefabs)
afterAll(() => installTilePrefabs(null))

const KNOBS: { coast?: number; hills?: number; rain?: number }[] = [{}]
for (const rain of [0.3, 3])
  for (const coast of [0, 2]) for (const hills of [0, 9]) KNOBS.push({ rain, coast, hills })
const FILES = [500, 1500, 4000, 12000]
const FULL = process.env.FUZZ === "full"

describe("every place has floor, a way in and room of its own", () => {
  test(`over seeds 1–20 and the knob extremes${FULL ? ", every size" : ""}`, () => {
    const total = {
      water: 0,
      overlap: 0,
      gap: 0,
      unreached: 0,
      castle: 0,
      covered: 0,
      ends: 0,
      narrow: 0,
      through: 0,
      courtCovered: 0,
      courtNarrow: 0,
      doorSqueeze: 0,
      loose: 0,
    }
    const notes: string[] = []
    let n = 0
    for (let seed = 1; seed <= 20; seed++)
      for (const [k, knobs] of KNOBS.entries())
        for (const [f, files] of FILES.entries()) {
          if (!FULL && (seed + k) % FILES.length !== f) continue
          const h = hexIsland({ seed, files, ...knobs })
          const z = hexZones(h)
          const w = hexWorld(h, z)
          const r = siteReport(h, z, w, hexWalk(h, z, w, { reach: workTiles(h, z) }))
          total.water += r.water
          total.overlap += r.overlap
          total.gap += r.gap
          total.unreached += r.unreached
          total.castle += r.castle
          // roads are sacred (roads.ts): nothing over a way, no way ending in a solid or squeezed
          const ways = roadReport(h, z, w)
          total.covered += ways.covered
          total.ends += ways.ends
          total.narrow += ways.narrow
          total.through += ways.through
          total.courtCovered += ways.courtCovered
          total.courtNarrow += ways.courtNarrow
          total.doorSqueeze += ways.doorSqueeze
          // every road tile is on a road (zones.ts registers each street it marks, a short ring's too)
          const on = new Set(z.roads.flatMap((road) => road.tiles))
          for (let i = 0; i < h.grid.size; i++)
            if ((useOf(z, i) === "road" || useOf(z, i) === "bridge") && !on.has(i)) total.loose++
          for (const note of ways.notes.slice(0, 2))
            notes.push(`${seed} ${JSON.stringify(knobs)} ${files}: ${note}`)
          for (const note of r.notes.slice(0, 2))
            notes.push(`${seed} ${JSON.stringify(knobs)} ${files}: ${note}`)
          n++
        }
    expect(notes.slice(0, 10)).toEqual([])
    expect(total).toEqual({
      water: 0,
      overlap: 0,
      gap: 0,
      unreached: 0,
      castle: 0,
      covered: 0,
      ends: 0,
      narrow: 0,
      through: 0,
      courtCovered: 0,
      courtNarrow: 0,
      doorSqueeze: 0,
      loose: 0,
    })
    expect(n).toBe(FULL ? 720 : 180)
  }, 600_000)
})

describe("the reserved sites", () => {
  test("the castle's keep, its site and the town's square stay put as the island grows", () => {
    for (let seed = 1; seed <= 8; seed++)
      for (const knobs of [KNOBS[0]!, KNOBS[3]!, KNOBS[8]!]) {
        const sites = FILES.map((files) => hexIsland({ seed, files, ...knobs }).sites)
        for (const s of sites) {
          expect(s.castle).toEqual(sites[0]!.castle)
          expect(s.town).toEqual(sites[0]!.town)
        }
        expect(sites[0]!.castle.length).toBeGreaterThan(1)
        // the castle a tier builds is the start of its site, its keep first
        const zs = [500, 12000].map((files) => hexZones(hexIsland({ seed, files, ...knobs })))
        for (const z of zs) {
          if (!z.castle) continue
          expect(z.castle.keep).toBe(sites[0]!.castle[0]!)
          expect(sites[0]!.castle).toEqual(expect.arrayContaining(z.castle.tiles))
        }
      }
  }, 120_000)

  test("no river or lake lies inside a site, and each is level", () => {
    for (let seed = 1; seed <= 20; seed++)
      for (const [k, knobs] of KNOBS.entries()) {
        const files = FILES[(seed + k) % FILES.length]!
        {
          const h = hexIsland({ seed, files, ...knobs })
          for (const site of [h.sites.castle, h.sites.town]) {
            const land = site.filter((i) => kindOf(h, i) !== "sea" && kindOf(h, i) !== "shallows")
            for (const i of land) {
              expect(["river", "lake", "rock", "cliff"]).not.toContain(kindOf(h, i))
              expect(h.level[i]).toBe(h.level[land[0]!]!)
            }
          }
        }
      }
  }, 120_000)

  test("the castle's gate faces its road: the road comes in through the gatehouse, the keep and hall open on its yard", () => {
    for (let seed = 1; seed <= 10; seed++)
      for (const files of FILES) {
        const h = hexIsland({ seed, files })
        const z = hexZones(h)
        const plan = z.castle!
        expect(plan).not.toBeNull()
        const g = h.grid
        // a road arrives at the gate from the tile outside its gate side
        const road = z.roads.find((r) => r.a !== r.b && r.tiles.includes(plan.gate))
        expect(road).toBeDefined()
        if (plan.entry >= 0) expect(g.neighbours(plan.gate)[plan.gateSide]).toBe(plan.entry)
        const k = road!.tiles.indexOf(plan.gate)
        const before = road!.tiles[k - 1] ?? road!.tiles[k + 1]
        expect(before).toBe(g.neighbours(plan.gate)[plan.gateSide]!)
        // the keep is the site's tile furthest from the gate it can be, no nearer than any other building
        for (const i of plan.tiles) {
          const r = plan.role.get(i)
          if (r === "keep" || r === "hall" || r === "tower" || r === "barracks") {
            const d = plan.door.get(i)
            expect(d).toBeDefined()
            const front = g.neighbours(i)[d!]!
            expect(useOf(z, front)).toBe("court")
          }
        }
        // its yard is one piece with the gate in it
        const open = plan.tiles.filter((i) => ["yard", "court"].includes(plan.role.get(i)!))
        const seen = new Set([plan.gate])
        const queue = [plan.gate]
        for (let q = 0; q < queue.length; q++)
          for (const j of g.neighbours(queue[q]!))
            if (open.includes(j) && !seen.has(j)) seen.add(j) && queue.push(j)
        expect(seen.size).toBe(open.length)
      }
  }, 120_000)
})
