import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { gunzipSync } from "node:zlib"
import { applyAll, emptyModel } from "@guildhall/core"
import { rush } from "@guildhall/sim"
import { viewsOf } from "../src/guild/store.ts"
import { townViewsOf } from "../src/guild/town/views.ts"
import { Visits } from "../src/guild/visits.ts"
import { clearOccupancy, occupants } from "../src/scene/life/occupancy.ts"
import { Visiting } from "../src/scene/visit.ts"
import { setActiveWorld } from "../src/world/active.ts"
import { decodeChronicle } from "../src/world/chronicle/format.ts"
import { cellAt, unkey } from "../src/world/gen/hex.ts"
import { islandFromTree } from "../src/world/gen/islandFromTree.ts"
import type { RepoEntry } from "../src/world/gen/repo.ts"
import { cellToWorld, HEX_SCALE, MAP_FOR_TESTS, PIECES } from "../src/world/lands.ts"
import { GATE, type Spot, STATIONS } from "../src/world/layout.ts"
import { route } from "../src/world/paths.ts"
import { prefab } from "../src/world/prefabs/index.ts"
import { sitesOf } from "../src/world/siteMap.ts"
import { townsfolkAt } from "../src/world/town/townsfolk.ts"
import { nearestVenue, VENUE_KINDS, type Venue, venueKindOf, venueOfCraft } from "../src/world/venues.ts"
import { handWorld, repoWorld, type World } from "../src/world/world.ts"
import HINDSIGHT from "./fixtures/repos/codestz__claude-hindsight.json"
import MCPX from "./fixtures/repos/codestz__mcpx.json"
import MINTROOT from "./fixtures/repos/codestz__mintroot.json"
import COCKPIT from "./fixtures/repos/codestz__opencode-cockpit.json"
import REACT from "./fixtures/repos/facebook__react.json"
import SELF from "./fixtures/repos/guildhall.json"
import IS_ODD from "./fixtures/repos/jonschlinkert__is-odd.json"
import { along } from "./support/clearance.ts"

/**
 * The venues of a gen 2 island (world/venues.ts, ADR 0020 slice 5): one for each district its kind
 * calls for, its door reachable from the keep along the island's roads; what visits them by craft
 * (guild/visits.ts); and how a figure goes in and comes out (scene/visit.ts).
 */

const FIXTURES = [REACT, SELF, IS_ODD, HINDSIGHT, MCPX, MINTROOT, COCKPIT]
const grow = (fixture: { entries: unknown[]; repo: string }, gen: 1 | 2): World =>
  repoWorld(islandFromTree(fixture.entries as RepoEntry[], 0, gen), {
    repo: fixture.repo,
    source: "fixture",
    ...(gen === 2 ? { gen } : {}),
  })
const WORLDS: [string, World][] = FIXTURES.map((fixture) => [fixture.repo, grow(fixture, 2)])
const react = WORLDS[0]?.[1] as World

describe("the registry", () => {
  const district = (biome: Parameters<typeof venueKindOf>[0]["biome"], name = "x", pkg = false) => ({
    biome,
    name,
    package: pkg,
  })

  test("each district kind has its venue", () => {
    expect(venueKindOf(district("harbour", "/"), false)).toBe("tavern")
    expect(venueKindOf(district("library", "docs"), false)).toBe("library")
    expect(venueKindOf(district("quarry", "assets"), false)).toBe("mine")
    expect(venueKindOf(district("proving", "test"), false)).toBe("watchtower")
    expect(venueKindOf(district("farms", ".github"), false)).toBe("watchtower")
    expect(venueKindOf(district("farms", "scripts"), false)).toBe("forge")
  })

  test("a code district is a forge, a workspace package a market hall, the biggest village always the forge", () => {
    expect(venueKindOf(district("village", "src"), false)).toBe("forge")
    expect(venueKindOf(district("village", "packages/react", true), false)).toBe("market")
    expect(venueKindOf(district("village", "packages/react", true), true)).toBe("forge")
  })

  test("forests and the wilds have none", () => {
    expect(venueKindOf(district("forest", "vendor"), false)).toBeUndefined()
    expect(venueKindOf(district("wilds", "(other)"), false)).toBeUndefined()
  })

  test("a deed's craft takes someone to the venue its work belongs to", () => {
    expect(["edit", "write"].map((c) => venueOfCraft(c as never))).toEqual(["forge", "forge"])
    expect(["read", "search", "fetch"].map((c) => venueOfCraft(c as never))).toEqual([
      "library",
      "library",
      "library",
    ])
    expect(["test", "lint"].map((c) => venueOfCraft(c as never))).toEqual(["watchtower", "watchtower"])
    expect(venueOfCraft("run")).toBe("mine")
    expect(["plan", "consult", "delegate"].map((c) => venueOfCraft(c as never))).toEqual([
      "tavern",
      "tavern",
      "tavern",
    ])
    expect(venueOfCraft("other")).toBeUndefined()
    expect(venueOfCraft(undefined)).toBeUndefined()
  })

  test("every kind stands as a venue prefab with a door", () => {
    for (const { prefab: id } of Object.values(VENUE_KINDS)) {
      const item = prefab(id)
      expect(item.kind).toBe("venue")
      expect(item.doors.length).toBeGreaterThan(0)
    }
  })
})

describe("venues on a gen 2 island", () => {
  test("the hand lands and the first generator have none", () => {
    expect(handWorld().venues).toBeUndefined()
    expect(grow(SELF, 1).venues).toBeUndefined()
  })

  for (const [name, world] of WORLDS) {
    const venues = world.venues ?? []

    test(`${name}: one venue for each district whose kind has one, each its own id`, () => {
      expect(venues.length).toBeGreaterThan(0)
      expect(new Set(venues.map((v) => v.id)).size).toBe(venues.length)
      const withVenue = new Set(venues.map((v) => v.district))
      expect(withVenue.size).toBe(venues.length)
      const districts = world.repo?.districts ?? []
      const missing = districts
        .filter((d) => !["forest", "wilds"].includes(d.biome) && d.landmark && !withVenue.has(d.id))
        .map((d) => d.id)
      // Every district whose kind has a venue keeps it: the harbour's tavern too, off the civic wall's
      // hex and clear of the rivers' mouths, so folk and tavern-craft agents have somewhere to go.
      expect(missing).toEqual([])
      // The district's landmark is the venue's own building: its posts stand in front of it.
      for (const v of venues) expect(districts.find((d) => d.id === v.district)?.landmark).toBeDefined()
      // None stands in a river's bed.
      for (const v of venues)
        expect({ id: v.id, at: world.terrain.at(cellAt(v.at)) }).not.toEqual({ id: v.id, at: "r" })
    })

    test(`${name}: a mine stands at a mountain's foot when a range is near, its door facing away from the slope`, () => {
      const massifs = [...(world.relief?.keys ?? [])].map(unkey)
      for (const v of venues.filter((x) => x.kind === "mine")) {
        const [x, z] = v.at
        const slope = massifs
          .map((cell) => cellToWorld(cell))
          .map(([mx, mz]) => ({ mx, mz, d: Math.hypot(x - mx, z - mz) }))
          .sort((a, b) => a.d - b.d)[0]
        // Within two hexes of a massif (neighbouring hexes lie 10 apart), the mine opens away from it.
        if (!slope || slope.d > 21) continue
        const front = (v.door.step[0] - x) * (x - slope.mx) + (v.door.step[1] - z) * (z - slope.mz)
        expect({ id: v.id, front: front >= 0 }).toEqual({ id: v.id, front: true })
        expect({ id: v.id, beside: slope.d <= 10.1 }).toEqual({ id: v.id, beside: true })
      }
    })

    test(`${name}: every door's step is on dry level ground beside the road graph, its sill inside the building`, () => {
      for (const v of venues) {
        const at = `${v.id} @ ${v.door.step}`
        const cell = cellAt(v.door.step)
        expect({ at, char: world.terrain.at(cell) }).not.toEqual({ at, char: "~" })
        expect({ at, level: world.terrain.level(cell) }).toEqual({ at, level: 0 })
        const node = world.roads.nodes[v.node]
        expect(node).toBeDefined()
        // Beside the road: 8.5 where a hex clear of the other venues allows, 14 where only a stray one does.
        expect(Math.hypot(v.door.step[0] - (node?.[0] ?? 0), v.door.step[1] - (node?.[1] ?? 0))).toBeLessThan(
          14,
        )
        expect(footprints(v).some((f) => f(v.door.sill))).toBe(true)
        // Facing the door from the step looks at the sill.
        const ahead: Spot = [
          v.door.step[0] + Math.sin(v.door.inward),
          v.door.step[1] + Math.cos(v.door.inward),
        ]
        expect(Math.hypot(ahead[0] - v.door.sill[0], ahead[1] - v.door.sill[1])).toBeLessThan(
          Math.hypot(v.door.step[0] - v.door.sill[0], v.door.step[1] - v.door.sill[1]),
        )
      }
    })

    test(`${name}: from the keep, every door is reached along the roads, never wading`, () => {
      const forge = STATIONS.forge.posts[0] ?? [0, 0, 0]
      const from: Spot = [forge[0], forge[1]]
      const at = (spot: Spot) => world.terrain.at(MAP_FOR_TESTS.cellOf(spot))
      for (const v of venues) {
        const path = route(from, v.door.step, world.roads)
        expect(path.at(-1)).toEqual(v.door.step)
        expect(path.some((p) => p[0] === GATE[0] && p[1] > 13 && p[1] < 14)).toBe(true)
        // Out of the keep, every leg but the last (the step off the road to the door) is road (or a bridge).
        const outside = ([x, z]: Spot) => Math.abs(x) > 19 || z > GATE[1] + 1
        const offRoad = along([from, ...path.slice(0, -1)])
          .filter(outside)
          .filter((p) => !"=r".includes(at(p)))
        expect({ id: v.id, offRoad: offRoad.slice(0, 2) }).toEqual({ id: v.id, offRoad: [] })
        const wading = along([from, ...path]).filter((p) => at(p) === "~")
        expect({ id: v.id, wading: wading.slice(0, 2) }).toEqual({ id: v.id, wading: [] })
      }
    })

    test(`${name}: a story site takes a district within reach of the keep when its trade has one`, () => {
      const sites = sitesOf(world)
      const districts = (world.repo?.districts ?? []).filter((d) => d.landmark)
      const trade = {
        yard: "village",
        forest: "forest",
        quarry: "quarry",
        proving: "proving",
        tower: "library",
      } as const
      for (const [id, biome] of Object.entries(trade) as [keyof typeof trade, string][])
        if (districts.some((d) => d.biome === biome && Math.hypot(...d.at) <= 90))
          expect({ id, near: Math.hypot(...sites[id].at) <= 90 }).toEqual({ id, near: true })
    })
  }

  test("React's compiler mine is dug into a mountain's flank, and its harbour has its tavern", () => {
    const mine = react.venues?.find((v) => v.kind === "mine")
    const range = [...(react.relief?.keys ?? [])].map((id) => cellToWorld(unkey(id)))
    expect(mine).toBeDefined()
    expect(range.some(([x, z]) => Math.hypot(x - (mine?.at[0] ?? 0), z - (mine?.at[1] ?? 0)) <= 10.1)).toBe(
      true,
    )
    expect(react.venues?.some((v) => v.id === "/#tavern")).toBe(true)
  })

  test("the nearest venue of a kind to the keep is the one agents go to", () => {
    const forge = nearestVenue("forge", [0, 0], react)
    expect(forge).toBeDefined()
    const all = (react.venues ?? []).filter((v) => v.kind === "forge")
    expect(Math.min(...all.map((v) => Math.hypot(...v.at)))).toBe(Math.hypot(...(forge?.at ?? [0, 0])))
  })
})

/** The venue's buildings' footprints: a point test in the world, each part's box turned and scaled. */
function footprints(v: Venue): ((p: Spot) => boolean)[] {
  const item = prefab(v.prefab)
  return item.parts
    .filter((part) => part.piece.startsWith("building_"))
    .map((part) => {
      const box = (PIECES as Record<string, { min: number[]; max: number[] }>)[part.piece]
      const k = HEX_SCALE * (part.scale ?? 1)
      const turn = v.rot + (part.rot ?? 0)
      // The part's own origin in the world, by the prefab's turn.
      const ox = v.at[0] + part.x * Math.cos(v.rot) + part.z * Math.sin(v.rot)
      const oz = v.at[1] - part.x * Math.sin(v.rot) + part.z * Math.cos(v.rot)
      return ([x, z]: Spot): boolean => {
        if (!box) return false
        const dx = x - ox
        const dz = z - oz
        // Back into the piece's own frame (the inverse turn), in pack units.
        const lx = (dx * Math.cos(turn) - dz * Math.sin(turn)) / k
        const lz = (dx * Math.sin(turn) + dz * Math.cos(turn)) / k
        const margin = 0.4 / k
        return (
          lx >= (box.min[0] ?? 0) - margin &&
          lx <= (box.max[0] ?? 0) + margin &&
          lz >= (box.min[2] ?? 0) - margin &&
          lz <= (box.max[2] ?? 0) + margin
        )
      }
    })
}

describe("who visits", () => {
  const venues = react.venues ?? []

  test("a deed's craft takes an agent to the nearest venue of its kind: its door's step, facing in", () => {
    const visits = new Visits(venues)
    const go = visits.forCraft("edit")
    const forge = nearestVenue("forge", [0, 0], react)
    expect(go?.visit.venue).toBe(forge?.id)
    expect(go?.visit.wait).toBe(false)
    expect(go?.target).toEqual([forge?.door.step[0], forge?.door.step[1], forge?.door.inward])
  })

  test("a craft with no venue, and an island with none, send nobody", () => {
    expect(new Visits(venues).forCraft("other")).toBeUndefined()
    expect(new Visits([]).forCraft("edit")).toBeUndefined()
    expect(new Visits([]).any).toBe(false)
  })

  test("a venue holds its capacity; the rest wait at its step, either side of the door", () => {
    const visits = new Visits(venues)
    const forge = nearestVenue("forge", [0, 0], react) as Venue
    const people = Array.from({ length: forge.capacity + 3 }, () => visits.forCraft("write"))
    expect(people.map((p) => p?.visit.wait)).toEqual([...Array(forge.capacity).fill(false), true, true, true])
    const waiting = people.slice(forge.capacity).map((p) => p?.target ?? [0, 0, 0])
    // The first waits on the step; the next two stand off, one each side.
    expect([waiting[0]?.[0], waiting[0]?.[1]]).toEqual([forge.door.step[0], forge.door.step[1]])
    expect(waiting[1]?.[0]).not.toBe(waiting[2]?.[0])
  })

  test("the views send a busy agent whose deed has a venue; the hand lands send nobody", () => {
    const changes = rush(100)
    const start = changes[0]?.at ?? 0
    const model = applyAll(
      emptyModel(),
      changes.filter((c) => c.at <= start + 20_000),
    )
    setActiveWorld(react)
    try {
      const views = viewsOf(model, start + 20_000)
      const visitors = views.filter((v) => v.visit)
      expect(visitors.length).toBeGreaterThan(5)
      for (const v of visitors) {
        const venue = venues.find((x) => x.id === v.visit?.venue)
        expect(venue).toBeDefined()
        expect(v.phase).toBe("working")
        expect(v.site).toBeUndefined()
        expect(v.station).toBeUndefined()
        if (!v.visit?.wait && venue) expect([v.target[0], v.target[1]]).toEqual([...venue.door.step])
      }
    } finally {
      setActiveWorld(undefined)
    }
    expect(viewsOf(model, start + 20_000).some((v) => v.visit)).toBe(false)
  })
})

describe("the townsfolk call in", () => {
  const chronicle = decodeChronicle(
    gunzipSync(readFileSync(join(import.meta.dir, "../public/chronicles/react__react.json.gz"))).toString(),
  )

  test("a busy resident of a district with a venue calls in at it between spells at work", () => {
    const folk = townsfolkAt(chronicle, react, chronicle.end, { cap: 120 })
    const views = townViewsOf(folk, react, "world", true)
    const calling = views.filter((v) => v.visit)
    expect(calling.length).toBeGreaterThan(5)
    for (const v of calling) {
      expect(v.phase).toBe("working")
      expect(v.visit?.cycle).toBe(true)
      expect(react.venues?.some((venue) => venue.id === v.visit?.venue)).toBe(true)
      // A district's own people: the venue is in the district they work in, when the view says which.
      if (v.district) expect(v.visit?.venue.startsWith(`${v.district}#`)).toBe(true)
      // Their work post stays their target: the visit is a trip from it.
      expect(v.visit?.door.step).not.toEqual([v.target[0], v.target[1]])
    }
  })

  test("on the first generator's island nobody does", () => {
    const first = grow(REACT, 1)
    const folk = townsfolkAt(chronicle, first, chronicle.end, { cap: 60 })
    expect(townViewsOf(folk, first, "world", true).some((v) => v.visit)).toBe(false)
  })
})

describe("going in and coming out", () => {
  const door = { step: [10, 0] as Spot, sill: [10, -2] as Spot, y: 0, inward: Math.PI }
  const visit = { venue: "v#forge", kind: "forge" as const, door, wait: false }
  const quiet = () => {}
  const frame = (v: Visiting, want: typeof visit | undefined, arrived: boolean, dt = 0.1) =>
    v.update(want, arrived, dt)

  test("walks to the step, waits at the door, goes through the sill hidden, and comes out the same way", () => {
    clearOccupancy()
    const v = new Visiting("a", quiet, () => 1)
    expect(v.engaged).toBe(false)
    frame(v, visit, false)
    expect(v.phase).toBe("go")
    expect(v.leg()).toEqual({ to: door.step, direct: false })
    frame(v, visit, false)
    expect(v.phase).toBe("go")
    frame(v, visit, true)
    expect(v.phase).toBe("knock")
    expect(v.leg()?.face).toBe(door.inward)
    // The door opens after its pause, once.
    for (let t = 0; v.phase === "knock" && t < 20; t++) frame(v, visit, true)
    expect(v.phase).toBe("enter")
    expect(v.opened).toBe(1)
    expect(v.goal).toBe(0)
    expect(v.leg()).toEqual({ to: door.sill, direct: true })
    frame(v, visit, true)
    expect(v.phase).toBe("inside")
    expect(occupants("v#forge", 1)).toBe(1)
    // Still inside while the visit lasts, however long.
    for (let t = 0; t < 100; t++) frame(v, visit, true)
    expect(v.phase).toBe("inside")
    // The deed is done: out through the sill, fading in, to the step.
    frame(v, undefined, true)
    expect(v.phase).toBe("leave")
    expect(v.opened).toBe(2)
    expect(v.goal).toBe(1)
    expect(occupants("v#forge", 1)).toBe(0)
    expect(v.leg()).toEqual({ to: door.step, direct: true })
    frame(v, undefined, false)
    expect(v.phase).toBe("leave")
    frame(v, undefined, true)
    expect(v.phase).toBe("out")
    expect(v.engaged).toBe(false)
    expect(v.leg()).toBeUndefined()
  })

  test("a visit called off on the way (or at the door, before it opens) goes back to work", () => {
    const v = new Visiting("b", quiet, () => 1)
    frame(v, visit, false)
    frame(v, undefined, false)
    expect(v.phase).toBe("out")
    frame(v, visit, false)
    frame(v, visit, true)
    expect(v.phase).toBe("knock")
    frame(v, undefined, true)
    expect(v.phase).toBe("out")
    expect(v.opened).toBe(0)
  })

  test("a full venue's waiting visitor stays out, and goes in when it is let", () => {
    const v = new Visiting("c", quiet, () => 1)
    frame(v, { ...visit, wait: true }, true)
    expect(v.phase).toBe("out")
    frame(v, visit, true)
    expect(v.phase).toBe("go")
  })

  test("a different venue asked for from inside: out of this door first", () => {
    const v = new Visiting("d", quiet, () => 1)
    for (let t = 0; t < 12; t++) frame(v, visit, true)
    expect(v.phase).toBe("inside")
    frame(v, { ...visit, venue: "w#library" }, true)
    expect(v.phase).toBe("leave")
  })

  test("a townsperson's calls come between spells at work: in for a while, then out, over and over", () => {
    const calls = { ...visit, cycle: true as const }
    const v = new Visiting("town:ada", quiet, () => 1)
    const seen = new Set<string>()
    let ins = 0
    for (let t = 0; t < 4000; t++) {
      const before = v.phase
      frame(v, calls, v.phase !== "out", 0.1)
      seen.add(v.phase)
      if (before !== "inside" && v.phase === "inside") ins++
    }
    expect([...seen].sort()).toEqual(["enter", "go", "inside", "knock", "leave", "out"])
    expect(ins).toBeGreaterThan(3)
  })

  test("a raised sill lifts them up its steps as they go in", () => {
    const raised = { ...door, y: 1 }
    const v = new Visiting("e", quiet, () => 1)
    const node = { position: { x: 10, y: 0, z: 0 } } as never as import("three").Object3D
    const high = { ...visit, door: raised }
    v.update(high, false, 0.1, node)
    v.update(high, true, 0.1, node)
    for (let t = 0; v.phase === "knock" && t < 20; t++) v.update(high, true, 0.1, node)
    expect(v.phase).toBe("enter")
    node.position.z = -1
    v.update(high, false, 0.1, node)
    expect(node.position.y).toBeCloseTo(0.5, 1)
    node.position.z = -2
    v.update(high, true, 0.1, node)
    expect(node.position.y).toBeCloseTo(1, 5)
  })
})

describe("what an occupied venue shows", () => {
  test("a figure counts while it keeps saying it is inside, and not once it stops", () => {
    clearOccupancy()
    const v = new Visiting(
      "f",
      () => {},
      () => 5,
    )
    for (let t = 0; t < 12; t++)
      v.update(
        {
          venue: "x#tavern",
          kind: "tavern",
          door: { step: [0, 0], sill: [0, -1], y: 0, inward: 0 },
          wait: false,
        },
        true,
        0.1,
      )
    expect(occupants("x#tavern", 5)).toBe(1)
    // Unmounted: nobody says it any more, so it stops counting by itself.
    expect(occupants("x#tavern", 6)).toBe(0)
  })
})

beforeAll(() => setActiveWorld(undefined))
afterAll(() => setActiveWorld(undefined))
