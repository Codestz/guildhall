import { afterAll, describe, expect, test } from "bun:test"
import { apply, type Change, emptyModel, type Model } from "@guildhall/core"
import { Ordinals } from "../src/guild/ordinals.ts"
import { GuildStore, ordinalOf, RUSH, viewsOf } from "../src/guild/store.ts"

/**
 * The store at crowd size (Chapter 2, docs/perf-budget.md): a refresh and a rebuild stay cheap at
 * 300 adventurers, numbers within a role stay right when kept rather than recounted, and an
 * adventurer whose view did not change keeps the same object for the scene to memo by.
 */

afterAll(() => {
  RUSH.count = undefined
})

/** A rush of `n`, paused `t` ms in. */
function rushAt(n: number, t: number): GuildStore {
  RUSH.count = n
  const store = new GuildStore()
  store.load("rush")
  store.setSpeed(0)
  store.seek(t)
  return store
}

const median = (times: number[]) => times.sort((a, b) => a - b)[Math.floor(times.length / 2)] ?? 0

describe("cost at 300 adventurers", () => {
  test("a refresh is a fraction of a frame", () => {
    const store = rushAt(300, 30_000)
    expect(store.views.length).toBeGreaterThan(300)
    const times: number[] = []
    for (let i = 0; i < 30; i++) {
      const started = performance.now()
      store.tick(101) // paused: no events, but past the 100 ms refresh
      times.push(performance.now() - started)
    }
    expect(median(times)).toBeLessThan(3)
  })

  test("a rebuild (a seek) no longer counts every role's ranks per log line", () => {
    // Measured before (6af2edf): ~115 ms at 300 against ~17 at 100, every log line counting its
    // role's ranks again; now ~20 against ~6.
    const seek = (store: GuildStore) => {
      const times: number[] = []
      for (let i = 0; i < 5; i++) {
        const started = performance.now()
        store.seek(60_000)
        times.push(performance.now() - started)
      }
      // The quickest of several: the least disturbed by whatever else the machine is doing.
      return Math.min(...times)
    }
    expect(seek(rushAt(300, 60_000))).toBeLessThan(60)
  })
})

describe("numbers kept, not recounted", () => {
  test("in a crowd, every moment names its adventurer as the views do", () => {
    const store = rushAt(300, 30_000)
    const titles = new Map(store.views.map((v) => [v.id, v.title]))
    const named = store.moments.history.filter((m) => titles.has(m.id))
    expect(named.length).toBeGreaterThan(300)
    for (const m of named) expect({ id: m.id, title: m.title }).toEqual({ id: m.id, title: titles.get(m.id) })
  })

  test("out of order, a parent heard after its children, an identity changed: the same as counting afresh", () => {
    const model = emptyModel()
    const ordinals = new Ordinals()
    const check = () => {
      for (const s of model.sessions.values())
        expect([s.id, ordinals.of(model, s)]).toEqual([s.id, ordinalOf(model, s)])
    }
    const take = (change: Change) => {
      const mark = ordinals.mark(model, change.id)
      apply(model, change)
      ordinals.took(model, change.id, mark)
      check()
    }
    const join = (id: string, agent: string, at: number, parentID?: string) =>
      take({ type: "session", id, agent, title: "t", at, ...(parentID ? { parentID } : {}) })
    // A grandchild and a child before the conversation they belong to.
    join("grand", "guild-implementer", 3000, "child")
    join("child", "guild-implementer", 2000, "root")
    join("root", "build", 1000)
    join("imp-b", "guild-implementer", 4000, "root")
    // One that started earlier but is heard of later.
    join("imp-a", "guild-implementer", 1500, "root")
    // Heard of by a deed first, then told its agent and parent.
    take({ type: "tool", id: "late", call: "c1", name: "read", state: "running", at: 5000 })
    join("late", "guild-implementer", 900, "root")
    // A session that turns out to have started earlier than first heard.
    take({ type: "session", id: "imp-b", title: "t", at: 1200 })
  })
})

describe("stable views", () => {
  /** A guildmaster and three implementers at work. */
  function party(): Model {
    const model = emptyModel()
    const join = (id: string, agent: string, at: number, parentID?: string) => {
      apply(model, { type: "session", id, agent, title: "t", at, ...(parentID ? { parentID } : {}) })
      apply(model, { type: "status", id, status: "busy", at })
    }
    join("root", "build", 1000)
    join("a", "guild-implementer", 2000, "root")
    join("b", "guild-implementer", 2100, "root")
    join("c", "guild-implementer", 2200, "root")
    return model
  }

  test("an unchanged adventurer keeps the same object; a changed one gets a new one", () => {
    const model = party()
    const first = viewsOf(model, 3000)
    const again = viewsOf(model, 3100, undefined, undefined, undefined, first)
    expect(again).not.toBe(first)
    for (let i = 0; i < first.length; i++) expect(again[i]).toBe(first[i] as (typeof first)[number])
    // b starts a deed: only b's view changes.
    apply(model, {
      type: "tool",
      id: "b",
      call: "c1",
      name: "edit",
      state: "running",
      at: 3200,
      input: { filePath: "x.ts" },
    })
    const later = viewsOf(model, 3300, undefined, undefined, undefined, again)
    const byId = (views: typeof first, id: string) => views.find((v) => v.id === id)
    expect(byId(later, "b")).not.toBe(byId(again, "b"))
    expect(byId(later, "b")?.tool).toBe("edit")
    for (const id of ["root", "a", "c"])
      expect(byId(later, id)).toBe(byId(again, id) as (typeof first)[number])
  })

  test("the store hands the scene the same objects across a quiet refresh", () => {
    const store = rushAt(12, 30_000)
    const before = store.views
    store.tick(101)
    expect(store.views).not.toBe(before)
    expect(store.views.every((view, i) => view === before[i])).toBe(true)
  })
})
