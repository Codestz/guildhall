/**
 * Task B's pure parts (render props/ and character/carry.ts): the carry mount lands the load between
 * Holding_A's hands, stock levels and layouts, the rail, the float through the fishing clips and the
 * line's sag, the carrying walk's tracks, the built pieces, and the crowd's prop mask.
 */
import { describe, expect, test } from "bun:test"
import { mountBasis } from "@guildhall/assets"
import { PROPS } from "@guildhall/world"
import { AnimationClip, Quaternion, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack } from "three"
import { armTrack, CARRY_WALK, carryClip, withCarry } from "../src/character/carry.ts"
import { propShown } from "../src/crowd/crowd.ts"
import { BUILT, builtGeometry, builtOf, builtPath } from "../src/props/built.ts"
import { CARRY_AT, CARRY_SPAN, carryMount } from "../src/props/carry.ts"
import { CAST_AT, CATCH_AT, floatAt, floatPoint, HANG, LINE_SEGMENTS, sagLine } from "../src/props/line.ts"
import {
  BASKET,
  DRAWN_CAP,
  LEVELS,
  railPieces,
  stockLayout,
  stockLevel,
  stockRoom,
  TRACK_LEN,
} from "../src/props/stockLayout.ts"

/** Where prop point `p` lands in the slot's frame under a mount. */
function landed(m: ReturnType<typeof carryMount>, p: readonly [number, number, number]): Vector3 {
  const b = mountBasis(m, m.slot)
  const q = new Quaternion(...b.rotation)
  return new Vector3(...p)
    .multiplyScalar(m.scale ?? 1)
    .applyQuaternion(q)
    .add(new Vector3(...b.translation))
}

describe("carry mount", () => {
  test("a log's centre lands ahead of and under the chest, between the hands, its length across", () => {
    const size = [0.72, 0.73, 1.35] as const
    const m = carryMount(size)
    expect(m.slot).toBe("chest")
    expect(m.hands).toBe(2)
    const centre = landed(m, [0, size[1] / 2, 0])
    expect(centre.x).toBeCloseTo(0, 6)
    // (the scale is kept to 3 decimals)
    expect(centre.y).toBeCloseTo(-CARRY_AT.down, 3)
    expect(centre.z).toBeCloseTo(CARRY_AT.ahead, 3)
    // the log's long side (its z) runs across the body (the chest's x)
    const end = landed(m, [0, size[1] / 2, 1]).sub(centre)
    expect(Math.abs(end.x)).toBeGreaterThan(0.5)
    expect(Math.abs(end.z)).toBeLessThan(1e-6)
    // its up stays up
    const up = landed(m, [0, size[1] / 2 + 1, 0]).sub(centre)
    expect(up.y).toBeGreaterThan(0.5)
  })

  test("a wide load is scaled to span at most CARRY_SPAN; a small one keeps its size", () => {
    expect((carryMount([0.72, 0.73, 1.35]).scale ?? 1) * 1.35).toBeCloseTo(CARRY_SPAN, 2)
    expect(carryMount([0.5, 0.3, 0.5]).scale).toBe(1)
  })

  test("a centred piece lands its origin there", () => {
    const m = carryMount([0.6, 0.6, 0.6], true)
    const c = landed(m, [0, 0, 0])
    expect(c.y).toBeCloseTo(-CARRY_AT.down, 6)
    expect(c.z).toBeCloseTo(CARRY_AT.ahead, 6)
  })
})

describe("stock levels", () => {
  test("empty is level 0, the first unit shows something, the cap and past it the last level", () => {
    const top = LEVELS.basket.length - 1
    expect(stockLevel("basket", 0, 40)).toBe(0)
    expect(stockLevel("basket", 1, 40)).toBe(1)
    expect(stockLevel("basket", 40, 40)).toBe(top)
    expect(stockLevel("basket", 400, 40)).toBe(top)
  })

  test("a heap and a pile are drawn to their own caps (GF-A: heap 90, pile 40), not the plan's", () => {
    expect(DRAWN_CAP["ore-heap"]).toBe(90)
    expect(DRAWN_CAP["log-pile"]).toBe(40)
    const top = LEVELS["ore-heap"].length - 1
    expect(stockLevel("ore-heap", 89, 6)).toBeLessThan(top + 1)
    expect(stockLevel("ore-heap", 45, 6)).toBeLessThan(top)
    expect(stockLevel("ore-heap", 90, 6)).toBe(top)
  })

  test("levels only rise with the count", () => {
    for (const kind of ["basket", "log-pile", "ore-heap", "crates", "bars", "planks"] as const) {
      let was = 0
      for (let n = 0; n <= 120; n++) {
        const l = stockLevel(kind, n, 40)
        expect(l).toBeGreaterThanOrEqual(was)
        was = l
      }
    }
  })

  test("counted kinds show their count: a cart's throws, the butts' arrows", () => {
    expect(stockLevel("ore-cart", 4, 6)).toBe(4)
    expect(stockLevel("arrows", 7, 10)).toBe(7)
    expect(stockLevel("arrows", 30, 10)).toBe(10)
  })
})

describe("stock layouts", () => {
  test("each level shows its units (and a basket or a crate holds them)", () => {
    for (const [kind, levels] of Object.entries(LEVELS) as [keyof typeof LEVELS, readonly number[]][]) {
      for (const [level, units] of levels.entries()) {
        const pieces = stockLayout(kind, level, PROPS.fish)
        const unitsDrawn = pieces.filter((p) => p.piece === PROPS.fish).length
        if (kind === "stall-fish") expect(pieces.filter((p) => p.piece === BASKET).length).toBe(units)
        else expect(unitsDrawn).toBe(units)
      }
    }
    expect(stockLayout("basket", 0, PROPS.fish)[0]?.piece).toBe(BASKET)
  })

  test("a lower level's pieces are the full level's first ones (the batch's instances never change piece)", () => {
    for (const kind of Object.keys(LEVELS) as (keyof typeof LEVELS)[]) {
      const full = stockLayout(kind, LEVELS[kind].length - 1, PROPS.log)
      expect(full.length).toBe(stockRoom(kind, PROPS.log))
      for (let l = 0; l < LEVELS[kind].length; l++) {
        const some = stockLayout(kind, l, PROPS.log)
        expect(some.map((p) => p.piece)).toEqual(full.slice(0, some.length).map((p) => p.piece))
      }
    }
  })

  test("a heap rises to its middle", () => {
    const heap = stockLayout("ore-heap", LEVELS["ore-heap"].length - 1, PROPS.ore)
    const middle = heap[0]!
    const edge = heap.at(-1)!
    expect(middle.at[1]).toBeGreaterThan(edge.at[1])
  })
})

describe("rail", () => {
  test("tracks end to end along the rail, from behind the cart to past its end", () => {
    const pieces = railPieces([0, 0, 0], [0, 0, 5])
    expect(pieces.length).toBe(Math.ceil(6 / TRACK_LEN))
    const zs = pieces.map((p) => p.at[1])
    expect(Math.min(...zs) - TRACK_LEN / 2).toBeLessThanOrEqual(-0.5 + 1e-9)
    expect(Math.max(...zs) + TRACK_LEN / 2).toBeGreaterThanOrEqual(5.5 - 1e-9)
    for (const p of pieces) {
      expect(p.at[0]).toBeCloseTo(0, 9)
      expect(p.yaw).toBeCloseTo(0, 9)
    }
    expect(railPieces([0, 0, 0], [0, 0, 0])).toEqual([])
  })
})

describe("the fisher's float and line", () => {
  test("hangs under the tip on the swing back, flies out after letting go, lands at the end", () => {
    expect(floatAt("Fishing_Cast", 0.3, 0)).toMatchObject({ shown: true, out: 0, flying: true })
    const mid = floatAt("Fishing_Cast", (CAST_AT + 1) / 2, 0)
    expect(mid.out).toBeGreaterThan(0)
    expect(mid.out).toBeLessThan(1)
    expect(mid.dy).toBeGreaterThan(0)
    expect(floatAt("Fishing_Cast", 1, 0)).toMatchObject({ out: 1, flying: false })
  })

  test("rides at rest, dips under on a bite, comes in reeling, is gone once the fish is out", () => {
    expect(Math.abs(floatAt("Fishing_Idle", 0.5, 3).dy)).toBeLessThan(0.03)
    expect(floatAt("Fishing_Bite", 0.53, 0).dy).toBeLessThan(-0.05)
    expect(floatAt("Fishing_Reeling", 0.9, 0).out).toBeLessThan(floatAt("Fishing_Reeling", 0.1, 0).out)
    expect(floatAt("Fishing_Catch", CATCH_AT - 0.01, 0).shown).toBe(true)
    expect(floatAt("Fishing_Catch", CATCH_AT, 0).shown).toBe(false)
    expect(floatAt("PickUp", 0.5, 0).shown).toBe(false)
  })

  test("the line is slack at rest and taut on a bite", () => {
    expect(floatAt("Fishing_Idle", 0.5, 0).sag).toBeGreaterThan(floatAt("Fishing_Bite", 0.5, 0).sag)
  })

  test("the float's place: under the tip, on the water out there, over it in flight", () => {
    const tip = [0, 2, 0] as const
    const near = [0, 0, 1] as const
    const far = [0, 0, 4] as const
    expect(floatPoint(floatAt("Fishing_Cast", 0.2, 0), tip, near, far)).toEqual([0, 2 - HANG, 0])
    const rest = floatPoint({ shown: true, out: 1, dy: 0, flying: false, sag: 0 }, tip, near, far)
    expect(rest).toEqual([0, 0, 4])
    const flying = floatPoint({ shown: true, out: 0.5, dy: 0.3, flying: true, sag: 0 }, tip, near, far)
    expect(flying[2]).toBeCloseTo(2, 9)
    expect(flying[1]).toBeGreaterThan(0)
  })

  test("sagLine: segment pairs from tip to float, joined, sagging at the middle", () => {
    const out = new Float32Array(LINE_SEGMENTS * 6)
    const n = sagLine([0, 1, 0], [4, 1, 0], 0.1, out, 0)
    expect(n).toBe(LINE_SEGMENTS * 6)
    expect([out[0], out[1], out[2]]).toEqual([0, 1, 0])
    expect([...out.slice(n - 3, n)]).toEqual([4, 1, 0])
    // each segment starts where the last ended
    for (let k = 1; k < LINE_SEGMENTS; k++)
      for (let c = 0; c < 3; c++) expect(out[k * 6 + c]).toBeCloseTo(out[k * 6 - 3 + c]!, 6)
    // the middle hangs sag × length under the straight
    const mid = LINE_SEGMENTS / 2
    expect(out[mid * 6 + 1]).toBeCloseTo(1 - 0.1 * 4, 5)
  })
})

describe("carrying walk", () => {
  const track = (bone: string) =>
    new QuaternionKeyframeTrack(`${bone}.quaternion`, [0, 1], [0, 0, 0, 1, 0, 0, 0, 1])
  const walk = new AnimationClip("Walking_A", 1.067, [
    track("upperarml"),
    track("handr"),
    track("hips"),
    new VectorKeyframeTrack("root.position", [0, 1], [0, 0, 0, 0, 0, 0]),
  ])
  const hold = new AnimationClip("Holding_A", 1, [track("upperarml"), track("handr"), track("hips")])

  test("arm and hand tracks by name (three drops the dot), not the hips or the root", () => {
    expect(armTrack("upperarml.quaternion")).toBe(true)
    expect(armTrack("handslotr.position")).toBe(true)
    expect(armTrack("wristl.quaternion")).toBe(true)
    expect(armTrack("hips.quaternion")).toBe(false)
    expect(armTrack("root.position")).toBe(false)
  })

  test("Holding_A's arms over Walking_A's legs, at the walk's length", () => {
    const made = carryClip([walk, hold])
    expect(made?.name).toBe(CARRY_WALK)
    expect(made?.duration).toBe(walk.duration)
    const names = made?.tracks.map((t) => t.name).sort()
    expect(names).toEqual(["handr.quaternion", "hips.quaternion", "root.position", "upperarml.quaternion"])
    // the arms are the hold's copies, the rest the walk's
    expect(made?.tracks.find((t) => t.name === "hips.quaternion")?.times).toEqual(walk.tracks[2]!.times)
    expect(made?.tracks.find((t) => t.name === "handr.quaternion")).not.toBe(hold.tracks[1])
  })

  test("added once, and only when both clips are there", () => {
    const once = withCarry([walk, hold])
    expect(once.filter((c) => c.name === CARRY_WALK)).toHaveLength(1)
    expect(withCarry(once)).toBe(once)
    expect(withCarry([walk])).toEqual([walk])
  })
})

describe("built pieces", () => {
  test("every one is a coloured, palette-marked, flat-shaded mesh, standing on its base", () => {
    for (const name of BUILT) {
      const g = builtGeometry(name)
      const n = g.getAttribute("position").count
      expect(n).toBeGreaterThan(0)
      expect(g.getAttribute("color").count).toBe(n)
      expect(g.getAttribute("_swatch").count).toBe(n)
      expect(g.index).toBeNull()
      // on its base (a float: its waterline; a spyglass, held, on its axis)
      if (name !== "spyglass") expect(g.boundingBox!.min.y).toBeGreaterThan(name === "float" ? -0.1 : -0.01)
    }
  })

  test("their library paths name them; a library file does not", () => {
    expect(builtOf(`/library/${builtPath("cart")}`)).toBe("cart")
    expect(builtOf("/library/built/nothing.glb")).toBeNull()
    expect(builtOf("/library/pieces/kaykit-tools/axe.glb")).toBeNull()
  })
})

describe("crowd prop mask", () => {
  test("no mask shows every mount; a mask shows its bits", () => {
    expect(propShown(undefined, 5)).toBe(true)
    expect(propShown(0b101, 0)).toBe(true)
    expect(propShown(0b101, 1)).toBe(false)
    expect(propShown(0b101, 2)).toBe(true)
  })
})
