import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { applyAll, emptyModel } from "@guildhall/core"
import { rush } from "@guildhall/sim"
import { type AdventurerView, viewsOf } from "../src/guild/store.ts"
import { release, reserve } from "../src/scene/activity.ts"
import { setActiveWorld } from "../src/world/active.ts"
import { type Place, pilesOf, placeOf, shifted, workTreesOf } from "../src/world/behaviours.ts"
import { BODY, blocker, islandObstacles, onDryLand } from "../src/world/clearance.ts"
import { islandFromTree } from "../src/world/gen/islandFromTree.ts"
import { KEEP } from "../src/world/gen/plan.ts"
import type { RepoEntry } from "../src/world/gen/repo.ts"
import { MAP_FOR_TESTS, SITES, type SiteId } from "../src/world/lands.ts"
import { GATE, ROOM, type Spot, STATIONS } from "../src/world/layout.ts"
import { route } from "../src/world/paths.ts"
import { sitesOf } from "../src/world/siteMap.ts"
import { handWorld, repoWorld, type World } from "../src/world/world.ts"
import REACT from "./fixtures/repos/facebook__react.json"
import SELF from "./fixtures/repos/guildhall.json"
import IS_ODD from "./fixtures/repos/jonschlinkert__is-odd.json"
import { along, walks } from "./support/clearance.ts"

/**
 * The story's job sites on a repo's island (world/siteMap.ts): each takes the district that fits
 * its trade, the keep stands at the origin with its gate onto the harbour, and the guild walks the
 * island's own roads to work there.
 */

const grow = (entries: unknown[], repo: string): World =>
  repoWorld(islandFromTree(entries as RepoEntry[]), { repo, source: "fixture" })
const react = grow(REACT.entries, REACT.repo)
const WORLDS: [string, World][] = [
  ["guildhall", grow(SELF.entries, SELF.repo)],
  ["react", react],
  ["is-odd", grow(IS_ODD.entries, IS_ODD.repo)],
]
const IDS = Object.keys(SITES) as SiteId[]
const districtAt = (world: World, at: Spot) => world.repo?.districts.find((d) => d.at === at)

describe("the hand lands", () => {
  test("keep lands.ts' sites, active or not", () => {
    expect(sitesOf(handWorld())).toBe(SITES)
    expect(sitesOf(undefined)).toBe(SITES)
    expect(sitesOf()).toBe(SITES)
  })
})

describe("a repo's island", () => {
  test("each trade takes its own biome's district, the largest first; the river a shore", () => {
    const sites = sitesOf(react)
    const district = (id: SiteId) => districtAt(react, sites[id].at)
    expect(IDS.map((id) => [id, district(id)?.id])).toEqual([
      // A split workspace: the yard is its biggest package's village.
      ["yard", "packages/react-dom"],
      ["forest", ".codesandbox"],
      ["river", expect.any(String)],
      ["proving", "fixtures"],
      ["quarry", "compiler"],
      ["tower", ".claude"],
    ])
    // The river: a district no other trade took, its posts on the shore facing the open sea.
    const river = district("river")
    expect(river && ["harbour", "village", "forest", "quarry", "proving", "library"]).not.toContain(
      river?.biome,
    )
    for (const [x, z, facing] of sites.river.posts) {
      const ahead: Spot = [x + Math.sin(facing) * 6, z + Math.cos(facing) * 6]
      expect(react.terrain.at(MAP_FOR_TESTS.cellOf(ahead))).toBe("~")
    }
  })

  test("the same island always maps the same way", () => {
    expect(sitesOf(grow(REACT.entries, REACT.repo))).toEqual(sitesOf(react))
  })

  for (const [name, world] of WORLDS) {
    test(`${name}: every site has posts of its own on dry level land, clear of buildings`, () => {
      const sites = sitesOf(world)
      const buildings = world.island.decor.filter(
        (d) => d.piece.startsWith("building_") && !/dirt|bridge/.test(d.piece),
      )
      const posts = IDS.flatMap((id) => sites[id].posts.map((post) => ({ id, post })))
      for (const { id, post } of posts) {
        const at = `${id} @ ${post[0]},${post[1]}`
        expect({ at, dry: onDryLand([post[0], post[1]], world) }).toEqual({ at, dry: true })
        for (const house of buildings)
          expect(Math.hypot(house.x - post[0], house.z - post[1])).toBeGreaterThan(2.5)
        // Shared districts: each site round its own side of the landmark.
        for (const other of posts)
          if (other.id !== id)
            expect(Math.hypot(other.post[0] - post[0], other.post[1] - post[1])).toBeGreaterThan(1)
      }
    })

    test(`${name}: the keep stands at the origin on level ground, nothing built inside its walls`, () => {
      for (const id of KEEP.keys()) {
        const [q, line] = id.split(",").map(Number) as [number, number]
        expect(world.terrain.level([q, line])).toBe(0)
        for (const [dq, dl] of [
          [1, 1],
          [0, 2],
          [-1, 1],
          [-1, -1],
          [0, -2],
          [1, -1],
        ] as const)
          expect(world.terrain.at([q + dq, line + dl])).not.toBe("~")
      }
      const inside = world.island.decor.filter(
        (d) => Math.abs(d.x) < ROOM.width / 2 + 1 && Math.abs(d.z) < ROOM.depth / 2 + 1,
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
          // Out of the doorway, every leg but the last (the step off the road to the post) is road.
          const outside = ([x, z]: Spot) => Math.abs(x) > ROOM.width / 2 + 1 || z > GATE[1] + 1
          const offRoad = along([from, ...path.slice(0, -1)])
            .filter(outside)
            .filter((p) => at(p) !== "=")
          expect({ id, offRoad: offRoad.slice(0, 2) }).toEqual({ id, offRoad: [] })
          const wading = along([from, ...path]).filter((p) => at(p) === "~")
          expect({ id, wading: wading.slice(0, 2) }).toEqual({ id, wading: [] })
        }
    })
  }
})

describe("the guild at work on a repo's island", () => {
  beforeAll(() => setActiveWorld(react))
  afterAll(() => setActiveWorld(undefined))
  const obstacles = () => islandObstacles(react)

  test("its piles and work trees are the island's own, by the sites' posts", () => {
    const sites = sitesOf(react)
    expect(workTreesOf(react)).toHaveLength(sites.forest.posts.length)
    const piles = pilesOf(react)
    const near = (spot: { x: number; z: number }, id: SiteId) =>
      Math.min(...sites[id].posts.map((p) => Math.hypot(p[0] - spot.x, p[1] - spot.z)))
    expect(near(piles.logs, "forest")).toBeLessThan(4)
    expect(near(piles.stones, "quarry")).toBeLessThan(4)
    expect(near(piles.fish, "river")).toBeLessThan(4)
    expect(near(piles.books, "tower")).toBeLessThan(4)
  })

  test("every berth's standing spots are on dry land, clear of the island's obstacles", () => {
    for (const id of IDS)
      sitesOf(react)[id].posts.forEach((post, berth) => {
        const place = placeOf(id, undefined, post)
        expect(place?.berth).toBe(berth)
        if (!place) return
        for (const [name, spot] of Object.entries(place.spots)) {
          if (place.behaviour.marks.has(name)) continue
          const at = `${id}#${berth} ${name}`
          // The post itself stands where the district put it (its work may be a step off a prop).
          const blocked = name === "post" ? undefined : blocker(spot, obstacles())?.name
          expect({ at, dry: onDryLand(spot), blocked }).toEqual({ at, dry: true, blocked: undefined })
        }
      })
  })

  test("a rush of 100: everyone works at the site's posts, the crowd spread over dry ground", () => {
    const changes = rush(100)
    const start = changes[0]?.at ?? 0
    const views: AdventurerView[] = viewsOf(
      applyAll(
        emptyModel(),
        changes.filter((c) => c.at <= start + 20_000),
      ),
      start + 20_000,
    )
    const placed: { view: AdventurerView; place: Place; lap: number }[] = []
    for (const view of views) {
      if (view.phase !== "working" || !view.site) continue
      const place = placeOf(view.site, view.station, view.target)
      expect(place).toBeDefined()
      if (place) placed.push({ view, place, lap: reserve(place, view.id) })
    }
    for (const { view, place } of placed) release(place, view.id)
    expect(placed.length).toBeGreaterThan(30)
    for (const { place, lap } of placed) {
      const moved = shifted(place, lap)
      for (const [name, spot] of Object.entries(moved.spots)) {
        if (place.behaviour.marks.has(name) || (lap === 0 && name === "post")) continue
        const at = `${place.key}#${place.berth} lap ${lap} ${name}`
        expect({ at, dry: onDryLand(spot) }).toEqual({ at, dry: true })
      }
      // Short walks between their spots stay on dry land (the long ones take the roads).
      for (const walk of walks(moved, moved.behaviour.loop, [moved.post[0], moved.post[1]]))
        if (walk.path.length <= 2)
          for (const point of along(walk.path)) {
            const at = `${place.key}#${place.berth} lap ${lap} → ${walk.to}`
            expect({ at, dry: onDryLand(point), hit: blocker(point, obstacles(), BODY * 0.6)?.name }).toEqual(
              {
                at,
                dry: true,
                hit: lap === 0 ? blocker(point, obstacles(), BODY * 0.6)?.name : undefined,
              },
            )
          }
    }
  })
})
