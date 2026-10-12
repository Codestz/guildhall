import { describe, expect, test } from "bun:test"
import { type Recipe, recipeHash } from "../src/recipe.ts"

const recipe = (): Recipe => ({
  id: "cottage",
  seed: 7,
  instances: [
    { piece: "town/wall-door", x: 0, y: 0, z: 0, rot: 0, scale: 1 },
    { piece: "town/roof", x: 0, y: 3, z: 0, rot: Math.PI / 2, scale: 1, swatchMap: { 28: 31, 4: 1 } },
  ],
  sockets: [{ id: "door", kind: "door", at: [0, 0, 0.5], facing: 0 }],
})

describe("recipeHash", () => {
  test("is pinned (a change here means every saved recipe's hash moves)", () => {
    expect(recipeHash(recipe())).toBe("2869abc8")
  })

  test("is 8 hex digits and the same for an equal recipe", () => {
    expect(recipeHash(recipe())).toMatch(/^[0-9a-f]{8}$/)
    expect(recipeHash(recipe())).toBe(recipeHash(structuredClone(recipe())))
  })

  test("ignores noise below 1e-2 and the sign of zero", () => {
    const r = recipe()
    r.instances[0]!.x = 0.001
    r.instances[0]!.z = -0.0001
    expect(recipeHash(r)).toBe(recipeHash(recipe()))
  })

  test("does not depend on swatch map key order", () => {
    const r = recipe()
    r.instances[1]!.swatchMap = { 4: 1, 28: 31 }
    expect(recipeHash(r)).toBe(recipeHash(recipe()))
  })

  test("changes when what is drawn changes", () => {
    const base = recipeHash(recipe())
    const moved = recipe()
    moved.instances[0]!.x = 0.02
    const swapped = recipe()
    swapped.instances.reverse()
    const tinted = recipe()
    tinted.instances[0]!.swatchMap = { 1: 2 }
    const socket = recipe()
    socket.sockets[0]!.facing = Math.PI
    const reseeded = { ...recipe(), seed: 8 }
    for (const r of [moved, swapped, tinted, socket, reseeded]) expect(recipeHash(r)).not.toBe(base)
  })
})
