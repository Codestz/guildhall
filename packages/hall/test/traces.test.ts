import { describe, expect, test } from "bun:test"
import { applyAll, type Change, emptyModel, type Session } from "@guildhall/core"
import { party, rush, Script } from "@guildhall/sim"
import { CAPACITY, heapSlot, logSlot, NO_TRACES, shown, TraceLedger, tracesOf } from "../src/guild/traces.ts"

function sessions(changes: readonly Change[], until = Number.POSITIVE_INFINITY): Session[] {
  return [
    ...applyAll(
      emptyModel(),
      changes.filter((change) => change.at <= until),
    ).sessions.values(),
  ]
}

/** A guildmaster that sends one `role` out to do `deeds` (tool, failed?). */
function quest(role: string, deeds: readonly (readonly [string, boolean?])[]): Change[] {
  const script = new Script(5)
  const master = script.guildmaster("Do it")
  master.quest(role, "One quest", (child) => {
    for (const [tool, fail] of deeds) child.deed(tool, { path: "src" }, 500, fail ? { fail: "boom" } : {})
    child.finish("done")
  })
  master.finish("all done")
  return script.done()
}

describe("tracesOf", () => {
  test("an empty guild leaves nothing", () => {
    expect(tracesOf([])).toEqual(NO_TRACES)
  })

  test("explorers' searches pile logs; their reads don't", () => {
    const traces = tracesOf(sessions(quest("guild-explorer", [["grep"], ["glob"], ["read"], ["list"]])))
    expect(traces.logs).toBe(3)
    expect(traces.fish + traces.stones + traces.books + traces.hits).toBe(0)
  })

  test("researchers' webfetches land fish", () => {
    const traces = tracesOf(sessions(quest("guild-researcher", [["webfetch"], ["read"], ["websearch"]])))
    expect(traces.fish).toBe(2)
  })

  test("a stranger's deeds at the quarry each break a stone; failed deeds don't", () => {
    const traces = tracesOf(sessions(quest("general", [["bash"], ["read"], ["bash", true]])))
    expect(traces.stones).toBe(2)
  })

  test("the librarian stacks a book per finished deed", () => {
    const traces = tracesOf(sessions(quest("guild-librarian", [["context7_query-docs"], ["read"]])))
    expect(traces.books).toBe(2)
  })

  test("verifier runs hit the targets; any failure is a miss", () => {
    const traces = tracesOf(
      sessions(quest("guild-verifier", [["bash"], ["bash", true], ["read", true], ["read"]])),
    )
    expect(traces.hits).toBe(1)
    expect(traces.misses).toBe(2)
  })

  test("the guildmaster and the keep's roles leave nothing", () => {
    const traces = tracesOf(sessions(quest("guild-architect", [["grep"], ["webfetch"], ["bash"]])))
    expect(traces).toEqual(NO_TRACES)
  })

  test("piles only grow as the run goes on (a replay agrees with itself)", () => {
    const changes = rush(12)
    const end = changes.at(-1)?.at ?? 0
    let last = NO_TRACES
    for (let t = 0; t <= end; t += 2000) {
      const now = tracesOf(sessions(changes, t))
      for (const key of Object.keys(now) as (keyof typeof now)[])
        expect(now[key]).toBeGreaterThanOrEqual(last[key])
      last = now
    }
    expect(last.logs + last.stones + last.fish + last.books + last.hits).toBeGreaterThan(10)
  })

  test("the party leaves a verifier miss (the off-by-one) and a hit (the re-verify)", () => {
    const traces = tracesOf(sessions(party()))
    expect(traces.misses).toBe(1)
    expect(traces.hits).toBe(1)
  })
})

describe("TraceLedger", () => {
  test("keeps traces of sessions that left the cast", () => {
    const all = sessions(quest("guild-explorer", [["grep"], ["glob"]]))
    const byId = new Map(all.map((s) => [s.id, s]))
    const ledger = new TraceLedger()
    expect(ledger.update(byId.keys(), (id) => byId.get(id)).logs).toBe(2)
    // The explorer went home: no longer in the views, still in the model.
    expect(ledger.update([], (id) => byId.get(id)).logs).toBe(2)
  })

  test("forgets everything when the model is rebuilt (seek, new scenario)", () => {
    const all = sessions(quest("guild-explorer", [["grep"]]))
    const byId = new Map(all.map((s) => [s.id, s]))
    const ledger = new TraceLedger()
    ledger.update(byId.keys(), (id) => byId.get(id))
    expect(ledger.update([], () => undefined)).toEqual(NO_TRACES)
  })
})

describe("piles", () => {
  test("are capped", () => {
    expect(shown({ ...NO_TRACES, logs: 500 }).logs).toBe(CAPACITY.logs)
  })

  test("never put two traces in the same place", () => {
    for (const slot of [logSlot, heapSlot]) {
      const seen = new Set<string>()
      for (let i = 0; i < 21; i++) {
        const [x, y, z] = slot(i)
        const key = `${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(1)}`
        expect(seen.has(key)).toBe(false)
        seen.add(key)
      }
    }
  })

  test("log rows rest on the row below", () => {
    expect(logSlot(0)[1]).toBeLessThan(logSlot(6)[1])
    expect(logSlot(20)[1]).toBeGreaterThan(logSlot(19)[1] - 0.001)
  })
})
