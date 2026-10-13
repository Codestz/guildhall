import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { adaptV1, adaptV2, type Change } from "@guildhall/core"
import { recorded } from "../../core/test/events/fixtures.ts"
import { GuildModel, type Moment } from "../src/index.ts"

/**
 * The golden: V1's recorded runs (core's fixtures), replayed through the sim, make exactly the moments
 * V1 made. `fixtures/moments-v{1,2}.json` were written by V1's own code on main (core's translators
 * and model, the hall's `before` + `happenings`), one `{ at, ...happening }` per moment, in order.
 */

async function replayed(version: 1 | 2): Promise<Moment[]> {
  const { events } = await recorded(version)
  const translate = version === 1 ? adaptV1() : adaptV2()
  const changes: Change[] = events.flatMap((line) => translate.event(line.event, line.at))
  return new GuildModel().applyAll(changes)
}

async function golden(version: 1 | 2): Promise<Moment[]> {
  return (await Bun.file(join(import.meta.dir, "fixtures", `moments-v${version}.json`)).json()) as Moment[]
}

describe("replaying V1's recorded runs gives V1's moments", () => {
  for (const version of [1, 2] as const) {
    test(`OpenCode ${version}`, async () => {
      const moments = await replayed(version)
      expect(moments.length).toBeGreaterThan(5)
      expect(moments).toEqual(await golden(version))
    })
  }

  test("OpenCode 2's run: a quest, the explorer's join, its deeds and loot, then the master's", async () => {
    expect((await replayed(2)).map((m) => m.kind)).toEqual([
      "quest",
      "join",
      "deed",
      "deed",
      "deed",
      "loot",
      "deed",
      "loot",
    ])
  })
})
