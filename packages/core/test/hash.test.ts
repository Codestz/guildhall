import { describe, expect, test } from "bun:test"
import { fnv1a, hash, roll } from "../src/hash.ts"

describe("fnv1a", () => {
  test("is FNV-1a, 32 bits (the archive's golden values)", () => {
    expect(fnv1a("")).toBe(0x811c9dc5)
    expect(fnv1a("a")).toBe(0xe40c292c)
    expect(fnv1a("foobar")).toBe(0xbf9cf968)
  })
})

describe("hash", () => {
  test("is fnv1a of the parts joined by ':', as the archive spelled it by hand", () => {
    expect(hash("foobar")).toBe(0xbf9cf968)
    expect(hash(3, "0,1", "decor")).toBe(fnv1a("3:0,1:decor"))
    expect(hash(3, "0,1", "decor")).toBe(2273296628)
  })

  test("of no parts is the empty string's hash", () => {
    expect(hash()).toBe(0x811c9dc5)
  })
})

describe("roll", () => {
  test("is the archive's fnv1a(`seed:salt`) / 2^32, pinned to the bit", () => {
    expect(roll(0, "mirror")).toBe(fnv1a("0:mirror") / 4294967296)
    expect(roll(0, "mirror")).toBe(0.3882848871871829)
    expect(roll(11, "7:tree")).toBe(0.8315553483553231)
    expect(roll(42, "x")).toBe(0.7011422796640545)
  })

  test("stays in [0, 1)", () => {
    for (let i = 0; i < 500; i++) {
      const r = roll(i, `${i}:salt`)
      expect(r).toBeGreaterThanOrEqual(0)
      expect(r).toBeLessThan(1)
    }
  })
})
