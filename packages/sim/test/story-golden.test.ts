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

/** One place the port says something else than V1 did, on purpose: the path, V1's value, V2's. */
interface Departure {
  at: (string | number)[]
  v1: unknown
  v2: unknown
}

type Json = Record<string | number, unknown>

const valueAt = (root: unknown, at: readonly (string | number)[]): unknown =>
  at.reduce<unknown>((node, key) => (node as Json | undefined)?.[key], root)

function setAt(root: unknown, at: readonly (string | number)[], value: unknown): void {
  const parent = valueAt(root, at.slice(0, -1)) as Json
  parent[at[at.length - 1] as string | number] = value
}

/** Every leaf where `ours` differs from `v1` (a list of another length, or another kind, whole). */
function departuresOf(v1: unknown, ours: unknown, at: (string | number)[] = []): Departure[] {
  if (JSON.stringify(v1) === JSON.stringify(ours)) return []
  const both = (x: unknown) => typeof x === "object" && x !== null
  if (both(v1) && both(ours) && Array.isArray(v1) === Array.isArray(ours)) {
    if (Array.isArray(v1) && v1.length !== (ours as unknown[]).length) return [{ at, v1, v2: ours }]
    const keys = new Set([...Object.keys(v1 as object), ...Object.keys(ours as object)])
    if ([...keys].some((k) => !(k in (v1 as object)) || !(k in (ours as object))))
      return [{ at, v1, v2: ours }]
    return [...keys].flatMap((k) =>
      departuresOf((v1 as Json)[k], (ours as Json)[k], [...at, Array.isArray(v1) ? Number(k) : k]),
    )
  }
  return [{ at, v1, v2: ours }]
}

describe("the story tells V1's sessions as V1 told them", () => {
  for (const name of NAMES) {
    test(name, async () => {
      const v1 = await Bun.file(join(STORY_DIR, `${name}.story.json`)).json()
      const ours = told(await input(name))
      // V2's chosen departures from what V1 said (`<name>.departures.json`, fixtures/story/README.md):
      // each names a place in the golden, what V1 said there and what V2 says instead.
      const file = Bun.file(join(STORY_DIR, `${name}.departures.json`))
      if (process.env.GOLDEN_DEPARTURES === "write") {
        const found = departuresOf(v1, ours)
        if (found.length) await Bun.write(file, `${JSON.stringify(found, null, 1)}\n`)
      }
      const departures: Departure[] = (await file.exists()) ? await file.json() : []
      const golden = structuredClone(v1)
      for (const d of departures) {
        // the golden still says what the departure says V1 said: a departure never hides a drift
        expect({ at: d.at, v1: valueAt(golden, d.at) }).toEqual({ at: d.at, v1: d.v1 })
        setAt(golden, d.at, d.v2)
      }
      // Piece by piece, so a mismatch names what drifted.
      for (const key of ["start", "told", "sessions", "legend", "markdown", "recap", "renown", "captions"])
        expect({ [key]: ours[key] }).toEqual({ [key]: golden[key] })
    })
  }

  test("the fixtures are stories worth telling: chapters, renown, the sea, a hero", async () => {
    const saga = told(await input("saga"))
    expect(saga.legend.chapters.length).toBeGreaterThan(15)
    // its second root session is the second guildmaster, by name
    expect(saga.told.some((m: StoryMoment) => m.title === "Guildmaster II")).toBe(true)
    expect(saga.renown.length).toBeGreaterThan(2)
    expect(saga.recap.hero.label).toBe("The quest is done")
    const seas = told(await input("seas"))
    expect(seas.told.some((m: StoryMoment) => m.kind === "sea-release")).toBe(true)
    // OpenCode's own `explore` agent is no roster role: a Wanderer.
    expect(told(await input("v2")).legend.chapters.map((c: { who: string }) => c.who)).toEqual(["Wanderer"])
  })
})
