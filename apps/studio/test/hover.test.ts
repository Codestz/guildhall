import { describe, expect, test } from "bun:test"
import { activityLines, namesOf, rayThrough } from "../src/hall/hover.ts"

/**
 * The hover's pure parts (hall/hover.ts): the ray through the pointer and the tip's lines. The hex pick
 * itself, borders included, is world's (packages/world/test/hex-pick.test.ts).
 */

describe("the hover's pure parts", () => {
  test("rayThrough: an identity camera looks down −z from the origin; the corners spread", () => {
    // a 90° square frustum (near 1, far 100), inverse projection, and the camera at (0, 10, 0)
    const n = 1
    const f = 100
    const proj = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -(f + n) / (f - n), -1, 0, 0, (-2 * f * n) / (f - n), 0]
    const inverse = invert(proj)
    const world = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 10, 0, 1]
    const o: [number, number, number] = [0, 0, 0]
    const d: [number, number, number] = [0, 0, 0]
    rayThrough(0, 0, inverse, world, o, d)
    expect(o).toEqual([0, 10, 0])
    expect(d[0]).toBeCloseTo(0, 6)
    expect(d[1]).toBeCloseTo(0, 6)
    expect(d[2]).toBeLessThan(0)
    rayThrough(1, 1, inverse, world, o, d)
    // the top-right corner at 45°: x = y = −z
    expect(d[0] / -d[2]).toBeCloseTo(1, 5)
    expect(d[1] / -d[2]).toBeCloseTo(1, 5)
  })

  test("the tip's lines: failing first, then edits, then reads; names joined as the HUD says them", () => {
    const names: Record<string, string> = { a: "Scout", b: "Artisan", c: "Sage" }
    const lines = activityLines(
      {
        read: 0.6,
        edit: 1,
        blight: 1,
        readers: ["a", "c"],
        editors: ["b"],
        failing: [{ who: "b", cause: "test" }],
      },
      (id) => names[id],
    )
    expect(lines).toEqual([
      { text: "Failing: Artisan's tests are red", tone: "fail" },
      { text: "Edited by Artisan", tone: "edit" },
      { text: "Read by Scout and Sage", tone: "read" },
    ])
    expect(activityLines(null, () => undefined)).toEqual([])
    expect(namesOf(["A", "B", "C", "D", "E"])).toBe("A, B and 3 more")
    expect(
      activityLines(
        { read: 0, edit: 0, blight: 0.4, readers: [], editors: [], failing: [] },
        () => undefined,
      ),
    ).toEqual([{ text: "Healing: the fix has landed", tone: "fail" }])
  })
})

/** A 4×4 column-major matrix's inverse (Gauss–Jordan; the test's frustum is invertible). */
function invert(m: number[]): number[] {
  const a = [0, 1, 2, 3].map((r) => [0, 1, 2, 3].map((c) => m[c * 4 + r] as number))
  const inv = [0, 1, 2, 3].map((r) => [0, 1, 2, 3].map((c) => (r === c ? 1 : 0)))
  for (let c = 0; c < 4; c++) {
    let p = c
    for (let r = c + 1; r < 4; r++) if (Math.abs(a[r]?.[c] ?? 0) > Math.abs(a[p]?.[c] ?? 0)) p = r
    ;[a[c], a[p]] = [a[p] as number[], a[c] as number[]]
    ;[inv[c], inv[p]] = [inv[p] as number[], inv[c] as number[]]
    const k = (a[c] as number[])[c] as number
    for (let j = 0; j < 4; j++) {
      ;(a[c] as number[])[j] = ((a[c] as number[])[j] as number) / k
      ;(inv[c] as number[])[j] = ((inv[c] as number[])[j] as number) / k
    }
    for (let r = 0; r < 4; r++) {
      if (r === c) continue
      const f = (a[r] as number[])[c] as number
      for (let j = 0; j < 4; j++) {
        ;(a[r] as number[])[j] = ((a[r] as number[])[j] as number) - f * ((a[c] as number[])[j] as number)
        ;(inv[r] as number[])[j] =
          ((inv[r] as number[])[j] as number) - f * ((inv[c] as number[])[j] as number)
      }
    }
  }
  const out: number[] = []
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) out.push((inv[r] as number[])[c] as number)
  return out
}
