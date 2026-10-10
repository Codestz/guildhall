import { describe, expect, test } from "bun:test"
import type { KitColour } from "../src/world/gen/biomes.ts"
import { crowds, footprintsOf } from "../src/world/gen/dress/footprints.ts"
import { HEX_SCALE, PIECES } from "../src/world/lands.ts"
import { flatten } from "../src/world/prefabs/composite/flatten.ts"
import { COMPOSITES, composed } from "../src/world/prefabs/composite/index.ts"
import type { Composite } from "../src/world/prefabs/composite/types.ts"
import { instantiate, PREFABS, prefab } from "../src/world/prefabs/index.ts"

const KITS: KitColour[] = ["blue", "red", "yellow", "green"]
const SEEDS = Array.from({ length: 24 }, (_, n) => n)
type Box = { min: number[]; max: number[] }
const boxes = PIECES as unknown as Record<string, Box>
/** A hex's corner reach and the 10 units between neighbours (as prefabs.test.ts). */
const CORNER = 5.78
const STEP = 10

/** Every corner of every part's box, in the prefab's frame. */
function corners(parts: readonly { piece: string; x: number; z: number; rot?: number; scale?: number }[]) {
  const out: { piece: string; x: number; z: number }[] = []
  for (const part of parts) {
    const box = boxes[part.piece]
    if (!box) continue
    const k = HEX_SCALE * (part.scale ?? 1)
    const [sin, cos] = [Math.sin(part.rot ?? 0), Math.cos(part.rot ?? 0)]
    for (const cx of [box.min[0] ?? 0, box.max[0] ?? 0])
      for (const cz of [box.min[2] ?? 0, box.max[2] ?? 0])
        out.push({
          piece: part.piece,
          x: part.x + cx * k * cos + cz * k * sin,
          z: part.z - cx * k * sin + cz * k * cos,
        })
  }
  return out
}

describe("composite catalogue", () => {
  test("ids are stable and unique, and none collides with a prefab's", () => {
    const ids = COMPOSITES.map((item) => item.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual([
      "castle-grand",
      "castle-keep",
      "cathedral",
      "academy",
      "forge-works",
      "harbour-fortress",
      "observatory",
      "guildhouse-plaza",
      "islet-lighthouse",
      "islet-shrine",
      "islet-fort",
    ])
    for (const id of ids) expect(PREFABS.some((item) => item.id === id)).toBe(false)
  })

  test("the catalogue has every size and a coastal landmark", () => {
    expect(new Set(COMPOSITES.map((item) => item.size))).toEqual(new Set(["S", "M", "L"]))
    expect(COMPOSITES.filter((item) => item.coastal).map((item) => item.id)).toEqual(["harbour-fortress"])
  })
})

describe.each(COMPOSITES.map((item) => [item.id, item] as const))("%s", (_id, item) => {
  test("flattens to pieces the kits have, in every seed and district colour", () => {
    for (const seed of SEEDS)
      for (const kit of KITS) {
        const made = composed(item, seed, kit)
        expect(made.parts.length).toBeGreaterThan(8)
        for (const part of made.parts)
          expect(boxes[part.piece], `${seed}/${kit}: ${part.piece}`).toBeDefined()
        for (const part of made.parts) expect(part.piece).not.toContain("{kit}")
      }
  })

  test("every part stands inside the footprint's rings (a coastal one's dock a hex beyond)", () => {
    for (const seed of SEEDS)
      for (const c of corners(composed(item, seed).parts)) {
        const limit = item.rings * STEP + CORNER + (item.coastal && c.z < 0 ? STEP : 0)
        expect(Math.hypot(c.x, c.z), `seed ${seed}: ${c.piece}`).toBeLessThanOrEqual(limit)
      }
  })

  test("is the same landmark for the same seed, and seed 0 is the plain one", () => {
    for (const seed of [0, 3, 11]) expect(composed(item, seed, "red")).toEqual(composed(item, seed, "red"))
    expect(composed(item, 0, "green").mirrored).toBe(false)
    expect(composed(item, 0, "blue").seed).toBe(0)
  })

  test("seeds make it differ: at least four looks in a dozen seeds", () => {
    const looks = new Set(SEEDS.slice(0, 12).map((seed) => JSON.stringify(composed(item, seed).parts)))
    expect(looks.size).toBeGreaterThanOrEqual(4)
  })

  test("has a focal point above ground and a door a person can reach", () => {
    for (const seed of [0, 1, 2, 3]) {
      const made = composed(item, seed)
      expect(made.focal.y).toBeGreaterThan(4)
      expect(made.doors.length).toBeGreaterThan(0)
      for (const door of made.doors)
        expect(Math.hypot(door.x, door.z)).toBeLessThanOrEqual(item.rings * STEP + CORNER + 10)
    }
  })

  test("its buildings do not overlap one another (by footprints, a unit's give)", () => {
    for (const seed of [0, 1, 2, 3, 4, 5]) {
      const placed = instantiate(composed(item, seed), [0, 0], 0, "blue").filter((p) =>
        p.piece.startsWith("building_"),
      )
      const shapes = footprintsOf(placed)
      for (let a = 0; a < shapes.length; a++)
        for (let b = a + 1; b < shapes.length; b++) {
          const [pa, pb] = [placed[a], placed[b]]
          expect(
            crowds(shapes[a] ?? [], shapes[b] ?? [], -1.5),
            `seed ${seed}: ${pa?.piece} / ${pb?.piece}`,
          ).toBe(false)
        }
    }
  })

  test("instantiates at a hex, turned, like any prefab", () => {
    const made = composed(item, 2)
    const placed = instantiate(made, [100, 50], Math.PI, "blue")
    expect(placed.length).toBe(made.parts.length)
    expect(placed.every((p) => Number.isFinite(p.x) && Number.isFinite(p.z))).toBe(true)
  })
})

describe("composing", () => {
  const lookup = (id: string) => (id === "inn" ? prefab("inn") : undefined)
  const make = (kids: Composite["build"]): Composite => ({
    id: "test",
    label: "Test",
    size: "S",
    rings: 1,
    variation: { mirror: true },
    build: kids,
  })

  test("a child prefab is placed at its pose and a group's turn and scale carry into it", () => {
    const flat = flatten(
      make(() => ({ name: "root", kids: [{ ref: "inn", x: 10, z: 0, rot: Math.PI / 2, scale: 2 }] })),
      0,
      "blue",
      lookup,
    )
    const tavern = flat.parts.find((part) => part.piece === "building_tavern_blue")
    expect(tavern?.scale).toBe(2)
    expect(tavern?.rot).toBeCloseTo(Math.PI / 2, 2)
    // The inn's tavern stands 0.4 behind its anchor: turned a quarter that is a step in -x, doubled.
    expect(tavern?.x).toBeCloseTo(10 - 0.8, 1)
  })

  test("composites nest, and a nested group's marks reach the top, in its place", () => {
    const inner = make(() => ({
      name: "inner",
      kids: [{ piece: "wall_straight", x: 1, z: 0 }],
      doors: [{ x: 1, z: 2, rot: 0 }],
      focal: { x: 0, y: 9, z: 0 },
    }))
    const outer = make(() => ({ name: "outer", kids: [{ ref: "inner", x: 5, z: 5, rot: Math.PI }] }))
    const flat = flatten(outer, 0, "blue", (id) => (id === "inner" ? inner : undefined))
    expect(flat.parts[0]).toMatchObject({ piece: "wall_straight", x: 4, z: 5 })
    expect(flat.doors[0]).toMatchObject({ x: 4, z: 3 })
    expect(flat.focal).toEqual({ x: 5, y: 9, z: 5 })
    expect(flat.tree.kids[0]?.name).toBe("inner")
  })

  test("a mirrored seed flips parts and doors, and a missing child is an error, not a gap", () => {
    const lopsided = make(() => ({
      name: "r",
      kids: [{ piece: "wall_straight", x: 4, z: 0, rot: 0.5 }],
      doors: [{ x: 4, z: 1, rot: 0.5 }],
    }))
    const mirrored = SEEDS.map((seed) => flatten(lopsided, seed, "blue", lookup)).find(
      (flat) => flat.mirrored,
    )
    expect(mirrored?.parts[0]).toMatchObject({ x: -4, rot: -0.5 })
    expect(mirrored?.doors[0]).toMatchObject({ x: -4, rot: -0.5 })
    expect(() =>
      flatten(
        make(() => ({ name: "r", kids: [{ ref: "nowhere" }] })),
        0,
        "blue",
        lookup,
      ),
    ).toThrow(/nowhere/)
  })

  test("the forge works names its smoke points, and the grand castle's keep is its tallest piece", () => {
    expect(composed("forge-works").smoke.length).toBeGreaterThanOrEqual(2)
    const castle = composed("castle-grand")
    expect(castle.focal.y).toBeGreaterThanOrEqual(20)
  })
})
