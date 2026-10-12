import { afterAll, describe, expect, test } from "bun:test"
import type { Moment } from "../src/guild/moments.ts"
import { hear, masterOf, RAVENS_MAX } from "../src/guild/ravens.ts"
import { GuildStore } from "../src/guild/store.ts"

/** The ravens' rules (guild/ravens.ts): whose guildmaster a raven flies to, what is queued to fly. */

const stores: GuildStore[] = []
afterAll(() => {
  for (const store of stores) store.load("party")
})

describe("ravens", () => {
  test("parties: a join's or loot's raven flies to its own party's guildmaster, never another's", () => {
    const store = new GuildStore()
    stores.push(store)
    store.load("parties")
    let checked = 0
    let crowded = 0
    const wrong: string[] = []
    store.moments.on((m) => {
      if (m.kind !== "join" && m.kind !== "loot") return
      checked++
      const masters = store.views.filter((v) => v.master)
      if (masters.length > 1) crowded++
      const picked = masterOf(m, store.views)
      if (picked && picked.id !== m.master)
        wrong.push(`${m.kind} ${m.id} (party ${m.master}) -> ${picked.id}`)
      // Its own guildmaster is on stage: the raven has somewhere to fly.
      if (masters.some((v) => v.id === m.master)) expect(picked?.id).toBe(m.master)
    })
    for (let t = 0; t < 130_000; t += 100) store.tick(100)
    expect(checked).toBeGreaterThan(10)
    // Several guildmasters were on the island for most of them: the case that used to go wrong.
    expect(crowded).toBeGreaterThan(5)
    expect(wrong).toEqual([])
  })

  test("a guildmaster's own loot sends no raven to itself; a party off stage has no guildmaster", () => {
    const views = [
      { id: "A", master: true },
      { id: "a1", master: false },
      { id: "B", master: true },
    ]
    expect(masterOf({ master: "B" }, views)?.id).toBe("B")
    expect(masterOf({ master: "C" }, views)).toBeUndefined()
    // a1's id is never taken for a guildmaster, whatever its moment says.
    expect(masterOf({ master: "a1" }, views)).toBeUndefined()
  })

  test("hidden tab: nothing is queued (no stale flock on return); the queue holds at most the sky", () => {
    const moment = (kind: Moment["kind"], n: number) =>
      ({
        kind,
        id: `s${n}`,
        master: "A",
        title: "x",
        color: "#fff",
        agent: "a",
        at: n,
        seq: n,
        live: true,
      }) as Moment
    const news: Moment[] = []
    for (let n = 0; n < 20; n++) hear(news, moment("join", n), true)
    expect(news).toEqual([])
    hear(news, moment("deed", 1), false)
    expect(news).toEqual([])
    for (let n = 0; n < 20; n++) hear(news, moment(n % 2 ? "loot" : "plea", n), false)
    expect(news.length).toBe(RAVENS_MAX)
    expect(news.at(-1)?.seq).toBe(19)
  })
})
