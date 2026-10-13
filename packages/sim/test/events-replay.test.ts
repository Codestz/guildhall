import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { adaptV1, adaptV2, type Change, type GuildEvent } from "@guildhall/core"
import { hexIsland, hexZones, landTiles } from "@guildhall/world"
import { recorded } from "../../core/test/events/fixtures.ts"
import {
  bindPlaces,
  EventLog,
  flush,
  GONE_MS,
  heroes,
  type Moment,
  normalize,
  normalizer,
  placeSpecs,
  unitsAt,
  type WorldEvent,
} from "../src/index.ts"
import { chronicle } from "./repo-fixtures.ts"

/** V1's recorded runs (core's fixtures) and, when this machine has one, a real guild chronicle, replayed. */

async function changesOf(version: 1 | 2): Promise<Change[]> {
  const { events } = await recorded(version)
  const translate = version === 1 ? adaptV1() : adaptV2()
  return events.flatMap((line) => translate.event(line.event, line.at))
}

const wire = (changes: readonly Change[]): GuildEvent[] =>
  changes.map((change, i) => ({ v: 1, guild: "fixture", seq: i + 1, change }))

describe("replaying V1's recorded runs", () => {
  for (const version of [1, 2] as const) {
    test(`OpenCode ${version}: the guildmaster and its explorer, every deed V1 counted`, async () => {
      const ctx = normalizer()
      const log = new EventLog()
      for (const ev of wire(await changesOf(version))) log.append(...normalize(ev, ctx))
      const golden = (await Bun.file(
        join(import.meta.dir, "fixtures", `moments-v${version}.json`),
      ).json()) as Moment[]
      const count = (kinds: string[]) => golden.filter((m) => kinds.includes(m.kind)).length
      const made = (kind: WorldEvent["kind"]) => log.events.filter((e) => e.kind === kind).length
      expect(made("actor.deed")).toBe(count(["deed", "deed-failed"]))
      expect(made("actor.loot")).toBe(count(["loot"]))
      expect(made("actor.quest")).toBe(count(["quest"]))

      const cast = heroes(log.head)
      expect(cast).toHaveLength(2)
      const [root, scout] = cast
      expect(root).toMatchObject({ root: true, name: "Guildmaster", body: "knight", status: "done" })
      expect(scout).toMatchObject({ root: false, parent: root?.id, status: "done" })
      expect(scout?.deeds).toBeGreaterThan(0)
      expect(scout?.task).toBeTruthy()
      // the explorer leaves the island; the guildmaster keeps its seat
      const end = log.head.at + GONE_MS
      log.append(...flush(ctx, end))
      expect(heroes(log.head, end).map((h) => h.id)).toEqual([root?.id])
    })
  }
})

const CHRONICLES = join(homedir(), ".cache", "guildhall", "chronicles", "guildhall")
const runs = existsSync(CHRONICLES)
  ? readdirSync(CHRONICLES)
      .filter((f) => f.endsWith(".jsonl") && !f.endsWith(".raw.jsonl"))
      .sort()
  : []

describe.skipIf(runs.length === 0)("a real guild chronicle on this machine", () => {
  test("reduces without throwing, and its heroes walk to this repo's places", async () => {
    const c = await chronicle("guildhall")
    const units = unitsAt(c, c.end)
    const specs = placeSpecs(units, landTiles(c.repo.files))
    const zones = hexZones(hexIsland({ seed: 7, files: c.repo.files }), { places: specs })
    const binding = bindPlaces(specs, zones)
    const ctx = normalizer({ placeOf: binding.placeOf })
    const log = new EventLog()
    let lines = 0
    for (const file of runs) {
      const text = await Bun.file(join(CHRONICLES, file)).text()
      for (const line of text.split("\n")) {
        if (!line.trim()) continue
        const record = JSON.parse(line) as Partial<GuildEvent>
        if (!record.change) continue
        lines++
        log.append(...normalize(record as GuildEvent, ctx))
      }
    }
    log.append(...flush(ctx, log.head.at + GONE_MS))
    expect(lines).toBeGreaterThan(100)
    const all = heroes(log.head, log.head.at, { gone: true })
    expect(all.length).toBeGreaterThan(1)
    for (const h of all) {
      expect(h.name).toBeTruthy()
      if (h.place !== undefined) expect(zones.zones[h.place]).toBeDefined()
    }
    // somebody's work settled somewhere: a move happened, and not everyone stayed in the hall
    expect([...log.head.actors.values()].some((a) => a.place !== undefined)).toBe(true)
    // a seek into the middle agrees with the head's history
    const mid = (log.events[Math.floor(log.length / 2)] as WorldEvent).at
    expect(log.stateAt(mid).count).toBe(log.countAt(mid))
  })
})
