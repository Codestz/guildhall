import { describe, expect, test } from "bun:test"
import { directingOf } from "../src/hud/directing.ts"

describe("Director's controls: who gets them", () => {
  test("a plain showcase visit keeps them away", () => {
    expect(directingOf("showcase", false, "")).toBe(false)
    expect(directingOf("showcase", false, "?repo=facebook/react&grow")).toBe(false)
    expect(directingOf("showcase", false, "?archipelago")).toBe(false)
    expect(directingOf("showcase", false, "?renderer=webgpu")).toBe(false)
  })

  test("a link from /demos, or one that asks for a scene, gets them", () => {
    expect(directingOf("showcase", false, "?demo")).toBe(true)
    expect(directingOf("showcase", false, "?archipelago&demo")).toBe(true)
    for (const search of ["?story=party", "?act=3", "?hour=22&weather=storm", "?t=6:00", "?weather=snow"])
      expect(directingOf("showcase", false, search)).toBe(true)
  })

  test("the local app and probe builds always get them", () => {
    expect(directingOf("app", false, "")).toBe(true)
    expect(directingOf("showcase", true, "")).toBe(true)
  })

  test("demo=0 previews the plain visit anywhere", () => {
    expect(directingOf("app", true, "?demo=0")).toBe(false)
    expect(directingOf("showcase", true, "?story=saga&demo=0")).toBe(false)
  })
})
