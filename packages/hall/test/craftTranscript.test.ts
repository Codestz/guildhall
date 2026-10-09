import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { craftOf, deedCraft } from "@guildhall/core"
import { sampleFor } from "../src/audio/samples.ts"
import { legendOf } from "../src/guild/legends.ts"
import type { Moment } from "../src/guild/moments.ts"
import { type AdventurerView, GuildStore, type ScenarioId } from "../src/guild/store.ts"
import { listen, Narrator } from "../src/guild/story.ts"
import { verbOf } from "../src/hud/format.ts"
import { sigilOf, sigilOfCraft } from "../src/scene/sigilBoard.ts"

/**
 * One deed taxonomy (ADR 0011): the surfaces that say what a deed is — the chip's verb and glyph, the
 * sigil, the work look (clip, effect, walk), the spot sound, the captions and the Legends — played
 * through the scenario stories and compared with a committed transcript. The transcript was
 * recorded before the five tool classifiers became lookups from `Craft`, so a match is the proof
 * that nothing a story shows, says or sounds like moved. `UPDATE=1` re-records it (say why).
 */
const FIXTURE = join(import.meta.dir, "fixtures/craftSurfaces.json")
const STEP = 100
/** The Saga is long: a sample of its opening acts is plenty of deeds. */
const SAGA_SAMPLE = 0.35

/**
 * The one deed whose surfaces changed, on purpose. The chip used to look for a test runner in its
 * 28-character line (`git bisect skip && git bise…`), so this call read as running there while the
 * captions and Legends, reading the whole command, already told it as a test ("Tests failed: …").
 * Read once from the whole command, it is a test everywhere. Lines from the recording before → now.
 */
const INTENDED: Record<string, [before: string, now: string][]> = {
  saga: [
    [
      "working|bash|bash · git bisect skip && git bise…|false => running run | run | Use_Item/steam/-",
      "working|bash|bash · git bisect skip && git bise…|false => testing test | test | Use_Item/steam/-",
    ],
    ["deed-failed bash call_sim0217 => - | - | run", "deed-failed bash call_sim0217 => - | - | test"],
  ],
}

function amended(scenario: string, lines: readonly string[]): string[] {
  const swaps = new Map(INTENDED[scenario] ?? [])
  return lines.map((line) => swaps.get(line) ?? line)
}

type Transcript = {
  views: string[]
  moments: string[]
  captions: string[]
  legends: unknown[]
}

function chip(v: AdventurerView): string {
  const { verb, glyph } = verbOf(v)
  const look = v.look ? `${v.look.clip}/${v.look.effect}/${v.look.goTo ?? "-"}` : "-"
  return `${v.phase}|${v.tool ?? "-"}|${v.doing}|${v.thinking} => ${verb} ${glyph} | ${sigilOf(v) ?? "-"} | ${look}`
}

function play(scenario: ScenarioId): Transcript {
  const store = new GuildStore()
  store.load(scenario)
  let clock = 0
  const narrator = new Narrator({ session: (id) => store.sessionOf(id) })
  listen(store.moments, narrator, () => clock)
  const views = new Set<string>()
  const moments: string[] = []
  const captions: string[] = []
  /** The views as the sigil board last synced them (a frame behind the moments, as in the scene). */
  let synced = new Map<string, AdventurerView>()
  store.moments.on((m: Moment) => {
    if (m.kind !== "deed" && m.kind !== "deed-failed") return
    const view = store.views.find((v) => v.id === m.id)
    const entry = store.sessionOf(m.id)?.entries.find((e) => e.kind === "tool" && e.call === m.call)
    // As audio/SoundStage.tsx infoOf hears it: the finished call's craft.
    const craft = entry?.kind === "tool" ? deedCraft(entry) : craftOf(m.tool)
    const sound = m.kind === "deed" ? sigilOfCraft(craft) : "-"
    const sample = sampleFor(m.kind, craft, { station: view?.station, site: view?.site })
    // As scene/sigilBoard.ts take() pops it: the craft last synced, when it is the same tool.
    const last = synced.get(m.id)
    const pop = sigilOfCraft((last && m.tool === last.tool ? last.craft : undefined) ?? craftOf(m.tool))
    moments.push(`${m.kind} ${m.tool} ${m.call} => ${sound} | ${sample ?? "-"} | ${pop}`)
  })
  const end = scenario === "saga" ? store.duration * SAGA_SAMPLE : store.duration - 50
  while (store.time < end) {
    store.tick(STEP)
    clock += STEP
    for (const v of store.views) views.add(chip(v))
    synced = new Map(store.views.map((v) => [v.id, v]))
    for (let caption = narrator.next(clock); caption; caption = narrator.next(clock))
      captions.push(caption.text)
  }
  const legends = store.parties.map((p) => legendOf(store.moments.history, store.party(p.id)) ?? null)
  return { views: [...views].sort(), moments, captions, legends }
}

const SCENARIOS: ScenarioId[] = ["party", "rush", "saga", "seas", "factions"]

describe("craft surfaces: the scenario stories show, say and sound as they did", () => {
  const recorded: Record<string, Transcript> = existsSync(FIXTURE)
    ? JSON.parse(readFileSync(FIXTURE, "utf8"))
    : {}
  const now: Record<string, Transcript> = {}
  for (const scenario of SCENARIOS) {
    test(scenario, () => {
      now[scenario] = play(scenario)
      if (process.env.UPDATE === "1") return
      const before = recorded[scenario]
      expect(before).toBeDefined()
      const after = now[scenario]
      expect(after.views).toEqual(amended(scenario, before?.views ?? []))
      expect(after.moments).toEqual(amended(scenario, before?.moments ?? []))
      expect(after.captions).toEqual(before?.captions as string[])
      expect(after.legends).toEqual(before?.legends as unknown[])
    })
  }
  test("covers deeds of every kind", () => {
    if (process.env.UPDATE === "1") writeFileSync(FIXTURE, `${JSON.stringify(now, null, 1)}\n`)
    const all = Object.values(now).flatMap((t) => t.views)
    for (const verb of ["reading", "editing", "searching", "testing", "running", "consulting", "dispatching"])
      expect(all.some((line) => line.includes(`=> ${verb} `))).toBe(true)
  })
})
