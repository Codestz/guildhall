import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { createHash } from "node:crypto"
import { BODY, blocker, box, islandObstacles, type Obstacle } from "../src/world/clearance.ts"
import { liftOf, type Placement } from "../src/world/furniture.ts"
import { cellAt } from "../src/world/gen/hex.ts"
import { buildHall, sizeOf, wayIn, wayOut } from "../src/world/hall/build.ts"
import { spotFor } from "../src/world/hall/spots.ts"
import { STYLE_OF, STYLES } from "../src/world/hall/styles.ts"
import type { Hall, HallStyle } from "../src/world/hall/types.ts"
import KIT from "../src/world/kit.json"
import { COMPOSITES } from "../src/world/prefabs/composite/index.ts"
import { SLOW } from "./support/slow.ts"
import { reactSplit } from "./support/splitFixture.ts"

// React is grown as an archipelago once for the file (a few seconds; more on a slow machine).
setDefaultTimeout(60_000 * SLOW)

/**
 * An island's hall (world/hall): a far island's open-roofed floor before its main landmark's door,
 * furnished in the landmark's style with seats and stations the island's folk take.
 */

type Bounds = { min: readonly number[]; max: readonly number[] }
const bounds = (piece: string): Bounds | undefined => (KIT as Record<string, Bounds>)[piece]

const hashOf = (value: unknown): string =>
  createHash("sha1").update(JSON.stringify(value)).digest("hex").slice(0, 8)
const STYLE_IDS = Object.keys(STYLES) as HallStyle[]

/** What stands on a hall's floor as footprints (floor tiles, rugs, wall hangings and things on tables left out). */
function furniture(hall: Hall): { piece: Placement; body: Obstacle }[] {
  return hall.props.flatMap((piece) => {
    const b = bounds(piece.piece)
    if (!b || (piece.y ?? 0) > 0.05 || /^(rug_|pillar|torch)/.test(piece.piece)) return []
    return [{ piece, body: box(piece.piece, b, piece.x, piece.z, piece.rot ?? 0, piece.scale ?? 1) }]
  })
}

/** Points along a straight way, every `step`. */
function along(a: readonly [number, number], b: readonly [number, number], step = 0.25): [number, number][] {
  const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step))
  return Array.from({ length: n + 1 }, (_, i) => [
    a[0] + ((b[0] - a[0]) * i) / n,
    a[1] + ((b[1] - a[1]) * i) / n,
  ])
}

describe("halls by landmark", () => {
  test("every composite landmark has a style, and every style a distinct layout", () => {
    for (const composite of COMPOSITES) expect(STYLE_OF[composite.id]).toBeDefined()
    const sizes = [{ w: 20, d: 16 }]
    const signatures = new Set<string>()
    for (const style of STYLE_IDS) {
      const hall = buildHall(style, [0, 0], 0, sizes[0]?.w ?? 20, sizes[0]?.d ?? 16, [0, 0])
      signatures.add(hashOf([hall.floor, hall.walls, hall.props, hall.spots]))
      // Each is furnished with more than the bones: a style's own pieces.
      expect(new Set(hall.props.map((p) => p.piece)).size).toBeGreaterThan(5)
    }
    expect(signatures.size).toBe(STYLE_IDS.length)
  })

  test("styles differ in what their folk sit and stand at, not only in a hash", () => {
    const stationsOf = (style: HallStyle): string =>
      [
        ...new Set(
          buildHall(style, [0, 0], 0, 28, 20, [0, 0]).spots.map((spot) => `${spot.kind}:${spot.clip}`),
        ),
      ]
        .sort()
        .join(",")
    expect(stationsOf("workshop")).toContain("anvil:Hammering")
    expect(stationsOf("scriptorium")).toContain("shelf:Working_B")
    expect(stationsOf("chapel")).toContain("pew:Sit_Chair_Idle")
    expect(stationsOf("harbour-hall")).toContain("table:Working_B")
    expect(new Set(STYLE_IDS.map(stationsOf)).size).toBeGreaterThan(6)
  })

  test("a hall's seat count grows with the island's size, for every style", () => {
    const sizes = [5, 40, 120, 400, 1500].map((files) => sizeOf(files, 2))
    for (const style of STYLE_IDS) {
      const counts = sizes.map(({ w, d }) => buildHall(style, [0, 0], 0, w, d, [0, 0]).spots.length)
      expect(counts[0]).toBeLessThan(counts[counts.length - 1] ?? 0)
      for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1] ?? 0)
    }
  })

  test("a smaller landmark's reach limits the hall's width", () => {
    expect(sizeOf(2000, 0).w).toBe(12)
    expect(sizeOf(2000, 1).w).toBe(20)
    expect(sizeOf(2000, 2).w).toBe(28)
  })
})

describe("a hall's floor plan", () => {
  for (const style of STYLE_IDS)
    for (const [w, d] of [
      [12, 12],
      [20, 16],
      [28, 20],
    ] as const)
      test(`${style} ${w}×${d}: every spot is reached from the gate along the lane without crossing furniture`, () => {
        const hall = buildHall(style, [3, -7], 0.6, w, d, [0, 0])
        const items = furniture(hall)
        expect(hall.spots.length).toBeGreaterThan(0)
        const ids = new Set(hall.spots.map((spot) => spot.id))
        expect(ids.size).toBe(hall.spots.length)
        for (const spot of hall.spots) {
          // The spot's own seat is where they sit: it is theirs, not in the way.
          const own = items.find((item) =>
            item.piece.piece === "chair" || item.piece.piece === "stool" || item.piece.piece === "armchair"
              ? Math.hypot(item.piece.x - spot.post[0], item.piece.z - spot.post[1]) < 0.05
              : false,
          )
          const others = items.filter((item) => item !== own).map((item) => item.body)
          // In from the gate, and back out: every leg of the way clear of what stands on the floor.
          const post: [number, number] = [spot.post[0], spot.post[1]]
          for (const way of [
            [hall.door.step, ...wayIn(hall, post)],
            [post, ...wayOut(hall, post)],
          ]) {
            const ways = way
              .slice(1)
              .flatMap((to, i) => along(way[i] as [number, number], to as [number, number]))
            expect(ways.find((point) => blocker(point, others, BODY - 0.05))).toBeUndefined()
          }
        }
      })

  test("the gate's step is outside the walls, its sill within", () => {
    const hall = buildHall("workshop", [10, 10], 1.2, 20, 16, [0, 0])
    const [sin, cos] = [Math.sin(hall.rot), Math.cos(hall.rot)]
    const local = (p: readonly [number, number]): number =>
      (p[0] - hall.at[0]) * sin + (p[1] - hall.at[1]) * cos
    expect(local(hall.door.step)).toBeGreaterThan(hall.d / 2 + 1)
    expect(local(hall.door.sill)).toBeLessThan(hall.d / 2)
  })

  test("a seat plays the sitting clip and a station its own work", () => {
    const hall = buildHall("workshop", [0, 0], 0, 28, 20, [0, 0])
    for (const spot of hall.spots) {
      if (spot.seat) expect(spot.clip).toBe("Sit_Chair_Idle")
      else expect(spot.clip).not.toBe("Sit_Chair_Idle")
    }
  })
})

describe("who takes which spot", () => {
  const hall = buildHall("workshop", [0, 0], 0, 28, 20, [0, 0])

  test("an edit goes to an anvil, a read to a seat or shelf, a thinker to a seat", () => {
    expect(spotFor(hall, "edit", new Set())?.kind).toBe("anvil")
    expect(["desk", "shelf"]).toContain(spotFor(hall, "read", new Set())?.kind as string)
    expect(spotFor(hall, undefined, new Set())?.seat).toBe(true)
  })

  test("a taken spot is not given twice, and the same spots taken give the same answer", () => {
    const taken = new Set<string>()
    const given: string[] = []
    for (let i = 0; i < hall.spots.length; i++) {
      const spot = spotFor(hall, "edit", taken)
      expect(spot).toBeDefined()
      given.push((spot as { id: string }).id)
      taken.add((spot as { id: string }).id)
    }
    expect(new Set(given).size).toBe(hall.spots.length)
    expect(spotFor(hall, "edit", taken)).toBeUndefined()
    expect(spotFor(hall, "edit", new Set(given.slice(0, 3)))?.id).toBe(given[3] as string)
  })
})

describe("the halls of React's archipelago", () => {
  test("every far island has a hall of its landmark's style; the core has the keep's", async () => {
    const { home, archipelago } = await reactSplit()
    expect(home.hall).toBeUndefined()
    expect(archipelago.islands.length).toBeGreaterThan(10)
    for (const island of archipelago.islands) {
      const { hall, main } = island.world
      expect(hall).toBeDefined()
      expect(hall?.style).toBe(STYLE_OF[main?.id as string] as HallStyle)
      // It is a venue too (world/venues.ts), whose capacity is its seats and stations.
      const venue = island.world.venues?.find((v) => v.kind === "hall")
      expect(venue?.capacity).toBe(hall?.spots.length)
      expect(venue?.door).toEqual(hall?.door as Hall["door"])
    }
  })

  test("a bigger island has a hall with more seats than a smaller one of the same landmark", async () => {
    const { archipelago } = await reactSplit()
    const keeps = archipelago.islands.filter((island) => island.world.main?.id === "castle-keep")
    expect(keeps.length).toBeGreaterThan(1)
    const [big, small] = [...keeps].sort((a, b) => (b.files ?? 0) - (a.files ?? 0)) as [
      (typeof keeps)[0],
      (typeof keeps)[0],
    ]
    expect(big.world.hall?.spots.length).toBeGreaterThan(small.world.hall?.spots.length ?? 0)
    const islets = archipelago.islands.filter((island) => island.kind === "islet")
    const mean = (list: typeof islets): number =>
      list.reduce((sum, island) => sum + (island.world.hall?.spots.length ?? 0), 0) / list.length
    expect(mean(islets)).toBeLessThan(mean(archipelago.islands.filter((island) => island.kind === "island")))
  })

  test("each hall's floor is level dry land with nothing standing on it, and its gate is on the roads", async () => {
    const { archipelago } = await reactSplit()
    for (const island of archipelago.islands) {
      const { world } = island
      const hall = world.hall as Hall
      const obstacles = islandObstacles(world).filter((o) => !o.name.startsWith("light "))
      for (let x = -hall.w / 2; x <= hall.w / 2; x += 2)
        for (let z = -hall.d / 2; z <= hall.d / 2; z += 2) {
          const [sin, cos] = [Math.sin(hall.rot), Math.cos(hall.rot)]
          const at: [number, number] = [hall.at[0] + x * cos + z * sin, hall.at[1] - x * sin + z * cos]
          const cell = cellAt(at)
          expect(world.terrain.level(cell)).toBe(0)
          expect("~orwdm".includes(world.terrain.at(cell))).toBe(false)
          expect(blocker(at, obstacles, 0.2)?.name).toBeUndefined()
        }
      // Its gate joins the roads the keep and the quays are on.
      const reach = new Set<string>(["HALL"])
      for (let again = true; again; ) {
        again = false
        for (const [a, b] of world.roads.edges)
          if (reach.has(a) !== reach.has(b)) {
            reach.add(a).add(b)
            again = true
          }
      }
      expect(world.roads.nodes.HALL).toEqual(hall.door.step)
      expect(
        Object.keys(world.roads.nodes)
          .filter((id) => /^Q\d/.test(id))
          .every((id) => reach.has(id)),
      ).toBe(true)
    }
  })

  test("the gate's way to the roads does not cross the hall's own walls", async () => {
    const { archipelago } = await reactSplit()
    for (const island of archipelago.islands) {
      const hall = island.world.hall as Hall
      const edge = island.world.roads.edges.find(([a, b]) => a === "HALL" || b === "HALL") as readonly [
        string,
        string,
      ]
      const other = island.world.roads.nodes[edge[0] === "HALL" ? edge[1] : edge[0]] as [number, number]
      const [sin, cos] = [Math.sin(hall.rot), Math.cos(hall.rot)]
      for (const [x, z] of along(hall.door.step as [number, number], other, 0.5)) {
        const [dx, dz] = [x - hall.at[0], z - hall.at[1]]
        const [lx, lz] = [dx * cos - dz * sin, dx * sin + dz * cos]
        // Never strictly inside the walls' box (the step itself is outside, and the way leads away).
        expect(Math.abs(lx) < hall.w / 2 && Math.abs(lz) < hall.d / 2).toBe(false)
      }
    }
  })

  test("the hall's pieces are all of the kit, and lie where the floor is", async () => {
    const { archipelago } = await reactSplit()
    for (const island of archipelago.islands) {
      const hall = island.world.hall as Hall
      for (const piece of [...hall.floor, ...hall.walls.flatMap((wall) => wall.pieces), ...hall.props]) {
        expect(bounds(piece.piece)).toBeDefined()
        expect(Number.isFinite(liftOf(piece.piece))).toBe(true)
      }
    }
  })
})
