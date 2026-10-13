import { describe, expect, test } from "bun:test"
import { createSession } from "../src/hall/feeds/index.ts"
import { HomeFeed, homeStoryOf } from "../src/site/homeFeed.ts"
import { districtOf, homePlaces } from "../src/site/homePlaces.ts"

// an island's zones by index: a castle and a town, then the places the demo's folders go to
const KINDS = ["castle", "town", "market", "monastery", "camp", "harbour", "mine", "farm"]

describe("the home's story", () => {
  test("?story= names a told story; anything else is the demo guild", () => {
    expect(homeStoryOf("saga")).toBe("saga")
    expect(homeStoryOf("factions")).toBe("factions")
    expect(homeStoryOf("nope")).toBe("demo")
    expect(homeStoryOf(null)).toBe("demo")
  })
})

describe("a story's folders on the home island's own zones", () => {
  test("a district is its first two folders, and the demo's root is not one", () => {
    expect(districtOf("packages/world/src/hex/zones.ts")).toBe("packages/world")
    expect(districtOf("/demo/guildhall/test/arena.test.ts")).toBe("test")
    expect(districtOf("README.md")).toBe("")
  })

  test("tests go to the camp, docs to the monastery, assets to the harbour, scripts to the mine, the app to the market", () => {
    const p = homePlaces(KINDS)
    const kind = (path: string) => KINDS[p.placeOf?.(path) ?? -1]
    expect(kind("/demo/guildhall/test/arena.test.ts")).toBe("camp")
    expect(kind("/demo/guildhall/docs/guide.md")).toBe("monastery")
    expect(kind("/demo/guildhall/assets/sails.png")).toBe("harbour")
    expect(kind("/demo/guildhall/scripts/pack.ts")).toBe("mine")
    expect(kind("/demo/guildhall/app/market.tsx")).toBe("market")
  })

  test("a district keeps its zone, two districts of one kind take two zones, a root file stays in the hall", () => {
    const p = homePlaces([...KINDS, "camp"])
    const world = p.placeOf?.("packages/world/src/a.ts")
    expect(world).toBeDefined()
    expect(p.placeOf?.("packages/world/src/b.ts")).toBe(world)
    const first = p.placeOf?.("tests/alpha/x.ts")
    const second = p.placeOf?.("spec/beta/y.ts")
    expect(KINDS[first ?? -1] ?? "camp").toBe("camp")
    expect(first).not.toBe(second)
    expect(p.placeOf?.("README.md")).toBeUndefined()
  })

  test("zones are named as the Guild's lines say them, and a new story deals the districts again", () => {
    const p = homePlaces(KINDS)
    const camp = p.placeOf?.("test/a.test.ts")
    expect(p.name(camp)).toBe("the camp")
    expect(p.name(undefined)).toBe("the Guildhall")
    const first = p.placeOf?.("zzz/qqq/a.ts")
    p.reset()
    expect(p.placeOf?.("other/thing/a.ts")).toBe(first)
  })

  test("an island without a kind of place sends its folders to the next it has, or leaves them in the hall", () => {
    const small = homePlaces(["castle", "market"])
    expect(small.placeOf?.("test/a.test.ts")).toBe(1)
    expect(homePlaces(["castle"]).placeOf?.("test/a.test.ts")).toBeUndefined()
  })
})

describe("the home's session", () => {
  test("the demo guild plays through the hall's session: its heroes join, walk to the island's places and the log is told", () => {
    const places = homePlaces(KINDS)
    const bound = new Set<number>()
    const feed = new HomeFeed("demo")
    const session = createSession(feed, { autoplay: true })
    session.start((path) => {
      const zone = places.placeOf?.(path)
      if (zone !== undefined) bound.add(zone)
      return zone
    })
    expect(feed.status()).toBe("replay")
    expect(session.log().length).toBeGreaterThan(20)
    expect(bound.size).toBeGreaterThan(2)
  })

  test("a story switches in place: the log starts over and the acts are the story's", () => {
    const feed = new HomeFeed("demo")
    const session = createSession(feed, { autoplay: true })
    session.start(homePlaces(KINDS).placeOf)
    let resets = 0
    session.onReset(() => resets++)
    feed.switchTo("saga")
    expect(resets).toBe(1)
    expect(feed.chapters).toHaveLength(5)
    expect(feed.name).toBe("The Saga")
    feed.switchTo("demo")
    expect(feed.chapters).toHaveLength(0)
  })
})
