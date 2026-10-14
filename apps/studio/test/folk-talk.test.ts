/** The townsfolk's words (folkTalk.ts): few, near, under the heroes' speaker cap, never over a bubble. */
import { describe, expect, test } from "bun:test"
import { MAX_SPEAKERS } from "../src/hexworld/chips.ts"
import { chooseSayings, FOLK_SAY_M, type Saying } from "../src/hexworld/folkTalk.ts"

const say = (id: number, x: number, y: number, depth: number): Saying => ({
  id,
  text: "Cheers!",
  x,
  y,
  depth,
})

describe("townsfolk sayings", () => {
  test("the nearest first, at most what the heroes' speakers leave of the cap", () => {
    const said = [say(1, 100, 100, 12), say(2, 400, 100, 5), say(3, 700, 100, 8), say(4, 100, 400, 3)]
    expect(chooseSayings(said, [], 0).map((s) => s.id)).toEqual([4, 2, 3].slice(0, MAX_SPEAKERS))
    expect(chooseSayings(said, [], MAX_SPEAKERS - 1).map((s) => s.id)).toEqual([4])
    expect(chooseSayings(said, [], MAX_SPEAKERS)).toEqual([])
  })

  test("only within reach of the eye", () => {
    expect(chooseSayings([say(1, 100, 100, FOLK_SAY_M + 0.5)], [], 0)).toEqual([])
  })

  test("never over a hero's bubble or another saying", () => {
    const said = [say(1, 100, 100, 4), say(2, 130, 105, 5), say(3, 600, 100, 6)]
    expect(chooseSayings(said, [], 0).map((s) => s.id)).toEqual([1, 3])
    expect(chooseSayings(said, [{ x: 590, y: 110 }], 1).map((s) => s.id)).toEqual([1])
  })
})
