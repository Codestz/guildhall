import { describe, expect, test } from "bun:test"
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Scene } from "three"
import {
  type Carried,
  carried,
  carryLantern,
  type Flame,
  flicker,
  litGlass,
  nearestFlames,
  nightGlow,
  track,
} from "../src/scene/lights/carried.ts"

/** A kit-like lantern: an opaque frame and a transparent glass pane centred 0.4 up. */
function lantern() {
  const frame = new Mesh(new BoxGeometry(0.5, 1, 0.5), new MeshStandardMaterial())
  const own = new MeshStandardMaterial({ transparent: true, opacity: 0.2 })
  const glass = new Mesh(new BoxGeometry(0.4, 0.4, 0.4).translate(0, 0.4, 0), own)
  const held = new Group()
  held.add(frame, glass)
  const body = new Group()
  body.add(held)
  const scene = new Scene()
  scene.add(body)
  return { scene, body, held, glass, own, frame }
}

describe("carried lanterns", () => {
  test("a held lantern's glass wears the lit glass; put down, its own comes back", () => {
    const { body, held, glass, own } = lantern()
    const putDown = carryLantern(held, body)
    expect(glass.material).toBe(litGlass.material as MeshStandardMaterial)
    expect(glass.material).not.toBe(own)
    putDown()
    expect(glass.material).toBe(own)
    expect(carried.length).toBe(0)
  })

  test("all lanterns share one lit glass, freed with the last one put down", () => {
    const a = lantern()
    const b = lantern()
    const downA = carryLantern(a.held, a.body)
    const downB = carryLantern(b.held, b.body)
    expect(a.glass.material).toBe(b.glass.material)
    downA()
    expect(litGlass.material).not.toBeNull()
    downB()
    expect(litGlass.material).toBeNull()
  })

  test("the flame is tracked at the glass's centre in the world, and the ground at the body's feet", () => {
    const { scene, body, held, glass } = lantern()
    body.position.set(3, 0.5, -2)
    held.position.set(0.3, 1, 0)
    const putDown = carryLantern(held, body)
    track()
    const entry = carried[0] as Carried
    expect(entry.lit).toBe(true)
    expect(entry.at.x).toBeCloseTo(3.3)
    expect(entry.at.y).toBeCloseTo(0.5 + 1 + 0.4)
    expect(entry.at.z).toBeCloseTo(-2)
    expect(entry.ground).toBeCloseTo(0.5)
    expect(glass.parent?.parent?.parent).toBe(scene)
    putDown()
  })

  test("a hidden lantern, a hidden carrier or one not in a scene gives no light", () => {
    const { scene, body, held } = lantern()
    const putDown = carryLantern(held, body)
    const entry = carried[0] as Carried
    held.visible = false
    track()
    expect(entry.lit).toBe(false)
    held.visible = true
    body.visible = false
    track()
    expect(entry.lit).toBe(false)
    body.visible = true
    scene.remove(body)
    track()
    expect(entry.lit).toBe(false)
    putDown()
  })

  test("a piece with no glass is not carried as a light", () => {
    const held = new Group()
    held.add(new Mesh(new BoxGeometry(), new MeshStandardMaterial()))
    const putDown = carryLantern(held, new Group())
    expect(carried.length).toBe(0)
    putDown()
  })

  test("nothing by day (the sky keeps lamps at 0.12 or more), full at night", () => {
    expect(nightGlow(0.12)).toBe(0)
    expect(nightGlow(0.3)).toBe(0)
    expect(nightGlow(1)).toBe(1)
    expect(nightGlow(0.65)).toBeCloseTo(0.5)
  })

  test("the lit glass glows only at night", () => {
    const { body, held } = lantern()
    const putDown = carryLantern(held, body)
    const fire = { r: 1, g: 0.6, b: 0.3 }
    litGlass.set(0, fire)
    expect(litGlass.material?.emissiveIntensity).toBe(0)
    expect(litGlass.material?.opacity).toBeCloseTo(0.2)
    litGlass.set(1, fire)
    expect(litGlass.material?.emissiveIntensity).toBeGreaterThan(1)
    expect(litGlass.material?.opacity).toBeGreaterThan(0.2)
    putDown()
  })

  test("reduced motion: the flame holds still", () => {
    for (const t of [0, 0.3, 1.7, 12]) expect(flicker(t, 1, true)).toBe(1)
    expect(flicker(0.3, 1, false)).not.toBe(flicker(1.7, 1, false))
  })
})

describe("nearest flames, fixed and carried", () => {
  const fixed: (readonly [number, number, number])[] = [
    [10, 2, 0],
    [0, 2, 5],
    [-20, 2, 0],
  ]
  const walker = (x: number, z: number) => {
    const { body, held } = lantern()
    const putDown = carryLantern(held, body)
    const entry = carried[carried.length - 1] as Carried
    return { entry, putDown, place: () => entry.at.set(x, 1, z) }
  }

  test("picks the nearest of both, nearest first, and skips unlit lanterns", () => {
    const near = walker(1, 1)
    const dark = walker(0, 0)
    track()
    near.place()
    dark.place()
    dark.entry.lit = false
    const out = new Array<Flame | undefined>(2)
    const distances = new Array<number>(2).fill(0)
    nearestFlames(0, 0, fixed, carried, out, distances)
    expect(out[0]).toBe(near.entry)
    expect(out[1]).toBe(fixed[1])
    near.putDown()
    dark.putDown()
  })

  test("fewer flames than lights: the rest are left empty", () => {
    const out = new Array<Flame | undefined>(2)
    const distances = new Array<number>(2).fill(0)
    nearestFlames(0, 0, [[3, 1, 0]], [], out, distances)
    expect(out[0]).toEqual([3, 1, 0])
    expect(out[1]).toBeUndefined()
  })
})
