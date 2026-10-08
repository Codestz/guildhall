import { describe, expect, test } from "bun:test"
import { activityOf, applyAll, emptyModel, rootOf, subagentsOf } from "@guildhall/core"
import { Player, parties, party, rush, Script, sagaTale, solo, toEvents } from "../src/index.ts"

describe("simulated runs read like real ones", () => {
  test("same seed, same story", () => {
    expect(solo(7)).toEqual(solo(7))
    expect(solo(7)).not.toEqual(solo(8))
  })

  test("changes are in time order", () => {
    const changes = rush(12)
    for (let i = 1; i < changes.length; i++) expect(changes[i]!.at).toBeGreaterThanOrEqual(changes[i - 1]!.at)
  })

  test("the model sees a finished solo run", () => {
    const model = applyAll(emptyModel(), solo())
    const [master] = [...model.sessions.values()]
    expect(master?.status).toBe("done")
    expect(master?.entries.filter((e) => e.kind === "tool")).toHaveLength(6)
  })

  test("rush brings every role, including an outsider", () => {
    const agents = new Set(rush(12).flatMap((c) => (c.type === "session" && c.agent ? [c.agent] : [])))
    expect(agents.has("general")).toBe(true)
    expect(agents.size).toBe(7)
  })

  test("quests become subagents of the guildmaster", () => {
    const model = applyAll(emptyModel(), rush(5))
    const root = [...model.sessions.values()].find((s) => !s.parentID)!
    expect(subagentsOf(model, root.id)).toHaveLength(5)
  })

  test("a plea shows as waiting, then work resumes", () => {
    const script = new Script()
    const master = script.guildmaster("t")
    master.plea(1000)
    const changes = script.done()
    const waitingAt = changes.find((c) => c.type === "status" && c.status === "waiting")!.at
    const model = applyAll(
      emptyModel(),
      changes.filter((c) => c.at <= waitingAt),
    )
    expect(activityOf([...model.sessions.values()][0]!).kind).toBe("waiting")
  })
})

describe("party, the hero run", () => {
  const changes = party()
  const model = applyAll(emptyModel(), changes)
  const sessions = [...model.sessions.values()]

  test("runs 60–90 s", () => {
    const length = changes.at(-1)!.at - changes[0]!.at
    expect(length).toBeGreaterThan(60_000)
    expect(length).toBeLessThan(90_000)
  })

  test("has every moment the Bard ranks", () => {
    expect(changes.some((c) => c.type === "status" && c.status === "waiting")).toBe(true)
    expect(changes.some((c) => c.type === "tool" && c.state === "failed")).toBe(true)
    expect(changes.some((c) => c.type === "tool" && c.name === "webfetch")).toBe(true)
    expect(new Set(sessions.map((s) => s.agent)).size).toBeGreaterThanOrEqual(5)
  })

  test("ends with the whole party done", () => {
    expect(sessions.every((s) => s.status === "done")).toBe(true)
  })

  test("the fix is a resume: the query smith is called back, not replaced", () => {
    const smiths = sessions.filter((s) => s.agent === "guild-implementer")
    expect(smiths).toHaveLength(2)
    const resumed = smiths.find((s) => s.entries.filter((e) => e.kind === "prompt").length === 2)
    expect(resumed).toBeDefined()
    const finished = changes.filter((c) => c.type === "status" && c.id === resumed?.id && c.status === "idle")
    expect(finished.length).toBe(2)
  })

  test("three adventurers work at once", () => {
    const busy = (at: number) =>
      sessions.filter((s) => s.parentID && s.started <= at && (s.ended ?? Infinity) > at).length
    expect(Math.max(...changes.map((c) => busy(c.at)))).toBeGreaterThanOrEqual(3)
  })
})

describe("Player", () => {
  test("ticks release events in order and loop restarts", () => {
    const events = toEvents(solo(), "demo")
    const player = new Player(events, { loop: true })
    let seen = 0
    while (seen < events.length) seen += player.tick(500).events.length
    expect(seen).toBe(events.length)
    expect(player.tick(1_000_000).restarted).toBe(true)
  })

  test("seek returns everything up to the time", () => {
    const events = toEvents(solo(), "demo")
    const player = new Player(events)
    expect(player.seek(player.duration)).toHaveLength(events.length)
    expect(player.seek(0).length).toBeLessThan(events.length)
  })
})

describe("rush", () => {
  test("two quests fail as sessions; the second is called back and recovers", () => {
    const changes = rush(12)
    const failed = changes.filter((c) => c.type === "status" && c.status === "failed").map((c) => c.id)
    expect(new Set(failed).size).toBe(2)
    const model = applyAll(emptyModel(), changes)
    const statuses = failed.map((id) => model.sessions.get(id)?.status)
    expect(statuses).toEqual(["failed", "done"])
  })

  test("a crowd of 300 is 300 distinct quests that all end; one stays fallen, the retried one recovers", () => {
    const changes = rush(300)
    const model = applyAll(emptyModel(), changes)
    const root = [...model.sessions.values()].find((s) => !s.parentID)!
    const quests = [...model.sessions.values()].filter((s) => s.parentID === root.id)
    expect(quests).toHaveLength(300)
    expect(new Set(quests.map((s) => s.title)).size).toBe(300)
    expect(quests.filter((s) => s.status === "failed")).toHaveLength(1)
    expect(quests.every((s) => s.status === "done" || s.status === "failed")).toBe(true)
    expect(root.status).toBe("done")
  })
})

describe("parties: several conversations at once", () => {
  const changes = parties()
  const model = applyAll(emptyModel(), changes)
  const roots = [...model.sessions.values()].filter((s) => !s.parentID)

  test("three root sessions, started 0, 3 and 9 s in, each with its own adventurers", () => {
    expect(roots.map((s) => s.started)).toEqual([0, 3000, 9000])
    expect(roots.map((s) => subagentsOf(model, s.id).length)).toEqual([7, 0, 8])
  })

  test("their work overlaps: two guildmasters are busy at the same time", () => {
    const busy = (t: number) =>
      roots.filter((r) => {
        const live = applyAll(
          emptyModel(),
          changes.filter((c) => c.at <= t),
        ).sessions.get(r.id)
        return live?.status === "running"
      }).length
    expect(busy(12_000)).toBeGreaterThanOrEqual(2)
  })

  test("the quick fix is done early and the long one runs past two minutes", () => {
    const ends = roots.map((r) => r.ended ?? 0)
    expect(ends[1]).toBeLessThan(25_000)
    expect(changes.at(-1)?.at ?? 0).toBeGreaterThan(121_000)
    expect(roots.every((r) => r.status === "done")).toBe(true)
  })
})

describe("the Saga, the showcase's story", () => {
  const tale = sagaTale()
  const model = applyAll(emptyModel(), tale.changes)
  const roots = [...model.sessions.values()].filter((s) => !s.parentID)

  test("changes in time order; chapters and the clock's hours in order too", () => {
    const { changes, chapters, hours } = tale
    for (let i = 1; i < changes.length; i++) expect(changes[i]!.at).toBeGreaterThanOrEqual(changes[i - 1]!.at)
    expect(chapters.map((c) => c.at)).toEqual([...chapters.map((c) => c.at)].sort((a, b) => a - b))
    expect(hours.map((h) => h.hour)).toEqual([...hours.map((h) => h.hour)].sort((a, b) => a - b))
  })

  test("two conversations, both finished; everyone sent out comes back or is called back", () => {
    expect(roots).toHaveLength(2)
    expect([...model.sessions.values()].every((s) => s.status === "done")).toBe(true)
  })

  test("a context that goes back every step: tens of thousands of tokens a step, millions a run", () => {
    const main = roots[0]!
    const party = [...model.sessions.values()].filter((s) => rootOf(model, s.id) === main.id)
    const tokens = party.reduce((sum, s) => sum + s.tokens, 0)
    expect(tokens).toBeGreaterThan(5_000_000)
    expect(party.reduce((sum, s) => sum + s.cost, 0)).toBeLessThan(10)
  })
})
