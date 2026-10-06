import { describe, expect, test } from "bun:test"
import { insideHex, plant } from "../src/world/fields.ts"
import { type Field, island } from "../src/world/lands.ts"

describe("farm fields", () => {
  const land = island()
  const planted = plant()
  /** Each planting belongs to the field whose centre is nearest. */
  const nearest = (x: number, z: number): Field | undefined =>
    land.fields.reduce<Field | undefined>(
      (best, f) => (!best || Math.hypot(f.x - x, f.z - z) < Math.hypot(best.x - x, best.z - z) ? f : best),
      undefined,
    )

  test("the island has wheat fields and vegetable plots, every one on tilled soil", () => {
    expect(land.fields.some((f) => f.kind === "wheat")).toBe(true)
    expect(land.fields.some((f) => f.kind === "crops")).toBe(true)
    for (const field of land.fields)
      expect(
        land.decor.some(
          (d) =>
            d.piece === "building_dirt" && Math.abs(d.x - field.x) < 0.01 && Math.abs(d.z - field.z) < 0.01,
        ),
      ).toBe(true)
    expect(land.decor.some((d) => d.piece === "building_grain")).toBe(false)
  })

  test("plots grow lettuce or carrots in rows inside the fence, and some rest empty", () => {
    const kinds = land.fields.map((field) => {
      const plants = planted.crops.filter((c) => nearest(c.x, c.z) === field)
      for (const c of plants) expect(insideHex(c.x - field.x, c.z - field.z, 0.6)).toBe(true)
      const pieces = new Set(plants.map((c) => c.piece))
      expect(pieces.size).toBeLessThanOrEqual(1)
      if (plants.length > 0) expect(plants.length).toBeGreaterThan(25)
      return [...pieces][0] ?? "resting"
    })
    expect(new Set(kinds)).toEqual(new Set(["food_ingredient_lettuce", "food_ingredient_carrot", "resting"]))
    // Every plot is ploughed, planted or not.
    for (const field of land.fields)
      expect(planted.ridges.some((r) => nearest(r.x, r.z) === field)).toBe(true)
  })

  test("the planting is deterministic", () => {
    const again = plant()
    expect(again.crops.length).toBe(planted.crops.length)
    expect(again.crops[7]).toEqual(planted.crops[7])
  })
})
