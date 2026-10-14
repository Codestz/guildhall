import { describe, expect, test } from "bun:test"
import type { NpcLook } from "@guildhall/assets"
import { type Bounds, bustCamera, bustFrame, HEADGEAR, portraitKey } from "../src/portrait.ts"

const look = (mounts: NpcLook["mounts"], more: Partial<NpcLook> = {}): NpcLook =>
  ({ body: "kaykit-adventurers/knight", mounts, rampMap: {}, hide: [], ...more }) as unknown as NpcLook

describe("portraitKey", () => {
  test("one sprite per body, tint and props, whatever the props' order or the tint's case", () => {
    const a = portraitKey({
      look: look([
        { piece: "sword", slot: "hand.r" },
        { piece: "shield", slot: "hand.l" },
      ]),
      tint: "#4F8FD6",
    })
    const b = portraitKey({
      look: look([
        { piece: "shield", slot: "hand.l" },
        { piece: "sword", slot: "hand.r" },
      ]),
      tint: "#4f8fd6",
    })
    expect(a).toBe(b)
    expect(portraitKey({ look: look([]), tint: "#4f8fd6" })).not.toBe(a)
    expect(portraitKey({ look: look([{ piece: "sword", slot: "hand.r" }]), tint: "#d4ad3a" })).not.toBe(
      portraitKey({ look: look([{ piece: "sword", slot: "hand.r" }]), tint: "#4f8fd6" }),
    )
  })

  test("the same body in another outfit is another sprite: its colours and its hidden parts count", () => {
    const plain = portraitKey({ look: look([]), tint: "#9a8f80" })
    const dyed = portraitKey({ look: look([], { rampMap: { accent: "teal" } }), tint: "#9a8f80" })
    const bare = portraitKey({ look: look([], { hide: ["Knight_Helmet"] }), tint: "#9a8f80" })
    expect(new Set([plain, dyed, bare]).size).toBe(3)
    // the order the outfit lists its ramps or hidden parts in does not matter
    expect(
      portraitKey({ look: look([], { rampMap: { a: "x", b: "y" }, hide: ["P", "Q"] }), tint: "#9a8f80" }),
    ).toBe(
      portraitKey({ look: look([], { rampMap: { b: "y", a: "x" }, hide: ["Q", "P"] }), tint: "#9a8f80" }),
    )
  })

  test("seed, phase and scale do not split the cache (they do not change the picture)", () => {
    expect(portraitKey({ look: look([], { seed: 1, phase: 0.1, scale: 1 }), tint: "#9a8f80" })).toBe(
      portraitKey({ look: look([], { seed: 2, phase: 0.7, scale: 1.06 }), tint: "#9a8f80" }),
    )
  })
})

/** A KayKit head: about a metre tall, from 1.08 m to 2.16 m, a metre across. */
const HEAD: Bounds = { min: [-0.57, 1.08, -0.5], max: [0.57, 2.16, 0.52] }
const H = HEAD.max[1] - HEAD.min[1]

describe("bustFrame", () => {
  test("a bare head: the whole head and the top of the shoulders, centred on the head", () => {
    const { centre, half } = bustFrame(HEAD, null)
    expect(centre[0]).toBeCloseTo(0, 6)
    expect(centre[1] + half).toBeGreaterThan(HEAD.max[1])
    expect(centre[1] - half).toBeLessThan(HEAD.min[1])
    // tight: the head fills most of the frame, so the face reads at badge size
    expect(H / (2 * half)).toBeGreaterThan(0.7)
  })

  test("a hat is framed with the head (the mage's), its tip capped at half a head", () => {
    const hat: Bounds = { min: [-0.93, 1.31, -0.97], max: [0.93, 2.65, 1] }
    const bare = bustFrame(HEAD, null)
    const hatted = bustFrame(HEAD, hat)
    expect(hatted.centre[1] + hatted.half).toBeGreaterThanOrEqual(2.65)
    expect(hatted.half).toBeGreaterThan(bare.half)
    const steeple: Bounds = { min: [-0.3, 1.9, -0.3], max: [0.3, 6, 0.3] }
    const top = bustFrame(HEAD, steeple)
    expect(top.centre[1] + top.half).toBeLessThan(HEAD.max[1] + H * 0.6)
  })

  test("a wide brim keeps its width, a helmet no taller than the head changes nothing above it", () => {
    const brim: Bounds = { min: [-1.1, 1.9, -1.1], max: [1.1, 2.3, 1.1] }
    expect(bustFrame(HEAD, brim).half).toBeGreaterThanOrEqual(1.1)
    const helm: Bounds = { min: [-0.6, 1.3, -0.55], max: [0.6, 2.1, 0.55] }
    expect(bustFrame(HEAD, helm).centre[1] + bustFrame(HEAD, helm).half).toBeCloseTo(
      bustFrame(HEAD, null).centre[1] + bustFrame(HEAD, null).half,
      6,
    )
  })

  test("scales with the figure", () => {
    const big: Bounds = {
      min: HEAD.min.map((v) => v * 2) as Bounds["min"],
      max: HEAD.max.map((v) => v * 2) as Bounds["max"],
    }
    expect(bustFrame(big, null).half).toBeCloseTo(bustFrame(HEAD, null).half * 2, 6)
  })
})

describe("bustCamera", () => {
  test("aims at the frame's middle from in front and to one side, a little from above", () => {
    const { target, position } = bustCamera([0, 1.5, 0], 0.8)
    expect(target).toEqual([0, 1.5, 0])
    expect(position[2]).toBeGreaterThan(0)
    expect(position[0]).toBeGreaterThan(0)
    expect(position[0]).toBeLessThan(position[2])
    expect(position[1]).toBeGreaterThan(target[1])
  })

  test("twice the frame, twice the distance; the face's depth moves it back by as much", () => {
    const d = (half: number, depth = 0) => {
      const { target, position } = bustCamera([0, 0, 0], half, depth)
      return Math.hypot(position[0] - target[0], position[1] - target[1], position[2] - target[2])
    }
    expect(d(1.6)).toBeCloseTo(d(0.8) * 2, 6)
    expect(d(0.8, 0.5)).toBeCloseTo(d(0.8) + 0.5, 6)
  })

  test("the frame's half side fills half the view (the field of view's half angle)", () => {
    const { target, position } = bustCamera([0, 0, 0], 1)
    const d = Math.hypot(...position.map((v, i) => v - (target[i] as number)))
    // half the view at that distance is 1: tan(11°) · d
    expect(Math.tan((11 * Math.PI) / 180) * d).toBeCloseTo(1, 6)
  })
})

describe("HEADGEAR", () => {
  test("names KayKit's hats, helmets, visors and hoods, not heads or bodies", () => {
    for (const n of ["Mage_Hat", "Knight_Helmet", "Knight_HelmetVisor", "Barbarian_BearHat", "Rogue_Hood"])
      expect(HEADGEAR.test(n)).toBe(true)
    for (const n of ["Mage_Head", "Knight_Body", "Ranger_Cape", "Mage_ArmLeft"])
      expect(HEADGEAR.test(n)).toBe(false)
  })
})
