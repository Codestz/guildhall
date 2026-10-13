import { describe, expect, test } from "bun:test"
import { roman } from "../src/components/controls.tsx"
import { formatStep, type Knob, readKnob, readKnobs, withKnobs, writeKnob } from "../src/viewer/knobs.ts"

const files: Knob = {
  kind: "range",
  key: "files",
  label: "Repo files",
  min: 0,
  max: 30000,
  step: 100,
  default: 4000,
}
const spots: Knob = { kind: "toggle", key: "spots", label: "Spots", default: false }
const life: Knob = { kind: "toggle", key: "life", label: "Life", default: true }
const mode: Knob = {
  kind: "segment",
  key: "view",
  label: "View",
  default: "one",
  options: [
    { value: "one", label: "One" },
    { value: "grid", label: "Eight" },
  ],
}

describe("readKnob", () => {
  test("a missing key reads as the default", () => {
    expect(readKnob(files, new URLSearchParams())).toBe(4000)
    expect(readKnob(spots, new URLSearchParams())).toBe(false)
    expect(readKnob(mode, new URLSearchParams())).toBe("one")
  })

  test("numbers are clamped into range; garbage falls back to the default", () => {
    expect(readKnob(files, new URLSearchParams("files=1500"))).toBe(1500)
    expect(readKnob(files, new URLSearchParams("files=99999"))).toBe(30000)
    expect(readKnob(files, new URLSearchParams("files=-5"))).toBe(0)
    expect(readKnob(files, new URLSearchParams("files=lots"))).toBe(4000)
    expect(readKnob(files, new URLSearchParams("files="))).toBe(4000)
  })

  test("toggles read 1/0, true/false and a bare key", () => {
    expect(readKnob(spots, new URLSearchParams("spots=1"))).toBe(true)
    expect(readKnob(spots, new URLSearchParams("spots"))).toBe(true)
    expect(readKnob(life, new URLSearchParams("life=0"))).toBe(false)
    expect(readKnob(life, new URLSearchParams("life=maybe"))).toBe(true)
  })

  test("a choice outside the options reads as the default", () => {
    expect(readKnob(mode, new URLSearchParams("view=grid"))).toBe("grid")
    expect(readKnob(mode, new URLSearchParams("view=cube"))).toBe("one")
  })
})

describe("writing knobs to the query", () => {
  test("a default is left out of the link", () => {
    expect(writeKnob(files, 4000)).toBeNull()
    expect(writeKnob(life, true)).toBeNull()
    expect(writeKnob(life, false)).toBe("0")
    expect(writeKnob(spots, true)).toBe("1")
  })

  test("withKnobs sets changed values, drops defaults and keeps every other key", () => {
    const q = new URLSearchParams("seed=3&files=900&hud=perf")
    const out = withKnobs(q, [files, spots, life], { files: 4000, spots: true, life: true })
    expect(out.get("seed")).toBe("3")
    expect(out.get("hud")).toBe("perf")
    expect(out.has("files")).toBe(false)
    expect(out.get("spots")).toBe("1")
    expect(out.has("life")).toBe(false)
    // the input is not changed
    expect(q.get("files")).toBe("900")
  })

  test("a link read back gives the values written", () => {
    const values = { files: 12000, spots: true, life: false, view: "grid" }
    const q = withKnobs(new URLSearchParams(), [files, spots, life, mode], values)
    expect(readKnobs([files, spots, life, mode], q)).toEqual(values)
  })
})

test("formatStep shows the step's decimals", () => {
  expect(formatStep(4000, 100)).toBe("4,000")
  expect(formatStep(5, 1)).toBe("5")
  expect(formatStep(0.2, 0.05)).toBe("0.20")
  expect(formatStep(1, 0.01)).toBe("1.00")
})

test("roman numerals, and plain digits outside 1–3999", () => {
  expect([1, 4, 9, 14, 40, 90, 400, 1994, 3999].map(roman)).toEqual([
    "I",
    "IV",
    "IX",
    "XIV",
    "XL",
    "XC",
    "CD",
    "MCMXCIV",
    "MMMCMXCIX",
  ])
  expect(roman(0)).toBe("0")
  expect(roman(2.5)).toBe("2.5")
})
