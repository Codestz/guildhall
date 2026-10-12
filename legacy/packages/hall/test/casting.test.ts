import { describe, expect, test } from "bun:test"
import { apply, type Change, emptyModel } from "@guildhall/core"
import { initials, namedOf, rankOf } from "../src/guild/casting.ts"
import { viewsOf } from "../src/guild/store.ts"

const sub = (agent: string, archetype?: string) => ({
  agent,
  parentID: "root",
  ...(archetype ? { archetype } : {}),
})

describe("namedOf: what the hall calls someone", () => {
  test("world names: the archetype, subtitled with the source's own name", () => {
    const named = namedOf(sub("guild-verifier"))
    expect([named.name, named.subtitle, named.glyph, named.plural]).toEqual([
      "Warden",
      "verifier",
      "Wd",
      "Wardens",
    ])
  })

  test("an unknown agent is a Wanderer under its own name; a bot an Automaton", () => {
    expect([namedOf(sub("general")).name, namedOf(sub("general")).subtitle]).toEqual(["Wanderer", "general"])
    expect(namedOf(sub("dependabot[bot]")).archetype.id).toBe("automaton")
  })

  test("the source's declared archetype wins", () => {
    expect(namedOf(sub("Explore", "scout")).name).toBe("Scout")
    expect(namedOf(sub("Explore", "scout")).subtitle).toBe("Explore")
  })

  test("a party's root is the Guildmaster whatever runs it; no subtitle that only repeats the name", () => {
    expect(namedOf({ agent: "build" }).name).toBe("Guildmaster")
    expect(namedOf({ agent: "build" }).subtitle).toBe("build")
    expect(namedOf({ agent: "guild-master" }).subtitle).toBe("")
    // A root named by the caller (the stage's root), even with a parent id.
    expect(namedOf(sub("guild-implementer"), "world", true).name).toBe("Guildmaster")
  })

  test("source names: the source's own title and letters, no subtitle; the root stays the Guildmaster", () => {
    const named = namedOf(sub("guild-product-owner"), "source")
    expect([named.name, named.subtitle, named.glyph, named.plural]).toEqual([
      "Product owner",
      "",
      "Po",
      "Product owners",
    ])
    expect(namedOf(sub("general"), "source").name).toBe("general")
    expect(namedOf({ agent: "build" }, "source").name).toBe("Guildmaster")
  })

  test("initials", () => {
    expect(initials("Verifier")).toBe("Ve")
    expect(initials("Product owner")).toBe("Po")
    expect(initials("general-purpose")).toBe("Gp")
    expect(initials("x")).toBe("X")
  })
})

describe("rankOf: a session's rank from its deeds and tokens", () => {
  const tools = (n: number) =>
    Array.from({ length: n }, () => ({ kind: "tool" as const })) as unknown as Parameters<
      typeof rankOf
    >[0]["entries"]

  test("deeds count, thoughts and replies don't", () => {
    expect(rankOf({ entries: tools(19), tokens: 0 })).toBe("apprentice")
    expect(rankOf({ entries: tools(20), tokens: 0 })).toBe("journeyman")
    expect(rankOf({ entries: tools(60), tokens: 0 })).toBe("master")
    const talk = [{ kind: "reply" }, { kind: "thinking" }] as unknown as Parameters<
      typeof rankOf
    >[0]["entries"]
    expect(rankOf({ entries: [...tools(19), ...talk], tokens: 0 })).toBe("apprentice")
  })

  test("a view carries its rank, archetype and the source's name", () => {
    const model = emptyModel()
    const changes: Change[] = [
      { type: "session", id: "root", agent: "build", at: 1 },
      { type: "status", id: "root", status: "busy", at: 1 },
      { type: "session", id: "v", parentID: "root", agent: "guild-verifier", at: 2 },
      { type: "status", id: "v", status: "busy", at: 2 },
      ...Array.from(
        { length: 20 },
        (_, i): Change => ({
          type: "tool",
          id: "v",
          call: `c${i}`,
          name: "bash",
          state: "completed",
          at: 3 + i,
        }),
      ),
    ]
    for (const change of changes) apply(model, change)
    const view = viewsOf(model, 100).find((v) => v.id === "v")
    expect(view && [view.archetype, view.rank, view.subtitle, view.character]).toEqual([
      "warden",
      "journeyman",
      "verifier",
      "rogue",
    ])
  })
})
