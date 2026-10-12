import { describe, expect, test } from "bun:test"
import type { CatalogEntry } from "../src/catalog.ts"
import type { Mount } from "../src/mount.ts"
import type { NpcLook, NpcRecipe } from "../src/npc/recipe.ts"
import { resolveNpc, SKIN_RAMPS } from "../src/npc/resolve.ts"
import data from "../src/palette.json"
import { loadPalette } from "../src/palette.ts"
import { createCatalog } from "../src/query.ts"
import { rampMapToSwatchMap } from "../src/tint.ts"
import { entry } from "./entry.ts"

const palette = loadPalette(data)
const SEEDS = Array.from({ length: 200 }, (_, i) => i)

const grip = (over: Partial<Mount> = {}): Mount => ({
  slot: "hand.r",
  hands: 1,
  handle: [0, 0, 0],
  axis: [0, 1, 0],
  edge: [1, 0, 0],
  ...over,
})
const body = (id: string, parts?: string[]): CatalogEntry =>
  entry({ id, kind: "character", character: { rig: "rig-medium", clips: [], bones: 23, parts } })
const prop = (id: string, mount?: Mount): CatalogEntry =>
  entry({
    id,
    compose: { front: null, streetEdge: null, attach: "held", anchors: [], source: "pack", mount },
  })

const catalog = createCatalog({ version: 1, palette: "test", importer: "test", packs: [], rigs: [] }, [
  [
    body("kaykit-adventurers/barbarian", ["Barbarian_Body", "Barbarian_BearHat"]),
    body("kaykit-adventurers/rogue", ["Rogue_Body", "Rogue_Cape"]),
    body("kaykit-adventurers/knight"),
    entry({ id: "kaykit-tools/crate" }),
    prop("kaykit-tools/pitchfork", grip()),
    prop("kaykit-tools/lantern", grip({ alt: ["hand.l"] })),
    prop("kaykit-tools/hat-straw", grip({ slot: "head" })),
    prop("kaykit-tools/bare"),
  ],
])

const farmer = (over: Partial<NpcRecipe> = {}): NpcRecipe => ({
  version: 1,
  id: "farmer",
  role: "farmer",
  body: ["kaykit-adventurers/barbarian", "kaykit-adventurers/rogue", "kaykit-adventurers/knight"],
  hide: ["Barbarian_BearHat", "Rogue_Cape"],
  outfit: { timber: ["timber", "thatch", "terracotta"], sandstone: ["slate"] },
  head: { pieces: ["kaykit-tools/hat-straw"], chance: 0.5 },
  hands: { r: ["kaykit-tools/pitchfork", "kaykit-tools/lantern", ""], l: ["", "kaykit-tools/lantern"] },
  activity: { work: "Pickaxing", idle: ["Idle_A", "Idle_B"], walk: "Walking_A" },
  vary: { height: [0.96, 1.04], speed: [0.9, 1.1] },
  ...over,
})

const looks = (r: NpcRecipe = farmer()): NpcLook[] => SEEDS.map((s) => resolveNpc(r, s, catalog))

describe("resolveNpc", () => {
  test("the same recipe and seed give the same look; a look names its recipe and seed", () => {
    const a = resolveNpc(farmer(), 42, catalog)
    expect(resolveNpc(farmer(), 42, catalog)).toEqual(a)
    expect(a.recipe).toBe("farmer")
    expect(a.seed).toBe(42)
  })

  test("100 seeds over three option axes give at least 20 distinct looks", () => {
    // Discrete choices only: the variation alone would make every look distinct.
    const r = farmer({
      head: undefined,
      hands: { r: ["kaykit-tools/pitchfork", "kaykit-tools/lantern", ""] },
    })
    const keys = looks(r)
      .slice(0, 100)
      .map((l) => JSON.stringify([l.body, l.rampMap, l.mounts]))
    expect(new Set(keys).size).toBeGreaterThanOrEqual(20)
  })

  test("every option on every axis is drawn by some seed", () => {
    const all = looks()
    expect(new Set(all.map((l) => l.body)).size).toBe(3)
    expect(new Set(all.map((l) => l.rampMap.timber ?? "timber"))).toEqual(
      new Set(["timber", "thatch", "terracotta"]),
    )
    expect(new Set(all.map((l) => l.clips.idle))).toEqual(new Set(["Idle_A", "Idle_B"]))
    const worn = all.filter((l) => l.mounts.some((m) => m.slot === "head")).length
    expect(worn / all.length).toBeGreaterThan(0.35)
    expect(worn / all.length).toBeLessThan(0.65)
  })

  test("outfits re-tint only the ramps the recipe swaps, and never skin", () => {
    const skin = new Set(
      palette.ramps.filter((r) => SKIN_RAMPS.includes(r.name)).flatMap((r) => Object.values(r.tones)),
    )
    expect(skin.size).toBe(3)
    for (const look of looks()) {
      expect(Object.keys(look.rampMap).every((ramp) => ramp === "timber")).toBe(true)
      const swatches = Object.keys(rampMapToSwatchMap(palette, look.rampMap)).map(Number)
      expect(swatches.filter((s) => skin.has(s))).toEqual([])
    }
  })

  test("an identity outfit choice leaves the ramp out of the map", () => {
    const plain = looks().filter((l) => l.rampMap.timber === undefined)
    expect(plain.length).toBeGreaterThan(0)
    for (const l of plain) expect(l.rampMap).toEqual({})
  })

  test("height, speed and phase stay in their ranges and spread across them", () => {
    const all = looks()
    const span = (xs: number[]) => [Math.min(...xs), Math.max(...xs)]
    const [hMin, hMax] = span(all.map((l) => l.scale))
    const [sMin, sMax] = span(all.map((l) => l.speed))
    const [pMin, pMax] = span(all.map((l) => l.phase))
    expect(hMin).toBeGreaterThanOrEqual(0.96)
    expect(hMax).toBeLessThan(1.04)
    expect(hMax - hMin).toBeGreaterThan(0.06)
    expect(sMin).toBeGreaterThanOrEqual(0.9)
    expect(sMax).toBeLessThan(1.1)
    expect(sMax - sMin).toBeGreaterThan(0.15)
    expect(pMin).toBeGreaterThanOrEqual(0)
    expect(pMax).toBeLessThan(1)
    expect(pMax - pMin).toBeGreaterThan(0.8)
  })

  test("a fixed range gives exactly that value", () => {
    const look = resolveNpc(farmer({ vary: { height: [1, 1], speed: [1.2, 1.2] } }), 7, catalog)
    expect(look.scale).toBe(1)
    expect(look.speed).toBe(1.2)
  })

  test("props ride their slot; an empty hand holds nothing; an alt slot is allowed", () => {
    for (const look of looks()) {
      for (const m of look.mounts) expect(["hand.r", "hand.l", "head"]).toContain(m.slot)
      expect(
        look.mounts.filter((m) => m.slot === "hand.l").every((m) => m.piece === "kaykit-tools/lantern"),
      ).toBe(true)
    }
    const bare = resolveNpc(farmer({ head: undefined, hands: { r: [""], l: [""] } }), 1, catalog)
    expect(bare.mounts).toEqual([])
  })

  test("hidden parts are the ones the drawn body has, or all of them when its parts are unknown", () => {
    for (const look of looks()) {
      const expected = {
        "kaykit-adventurers/barbarian": ["Barbarian_BearHat"],
        "kaykit-adventurers/rogue": ["Rogue_Cape"],
        "kaykit-adventurers/knight": ["Barbarian_BearHat", "Rogue_Cape"],
      }[look.body]
      expect(look.hide).toEqual(expected!)
    }
  })

  test("throws, naming the recipe, on an invalid recipe, a non-character body or a prop without a mount", () => {
    expect(() => resolveNpc(farmer({ body: [] }), 0, catalog)).toThrow(/resolveNpc\(farmer\): body/)
    expect(() => resolveNpc(farmer({ body: ["kaykit-tools/crate"] }), 0, catalog)).toThrow(/not a character/)
    expect(() => resolveNpc(farmer({ body: ["nope/none"] }), 0, catalog)).toThrow(/not a character/)
    const held = (r: string) => farmer({ head: undefined, hands: { r: [r] } })
    expect(() => resolveNpc(held("kaykit-tools/bare"), 0, catalog)).toThrow(/has no mount/)
    expect(() => resolveNpc(held("nope/none"), 0, catalog)).toThrow(/unknown or has no mount/)
    expect(() => resolveNpc(held("kaykit-tools/hat-straw"), 0, catalog)).toThrow(/no mount for hand.r/)
  })
})
