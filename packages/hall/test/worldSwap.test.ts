import { describe, expect, test } from "bun:test"
import { DataTexture } from "three"
import { Bakes } from "../src/scene/nature/shore.ts"
import { heldFor } from "../src/scene/owned.ts"

/**
 * Swapping the world live (`repo=` applied in place, the repo door, Back/Forward): what was built for
 * the island left is never handed out once the world has changed, and its GPU side is freed.
 */

describe("an owned layer across a world swap (scene/owned.ts heldFor)", () => {
  const hand = { kind: "hand" }
  const repo = { kind: "repo" }

  test("the layer built for a world is handed out while that world is drawn", () => {
    const layer = { meshes: [] }
    expect(heldFor({ value: layer, deps: [hand, 1] }, [hand, 1])).toBe(layer)
  })

  // The crash: the render that sees the new world still handed out the old BatchedMesh, its
  // useFrame wrote into it after the effect freed it ("Cannot read properties of null (reading 'image')").
  test("the render that sees a new world hands out nothing, before the old layer is freed", () => {
    const layer = { meshes: [] }
    expect(heldFor({ value: layer, deps: [hand, 1] }, [repo, 1])).toBeNull()
    expect(heldFor({ value: layer, deps: [hand] }, [hand, 1])).toBeNull()
    expect(heldFor(null, [hand])).toBeNull()
  })
})

describe("baked shores per world (scene/nature/shore.ts Bakes)", () => {
  type Key = { kind: "hand" | "repo" }
  const make = () => {
    const freed: DataTexture[] = []
    const bakes = new Bakes<Key, { texture: DataTexture }>(
      (bake) => {
        bake.texture.dispose()
        freed.push(bake.texture)
      },
      (key) => key.kind === "hand",
    )
    return { bakes, freed }
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

  test("a repo's bake is freed (its GPU texture disposed) once no water draws it", async () => {
    const { bakes, freed } = make()
    const world: Key = { kind: "repo" }
    const texture = new DataTexture(new Uint8Array(4), 1, 1)
    let disposed = 0
    texture.addEventListener("dispose", () => disposed++)
    bakes.set(world, { texture })
    const release = bakes.hold(world)
    release()
    await settle()
    expect(disposed).toBe(1)
    expect(freed).toEqual([texture])
    expect(bakes.get(world)).toBeUndefined()
  })

  test("released and held again in the same commit (an effect re-run), it is kept", async () => {
    const { bakes, freed } = make()
    const world: Key = { kind: "repo" }
    bakes.set(world, { texture: new DataTexture(new Uint8Array(4), 1, 1) })
    bakes.hold(world)()
    const again = bakes.hold(world)
    await settle()
    expect(freed).toEqual([])
    expect(bakes.get(world)).toBeDefined()
    again()
  })

  test("kept while another water still draws it; freed with the last", async () => {
    const { bakes, freed } = make()
    const world: Key = { kind: "repo" }
    bakes.set(world, { texture: new DataTexture(new Uint8Array(4), 1, 1) })
    const one = bakes.hold(world)
    const two = bakes.hold(world)
    one()
    one() // a release twice counts once
    await settle()
    expect(freed).toHaveLength(0)
    two()
    await settle()
    expect(freed).toHaveLength(1)
  })

  test("the hand island's bake stays for the session: it is the one gone back to", async () => {
    const { bakes, freed } = make()
    const hand: Key = { kind: "hand" }
    bakes.set(hand, { texture: new DataTexture(new Uint8Array(4), 1, 1) })
    bakes.hold(hand)()
    await settle()
    expect(freed).toEqual([])
    expect(bakes.get(hand)).toBeDefined()
  })

  test("a bake still being read back (WebGPU) is freed when it lands", async () => {
    const { bakes, freed } = make()
    const world: Key = { kind: "repo" }
    let land: (bake: { texture: DataTexture }) => void = () => {}
    bakes.set(world, new Promise((resolve) => (land = resolve)))
    bakes.hold(world)()
    await settle()
    expect(freed).toEqual([])
    const texture = new DataTexture(new Uint8Array(4), 1, 1)
    land({ texture })
    await settle()
    expect(freed).toEqual([texture])
  })
})
