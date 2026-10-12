import { describe, expect, test } from "bun:test"
import { ShaderChunk } from "three"
import { installCascadeChunks } from "../src/scene/atmosphere/cascadeChunk.ts"
import {
  biasOf,
  cascadeRadii,
  cellOf,
  fitCascade,
  nearRadius,
  snap,
} from "../src/scene/atmosphere/cascades.ts"

/** scene/atmosphere/cascades.ts and cascadeChunk.ts: the cascaded key light's geometry and its shader patch. */

const SPAN = { floor: -2, ceiling: 60 }
const norm = (x: number, y: number, z: number): [number, number, number] => {
  const l = Math.hypot(x, y, z)
  return [x / l, y / l, z / l]
}
const standOf = (fit: ReturnType<typeof fitCascade>): number =>
  Math.hypot(
    fit.position[0] - fit.target[0],
    fit.position[1] - fit.target[1],
    fit.position[2] - fit.target[2],
  )

describe("cascade radii", () => {
  test("run from the near radius to the whole island, each as much wider as the last", () => {
    const radii = cascadeRadii(3, 20, 180)
    expect(radii[0]).toBeCloseTo(20)
    expect(radii[2]).toBeCloseTo(180)
    expect((radii[1] as number) / 20).toBeCloseTo(180 / (radii[1] as number))
  })

  test("one cascade is the near radius", () => {
    expect(cascadeRadii(1, 24, 200)).toEqual([24])
  })

  test("the near radius steps up with the need, and leaves room for the far cascade", () => {
    expect(nearRadius(10, 200, 3)).toBe(14)
    expect(nearRadius(25, 200, 3)).toBe(28)
    expect(nearRadius(500, 100, 3)).toBeCloseTo(100 / 1.8)
  })

  test("the far cascade is fixed at the origin; the near one snaps to a grid", () => {
    expect(snap(37.2, cellOf(200, true))).toBe(0)
    expect(snap(37.2, cellOf(24, false)) % 6).toBeCloseTo(0)
  })
})

describe("a cascade's light camera", () => {
  test("keeps the cylinder's centre between its planes, and reaches further upstream at a low sun", () => {
    const high = fitCascade(norm(0.3, 1, 0.2), 0, 0, 40, SPAN, 2048)
    const low = fitCascade(norm(1, 0.3, 0.4), 0, 0, 40, SPAN, 2048)
    expect(high.half).toBe(40)
    expect(low.far).toBeGreaterThan(high.far)
    for (const fit of [high, low]) {
      expect(standOf(fit)).toBeGreaterThan(fit.near)
      expect(standOf(fit)).toBeLessThan(fit.far)
    }
  })

  test("a flat sun is held off the horizon, so the box stays finite", () => {
    const fit = fitCascade(norm(1, 0, 0), 0, 0, 30, SPAN, 2048)
    expect(Number.isFinite(fit.far)).toBe(true)
    expect(fit.far).toBeLessThan(2000)
  })

  test("a straight-down sun fits too, and stands over the centre", () => {
    const fit = fitCascade([0, 1, 0], 10, -10, 30, SPAN, 2048)
    expect(fit.position[0]).toBeCloseTo(10)
    expect(fit.position[2]).toBeCloseTo(-10)
  })

  test("a coarser map takes a wider bias", () => {
    const near = biasOf(fitCascade(norm(1, 1, 0), 0, 0, 20, SPAN, 2048))
    const far = biasOf(fitCascade(norm(1, 1, 0), 0, 0, 200, SPAN, 2048))
    expect(far.normalBias).toBeGreaterThan(near.normalBias)
  })
})

describe("the shader patch", () => {
  test("applies to this three's chunks, and keeps the single-shadow lines for one-light programs", () => {
    expect(installCascadeChunks()).toBe(true)
    expect(ShaderChunk.shadowmap_pars_fragment).toContain("getCascadedShadow")
    expect(ShaderChunk.lights_fragment_begin).toContain("getCascadedShadow()")
    expect(ShaderChunk.lights_fragment_begin).toContain("directionalShadowMap[ i ]")
    expect(ShaderChunk.shadowmask_pars_fragment).toContain("getCascadedShadow()")
  })

  test("installing twice patches once", () => {
    installCascadeChunks()
    const once = ShaderChunk.lights_fragment_begin
    installCascadeChunks()
    expect(ShaderChunk.lights_fragment_begin).toBe(once)
  })
})
