import { describe, expect, test } from "bun:test"
import {
  activityOf,
  applyAll,
  districtMap,
  districtOf,
  emptyModel,
  heroes,
  parties,
  party,
  RELEASE_TAIL_MS,
  rehome,
  rootOf,
  rush,
  Script,
  STORY_IDS,
  seas,
  solo,
  story,
  subagentsOf,
} from "../src/index.ts"
import { guildhallHall, played, unitsOf } from "./stories-fixtures.ts"

/** V1's sim tests (main:packages/sim/test), ported: the told stories read like real runs. */
describe("simulated runs read like real ones", () => {
  test("same seed, same story", () => {
    expect(solo(7)).toEqual(solo(7))
    expect(solo(7)).not.toEqual(solo(8))
  })

  test("changes are in time order", () => {
    const changes = rush(12)
    for (let i = 1; i < changes.length; i++)
      expect(changes[i]?.at ?? 0).toBeGreaterThanOrEqual(changes[i - 1]?.at ?? 0)
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
    const root = [...model.sessions.values()].find((s) => !s.parentID)
    expect(subagentsOf(model, root?.id ?? "")).toHaveLength(5)
  })

  test("a plea shows as waiting, then work resumes", () => {
    const script = new Script()
    script.guildmaster("t").plea(1000)
    const changes = script.done()
    const waitingAt = changes.find((c) => c.type === "status" && c.status === "waiting")?.at ?? 0
    const model = applyAll(
      emptyModel(),
      changes.filter((c) => c.at <= waitingAt),
    )
    const [s] = [...model.sessions.values()]
    expect(s && activityOf(s).kind).toBe("waiting")
  })

  test("party: 60–90 s, five roles at least, a plea and a failure, all done, three at once", () => {
    const changes = party()
    const length = (changes.at(-1)?.at ?? 0) - (changes[0]?.at ?? 0)
    expect(length).toBeGreaterThan(60_000)
    expect(length).toBeLessThan(90_000)
    const sessions = [...applyAll(emptyModel(), changes).sessions.values()]
    expect(changes.some((c) => c.type === "status" && c.status === "waiting")).toBe(true)
    expect(changes.some((c) => c.type === "tool" && c.state === "failed")).toBe(true)
    expect(new Set(sessions.map((s) => s.agent)).size).toBeGreaterThanOrEqual(5)
    expect(sessions.every((s) => s.status === "done")).toBe(true)
    const busy = (at: number) =>
      sessions.filter((s) => s.parentID && s.started <= at && (s.ended ?? Infinity) > at).length
    expect(Math.max(...changes.map((c) => busy(c.at)))).toBeGreaterThanOrEqual(3)
  })

  test("rush: a crowd of 300 all end; one stays fallen, the retried one recovers", () => {
    const model = applyAll(emptyModel(), rush(300))
    const root = [...model.sessions.values()].find((s) => !s.parentID)
    const quests = [...model.sessions.values()].filter((s) => s.parentID === root?.id)
    expect(quests).toHaveLength(300)
    expect(quests.filter((s) => s.status === "failed")).toHaveLength(1)
    expect(root?.status).toBe("done")
  })

  test("parties: three conversations, started 0, 3 and 9 s in", () => {
    const model = applyAll(emptyModel(), parties())
    const roots = [...model.sessions.values()].filter((s) => !s.parentID)
    expect(roots.map((s) => s.started)).toEqual([0, 3000, 9000])
    expect(roots.map((s) => subagentsOf(model, s.id).length)).toEqual([7, 0, 8])
    expect(roots.every((r) => rootOf(model, r.id) === r.id)).toBe(true)
  })

  test("seas: a PR opened then merged, CI red then green, a release last, and a tail after it", () => {
    const { changes, sea } = seas()
    const kinds = sea.map((e) => (e.kind === "ci" ? `ci:${e.state}` : e.kind))
    expect(kinds.indexOf("pr_opened")).toBeLessThan(kinds.indexOf("pr_merged"))
    expect(kinds.indexOf("ci:failed")).toBeLessThan(kinds.indexOf("ci:passed"))
    expect(kinds.at(-1)).toBe("release")
    const release = sea.find((e) => e.kind === "release")
    expect((changes.at(-1)?.at ?? 0) - (release?.at ?? 0)).toBeGreaterThanOrEqual(RELEASE_TAIL_MS)
    expect(new Set(sea.map((e) => e.id)).size).toBe(sea.length)
  })
})

describe("story(id, opts)", () => {
  test("every story the site lists is told, deterministic, in order, with seq from 1", () => {
    for (const id of STORY_IDS) {
      const a = story(id)
      expect(a).toEqual(story(id))
      expect(a.events.length).toBeGreaterThan(0)
      expect(a.events.map((e) => e.seq)).toEqual(a.events.map((_, i) => i + 1))
      expect(a.events.every((e) => e.guild === `story:${id}` && e.v === 1)).toBe(true)
      for (let i = 1; i < a.events.length; i++)
        expect(a.events[i]?.change.at ?? 0).toBeGreaterThanOrEqual(a.events[i - 1]?.change.at ?? 0)
      expect(a.duration).toBeGreaterThan(0)
    }
    expect(story("saga", { seed: 2 })).not.toEqual(story("saga"))
    expect(story("rush", { count: 30 }).events.filter((e) => e.change.type === "session")).toHaveLength(31)
  })

  test("`start` moves every time, `guild` names the guild, `repo.name` the sea's repo", () => {
    const a = story("seas")
    const b = story("seas", { start: 1_700_000_000_000, guild: "demo", repo: { name: "Codestz/guildhall" } })
    expect(b.events.map((e) => e.change.at - 1_700_000_000_000)).toEqual(a.events.map((e) => e.change.at))
    expect(b.events[0]?.guild).toBe("demo")
    expect(b.seas.every((e) => e.repo === "Codestz/guildhall" && !e.id.includes("acme"))).toBe(true)
    expect(b.duration).toBe(a.duration)
  })
})

describe("rehome: a story's paths on another repo's units", () => {
  test("a path's district is its first two folders; a file at the root has none", () => {
    expect(districtOf("packages/world/src/hex/heroes.ts")).toBe("packages/world")
    expect(districtOf("src/users/routes.ts")).toBe("src/users")
    expect(districtOf("src/mod3")).toBe("src/mod3")
    expect(districtOf("migrations/0042.sql")).toBe("migrations")
    expect(districtOf("CHANGELOG.md")).toBe("")
  })

  test("a district the repo has stays; the rest take the biggest units in story order, content to its kind", () => {
    const units = [
      { name: "src", files: 300 },
      { name: "lib", files: 120 },
      { name: "docs", files: 40 },
      { name: "packages/sim", files: 20 },
      { name: "/", files: 9 },
      { name: "packages/*", files: 3 },
    ]
    const map = districtMap(
      [
        "packages/sim/a.ts",
        "app/users/x.ts",
        "docs/plan/p.md",
        "app/auth/y.ts",
        "migrations/1.sql",
        "README.md",
      ],
      units,
    )
    expect([...map]).toEqual([
      ["packages/sim", "packages/sim"],
      ["app/users", "src"],
      ["docs/plan", "docs"],
      ["app/auth", "lib"],
      ["migrations", "src"],
    ])
    // what matters most goes first
    expect(districtMap(["a/x/1.ts", "b/y/2.ts"], units, ["b/y"]).get("b/y")).toBe("src")
  })

  test("paths move by prefix, the district's name moves in the words; nothing else changes", () => {
    const script = new Script()
    const k = script.guildmaster("Fix packages/world's sweep")
    k.deed("edit", { filePath: "packages/world/src/a.ts" }, 100)
    k.deed("bash", { command: "bun test packages/world" }, 100, { output: "✗ packages/world/test/a.test.ts" })
    k.deed("read", { filePath: "README.md" }, 100)
    k.finish("packages/worldly is not packages/world")
    const before = script.done()
    const after = rehome(before, [{ name: "packages/hall", files: 9 }])
    const tool = after.filter((c) => c.type === "tool" && c.state === "running")
    expect(tool.map((c) => (c.type === "tool" ? c.input : undefined))).toEqual([
      { filePath: "packages/hall/src/a.ts" },
      { command: "bun test packages/hall" },
      { filePath: "README.md" },
    ])
    const out = after.find((c) => c.type === "tool" && c.output)
    expect(out?.type === "tool" && out.output).toBe("✗ packages/hall/test/a.test.ts")
    expect(after.find((c) => c.type === "session")).toMatchObject({ title: "Fix packages/hall's sweep" })
    const reply = after.findLast((c) => c.type === "reply")
    expect(reply?.type === "reply" && reply.text).toBe("packages/worldly is not packages/hall")
    expect(after.map((c) => [c.type, c.at])).toEqual(before.map((c) => [c.type, c.at]))
    expect(rehome(before, [])).toEqual(before)
  })

  test("on Guildhall's island V1's party spreads over places instead of crowding the capital", async () => {
    const hall = await guildhallHall()
    const places = (s: ReturnType<typeof story>) => {
      const log = played(s, hall.binding.placeOf)
      const seen = new Set<string>()
      for (const ev of log.events)
        if (ev.kind === "actor.deed") {
          const world = log.stateAt(ev.at)
          for (const h of heroes(world, ev.at)) if (h.place !== undefined) seen.add(hall.unitOf(h.place))
        }
      return seen
    }
    expect(places(story("party")).size).toBe(1)
    expect(places(story("party", { repo: { units: unitsOf(hall) } })).size).toBeGreaterThanOrEqual(2)
  })
})
