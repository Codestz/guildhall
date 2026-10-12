import { describe, expect, test } from "bun:test"
import { validateMount } from "@guildhall/assets"
import { defaultMount } from "../src/grips/matrix/defaults.ts"
import { DEFAULT_PROPS, parseParams } from "../src/grips/matrix/params.ts"

describe("defaultMount", () => {
  test("an elongated prop is gripped near the low end of its longest axis, edge on the second", () => {
    // An axe: 0.62 wide, 1.05 tall, centred at (0.1, 0.5, 0).
    const m = defaultMount([0.62, 1.05, 0.22], [0.1, 0.5, 0])
    expect(m.axis).toEqual([0, 1, 0])
    expect(m.edge).toEqual([1, 0, 0])
    expect(m.handle[0]).toBeCloseTo(0.1)
    expect(m.handle[1]).toBeCloseTo(0.5 - 0.38 * 1.05)
    expect(m.upright).toBeUndefined()
  })

  test("a prop long along x takes x as its handle axis", () => {
    const m = defaultMount([1.96, 0.09, 0.4], [0, 0, 0])
    expect(m.axis).toEqual([1, 0, 0])
    expect(m.edge).toEqual([0, 0, 1])
  })

  test("a compact prop hangs upright from the top centre of its box", () => {
    const m = defaultMount([0.75, 1.11, 0.75], [0, 0.55, 0])
    expect(m.upright).toEqual({ up: [0, 1, 0] })
    expect(m.handle).toEqual([0, 1.105, 0])
  })

  test("every default is a valid mount", () => {
    for (const size of [
      [0.62, 1.05, 0.22],
      [0.53, 0.55, 0.4],
      [1, 1, 1],
    ] as const)
      expect(validateMount(defaultMount([...size], [0, 0, 0]))).toEqual([])
  })
})

describe("parseParams", () => {
  const parse = (q: string) => parseParams(new URLSearchParams(q))

  test("no query: the default props and the eight key clips, live", () => {
    const p = parse("")
    expect(p.props).toEqual(DEFAULT_PROPS)
    expect(p.columns.map((c) => c.clip)).toEqual([
      "Idle_A",
      "Walking_A",
      "Chopping",
      "Pickaxing",
      "Hammering",
      "Sit_Chair_Idle",
      "Waving",
      "Holding_A",
    ])
    expect(p.columns.every((c) => c.t === null)).toBe(true)
    expect(p.axes).toBe(false)
  })

  test("t lists give one frozen column per clip and time; out-of-range times are dropped", () => {
    const p = parse("clips=chop,Throw&t=0.3,0.7,2")
    expect(p.columns).toEqual([
      { key: "chop", clip: "Chopping", t: 0.3 },
      { key: "chop", clip: "Chopping", t: 0.7 },
      { key: "Throw", clip: "Throw", t: 0.3 },
      { key: "Throw", clip: "Throw", t: 0.7 },
    ])
  })

  test("props=held, an id list, or empty for the axes row alone", () => {
    expect(parse("props=held").props).toBe("held")
    expect(parse("props=a/b,c/d").props).toEqual(["a/b", "c/d"])
    expect(parse("props=&axes=1")).toMatchObject({ props: [], axes: true })
  })
})
