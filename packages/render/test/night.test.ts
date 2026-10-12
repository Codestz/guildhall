import { describe, expect, test } from "bun:test"
import { BufferAttribute, BufferGeometry, Group, Mesh, MeshBasicMaterial } from "three"
import { batchGeometry } from "../src/batchGeometry.ts"
import { FIRE_FLOOR, keyLight, lightAt } from "../src/light.ts"
import { poolLevel } from "../src/night/index.ts"
import { windowsDark } from "../src/night/windows.ts"

/** Night: the moon, the light sources' glow, the lit windows. */

/** A piece of two triangles, swatch `a` then swatch `b`. */
function twoSwatches(a: number, b: number): Group {
  const g = new BufferGeometry()
  g.setAttribute(
    "position",
    new BufferAttribute(Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 2, 0, 0, 3, 0, 0, 2, 1, 0]), 3),
  )
  g.setAttribute("_swatch", new BufferAttribute(Uint8Array.from([a, a, a, b, b, b]), 1))
  g.setIndex([0, 1, 2, 3, 4, 5])
  const root = new Group()
  root.add(new Mesh(g, new MeshBasicMaterial()))
  return root
}
const glow = (g: BufferGeometry) => Array.from(g.getAttribute("_glow").array as ArrayLike<number>)

describe("batchGeometry _glow", () => {
  test("marks only the piece's light-source swatches", () => {
    expect(glow(batchGeometry(twoSwatches(42, 56), {}, [56]))).toEqual([0, 0, 0, 255, 255, 255])
  })

  test("no pins, no glow, even on the glow swatch (it is also banners and coins)", () => {
    expect(glow(batchGeometry(twoSwatches(44, 56)))).toEqual([0, 0, 0, 0, 0, 0])
  })

  test("a geometry already in the batch format keeps its glow (shells merge baked parts)", () => {
    const baked = batchGeometry(twoSwatches(42, 56), {}, [56])
    const root = new Group()
    root.add(new Mesh(baked))
    expect(glow(batchGeometry(root))).toEqual([0, 0, 0, 255, 255, 255])
  })
})

describe("lightAt by night", () => {
  test("fires burn all day; the lamps' pools on the ground wait for the sun to go", () => {
    expect(lightAt(12).fire).toBe(FIRE_FLOOR)
    expect(lightAt(17.5).fire).toBe(lightAt(17.5).lamps)
    expect(lightAt(0).fire).toBe(1)
    expect(poolLevel(lightAt(17.5))).toBeLessThan(0.1)
    expect(poolLevel(lightAt(19.5))).toBeGreaterThan(0.8)
  })

  test("a shadow lifts the shade rather than blacking it: the key's shadow keeps some of its light", () => {
    for (const hour of [0, 10, 13, 17.5]) {
      expect(lightAt(hour).shadow).toBeGreaterThan(0.5)
      expect(lightAt(hour).shadow).toBeLessThan(1)
    }
  })

  test("noon is day: no lamps, no moon, the sun is the key", () => {
    const l = lightAt(12)
    expect(l.lamps).toBe(0)
    expect(l.night).toBe(0)
    expect(l.moonIntensity).toBe(0)
    expect(keyLight(l).intensity).toBe(l.sunIntensity)
  })

  test("midnight is night: lamps full, the moon is up and is the key, high enough for soft shadows", () => {
    const l = lightAt(0)
    expect(l.lamps).toBe(1)
    expect(l.night).toBe(1)
    expect(l.moonElevation).toBeGreaterThan(30)
    expect(keyLight(l).dir).toEqual(l.moonDir)
    expect(l.moonDir[1]).toBeGreaterThanOrEqual(Math.sin((30 * Math.PI) / 180) - 1e-9)
  })

  test("lamps come on before the sun sets and go off after it rises", () => {
    expect(lightAt(19).lamps).toBeGreaterThan(0.3)
    // A first soft glow from late afternoon (~16:30), about half by golden hour, full by dusk.
    expect(lightAt(16.5).lamps).toBeGreaterThan(0)
    expect(lightAt(16.5).lamps).toBeLessThan(0.15)
    expect(lightAt(17.5).lamps).toBeGreaterThan(0.3)
    expect(lightAt(17.5).lamps).toBeLessThan(0.6)
    expect(lightAt(19.5).lamps).toBeGreaterThan(0.95)
    expect(lightAt(15).lamps).toBe(0)
    expect(lightAt(7).lamps).toBe(0)
  })

  test("dusk and dawn have no pops: every level moves a little per minute, the key light never jumps", () => {
    for (let m = 0; m < 24 * 60; m++) {
      const a = lightAt(m / 60)
      const b = lightAt((m + 1) / 60)
      for (const k of [
        "lamps",
        "night",
        "sunIntensity",
        "moonIntensity",
        "exposure",
        "hemiIntensity",
      ] as const)
        expect(Math.abs(b[k] - a[k]), `${k} at ${m} min`).toBeLessThan(0.05)
      expect(Math.abs(keyLight(b).intensity - keyLight(a).intensity), `key at ${m} min`).toBeLessThan(0.05)
    }
  })

  test("the key light swaps between sun and moon only while both are near dark", () => {
    for (let m = 0; m < 24 * 60; m++) {
      const a = lightAt(m / 60)
      const b = lightAt((m + 1) / 60)
      const swapped = a.sunIntensity >= a.moonIntensity !== b.sunIntensity >= b.moonIntensity
      if (swapped) expect(Math.max(keyLight(a).intensity, keyLight(b).intensity)).toBeLessThan(0.05)
    }
  })
})

describe("windowsDark", () => {
  test("every house is lit in the evening, most are dark after 2:30, a few wake before dawn", () => {
    expect(windowsDark(20)).toBe(0)
    expect(windowsDark(21)).toBe(0)
    expect(windowsDark(2.5)).toBeCloseTo(0.8, 2)
    expect(windowsDark(5.5)).toBeLessThan(windowsDark(3))
    expect(windowsDark(5.5)).toBeGreaterThan(0.3)
  })

  test("the share falls off smoothly through the night", () => {
    for (let m = 18 * 60; m < 30 * 60; m++)
      expect(Math.abs(windowsDark((m + 1) / 60) - windowsDark(m / 60))).toBeLessThan(0.01)
  })
})
