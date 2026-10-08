import { afterEach, describe, expect, test } from "bun:test"
import { Object3D, OrthographicCamera } from "three"
import {
  addChip,
  type ChipSlot,
  chipSlot,
  layout,
  MAX_SPEAKERS,
  READ_AT_PX,
  resetChips,
  setChipMode,
  speaks,
} from "../src/scene/chips.ts"

/** Just enough of an HTMLElement for the declutter: a size, a style, attributes. */
function fakeChip(w = 60, h = 20) {
  const attrs = new Set<string>()
  const style = new Map<string, string>()
  const el = {
    offsetWidth: w,
    offsetHeight: h,
    style: { setProperty: (k: string, v: string) => style.set(k, v) },
    hasAttribute: (k: string) => attrs.has(k),
    toggleAttribute: (k: string, on: boolean) => (on ? attrs.add(k) : attrs.delete(k)),
  }
  const more = { textContent: "" }
  return { el, more, attrs, style }
}

// 20 world units across 200 px: 10 px a unit. Looking down -z, so a larger z is nearer.
const camera = new OrthographicCamera(-10, 10, 10, -10, 0.1, 100)
camera.position.set(0, 0, 50)
camera.updateMatrixWorld()
camera.updateProjectionMatrix()

function chipAt(x: number, z: number, pinned = false) {
  const anchor = new Object3D()
  anchor.position.set(x, 0, z)
  anchor.updateMatrixWorld()
  const fake = fakeChip()
  const slot: ChipSlot = chipSlot()
  slot.anchor = anchor
  slot.el = fake.el as unknown as HTMLElement
  slot.more = fake.more as unknown as HTMLElement
  slot.pinned = pinned
  addChip(slot)
  return { slot, ...fake }
}

/** Folding waits a few runs so chips walking past don't flicker. */
const settle = () => {
  for (let i = 0; i < 4; i++) layout(camera, 200, 200)
}

afterEach(resetChips)

describe("chip declutter", () => {
  test("two overlapping chips: the farther one is lifted clear, the nearer one stays", () => {
    const near = chipAt(0, 5)
    const far = chipAt(1, -5)
    settle()
    expect(near.style.get("--lift") ?? "0px").toBe("0px")
    // 20 px tall + 3 px gap.
    expect(far.style.get("--lift")).toBe("23px")
    expect(far.attrs.has("data-folded")).toBe(false)
  })

  test("chips apart are left alone", () => {
    const a = chipAt(-6, 0)
    const b = chipAt(6, 1)
    settle()
    for (const c of [a, b]) {
      expect(c.style.get("--lift") ?? "0px").toBe("0px")
      expect(c.attrs.has("data-folded")).toBe(false)
    }
  })

  test("three in a pile fold into the nearest, which reads +2", () => {
    const near = chipAt(0, 5)
    const mid = chipAt(0.5, 0)
    const far = chipAt(1, -5)
    settle()
    expect(near.attrs.has("data-folded")).toBe(false)
    expect(near.more.textContent).toBe("+2")
    expect(mid.attrs.has("data-folded")).toBe(true)
    expect(far.attrs.has("data-folded")).toBe(true)
  })

  test("a pinned chip (selected or pleading) is never folded, and hosts the +N", () => {
    const near = chipAt(0, 5)
    const pleading = chipAt(0.5, -5, true)
    const far = chipAt(1, -6)
    settle()
    expect(pleading.attrs.has("data-folded")).toBe(false)
    expect(pleading.style.get("--lift") ?? "0px").toBe("0px")
    expect(pleading.more.textContent).toBe("+2")
    expect(near.attrs.has("data-folded")).toBe(true)
    expect(far.attrs.has("data-folded")).toBe(true)
  })

  test("chips far apart on a wide screen are not lifted; two that meet across it are", () => {
    // 100 px a unit on a 2000 px canvas: chips land in different grid cells.
    const left = chipAt(-9, 0)
    const right = chipAt(9, 0)
    const meet = chipAt(9.2, -1)
    for (let i = 0; i < 3; i++) layout(camera, 2000, 2000)
    expect(left.style.get("--lift") ?? "0px").toBe("0px")
    expect(right.style.get("--lift") ?? "0px").toBe("0px")
    expect(meet.style.get("--lift")).toBe("23px")
  })

  test("a pile does not fold on a single run (no flicker as chips pass)", () => {
    chipAt(0, 5)
    const mid = chipAt(0.5, 0)
    chipAt(1, -5)
    layout(camera, 200, 200)
    expect(mid.attrs.has("data-folded")).toBe(false)
  })
})

describe("chip sizes", () => {
  /** Hands each observed element's resize to the test, as the browser would after a layout. */
  class FakeObserver {
    static last: FakeObserver | null = null
    constructor(readonly notify: (entries: ResizeObserverEntry[]) => void) {
      FakeObserver.last = this
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  const real = globalThis.ResizeObserver
  afterEach(() => {
    globalThis.ResizeObserver = real
  })

  test("a chip is measured once when it appears, not on every run (no forced layout)", () => {
    const near = chipAt(0, 5)
    let reads = 0
    Object.defineProperty(near.el, "offsetHeight", {
      get: () => {
        reads++
        return 20
      },
    })
    settle()
    settle()
    expect(reads).toBe(1)
  })

  test("a chip that grows (its observer says so) pushes the chip above it higher", () => {
    globalThis.ResizeObserver = FakeObserver as unknown as typeof ResizeObserver
    const near = chipAt(0, 5)
    const far = chipAt(1, -5)
    settle()
    expect(far.style.get("--lift")).toBe("23px")
    near.el.offsetHeight = 40
    FakeObserver.last?.notify([{ target: near.el } as unknown as ResizeObserverEntry])
    settle()
    expect(far.style.get("--lift")).toBe("43px")
  })
})

describe("speech bubbles", () => {
  test("Hidden: never; Detailed: always; Minimal: the followed one, or close enough to read", () => {
    expect(speaks("hidden", true, 100)).toBe(false)
    expect(speaks("detailed", false, 1)).toBe(true)
    expect(speaks("minimal", true, 1)).toBe(true)
    expect(speaks("minimal", false, READ_AT_PX - 1)).toBe(false)
    expect(speaks("minimal", false, READ_AT_PX)).toBe(true)
  })

  /** This camera spans 10 px a unit: the diorama's distance, too far to read speech unasked. */
  function speaker(x: number, z: number, selected = false) {
    const chip = chipAt(x, z, selected)
    chip.slot.bubble = true
    chip.slot.selected = selected
    return chip
  }

  test("Minimal at overview distance: only the followed adventurer speaks", () => {
    setChipMode("minimal")
    const followed = speaker(-8, 0, true)
    const other = speaker(8, 0)
    settle()
    expect(followed.attrs.has("data-speak")).toBe(true)
    expect(other.attrs.has("data-speak")).toBe(false)
  })

  test("Hidden: no bubble at all, the followed one included", () => {
    setChipMode("hidden")
    const followed = speaker(0, 0, true)
    settle()
    expect(followed.attrs.has("data-speak")).toBe(false)
  })

  test("never two bubbles over one another: the nearer speaks", () => {
    setChipMode("detailed")
    const near = speaker(0, 5)
    const far = speaker(2, -5)
    settle()
    expect(near.attrs.has("data-speak")).toBe(true)
    expect(far.attrs.has("data-speak")).toBe(false)
  })

  test("at most MAX_SPEAKERS on screen, the followed one first", () => {
    setChipMode("detailed")
    // 100 px a unit: 450 px apart, no two bubbles touch; only the cap holds them back.
    const chips = [speaker(-9, 4), speaker(-4.5, 3), speaker(4.5, 2), speaker(9, 1), speaker(0, -9, true)]
    for (let i = 0; i < 3; i++) layout(camera, 2000, 2000)
    const speaking = chips.filter((chip) => chip.attrs.has("data-speak"))
    expect(speaking.length).toBe(MAX_SPEAKERS)
    expect(chips[4]?.attrs.has("data-speak")).toBe(true)
  })

  test("nothing to say, nothing shown; a chip that stops speaking loses its bubble", () => {
    setChipMode("detailed")
    const quiet = chipAt(0, 0)
    const talker = speaker(-8, 0)
    settle()
    expect(quiet.attrs.has("data-speak")).toBe(false)
    expect(talker.attrs.has("data-speak")).toBe(true)
    talker.slot.bubble = false
    settle()
    expect(talker.attrs.has("data-speak")).toBe(false)
  })
})
