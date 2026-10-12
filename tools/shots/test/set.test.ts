import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { deflateSync } from "node:zlib"
import { decodePng, diffImages, encodePng, type Image, judge, parseSet, parseSetArgs } from "../src/set.ts"

/** A w×h image of one colour, with optional pixels changed. */
function image(w: number, h: number, rgba: number[], changed: [x: number, y: number, rgba: number[]][] = []) {
  const data = new Uint8Array(w * h * 4)
  for (let i = 0; i < w * h; i++) data.set(rgba, i * 4)
  for (const [x, y, c] of changed) data.set(c, (y * w + x) * 4)
  return { width: w, height: h, data } satisfies Image
}

describe("png", () => {
  test("encode then decode gives the same pixels", () => {
    const img = image(5, 3, [10, 20, 30, 255], [[2, 1, [200, 0, 7, 128]]])
    expect(decodePng(encodePng(img))).toEqual(img)
  })

  test("an RGB PNG with every filter type decodes to RGBA", () => {
    // 2×5 RGB, one row per filter (none, sub, up, average, paeth), all bytes chosen by hand.
    const filtered = [
      [0, 1, 2, 3, 4, 5, 6],
      [1, 10, 10, 10, 5, 5, 5],
      [2, 1, 1, 1, 1, 1, 1],
      [3, 4, 4, 4, 0, 0, 0],
      [4, 0, 0, 0, 0, 0, 0],
    ].flat()
    const header = new Uint8Array(13)
    new DataView(header.buffer).setUint32(0, 2)
    new DataView(header.buffer).setUint32(4, 5)
    header.set([8, 2, 0, 0, 0], 8)
    const chunk = (type: string, body: Uint8Array) => {
      const out = new Uint8Array(12 + body.length)
      new DataView(out.buffer).setUint32(0, body.length)
      out.set(new TextEncoder().encode(type), 4)
      out.set(body, 8)
      return out
    }
    const png = Buffer.concat([
      Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(Uint8Array.from(filtered))),
      chunk("IEND", new Uint8Array()),
    ])
    const rows = [
      [1, 2, 3, 4, 5, 6], // none
      [10, 10, 10, 15, 15, 15], // sub: + left
      [11, 11, 11, 16, 16, 16], // up: + above
      [9, 9, 9, 12, 12, 12], // average: floor((left + above) / 2), left 0 on the first pixel
      [9, 9, 9, 12, 12, 12], // paeth: above wins
    ]
    const expected = rows.flatMap((r) => [...r.slice(0, 3), 255, ...r.slice(3), 255])
    expect([...decodePng(png).data]).toEqual(expected)
  })

  test("a non-PNG is refused", () => {
    expect(() => decodePng(new Uint8Array([1, 2, 3]))).toThrow("not a PNG")
  })
})

describe("diffImages", () => {
  const base = image(10, 10, [100, 100, 100, 255])

  test("identical images: nothing differs", () => {
    expect(diffImages(base, image(10, 10, [100, 100, 100, 255]), 16).pct).toBe(0)
  })

  test("a change within the threshold is not a difference; one past it is", () => {
    expect(diffImages(base, image(10, 10, [116, 100, 100, 255]), 16).differing).toBe(0)
    expect(diffImages(base, image(10, 10, [117, 100, 100, 255]), 16).differing).toBe(100)
  })

  test("counts the moved pixels and paints them red in the diff image", () => {
    const moved = image(10, 10, [100, 100, 100, 255], [[3, 4, [0, 255, 0, 255]]])
    const diff = diffImages(base, moved, 16)
    expect(diff.differing).toBe(1)
    expect(diff.pct).toBeCloseTo(1)
    expect([...(diff.image?.data.subarray((4 * 10 + 3) * 4, (4 * 10 + 4) * 4) ?? [])]).toEqual([
      255, 0, 0, 255,
    ])
  })

  test("a size change differs everywhere", () => {
    const diff = diffImages(base, image(10, 11, [100, 100, 100, 255]), 16)
    expect(diff.pct).toBe(100)
    expect(diff.image).toBeNull()
  })
})

describe("judge", () => {
  const diff = (pct: number) => ({ pct, differing: 0, image: null })

  test("under the limit passes, over it regresses", () => {
    expect(judge(diff(0.1), 0.1, false)).toBe("pass")
    expect(judge(diff(0.11), 0.1, false)).toBe("regressed")
  })

  test("no baseline is new (a failure) until approved", () => {
    expect(judge(null, 0.1, false)).toBe("new")
    expect(judge(null, 0.1, true)).toBe("approved")
  })
})

describe("parseSet", () => {
  test("fills the default threshold and limit", () => {
    const set = parseSet({ shots: [{ name: "a", url: "/?screen=grips" }] })
    expect(set).toEqual({ shots: [{ name: "a", url: "/?screen=grips" }], threshold: 16, maxDiffPct: 0.1 })
  })

  test("names every problem", () => {
    const bad = () =>
      parseSet({
        shots: [
          { name: "A b", url: "http://x/" },
          { name: "c", url: "/", camera: "1,2", size: "big" },
          { name: "c", url: "/" },
        ],
        threshold: 300,
      })
    expect(bad).toThrow(/shots\[0\]\.name/)
    expect(bad).toThrow(/shots\[0\]\.url/)
    expect(bad).toThrow(/shots\[1\]\.camera/)
    expect(bad).toThrow(/shots\[1\]\.size/)
    expect(bad).toThrow(/duplicate "c"/)
    expect(bad).toThrow(/threshold/)
  })

  test("an empty set is refused", () => {
    expect(() => parseSet({ shots: [] })).toThrow("non-empty")
  })

  test("the committed grips set is valid", () => {
    const json = JSON.parse(readFileSync(new URL("../sets/grips.json", import.meta.url), "utf8"))
    expect(parseSet(json).shots.map((s) => s.name)).toContain("matrix")
  })
})

describe("parseSetArgs", () => {
  test("a name alone: shoot into .probe/sets/<name>, no approval", () => {
    expect(parseSetArgs(["grips"])).toEqual({ name: "grips", approve: false, out: ".probe/sets/grips" })
  })

  test("--approve, --out and --port", () => {
    expect(parseSetArgs(["grips", "--approve", "--out", "x/y", "--port", "5341"])).toEqual({
      name: "grips",
      approve: true,
      out: "x/y",
      port: 5341,
    })
  })

  test("refuses a missing name, two names, a bad port and unknown flags", () => {
    expect(() => parseSetArgs([])).toThrow("set name")
    expect(() => parseSetArgs(["a", "b"])).toThrow("one set only")
    expect(() => parseSetArgs(["a", "--port", "x"])).toThrow("--port")
    expect(() => parseSetArgs(["a", "--fast"])).toThrow("unknown option --fast")
  })
})
