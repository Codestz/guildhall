import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { factions, parties, party, rush, Script, seas, solo, story } from "../src/index.ts"
import { STORIES_DIR, v1 } from "./stories-fixtures.ts"
import { storyInput } from "./story-fixtures.ts"

/**
 * The DSL's golden: V1's own sim (main:packages/sim = legacy/packages/sim) told these stories, and the
 * port tells them the same, change for change (fixtures/stories/README.md says how they were made).
 */

/** Every verb of the DSL once, with a model turn and an economy of its own (the same script as V1's run). */
function dsl() {
  const s = new Script(5, {
    turnMs: 3000,
    economy: (step, ms) => ({ tokens: 1000 + step * 10, cost: ms / 1e6 }),
  })
  const m = s.guildmaster("t", 100)
  m.wait(500).think("x", 900)
  m.deed("read", { filePath: "a.ts" }, 400, { batch: true })
  m.deed("read", { filePath: "b.ts" }, 400, { batch: true })
  m.deed("bash", { command: "bun test" }, 1200, { fail: "1 failed", summary: "exit 1", output: "✗ a" })
  const c = m.quest("guild-explorer", "map", (k) => {
    k.deed("grep", { pattern: "p" }, 300).plea(2000).finish("ok", 400)
  })
  const bg = m.quest(
    "guild-implementer",
    "bg",
    (k) => k.deed("edit", { filePath: "c.ts" }, 900).fail("nope"),
    {
      wait: false,
    },
  )
  m.waitFor(bg)
  m.resume(c, "again", (k) => k.deed("read", { filePath: "d.ts" }).finish("ok2"))
  m.prompt("more").plea().finish("done")
  s.chapter(0, { numeral: "I", title: "A", tagline: "b", hour: 6 })
  return { changes: s.done(), chapters: s.chapters, picks: [s.pick([1, 2, 3]), s.jitter(1000)] }
}

const same = (a: unknown, b: unknown) => expect(JSON.parse(JSON.stringify(a))).toEqual(b as never)

describe("the Script DSL, golden against V1", () => {
  test("every verb: session, prompt, think, deed (batch, fail, output), quest, background quest, waitFor, resume, plea, finish, fail, chapter, pick", async () => {
    same(dsl(), await v1("dsl"))
  })

  const cases: [string, () => unknown][] = [
    ["solo-1", () => solo(1)],
    ["solo-7", () => solo(7)],
    ["party-1", () => party(1)],
    ["party-3", () => party(3)],
    ["parties-1", () => parties(1)],
    ["rush-12-1", () => rush(12, 1)],
    ["rush-5-2", () => rush(5, 2, [1])],
    ["seas-1", () => seas(1)],
    ["seas-3", () => seas(3)],
    ["factions-1", () => factions(1)],
  ]
  for (const [name, make] of cases) test(name, async () => same(make(), await v1(name)))

  test("a crowd of 300, by its hash", async () => {
    const want = (await Bun.file(join(STORIES_DIR, "rush-300-1.sha256")).text()).trim()
    const hasher = new Bun.CryptoHasher("sha256")
    hasher.update(JSON.stringify(rush(300, 1)))
    expect(hasher.digest("hex")).toBe(want)
  })

  test("the stories V1's hall loaded (fixtures/story) are the ones `story` tells, with no repo", async () => {
    for (const name of ["solo", "party", "rush", "seas"] as const) {
      const input = await storyInput(name)
      const told = story(name)
      same(
        told.events.map((e) => e.change),
        input.changes,
      )
      if (name === "seas") same(told.seas, input.sea)
    }
  })
})
