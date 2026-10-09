import { describe, expect, test } from "bun:test"
import { blocker, islandObstacles, onDryLand } from "../src/world/clearance.ts"
import { footprintsOf } from "../src/world/gen/dress/footprints.ts"
import { KEEP } from "../src/world/gen/plan.ts"
import { MAP_FOR_TESTS, SITES, type SiteId } from "../src/world/lands.ts"
import { GATE, ROOM, type Spot, STATIONS } from "../src/world/layout.ts"
import { route } from "../src/world/paths.ts"
import { sitesOf } from "../src/world/siteMap.ts"
import type { World } from "../src/world/world.ts"
import { along } from "./support/clearance.ts"
import { gen2Worlds } from "./support/fixtures.ts"

/**
 * Every bundled repo grown as the default world (gen 2): the story's sites, the keep and the roads
 * work as they do at gen 1 (siteMap.test.ts), and nothing stands in the air or in the ground.
 */

const IDS = Object.keys(SITES) as SiteId[]
/** How far a building or tree may stand off the ground under it before it floats or sinks. */
const SLACK = 0.75
/** Trees on a terrace's ramp stand on their sloped hex by design (dress/hexes.ts). */
const RAMPED = /^tree_single/

/**
 * Islands so small that a district's work place and a venue's step can only stand on the beach: the
 * sand slopes away from the sea hex's centre for WATER_CLEARANCE (8), and these stand 6.8 or more
 * from it. There, land that is not water is dry enough.
 */
const BEACHED = new Set(["Codestz/mcpx"])

const dryOn = (name: string, world: World, spot: Spot): boolean => {
  const cell = MAP_FOR_TESTS.cellOf(spot)
  const land = world.terrain.level(cell) === 0 && world.terrain.at(cell) !== "~"
  return onDryLand(spot, world) || (BEACHED.has(name) && land)
}

describe("a gen 2 island", () => {
  for (const [name, world] of gen2Worlds()) {
    test(`${name}: every site has posts of its own on dry land, clear of buildings`, () => {
      const sites = sitesOf(world)
      const buildings = islandObstacles(world).filter(
        (o) => /^building_/.test(o.name) && !/dirt|bridge/.test(o.name),
      )
      const posts = IDS.flatMap((id) => sites[id].posts.map((post) => ({ id, post })))
      for (const { id, post } of posts) {
        const at = `${id} @ ${post[0]},${post[1]}`
        expect({ at, dry: dryOn(name, world, [post[0], post[1]]) }).toEqual({ at, dry: true })
        expect({ at, hit: blocker([post[0], post[1]], buildings, 0)?.name }).toEqual({ at, hit: undefined })
      }
    })

    test(`${name}: the keep stands at the origin on level ground, no building inside its walls`, () => {
      for (const id of KEEP.keys()) {
        const [q, line] = id.split(",").map(Number) as [number, number]
        expect(world.terrain.level([q, line])).toBe(0)
      }
      const inside = world.island.decor.filter(
        (d) =>
          footprintsOf([d]).length > 0 &&
          Math.abs(d.x) < ROOM.width / 2 + 1 &&
          Math.abs(d.z) < ROOM.depth / 2 + 1,
      )
      expect(inside.map((d) => d.piece)).toEqual([])
    })

    test(`${name}: from the forge, every site is reached through the gate along its roads, never wading`, () => {
      const forge = STATIONS.forge.posts[0] ?? [0, 0, 0]
      const at = (spot: Spot) => world.terrain.at(MAP_FOR_TESTS.cellOf(spot))
      for (const id of IDS)
        for (const post of sitesOf(world)[id].posts) {
          const from: Spot = [forge[0], forge[1]]
          const path = route(from, [post[0], post[1]], world.roads)
          expect(path.at(-1)).toEqual([post[0], post[1]])
          expect(path.some((p) => p[0] === GATE[0] && p[1] > 13 && p[1] < 14)).toBe(true)
          const wading = along([from, ...path]).filter((p) => at(p) === "~")
          expect({ id, wading: wading.slice(0, 2) }).toEqual({ id, wading: [] })
        }
    })

    test(`${name}: no building or forest tree floats above its ground or sinks into it`, () => {
      const off = world.island.decor
        .filter((d) => d.piece.startsWith("building_") || d.piece.startsWith("tree_"))
        .filter((d) => !RAMPED.test(d.piece))
        .filter((d) => Math.abs((d.y ?? 0) - world.ground.heightAt(d.x, d.z)) > SLACK)
        .map((d) => `${d.piece}@${d.x},${d.z} y ${d.y ?? 0} vs ${world.ground.heightAt(d.x, d.z).toFixed(2)}`)
      expect(off).toEqual([])
    })

    test(`${name}: no piece is placed twice on one spot`, () => {
      const seen = new Set<string>()
      const twice: string[] = []
      for (const d of world.island.decor) {
        const id = `${d.piece}|${d.x}|${d.z}|${d.y ?? 0}|${d.rot ?? 0}`
        if (seen.has(id)) twice.push(id)
        seen.add(id)
      }
      expect(twice).toEqual([])
    })

    test(`${name}: every venue's door step is on dry land`, () => {
      for (const venue of world.venues ?? []) {
        const at = `${venue.id} @ ${venue.door.step}`
        expect({ at, dry: dryOn(name, world, venue.door.step) }).toEqual({ at, dry: true })
      }
    })
  }
})
