import { describe, expect, test } from "bun:test"
import { activityOf, applyAll, emptyModel, subagentsOf } from "@guildhall/core"
import { Player, party, rush, Script, solo, toEvents } from "../src/index.ts"

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
