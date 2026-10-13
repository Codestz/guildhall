import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { adaptV1, adaptV2, type Change, type SeaEvent } from "@guildhall/core"
import { recorded } from "../../core/test/events/fixtures.ts"
import { legendMarkdown, legendOf, recapOf, renownOf, type StoryMoment, tellAll } from "../src/index.ts"
import { captionsOf, STORY_DIR, type StoryName, storyInput } from "./story-fixtures.ts"

/**
 * The story's golden: V1's own code on main (its Intake, legendOf, recapOf, renownOf and Narrator,
 * driven headless) told seven sessions, and the port tells them the same, field for field.
 *
 *   v1, v2                         core's recorded OpenCode runs (one explorer sent out)
 *   party, saga, seas, rush, solo  V1's told stories (main:packages/sim), as changes and GitHub sea
 *
 * `fixtures/story/<name>.story.json` holds what V1 said; fixtures/story/README.md how it was made.
 * The driver both sides share: every change in order (start = the first change's `at`), the sea
 * sighted as run time reaches it, the party under the guildmaster in join order; the narrator hears
 * each moment live at its run time and is asked every 50 ms until 30 s after the last.
 */

const NAMES = ["v1", "v2", "party", "saga", "seas", "rush", "solo"] as const

async function input(name: (typeof NAMES)[number]): Promise<{ changes: Change[]; sea: SeaEvent[] }> {
  if (name === "v1" || name === "v2") {
    const version = name === "v1" ? 1 : 2
    const { events } = await recorded(version)
    const translate = version === 1 ? adaptV1() : adaptV2()
    return { changes: events.flatMap((line) => translate.event(line.event, line.at)), sea: [] }
  }
  return storyInput(name as StoryName)
}

function told(source: { changes: Change[]; sea: SeaEvent[] }) {
  const teller = tellAll(source.changes, source.sea)
  const sessions = teller.party()
  const history = teller.history
  const legend = legendOf(history, sessions)
  const lookup = { session: (id: string) => teller.session(id) }
  const recap = legend
    ? recapOf({ legend, history, sessions, lookup, guild: "Codestz/guildhall", story: "A party" })
    : undefined
  // JSON's view of it: V1's golden went through JSON, so `undefined` fields are simply absent.
  return JSON.parse(
    JSON.stringify({
      start: teller.start,
      told: history,
      sessions: sessions.map((s) => s.id),
      legend,
      markdown: legend ? legendMarkdown(legend) : undefined,
      recap,
      renown: renownOf(history, sessions),
      captions: captionsOf(teller),
    }),
  )
}

describe("the story tells V1's sessions as V1 told them", () => {
  for (const name of NAMES) {
    test(name, async () => {
      const golden = await Bun.file(join(STORY_DIR, `${name}.story.json`)).json()
      const ours = told(await input(name))
      // Piece by piece, so a mismatch names what drifted.
      for (const key of ["start", "told", "sessions", "legend", "markdown", "recap", "renown", "captions"])
        expect({ [key]: ours[key] }).toEqual({ [key]: golden[key] })
    })
  }

  test("the fixtures are stories worth telling: chapters, renown, the sea, a hero", async () => {
    const saga = told(await input("saga"))
    expect(saga.legend.chapters.length).toBeGreaterThan(15)
    expect(saga.renown.length).toBeGreaterThan(2)
    expect(saga.recap.hero.label).toBe("The quest is done")
    const seas = told(await input("seas"))
    expect(seas.told.some((m: StoryMoment) => m.kind === "sea-release")).toBe(true)
    // OpenCode's own `explore` agent is no roster role: a Wanderer.
    expect(told(await input("v2")).legend.chapters.map((c: { who: string }) => c.who)).toEqual(["Wanderer"])
  })
})
