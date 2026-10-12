import { describe, expect, test } from "bun:test"
import data from "../src/palette.json"
import { loadPalette } from "../src/palette.ts"
import { validateEntry, validateIndex } from "../src/validate.ts"
import { entry } from "./entry.ts"

const palette = loadPalette(data)
const ok = entry({ id: "town/wall-door" })
/** A JSON copy with one field replaced (or removed, for `undefined`). */
const withField = (key: string, value: unknown): unknown =>
  JSON.parse(JSON.stringify({ ...ok, [key]: value }))

describe("validateEntry", () => {
  test("a well-formed entry has no problems", () => {
    expect(validateEntry(ok, palette)).toEqual([])
  })

  test("a well-formed character with a rig, anchors and auto tags has no problems", () => {
    const hero = entry({
      id: "kaykit-adventurers/knight",
      kind: "character",
      category: "character",
      character: { rig: "rig-medium", clips: ["Idle"], bones: 40 },
      autoTags: { tags: ["hero"], by: "vision", thumb: "abc" },
      scale: { factor: 1, rule: "ref", confidence: "ref", target: [5.5, null], flags: ["undersize"] },
      compose: {
        front: "+z",
        streetEdge: null,
        attach: "held",
        edgeKind: "fence",
        anchors: [{ id: "door", kind: "door", at: [0, 0, 0.5], facing: 0 }],
        source: "manual",
      },
      files: { glb: "pieces/x.glb", thumb: null },
    })
    expect(validateEntry(hero, palette)).toEqual([])
  })

  test("prefixes each problem with the entry id", () => {
    expect(validateEntry(withField("hash", ""))).toEqual(["town/wall-door: hash: expected a string"])
  })

  test("rejects an id that is not <pack>/<kebab-slug>", () => {
    expect(validateEntry({ ...ok, id: "other/wall-door" })[0]).toContain('id: expected "<pack>/<kebab-slug>"')
    expect(validateEntry({ ...ok, id: "town/Wall Door" })[0]).toContain("id: expected")
  })

  test("rejects unknown vocabulary", () => {
    expect(validateEntry({ ...ok, category: "spaceship" })).toEqual([
      'town/wall-door: category: unknown "spaceship"',
    ])
    expect(validateEntry({ ...ok, flags: ["wobbly"] })).toEqual(['town/wall-door: flags: unknown "wobbly"'])
    expect(validateEntry({ ...ok, compose: { ...ok.compose, attach: "glued" } })).toEqual([
      'town/wall-door: compose.attach: unknown "glued"',
    ])
    expect(validateEntry({ ...ok, compose: { ...ok.compose, front: "up" } })).toEqual([
      'town/wall-door: compose.front: unknown "up"',
    ])
  })

  test("rejects a bad size, footprint and counts", () => {
    expect(validateEntry({ ...ok, size: [1, 2] })).toEqual([
      "town/wall-door: size: expected [w, h, d] metres >= 0",
    ])
    expect(validateEntry({ ...ok, size: [1, -2, 1] })).toHaveLength(1)
    expect(validateEntry({ ...ok, footprint: { w: 1.5, d: 1 } })).toEqual([
      "town/wall-door: footprint: expected whole cells { w, d }",
    ])
    expect(validateEntry({ ...ok, tris: -1 })).toEqual(["town/wall-door: tris: expected a count"])
  })

  test("swatches must be sorted, distinct and, given a palette, inside it", () => {
    expect(validateEntry({ ...ok, swatches: [3, 1] })).toEqual([
      "town/wall-door: swatches: expected sorted, distinct ids",
    ])
    expect(validateEntry({ ...ok, swatches: [1, 1] })).toHaveLength(1)
    expect(validateEntry({ ...ok, swatches: [1, 48, 99] }, palette)).toEqual([
      "town/wall-door: swatches: not in the palette: 48, 99",
    ])
    expect(validateEntry({ ...ok, swatches: [1, 48] })).toEqual([])
  })

  test("checks the scale block", () => {
    expect(validateEntry({ ...ok, scale: { ...ok.scale, factor: 0 } })).toEqual([
      "town/wall-door: scale.factor: expected a positive number",
    ])
    expect(validateEntry({ ...ok, scale: { ...ok.scale, target: [9, 4] } })).toEqual([
      "town/wall-door: scale.target: expected [min, max | null] with min <= max",
    ])
    expect(validateEntry({ ...ok, scale: { ...ok.scale, flags: ["undersize", "undersize"] } })).toEqual([
      "town/wall-door: scale.flags: duplicates",
    ])
  })

  test("checks anchors", () => {
    const anchors = [{ id: "a", kind: "portal", at: [0, 0], facing: "north" }]
    expect(validateEntry({ ...ok, compose: { ...ok.compose, anchors } })).toEqual([
      'town/wall-door: compose.anchors[0].kind: unknown "portal"',
      "town/wall-door: compose.anchors[0].at: expected [x, y, z]",
      "town/wall-door: compose.anchors[0].facing: expected a number",
    ])
  })

  test("a character needs its rig block", () => {
    expect(validateEntry({ ...ok, kind: "character" })).toEqual([
      "town/wall-door: character: required for kind character",
    ])
  })

  test("a missing field is reported, not thrown", () => {
    expect(validateEntry(withField("compose", undefined))).toEqual([
      "town/wall-door: compose: expected an object",
    ])
    expect(validateEntry(withField("files", { glb: "x.glb" }))).toEqual([
      "town/wall-door: files: expected { glb, thumb | null }",
    ])
    expect(validateEntry(null)).toEqual(["entry: expected an object"])
  })
})

describe("validateIndex", () => {
  const index = {
    version: 1,
    palette: "deadbeef",
    importer: "guildhall-import@0",
    packs: [{ id: "town", vendor: "kenney", count: 3, hash: "a" }],
    rigs: [
      { id: "rig-medium", file: "rigs/rig-medium.glb", clips: [{ name: "Idle", seconds: 2 }], bones: 40 },
    ],
  }

  test("a well-formed index has no problems", () => {
    expect(validateIndex(index)).toEqual([])
  })

  test("rejects a wrong version, missing palette hash and malformed packs and rigs", () => {
    expect(
      validateIndex({
        ...index,
        version: 2,
        palette: "",
        packs: [{ id: "town" }],
        rigs: [{ ...index.rigs[0], clips: [{ name: "Idle", seconds: -1 }] }],
      }),
    ).toEqual([
      "version: expected 1, got 2",
      "palette: expected the palette hash",
      "packs[0]: expected { id, vendor, count, hash }",
      "rigs[0]: expected { id, file, clips: { name, seconds }[], bones }",
    ])
    expect(validateIndex([])).toEqual(["index: expected an object"])
  })
})
