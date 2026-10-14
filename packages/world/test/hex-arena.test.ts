/**
 * The training arena (decisions.md "training arena"): one an island, at a camp or beside the castle;
 * lived in by day by the soldiers and knights it brings and the place's guards (duels both sides
 * filled, the dummies and the drill line worked), empty at night; a knight hero spars there.
 */
import { afterAll, describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { agentLoop, type LifeStay, lifePlaces, planFolk, workTiles } from "../src/hex/life.ts"
import {
  hexIsland,
  hexWalk,
  hexWorld,
  hexZones,
  installTilePrefabs,
  parseTilePrefabs,
  tilePrefab,
} from "../src/index.ts"

const DIR = join(import.meta.dir, "../../../data/tiles")
installTilePrefabs(
  parseTilePrefabs(
    Object.fromEntries(
      readdirSync(DIR)
        .filter((f) => f.endsWith(".json"))
        .map((f) => [f.slice(0, -5), JSON.parse(readFileSync(join(DIR, f), "utf8")) as unknown]),
    ),
  ).prefabs,
)
afterAll(() => installTilePrefabs(null))

const ARENA = "training-arena"
const FIGHT = new Set(["guard", "knight", "soldier"])

describe("the training arena", () => {
  const islands = [1, 2, 3, 4, 5].map((seed) => {
    const h = hexIsland({ seed, files: 4000 })
    const z = hexZones(h)
    return { seed, h, z, w: hexWorld(h, z) }
  })

  test("lands once on every one of seeds 1–5, at a camp or a place beside the castle", () => {
    for (const { z, w } of islands) {
      const at = w.tiles.filter((t) => t.prefab === ARENA)
      expect(at.length).toBe(1)
      expect(["camp", "town", "hamlet", "market"]).toContain(z.zones[z.zoneOf[at[0]!.i]! - 1]!.kind)
    }
  })

  for (const seed of [1, 4]) {
    const { h, z, w } = islands[seed - 1]!
    const walk = hexWalk(h, z, w, { reach: workTiles(h, z) })
    const places = lifePlaces(h, z, w, walk)
    const warden = agentLoop(walk, z, [{ place: "camp", scene: ARENA, work: 45, idle: 10 }], {
      slot: 2,
      role: "guard",
      places,
    })
    const folk = planFolk(h, z, w, walk, { seed, pace: 144, places })
    const arena = w.tiles.find((t) => t.prefab === ARENA)!
    const spots = places.furniture.spots.map((s, k) => ({ s, k })).filter(({ s }) => s.tile === arena.i)
    const here = (st: LifeStay, s: { x: number; z: number }) =>
      Math.abs(st.at[0] - s.x) < 0.01 && Math.abs(st.at[2] - s.z) < 0.01
    /** Who is at each of the arena's spots at `hour`. */
    const at = (hour: number) =>
      spots.map(({ s }) =>
        folk.find((f) =>
          f.day.some((st) => st.kind === "stay" && st.from <= hour && hour < st.to && here(st, s)),
        ),
      )

    test(`seed ${seed}: every spot of it is walked to`, () => {
      expect(spots.length).toBe(tilePrefab(ARENA)!.spots!.length)
      for (const { k } of spots) expect(places.nodeOf(k)).toBeGreaterThanOrEqual(0)
    })

    test(`seed ${seed}: by day its fighters fill the duels, the dummies and the line; at night it is empty`, () => {
      for (const hour of [10, 15]) {
        const who = at(hour)
        const work = spots.filter(({ s }) => s.kind === "work")
        const filled = spots.filter((_, i) => who[i]).length
        expect(filled).toBeGreaterThanOrEqual(Math.ceil(work.length * 0.6))
        for (const [i, { s }] of spots.entries())
          if (s.kind === "work" && who[i]) expect(FIGHT.has(who[i]!.role)).toBe(true)
        // a duel with both its sides there
        const pairs = new Map<string, number>()
        for (const [i, { s }] of spots.entries())
          if (s.pair && who[i]) pairs.set(s.pair, (pairs.get(s.pair) ?? 0) + 1)
        expect([...pairs.values()].some((n) => n === 2)).toBe(true)
      }
      for (const hour of [2, 22]) expect(at(hour).filter(Boolean)).toEqual([])
    })

    test(`seed ${seed}: a duel is never left with one side (nobody shadow-boxes), and some watch from the benches`, () => {
      let seated = 0
      // (the island without a visiting hero, who takes a duel side for his errand)
      const bare = planFolk(h, z, w, walk, { seed, pace: 144, places: lifePlaces(h, z, w, walk) })
      const bareSpots = lifePlaces(h, z, w, walk)
        .furniture.spots.map((s, k) => ({ s, k }))
        .filter(({ s }) => s.tile === arena.i)
      for (let hour = 9.5; hour <= 17.5; hour += 0.25) {
        const who = bareSpots.map(({ s }) =>
          bare.find((f) =>
            f.day.some((st) => st.kind === "stay" && st.from <= hour && hour < st.to && here(st, s)),
          ),
        )
        const pairs = new Map<string, number>()
        for (const [i, { s }] of bareSpots.entries())
          if (s.pair && who[i]) pairs.set(s.pair, (pairs.get(s.pair) ?? 0) + 1)
        // (a minute or two either side of lunch, one may be a step ahead of the other)
        const lone = [...pairs.values()].filter((n) => n === 1).length
        expect(lone).toBeLessThanOrEqual(hour > 11 && hour < 14.5 ? 2 : 0)
        for (const [i, { s }] of bareSpots.entries()) if (s.clip?.startsWith("Sit") && who[i]) seated++
      }
      // (the arena brings ~8 fighters, so its duels read: fewer left over to watch than before)
      expect(seated).toBeGreaterThan(4)
    }, 20_000)

    test(`seed ${seed}: a duel's stay carries its routine, its side and its pair; the Warden spars there`, () => {
      const duels = folk.flatMap((f) =>
        f.day.filter((st): st is LifeStay => st.kind === "stay" && st.drill?.id === "duel"),
      )
      expect(duels.length).toBeGreaterThan(0)
      for (const st of duels) {
        expect(st.drill!.pair).toBeDefined()
        expect([0, 1]).toContain(st.drill!.side)
      }
      const spar = warden.steps.find((st): st is LifeStay => st.kind === "stay" && st.act === "work")!
      expect(spots.some(({ s }) => here(spar, s))).toBe(true)
      expect(spar.drill?.id).toBe("duel")
    })
  }
})
