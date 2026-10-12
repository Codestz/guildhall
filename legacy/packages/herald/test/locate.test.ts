import { describe, expect, test } from "bun:test"
import { createLocationFilter } from "../src/locate.ts"

const PROJECT = "/Users/me/project"
const HOME = "/Users/me"
const created = (id: string, directory: string) => ({ location: { directory }, data: { sessionID: id } })
const usage = (id: string) => ({ data: { sessionID: id } })
const started = (id: string) => ({ durable: { aggregateID: id }, data: { sessionID: id } })

describe("which events are this project's", () => {
  test("a located event is kept here and nowhere else", () => {
    const project = createLocationFilter(PROJECT)
    const home = createLocationFilter(HOME)
    expect(project(created("ses_a", PROJECT))).toBe(true)
    expect(home(created("ses_a", PROJECT))).toBe(false)
  })

  test("status and usage without a location follow their session's project (no phantom guild)", () => {
    const project = createLocationFilter(PROJECT)
    const home = createLocationFilter(HOME)
    for (const filter of [project, home]) filter(created("ses_a", PROJECT))
    expect(project(usage("ses_a"))).toBe(true)
    expect(project(started("ses_a"))).toBe(true)
    expect(home(usage("ses_a"))).toBe(false)
    expect(home(started("ses_a"))).toBe(false)
  })

  test("subagent sessions are ours once created here", () => {
    const project = createLocationFilter(PROJECT)
    project(created("ses_parent", PROJECT))
    project(created("ses_child", PROJECT))
    expect(project(usage("ses_child"))).toBe(true)
  })

  test("events with neither a location nor a session, or of unknown sessions, are dropped", () => {
    const project = createLocationFilter(PROJECT)
    expect(project({})).toBe(false)
    expect(project(usage("ses_unknown"))).toBe(false)
  })
})
