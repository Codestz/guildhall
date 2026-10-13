import { describe, expect, test } from "bun:test"
import type { NpcLook } from "@guildhall/assets"
import { bustCamera, portraitKey } from "../src/portrait.ts"

const look = (mounts: NpcLook["mounts"]): NpcLook =>
  ({ body: "kaykit-adventurers/knight", mounts }) as unknown as NpcLook

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
})

describe("bustCamera", () => {
  test("aims a little above the head bone, in front and to one side, a little from above", () => {
    const { target, position } = bustCamera([0, 1.5, 0], 2)
    expect(target[1]).toBeGreaterThan(1.5)
    expect(position[2]).toBeGreaterThan(0)
    expect(position[0]).toBeGreaterThan(0)
    expect(position[0]).toBeLessThan(position[2])
    expect(position[1]).toBeGreaterThan(target[1])
  })

  test("scales with the figure: twice the height, twice the distance", () => {
    const d = (h: number) => {
      const { target, position } = bustCamera([0, 0, 0], h)
      return Math.hypot(position[0] - target[0], position[1] - target[1], position[2] - target[2])
    }
    expect(d(4)).toBeCloseTo(d(2) * 2, 6)
  })
})
