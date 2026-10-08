import { describe, expect, test } from "bun:test"
import { parseDeepLink } from "../src/guild/deeplink.ts"
import { GitHubError } from "../src/world/gen/fetch.ts"
import { islandFromTree } from "../src/world/gen/islandFromTree.ts"
import { reasonOf, type Tree } from "../src/world/gen/load.ts"
import type { RepoEntry } from "../src/world/gen/repo.ts"
import { MAP_FOR_TESTS } from "../src/world/lands.ts"
import type { Spot } from "../src/world/layout.ts"
import { GLOWS, glowsOf, LIGHTS, lightsOf, toSegment } from "../src/world/lights.ts"
import { worldSource } from "../src/world/source.ts"
import { ROAD_HALF, WATER_CLEARANCE, wilds, wildsOf } from "../src/world/wilds.ts"
import { handWorld, reachOf, repoWorld, type World } from "../src/world/world.ts"
import REACT from "./fixtures/repos/facebook__react.json"
import SELF from "./fixtures/repos/guildhall.json"

const grow = (entries: unknown[], repo: string): World =>
  repoWorld(islandFromTree(entries as RepoEntry[]), { repo, source: "fixture" })
const WORLDS: [string, World][] = [
  ["guildhall", grow(SELF.entries, SELF.repo)],
  ["react", grow(REACT.entries, REACT.repo)],
]

const roadsOf = (world: World): [Spot, Spot][] =>
  world.roads.edges.flatMap(([a, b]) => {
    const from = world.roads.nodes[a]
    const to = world.roads.nodes[b]
    return from && to ? [[from, to] as [Spot, Spot]] : []
  })

describe("the hand world", () => {
  test("is what the hall always drew: its lights and wilds are the hand map's", () => {
    const hand = handWorld()
    expect(hand.kind).toBe("hand")
    expect(lightsOf(hand)).toBe(LIGHTS)
    expect(glowsOf(hand)).toBe(GLOWS)
    expect(wildsOf(hand)).toEqual(wilds())
  })
})

describe("a repo's world", () => {
  for (const [name, world] of WORLDS) {
    test(`${name}: its districts' landmarks are its work places, posts and all`, () => {
      const landmarks = world.repo?.districts.filter((d) => d.landmark) ?? []
      expect(world.kind).toBe("repo")
      expect(world.sites.length).toBe(landmarks.length)
      expect(world.sites.length).toBeGreaterThan(1)
      for (const site of world.sites) expect(site.posts.length).toBeGreaterThan(0)
    })

    test(`${name}: its terrain is the plan's — land where the plan has land, sea round it`, () => {
      const { terrain } = world
      for (const id of terrain.cells()) {
        const [q, line] = id.split(",").map(Number) as [number, number]
        expect(terrain.at([q, line])).not.toBe("~")
      }
      expect(terrain.at([0, 40])).toBe("~")
      expect(terrain.at([0, 0])).toBe("=")
    })

    test(`${name}: lit along its roads, never in water, on a road, in a building or on a post`, () => {
      const lights = lightsOf(world)
      const torches = lights.filter((l) => l.placement.piece === "torch")
      expect(torches.length).toBeGreaterThan(Object.keys(world.roads.nodes).length / 3)
      expect(lights.some((l) => l.placement.piece === "lantern")).toBe(true)
      const buildings = world.island.decor.filter((d) => d.piece.startsWith("building_"))
      const posts = world.sites.flatMap((s) => s.posts)
      for (const { placement: p } of lights) {
        for (const w of world.island.water) expect(Math.hypot(w[0] - p.x, w[1] - p.z)).toBeGreaterThan(5)
        for (const b of buildings) expect(Math.hypot(b.x - p.x, b.z - p.z)).toBeGreaterThan(3.1)
        for (const post of posts) expect(Math.hypot(post[0] - p.x, post[1] - p.z)).toBeGreaterThan(1.7)
        for (const [a, b] of roadsOf(world)) expect(toSegment([p.x, p.z], a, b)).toBeGreaterThan(1.6)
      }
      // No keep, so no gate torches, and no graveyard glows.
      expect(glowsOf(world)).toBe(lights)
    })

    test(`${name}: wilds grow on its level land, off the sea and the roads`, () => {
      const grown = wildsOf(world)
      expect(grown.length).toBeGreaterThan(50)
      const sea = world.island.water
      const roads = roadsOf(world)
      for (const wild of grown) {
        const cell = MAP_FOR_TESTS.cellOf([wild.x, wild.z])
        expect(world.terrain.level(cell)).toBe(0)
        expect(".fvVs=".includes(world.terrain.at(cell))).toBe(true)
        for (const w of sea)
          expect(Math.hypot(w[0] - wild.x, w[1] - wild.z)).toBeGreaterThanOrEqual(WATER_CLEARANCE)
        for (const [a, b] of roads)
          expect(toSegment([wild.x, wild.z], a, b)).toBeGreaterThanOrEqual(ROAD_HALF)
      }
    })
  }

  test("reaches further than the hand island's keep, inside its drawn sea", () => {
    for (const [, world] of WORLDS) {
      const reach = reachOf(world)
      expect(reach).toBeGreaterThan(40)
      const sea = Math.max(...world.island.tiles.map((t) => Math.hypot(t.x, t.z)))
      expect(reach).toBeLessThan(sea)
    }
  })
})

describe("the world source", () => {
  const tree: Tree = { repo: "Codestz/guildhall", source: "fixture", entries: SELF.entries as RepoEntry[] }

  test("a repo that loads becomes the world; one that fails leaves the hand island and says why", async () => {
    const seen: string[] = []
    const off = worldSource.subscribe(() => seen.push(worldSource.status.state))
    const loaded = await worldSource.load("sample", async () => tree)
    expect(loaded.kind).toBe("repo")
    expect(worldSource.world).toBe(loaded)
    expect(loaded.repo?.repo).toBe("Codestz/guildhall")
    expect(seen).toEqual(["loading", "repo"])

    const failed = await worldSource.load("acme/missing", async () => {
      throw new Error("GitHub has no public repo called acme/missing")
    })
    expect(failed).toBe(handWorld())
    expect(worldSource.status).toEqual({
      state: "failed",
      repo: "acme/missing",
      reason: "GitHub has no public repo called acme/missing",
    })
    off()
  })

  test("only the last repo asked for wins", async () => {
    let release: (tree: Tree) => void = () => {}
    const slow = worldSource.load("first/one", () => new Promise<Tree>((resolve) => (release = resolve)))
    const fast = await worldSource.load("sample", async () => tree)
    release({ ...tree, repo: "first/one" })
    await slow
    expect(worldSource.world).toBe(fast)
    expect(worldSource.status).toEqual({ state: "repo" })
  })
})

describe("repo errors, in words", () => {
  test("not found, rate limited, other answers and no network", () => {
    expect(reasonOf(new GitHubError("x", 404), "acme/tool")).toBe(
      "GitHub has no public repo called acme/tool",
    )
    const limit = "GitHub's rate limit for unauthenticated calls (60 an hour) is used up"
    expect(reasonOf(new GitHubError(limit, 403), "acme/tool")).toBe(limit)
    expect(reasonOf(new GitHubError("x", 500), "acme/tool")).toBe("GitHub couldn't list acme/tool (500)")
    expect(reasonOf(new TypeError("fetch failed"), "acme/tool")).toBe("couldn't reach GitHub for acme/tool")
  })
})

describe("the repo deep link", () => {
  test("takes sample, owner/name or a GitHub URL; anything else is ignored", () => {
    expect(parseDeepLink("repo=sample", false).link.repo).toBe("sample")
    expect(parseDeepLink("repo=facebook/react", false).link.repo).toBe("facebook/react")
    expect(parseDeepLink("repo=https://github.com/facebook/react.git", false).link.repo).toBe(
      "facebook/react",
    )
    const bad = parseDeepLink("repo=../etc&repo=not a repo", false)
    expect(bad.link.repo).toBeUndefined()
    expect(bad.ignored).toEqual(["repo=../etc", "repo=not a repo"])
  })
})
