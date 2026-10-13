/**
 * A repo's hall (hexworld/hall.ts, loading.ts): the chronicle is read before anything is built, and
 * what is built comes from it (size, places, figures); a repo with no chronicle is a sketch, said so.
 */
import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { filesAt, readChronicle } from "@guildhall/sim"
import { landTiles } from "@guildhall/world"
import {
  type HallRepo,
  hallBinding,
  hallBuild,
  hallSubtitle,
  placeRows,
  repoOf,
} from "../src/hexworld/hall.ts"
import { type FromWorker, runHexJob } from "../src/hexworld/job.ts"
import { HALL_STEPS, LINES, loadPlan, STEPS } from "../src/hexworld/loading.ts"
import { kindWord } from "../src/hexworld/places.ts"

const REPO_DIR = join(import.meta.dir, "../public/lab/repo")
const read = async (name: string) =>
  readChronicle(new Uint8Array(await Bun.file(join(REPO_DIR, `${name}.json.gz`)).arrayBuffer()))

describe("the hall's loading order", () => {
  test("a hall reads the chronicle first; the island's own cover starts at the map", () => {
    expect(HALL_STEPS[0]).toBe("Chronicle")
    expect(HALL_STEPS.slice(1)).toEqual([...STEPS])
    expect(STEPS[0]).toBe("Map")
    expect(LINES.Chronicle).toBe("Reading the chronicle.")
    expect(loadPlan(4000).Chronicle).toBeGreaterThan(0)
  })

  test("what is built comes from the chronicle: its files size the island, not the query's default", async () => {
    const c = await read("guildhall")
    const repo = repoOf(c, "local")
    const built = hallBuild(repo, 4000)
    expect(built.sketch).toBe(false)
    // the replay's size (replay/: filesAt at the last day), not the query's default
    expect(built.files).toBe(filesAt(c, c.end))
    expect(built.files).not.toBe(4000)
    // and every place ranked under the land the island had at its unit's birth
    for (const p of built.places ?? []) expect(p.rankMax).toBeGreaterThan(0)
    expect(built.places?.length).toBe(c.units.length)
    // a world built from it carries every place, named, with its heart on the map
    const msgs: FromWorker[] = []
    runHexJob(
      {
        seed: 3,
        files: built.files,
        ground: "fine",
        step: 0.8,
        paint: false,
        tiles: null,
        places: built.places,
      },
      (m) => msgs.push(m),
    )
    const map = msgs[0]?.type === "map" ? msgs[0].map : null
    expect(map?.places.map((p) => p.id).sort()).toEqual(c.units.map((u) => u.name).sort())
    expect(map?.places[0]?.label).toBe("hall")
    expect(map?.places[0]?.kind).toBe("town")
    for (const p of map?.places ?? []) expect(p.tiles).toBeGreaterThan(0)
    // the island's own build has none
    const own: FromWorker[] = []
    runHexJob({ seed: 3, files: 600, ground: "fine", step: 0.8, paint: false, tiles: null }, (m) =>
      own.push(m),
    )
    expect(own[0]?.type === "map" ? own[0].map.places : null).toEqual([])
  })

  test("the same chronicle gives the same places and the same island", async () => {
    const c = await read("react")
    const a = repoOf(c, "cdn")
    const b = repoOf(c, "cdn")
    expect(a).toEqual(b)
    const land = landTiles(c.repo.files)
    expect(a.kind === "chronicled" && a.places.length).toBeLessThanOrEqual(Math.max(6, Math.floor(land / 55)))
  })
})

describe("the repo's card", () => {
  test("the figures from the chronicle, in one line", async () => {
    const c = await read("react")
    const repo = repoOf(c, "cdn")
    expect(repo.kind).toBe("chronicled")
    if (repo.kind !== "chronicled") return
    expect(repo.name).toBe("react/react")
    expect(repo.years).toEqual([2013, 2026])
    expect(hallSubtitle(repo)).toBe("7,252 files · 19,117 commits · 1,952 contributors · 2013 – 2026")
    expect(repo.places[0]?.capital).toBe(true)
    expect(repo.places[0]?.id).toBe("compiler")
    const b = hallBinding(repo, {
      zones: [{ kind: "town", tile: 0, tiles: [0], buildings: 0, place: repo.places[0] }],
    })
    expect(b?.placeOf("/x/react/compiler/a.rs")).toBe(0)
  })

  test("a repo with no chronicle is a sketch, said so, at the query's size", () => {
    const missing: HallRepo = { kind: "sketch", name: "a/b", why: "not-chronicled" }
    expect(hallBuild(missing, 4000)).toEqual({ files: 4000, sketch: true })
    expect(hallSubtitle(missing)).toMatch(/^A sketch: no chronicle/)
    const offline: HallRepo = { kind: "sketch", name: "a/b", why: "unavailable", reason: "HTTP 500" }
    expect(hallSubtitle(offline)).toMatch(/^A sketch: the chronicle could not be read/)
    expect(hallBinding(offline, { zones: [] })).toBeNull()
    // the island's own (no hall): the query's size, not a sketch
    expect(hallBuild(null, 1500)).toEqual({ files: 1500, sketch: false })
  })

  test("places read biggest first, in plain words", () => {
    const rows = placeRows([
      { label: "ui", files: 30, tiles: 4, kind: "hamlet" },
      { label: "hall", files: 245, tiles: 36, kind: "town" },
    ])
    expect(rows.map((r) => r.label)).toEqual(["hall", "ui"])
    expect(rows[0]?.value).toBe("245 files · 36 tiles · town")
    expect(kindWord("town")).toBe("capital")
    expect(kindWord("farm")).toBe("village")
    expect(kindWord("fishing")).toBe("fishing village")
  })
})
