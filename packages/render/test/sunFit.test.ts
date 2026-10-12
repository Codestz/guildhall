import { describe, expect, test } from "bun:test"
import { Matrix4, Vector3 } from "three"
import {
  type CascadeFit,
  fitBox,
  fitCascade,
  fitCascades,
  lightAxes,
  MIN_NEAR,
  type Vec3,
} from "../src/sun/fit.ts"

/** A golden-hour sun: 24° up, from the south-west. */
const SUN: Vec3 = (() => {
  const el = (24 * Math.PI) / 180
  const az = (225 * Math.PI) / 180
  return [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)]
})()
const MAP = 2048
const SPAN = { floor: 0, ceiling: 30 }

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const along = (p: Vec3, axis: Vec3, k: number): Vec3 => [
  p[0] + axis[0] * k,
  p[1] + axis[1] * k,
  p[2] + axis[2] * k,
]

/** A world point in a fit's light camera: x, y across the box and the view depth in front of it. */
function inLight(fit: CascadeFit, p: Vec3): Vec3 {
  const [x, y, z] = lightAxes(sub(fit.position, fit.target))
  const d = sub(p, fit.position)
  return [dot(d, x), dot(d, y), -dot(d, z)]
}

describe("lightAxes", () => {
  test("match three's lookAt from the light towards its target", () => {
    const [x, y, z] = lightAxes(SUN)
    const m = new Matrix4().lookAt(new Vector3(...SUN), new Vector3(0, 0, 0), new Vector3(0, 1, 0))
    const ax = new Vector3()
    const ay = new Vector3()
    const az = new Vector3()
    m.extractBasis(ax, ay, az)
    for (const [mine, three] of [
      [x, ax],
      [y, ay],
      [z, az],
    ] as const)
      for (const [i, v] of mine.entries()) expect(v).toBeCloseTo(three.getComponent(i), 9)
  })

  test("stay level and unit for a sun straight overhead", () => {
    const [x, y, z] = lightAxes([0, 1, 0])
    expect(x).toEqual([1, 0, 0])
    expect(Math.hypot(...y)).toBeCloseTo(1, 9)
    expect(z).toEqual([0, 1, 0])
  })
})

describe("fitCascade", () => {
  test("a target moved by less than a texel leaves the centre where it was", () => {
    const fit = fitCascade([12.3, 0, -4.7], SUN, 24, MAP, SPAN)
    const [x, y, z] = lightAxes(SUN)
    const nudge = fit.texel * 0.45
    for (const axis of [x, y, z]) {
      for (const k of [nudge, -nudge]) {
        const moved = fitCascade(along(fit.target, axis, k), SUN, 24, MAP, SPAN)
        expect(moved.key).toBe(fit.key)
        expect(moved.target).toEqual(fit.target)
      }
    }
  })

  test("any move slides the box by whole texels in light space", () => {
    const [x, y] = lightAxes(SUN)
    const a = fitCascade([0.37, 0, 0.11], SUN, 24, MAP, SPAN)
    for (const step of [0.5, 1, 1.5, 2, 7.3]) {
      const b = fitCascade([0.37 + step, 0, 0.11 - step / 3], SUN, 24, MAP, SPAN)
      const shift = sub(b.target, a.target)
      for (const axis of [x, y]) {
        const texels = dot(shift, axis) / a.texel
        expect(Math.abs(texels - Math.round(texels))).toBeLessThan(1e-6)
      }
    }
  })

  test("keeps the near plane at least a metre off and holds the whole slab in depth", () => {
    const fit = fitCascade([40, 0, 25], SUN, 80, MAP, SPAN)
    expect(fit.near).toBeGreaterThanOrEqual(MIN_NEAR)
    const [x, y, z] = lightAxes(SUN)
    // The slab's extremes inside the box: across ±half, from the floor to the ceiling.
    for (const a of [-fit.half, fit.half])
      for (const b of [-fit.half, fit.half])
        for (const h of [SPAN.floor, SPAN.ceiling]) {
          const across = along(along(fit.target, x, a), y, b)
          // Slide along the light ray to height h.
          const p = along(across, z, (h - across[1]) / z[1])
          const [, , depth] = inLight(fit, p)
          expect(depth).toBeGreaterThanOrEqual(fit.near - 1e-6)
          expect(depth).toBeLessThanOrEqual(fit.far + 1e-6)
        }
  })
})

describe("fitCascades", () => {
  test("radii are fixed: every target gets the same box sizes and texels", () => {
    const near = fitCascades([0, 0, 0], SUN, [24, 80], MAP, SPAN)
    const far = fitCascades([90, 0, -60], SUN, [24, 80], MAP, SPAN)
    expect(near.map((f) => f.half)).toEqual([24, 80])
    expect(far.map((f) => [f.half, f.texel])).toEqual(near.map((f) => [f.half, f.texel]))
    expect(near[0]?.texel).toBeCloseTo(48 / MAP, 12)
  })
})

describe("fitBox", () => {
  test("holds every corner of the town box across and in depth", () => {
    const box = { min: [-100, 0, -100] as Vec3, max: [100, 30, 100] as Vec3 }
    const fit = fitBox(box, SUN, MAP)
    for (const cx of [box.min[0], box.max[0]])
      for (const cy of [box.min[1], box.max[1]])
        for (const cz of [box.min[2], box.max[2]]) {
          const [lx, ly, depth] = inLight(fit, [cx, cy, cz])
          expect(Math.abs(lx)).toBeLessThanOrEqual(fit.half)
          expect(Math.abs(ly)).toBeLessThanOrEqual(fit.half)
          expect(depth).toBeGreaterThanOrEqual(MIN_NEAR - 1e-6)
          expect(depth).toBeLessThanOrEqual(fit.far)
        }
  })
})
