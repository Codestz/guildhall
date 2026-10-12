import { describe, expect, test } from "bun:test"
import type { Mount } from "../src/mount.ts"
import { applyOverlay, type DataOverlay } from "../src/overlay.ts"
import { entry } from "./entry.ts"

const mug: Mount = { slot: "hand.r", hands: 1, handle: [0, 0.05, 0], axis: [0, 1, 0], edge: [1, 0, 0] }
const hat: Mount = { slot: "head", hands: 1, handle: [0, 0, 0], axis: [0, 1, 0], edge: [0, 0, 1] }

const entries = () => [entry({ id: "bits/mug" }), entry({ id: "bits/hat" }), entry({ id: "town/wall" })]
const overlay = (): DataOverlay => ({ mounts: { "bits/mug": mug, "bits/hat": hat } })

describe("applyOverlay", () => {
  test("sets compose.mount on the listed entries and leaves the rest alone", () => {
    const out = applyOverlay(entries(), overlay())
    expect(out.map((e) => e.compose.mount)).toEqual([mug, hat, undefined])
    expect(out[2]).toEqual(entries()[2]!)
  })

  test("is idempotent", () => {
    const once = applyOverlay(entries(), overlay())
    const twice = applyOverlay(once, overlay())
    expect(twice).toEqual(once)
    // Unchanged entries come back as the same objects, so callers can skip rewriting a shard.
    twice.forEach((e, i) => {
      expect(e).toBe(once[i]!)
    })
  })

  test("does not mutate its inputs, nor share the overlay's objects", () => {
    const input = entries()
    const o = overlay()
    const before = structuredClone(input)
    const out = applyOverlay(input, o)
    expect(input).toEqual(before)
    out[0]!.compose.mount!.handle[1] = 9
    expect(o.mounts!["bits/mug"]!.handle[1]).toBe(0.05)
  })

  test("the overlay is the whole truth: a mount it no longer lists is removed", () => {
    const mounted = applyOverlay(entries(), overlay())
    const out = applyOverlay(mounted, { mounts: { "bits/mug": mug } })
    expect(out[1]!.compose.mount).toBeUndefined()
    expect("mount" in out[1]!.compose).toBe(false)
    expect(out[0]).toBe(mounted[0]!)
  })

  test("a changed mount replaces the old one", () => {
    const mounted = applyOverlay(entries(), overlay())
    const tilted: Mount = { ...mug, clips: { Waving: { roll: 0.3 } } }
    const out = applyOverlay(mounted, { mounts: { "bits/mug": tilted, "bits/hat": hat } })
    expect(out[0]!.compose.mount).toEqual(tilted)
    expect(out[0]).not.toBe(mounted[0]!)
  })

  test("ignores ids the catalog does not have, and an overlay without mounts changes nothing", () => {
    const input = entries()
    expect(applyOverlay(input, { mounts: { "gone/piece": mug } })).toEqual(input)
    const mounted = applyOverlay(input, overlay())
    expect(applyOverlay(mounted, {})).toEqual(mounted)
  })

  test("keeps entry order and handles an empty catalog", () => {
    expect(applyOverlay([], overlay())).toEqual([])
    expect(applyOverlay(entries(), overlay()).map((e) => e.id)).toEqual(["bits/mug", "bits/hat", "town/wall"])
  })
})
