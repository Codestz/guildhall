import { describe, expect, test } from "bun:test"
import { type BlobLook, blobOf } from "../src/scene/Blobs.tsx"
import { Fade } from "../src/scene/dissolve.ts"

const look = (): BlobLook => ({ size: 0, alpha: 0 })

describe("blob shadows", () => {
  test("a dissolving character's shadow fades at full size, never shrinks", () => {
    const fade = new Fade(1)
    const walker = { node: { visible: true }, radius: 0.85, opacity: () => fade.value }
    const out = look()
    const sizes: number[] = []
    const alphas: number[] = []
    for (let i = 0; i < 6; i++) {
      fade.step(0, 0.1, 0.8)
      expect(blobOf(walker, out)).toBe(true)
      sizes.push(out.size)
      alphas.push(out.alpha)
    }
    for (const size of sizes) expect(size).toBe(0.85)
    for (let i = 1; i < alphas.length; i++) expect(alphas[i]).toBeLessThan(alphas[i - 1] ?? 0)
    expect(alphas[0]).toBeCloseTo(0.875, 5)
  })

  test("fully faded, hidden or sized to nothing: no disc", () => {
    const out = look()
    expect(blobOf({ node: { visible: true }, radius: 1, opacity: () => 0 }, out)).toBe(false)
    expect(blobOf({ node: { visible: false }, radius: 1 }, out)).toBe(false)
    expect(blobOf({ node: { visible: true }, radius: 1, size: () => 0 }, out)).toBe(false)
  })

  test("size scales the radius; opacity is clamped to 0–1; defaults are whole", () => {
    const out = look()
    expect(blobOf({ node: { visible: true }, radius: 0.8, size: () => 1.5, opacity: () => 3 }, out)).toBe(
      true,
    )
    expect(out.size).toBeCloseTo(1.2, 5)
    expect(out.alpha).toBe(1)
    expect(blobOf({ node: { visible: true }, radius: 0.75 }, out)).toBe(true)
    expect(out).toEqual({ size: 0.75, alpha: 1 })
  })
})
