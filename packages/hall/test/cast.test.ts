import { describe, expect, test } from "bun:test"
import { Object3D } from "three"
import type { AdventurerView } from "../src/guild/store.ts"
import { type AdventurerProps, mixerStep, sameProps, sameView } from "../src/scene/Adventurer.tsx"
import { capacityFor } from "../src/scene/Blobs.tsx"
import { glowOfEffect, moteAt, motesOf } from "../src/scene/DeedEffect.tsx"
import { ringOf } from "../src/scene/Rings.tsx"

const view = (over: Partial<AdventurerView> = {}): AdventurerView => ({
  id: "s1",
  agent: "guild-implementer",
  title: "Implementer",
  role: "Implementer",
  ordinal: 1,
  color: "#e07a3a",
  character: "knight",
  master: false,
  phase: "working",
  target: [1, 2, 0.5],
  look: { clip: "Use_Item", effect: "sparks" } as AdventurerView["look"],
  thinking: false,
  doing: "edit · routes.ts",
  stung: false,
  party: "p1",
  banner: "#3a7ae0",
  enter: { kind: "gate", at: [0, 30, 0] },
  ...over,
})

const props = (over: Partial<AdventurerProps> = {}): AdventurerProps => ({
  view: view(),
  selected: false,
  following: null,
  banners: false,
  dark: false,
  ...over,
})

describe("the cast re-renders only what changed (scene/Adventurer memo)", () => {
  test("a refresh that rebuilt an unchanged view is the same figure", () => {
    expect(sameView(view(), view())).toBe(true)
  })

  test("any change the figure draws or walks by is a new figure", () => {
    expect(sameView(view(), view({ doing: "read · store.ts" }))).toBe(false)
    expect(sameView(view(), view({ target: [1, 2.5, 0.5] }))).toBe(false)
    expect(sameView(view(), view({ look: undefined }))).toBe(false)
    expect(sameView(view(), view({ bubble: "hm" }))).toBe(false)
    expect(sameView(view(), view({ thinking: true }))).toBe(false)
  })

  test("cast-level facts re-render too: selection, following, banners, nightfall", () => {
    const base = props()
    expect(sameProps(base, props())).toBe(true)
    expect(sameProps(base, props({ selected: true }))).toBe(false)
    expect(sameProps(base, props({ following: "p2" }))).toBe(false)
    expect(sameProps(base, props({ banners: true }))).toBe(false)
    expect(sameProps(base, props({ dark: true }))).toBe(false)
  })
})

describe("mixer culling (as the townsfolk's)", () => {
  const near = 10 * 10
  const far = 50 * 50

  test("off screen: never stepped; the selected one always is", () => {
    expect(mixerStep(false, near, 0, 0, false)).toBe("skip")
    expect(mixerStep(false, far, 1, 0, true)).toBe("full")
  })

  test("near and seen: every frame; far: every other frame, staggered", () => {
    expect([0, 1, 2, 3].map((f) => mixerStep(true, near, f, 0, false))).toEqual([
      "full",
      "full",
      "full",
      "full",
    ])
    expect([0, 1, 2, 3].map((f) => mixerStep(true, far, f, 0, false))).toEqual([
      "full",
      "skip",
      "full",
      "skip",
    ])
    expect([0, 1, 2, 3].map((f) => mixerStep(true, far, f, 1, false))).toEqual([
      "skip",
      "full",
      "skip",
      "full",
    ])
  })
})

describe("instanced cast layers grow with the crowd", () => {
  test("room enough: unchanged; more: doubled until it fits; never shrinks", () => {
    expect(capacityFor(10, 64)).toBe(64)
    expect(capacityFor(64, 64)).toBe(64)
    expect(capacityFor(65, 64)).toBe(128)
    expect(capacityFor(301, 64)).toBe(512)
    expect(capacityFor(0, 128)).toBe(128)
  })
})

describe("rings and deed motes keep their old look", () => {
  test("selected rings are wider and stronger", () => {
    expect(ringOf(false)).toEqual({ outer: 0.9, alpha: 0.55 })
    expect(ringOf(true)).toEqual({ outer: 1.05, alpha: 0.95 })
  })

  test("effects share four glows; portals ring the feet with ten motes, the rest rise with six", () => {
    expect(glowOfEffect("pages")).toBe("trim")
    expect(glowOfEffect("scroll")).toBe("trim")
    expect(glowOfEffect("sparks")).toBe("sparks")
    expect(motesOf("portal")).toBe(10)
    expect(motesOf("steam")).toBe(6)
    const mote = new Object3D()
    moteAt("portal", 0, 10, 0, mote)
    expect(mote.position.y).toBeCloseTo(0.05)
    expect(Math.hypot(mote.position.x, mote.position.z)).toBeCloseTo(0.42)
    moteAt("pages", 0, 6, 0, mote)
    expect(mote.position.y).toBeCloseTo(0.7)
    expect(mote.scale.x).toBeCloseTo(1)
  })
})
