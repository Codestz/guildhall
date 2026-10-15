/**
 * Face to face, never nose to nose: every source that sets two fighters facing each other keeps them
 * DUEL_APART between centres (drills.ts), closing no nearer than DUEL_CLOSEST at a blow. The sources:
 *
 *   the arena's duels    a tile's spots of one `pair` (data/tiles), stepping in for the bout;
 *   a hero's sparring    a hero at a `drill` spot (a practice shield, a dummy) plays sword and shield
 *                        (sim craft.ts SPARRING), so whoever stands near it, a hero or a townsfolk at
 *                        its own spot, may be squared up to: every such spot keeps DUEL_APART from all.
 */
import { afterAll, describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { DRILLS, DUEL_APART, DUEL_CLOSEST, drillFrame, pairedDrill } from "../src/hex/drills.ts"
import {
  hexIsland,
  hexWalk,
  hexWorld,
  hexZones,
  installTilePrefabs,
  lifePlaces,
  parseTilePrefabs,
  tilePrefabs,
  workTiles,
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

const turnDiff = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)))

describe("fighters face to face keep their distance", () => {
  test("every paired drill on every tile: DUEL_APART at rest, never nearer than DUEL_CLOSEST, facing each other", () => {
    let pairs = 0
    for (const prefab of tilePrefabs()) {
      const spots = prefab.spots ?? []
      const names = new Set(
        spots.filter((s) => s.pair && s.drill && pairedDrill(s.drill)).map((s) => s.pair!),
      )
      for (const name of names) {
        const [a, b] = spots.filter((s) => s.pair === name)
        pairs++
        expect(Math.hypot(a!.x - b!.x, a!.z - b!.z)).toBeCloseTo(DUEL_APART, 2)
        // each looks straight at the other (its shield arm's side toward the other's blade)
        expect(turnDiff(a!.facing, Math.atan2(b!.x - a!.x, b!.z - a!.z))).toBeLessThan(0.05)
        expect(turnDiff(b!.facing, Math.atan2(a!.x - b!.x, a!.z - b!.z))).toBeLessThan(0.05)
        const id = a!.drill!
        let closest = Number.POSITIVE_INFINITY
        for (let t = 0; t < DRILLS[id]!.period * 2; t += 0.05) {
          const sa = drillFrame(id, 0, t).step
          const sb = drillFrame(id, 1, t).step
          const ax = a!.x + Math.sin(a!.facing) * sa
          const az = a!.z + Math.cos(a!.facing) * sa
          const bx = b!.x + Math.sin(b!.facing) * sb
          const bz = b!.z + Math.cos(b!.facing) * sb
          closest = Math.min(closest, Math.hypot(ax - bx, az - bz))
        }
        expect(closest).toBeGreaterThanOrEqual(DUEL_CLOSEST - 1e-6)
        // and they do step in to fight (a blow at sword reach, not across the yard)
        expect(closest).toBeLessThan(DUEL_APART)
      }
    }
    expect(pairs).toBeGreaterThanOrEqual(2)
  })

  test("a hero's sparring spot keeps DUEL_APART from every other hero spot and every townsfolk spot", () => {
    let drills = 0
    let nearest = Number.POSITIVE_INFINITY
    for (const seed of [1, 2, 3, 4, 5]) {
      const h = hexIsland({ seed, files: 4000 })
      const z = hexZones(h)
      const w = hexWorld(h, z)
      const walk = hexWalk(h, z, w, { reach: workTiles(h, z) })
      const places = lifePlaces(h, z, w, walk, { heroSpots: 3 })
      const heroes = [...z.zones.keys()].flatMap((zi) => places.heroSpots(zi))
      for (const s of heroes) {
        if (s.pose !== "drill") continue
        drills++
        for (const o of heroes)
          if (o !== s) nearest = Math.min(nearest, Math.hypot(o.at[0] - s.at[0], o.at[2] - s.at[2]))
        for (const f of places.furniture.spots)
          nearest = Math.min(nearest, Math.hypot(f.x - s.at[0], f.z - s.at[2]))
      }
    }
    expect(drills).toBeGreaterThan(0)
    expect(nearest).toBeGreaterThanOrEqual(DUEL_APART - 1e-6)
  }, 60000)
})
