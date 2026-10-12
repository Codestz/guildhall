import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Object3D } from "three"
import type { AdventurerView } from "../src/guild/store.ts"
import { Visits } from "../src/guild/visits.ts"
import { Brain } from "../src/scene/brain.ts"
import { setActiveWorld } from "../src/world/active.ts"
import { islandFromTree } from "../src/world/gen/islandFromTree.ts"
import type { RepoEntry } from "../src/world/gen/repo.ts"
import { HIKERS, hikes, lookoutPost } from "../src/world/hikes.ts"
import type { Spot } from "../src/world/layout.ts"
import { groundAt, pace } from "../src/world/paths.ts"
import { repoWorld, type World } from "../src/world/world.ts"
import REACT from "./fixtures/repos/facebook__react.json"

/**
 * Going up a trail (terrain 2c): the lookouts someone hikes to (world/hikes.ts), the pace and the
 * lean on a slope (world/paths.ts `pace`, scene/brain.ts), and the Scout's search taking them there
 * (guild/visits.ts).
 */

const world: World = repoWorld(islandFromTree(REACT.entries as RepoEntry[], 0, 2), {
  repo: REACT.repo,
  source: "fixture",
  gen: 2,
})

describe("who hikes and where", () => {
  test("about a third of them, picked by who they are", () => {
    const ids = Array.from({ length: 300 }, (_, i) => `town:person-${i}`)
    const going = ids.filter(hikes).length
    expect(going / ids.length).toBeGreaterThan((HIKERS[0] / HIKERS[1]) * 0.7)
    expect(going / ids.length).toBeLessThan((HIKERS[0] / HIKERS[1]) * 1.3)
    expect(ids.filter(hikes)).toEqual(ids.filter(hikes))
  })

  test("to a lookout's trail end, standing short of the cairn and looking out over it", () => {
    const post = lookoutPost(world, "town:ada")
    expect(post).toBeDefined()
    const near = world.trails?.lookouts.find(
      (l) => Math.hypot(l.at[0] - (post?.[0] ?? 0), l.at[1] - (post?.[1] ?? 0)) < 3,
    )
    expect(near).toBeDefined()
    expect(post?.[2]).toBeCloseTo((near?.rot ?? 0) + Math.PI, 1)
  })

  test("nowhere on an island without trails", () => {
    expect(lookoutPost({}, "town:ada")).toBeUndefined()
  })
})

describe("a Scout's search", () => {
  beforeAll(() => setActiveWorld(world))
  afterAll(() => setActiveWorld(undefined))

  test("takes some of them up to a lookout; no one else, and no other deed", () => {
    const visits = new Visits([])
    const scouts = Array.from({ length: 30 }, (_, i) => `scout-${i}`)
    const up = scouts.filter((id) => visits.lookoutFor(id, "scout", "search"))
    expect(up.length).toBeGreaterThan(0)
    expect(up.length).toBeLessThan(scouts.length)
    for (const id of up) {
      expect(visits.lookoutFor(id, "artisan", "search")).toBeUndefined()
      expect(visits.lookoutFor(id, "scout", "edit")).toBeUndefined()
    }
  })

  test("on the hand lands there is nowhere to go", () => {
    setActiveWorld(undefined)
    expect(new Visits([]).lookoutFor("scout-0", "scout", "search")).toBeUndefined()
    setActiveWorld(world)
  })
})

describe("pace on a slope", () => {
  test("slower the steeper the way up, a little careful on the way down, the flat's pace on the level", () => {
    expect(pace(0)).toBe(1)
    expect(pace(0.33)).toBeCloseTo(0.8, 1)
    expect(pace(0.5)).toBeLessThan(pace(0.33))
    expect(pace(-0.3)).toBeLessThan(1)
    expect(pace(-0.3)).toBeGreaterThan(pace(0.33))
  })
})

/** How far (x, z) is from the leg a to b. */
function offLeg(a: Spot, b: Spot, x: number, z: number): number {
  const [dx, dz] = [b[0] - a[0], b[1] - a[1]]
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)))
  return Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t))
}

describe("a walker up a trail", () => {
  beforeAll(() => setActiveWorld(world))
  afterAll(() => setActiveWorld(undefined))

  /** Walks a brain's figure from the foot of a trail to its lookout; what happened on the way. */
  function hike(): { seconds: number; node: Object3D; top: number; pitch: number; astray: number } {
    const trail = world.trails?.trails[0]
    const lookout = world.trails?.lookouts[0]
    if (!trail || !lookout) throw new Error("no trail")
    const post = lookoutPost({ trails: { lookouts: [lookout] } }, "who") as readonly [number, number, number]
    const start = world.roads.nodes[trail.nodes[0] as string] as readonly [number, number]
    const node = new Object3D()
    node.position.set(start[0], 0, start[1])
    const brain = new Brain("who")
    const view = {
      phase: "idle",
      target: post,
      seat: undefined,
      visit: undefined,
    } as unknown as AdventurerView
    const along = trail.nodes.map((name) => world.roads.nodes[name] as readonly [number, number])
    let seconds = 0
    let pitch = 0
    let top = 0
    let astray = 0
    for (; seconds < 600; seconds += 0.05) {
      const stride = brain.walk(node, view, null, false, false, 0.05)
      pitch = Math.max(pitch, node.rotation.x)
      top = Math.max(top, node.position.y)
      astray = Math.max(
        astray,
        Math.min(
          ...along.slice(1).map((b, k) => offLeg(along[k] as Spot, b, node.position.x, node.position.z)),
        ),
      )
      if (!stride.walking) break
    }
    return { seconds, node, top, pitch, astray }
  }

  test("follows the mountain's ground up to the lookout, slowly, on the trail, and leans into the slope", () => {
    const { seconds, node, top, pitch, astray } = hike()
    // On the trail the whole way: never off one of its legs by more than the last few paces to the cairn.
    expect(astray).toBeLessThan(0.5)
    const lookout = world.trails?.lookouts[0]
    expect(
      Math.hypot(node.position.x - (lookout?.at[0] ?? 0), node.position.z - (lookout?.at[1] ?? 0)),
    ).toBeLessThan(4)
    expect(node.position.y).toBeGreaterThan((lookout?.y ?? 0) - 1.5)
    expect(top).toBeGreaterThan(10)
    // About 3.4 units a second on the flat, 0.8 of it up a trail: a hundred units of trail takes the better part of a minute.
    expect(seconds).toBeGreaterThan(30)
    expect(pitch).toBeGreaterThan(0.02)
    expect(pitch).toBeLessThan(0.3)
  })

  test("stands on the ground wherever the island has a mountain, and on the floor elsewhere", () => {
    const lookout = world.trails?.lookouts[0]
    expect(groundAt(lookout?.at[0] ?? 0, lookout?.at[1] ?? 0)).toBeCloseTo(lookout?.y ?? 0, 1)
    expect(groundAt(0, 14)).toBe(0)
    setActiveWorld(undefined)
    expect(groundAt(lookout?.at[0] ?? 0, lookout?.at[1] ?? 0)).toBe(0)
    setActiveWorld(world)
  })
})
