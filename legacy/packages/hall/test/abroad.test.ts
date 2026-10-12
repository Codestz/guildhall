import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { applyAll, type Change, emptyModel, type Session } from "@guildhall/core"
import { crossing, party } from "@guildhall/sim"
import { ABROAD_MS, HallVisits, islandOfSession } from "../src/guild/hall.ts"
import { type AdventurerView, viewsOf } from "../src/guild/store.ts"
import { clipFor } from "../src/scene/brain.ts"
import { islandOfPath, isleOf, seaNow, setSea, setSeaNet } from "../src/world/abroad.ts"
import { setActiveWorld } from "../src/world/active.ts"
import { covers } from "../src/world/hall/site.ts"
import type { Hall } from "../src/world/hall/types.ts"
import { SLOW } from "./support/slow.ts"
import { reactSplit } from "./support/splitFixture.ts"

/**
 * Who works abroad (guild/hall.ts): work on a package of a split repo is done on that package's
 * island, in its hall, at a seat or station; no package, or the home island's own, keeps them home.
 */

setDefaultTimeout(60_000 * SLOW)

const at = (changes: Change[], t: number) =>
  applyAll(
    emptyModel(),
    changes.filter((c) => c.at <= t),
  )

describe("the island a path belongs to", () => {
  const far = [
    { id: "facebook/react#packages/react-dom" },
    { id: "facebook/react#packages/react-dom-bindings" },
    { id: "facebook/react#compiler/packages/babel-plugin-react-compiler" },
    { id: "facebook/react#." },
    { id: "facebook/react#+" },
  ]

  test("a path under a package's folder, relative or absolute, belongs to its island", () => {
    expect(islandOfPath(far, "packages/react-dom/src/client/ReactDOM.js")).toBe(
      "facebook/react#packages/react-dom",
    )
    expect(islandOfPath(far, "/work/react/packages/react-dom/src/a.js")).toBe(
      "facebook/react#packages/react-dom",
    )
    expect(islandOfPath(far, "C:\\work\\react\\packages\\react-dom\\src\\a.js")).toBe(
      "facebook/react#packages/react-dom",
    )
  })

  test("a search's path may be the package's folder itself", () => {
    expect(islandOfPath(far, "packages/react-dom")).toBe("facebook/react#packages/react-dom")
    expect(islandOfPath(far, "/work/react/packages/react-dom-bindings/")).toBe(
      "facebook/react#packages/react-dom-bindings",
    )
  })

  test("whole folders only: react-dom-bindings is not react-dom, and the longest folder wins", () => {
    expect(islandOfPath(far, "packages/react-dom-bindings/src/a.js")).toBe(
      "facebook/react#packages/react-dom-bindings",
    )
    expect(islandOfPath(far, "packages/react-dom.js")).toBeUndefined()
    expect(islandOfPath(far, "compiler/packages/babel-plugin-react-compiler/src/x.ts")).toBe(
      "facebook/react#compiler/packages/babel-plugin-react-compiler",
    )
  })

  test("the root's share, the pooled rest, and a path on no package belong to no far island", () => {
    expect(islandOfPath(far, "README.md")).toBeUndefined()
    expect(islandOfPath(far, "scripts/build.js")).toBeUndefined()
    expect(islandOfPath(far, "packages/react/src/React.js")).toBeUndefined()
  })
})

describe("who works abroad", () => {
  let split: Awaited<ReturnType<typeof reactSplit>>
  const changes = crossing()
  const start = changes[0]?.at ?? 0

  beforeAll(async () => {
    split = await reactSplit()
    const { home } = split
    setActiveWorld(home)
    setSea(split.archipelago)
    setSeaNet(split.net)
  })
  afterAll(() => {
    setSea(null)
    setActiveWorld(undefined)
  })

  /** Everyone at run time `t` after the start. */
  const views = (t: number, previous: ReturnType<typeof viewsOf> = []) =>
    viewsOf(at(changes, start + t), start + t, undefined, undefined, undefined, previous)

  test("an agent on a deed in a package goes to its island's hall: their target is a spot there, inside its walls", () => {
    const now = views(40_000)
    const abroad = now.filter((v) => v.hall)
    expect(abroad.length).toBeGreaterThanOrEqual(2)
    const sea = seaNow()
    for (const v of abroad) {
      const hall = isleOf(sea as NonNullable<typeof sea>, v.hall?.island as string)?.world.hall as Hall
      const isle = isleOf(sea as NonNullable<typeof sea>, v.hall?.island as string)
      expect(v.phase).toBe("working")
      expect(v.site).toBeUndefined()
      expect(v.visit).toBeUndefined()
      // The target is in the archipelago's coordinates: the island's own, inside the hall, when they have a spot.
      const local: [number, number] = [v.target[0] - (isle?.at[0] ?? 0), v.target[1] - (isle?.at[1] ?? 0)]
      if (v.hall?.spot) expect(covers(hall, local[0], local[1])).toBe(true)
      else expect([v.target[0], v.target[1]]).toEqual([...(v.hall?.door.step ?? [])])
    }
  })

  test("the guildmaster stays home, and whoever works on the home island's own package or none does too", () => {
    const now = views(40_000)
    const master = now.find((v) => v.master)
    expect(master?.hall).toBeUndefined()
    // The pagination party names `src/…` files on no package of React's.
    const generic = viewsOf(at(party(), (party()[0]?.at ?? 0) + 30_000), (party()[0]?.at ?? 0) + 30_000)
    expect(generic.some((v) => v.hall)).toBe(false)
  })

  test("each takes a spot of their own that suits the deed, and keeps it while they stay", () => {
    const first = views(40_000)
    const spots = first.filter((v) => v.hall?.spot).map((v) => `${v.hall?.island}|${v.hall?.spot}`)
    expect(new Set(spots).size).toBe(spots.length)
    const later = views(41_000, first)
    for (const v of first.filter((x) => x.hall?.spot)) {
      const again = later.find((x) => x.id === v.id)
      if (again?.hall?.island === v.hall?.island) expect(again?.hall?.spot).toBe(v.hall?.spot)
    }
    // The same story gives the same spots.
    expect(views(40_000).map((v) => v.hall?.spot)).toEqual(first.map((v) => v.hall?.spot))
  })

  test("a seat plays the sitting clip; an edit at a bench goes to a station", () => {
    for (const t of [40_000, 80_000, 130_000]) {
      for (const v of views(t).filter((x) => x.hall?.spot)) {
        if (v.hall?.seat) expect(v.hall.clip).toBe("Sit_Chair_Idle")
      }
    }
  })

  test("they go home when the deeds on the package stop: not abroad ABROAD_MS after the last", () => {
    // The story told to its end: every deed is over, so none is still "running".
    const model = at(changes, start + 900_000)
    const sea = seaNow() as NonNullable<ReturnType<typeof seaNow>>
    const s = [...model.sessions.values()].find(
      (x) => x.parentID && x.entries.some((e) => e.kind === "tool" && e.input.filePath),
    ) as Session
    expect(s).toBeDefined()
    const tools = s.entries.filter((e) => e.kind === "tool")
    const last = tools[tools.length - 1]
    const end = last?.kind === "tool" ? (last.ended ?? last.at) : 0
    expect(islandOfSession(s, end + ABROAD_MS - 1000, sea)).toBeDefined()
    expect(islandOfSession(s, end + ABROAD_MS + 5000, sea)).toBeUndefined()
  })

  test("a full hall sends the next to wait at its gate", () => {
    const sea = seaNow() as NonNullable<ReturnType<typeof seaNow>>
    const island = sea.far.find((isle) => isle.id.endsWith("#packages/shared")) as (typeof sea.far)[number]
    const hall = island.world.hall as Hall
    const people = Array.from({ length: hall.spots.length + 2 }, (_, i) => `a${i}`)
    const halls = new HallVisits(sea, new Map(people.map((id) => [id, island.id])), [])
    const visits = people.map((id) => halls.visit(id, island.id, "read"))
    expect(new Set(visits.filter((v) => v?.visit.spot).map((v) => v?.visit.spot)).size).toBe(
      hall.spots.length,
    )
    const waiting = visits.slice(hall.spots.length)
    for (const w of waiting) {
      expect(w?.visit.spot).toBeUndefined()
      expect(w?.visit.seat).toBe(false)
      expect([w?.target[0], w?.target[1]]).toEqual([...(w?.visit.door.step ?? [])])
    }
  })

  test("at a seat they sit, at a station they work, aboard a ferry they stand, and walking they walk", () => {
    const [seated, standing] = [
      views(40_000).find((v) => v.hall?.seat) ?? views(80_000).find((v) => v.hall?.seat),
      views(40_000).find((v) => v.hall?.spot && !v.hall.seat),
    ]
    const base = (view: AdventurerView | undefined): AdventurerView => ({
      ...(view as AdventurerView),
      stung: false,
    })
    if (seated) expect(clipFor(base(seated), false, 0, null)).toBe("Sit_Chair_Idle")
    if (standing) expect(clipFor(base(standing), false, 0, null)).toBe(standing.hall?.clip as string)
    const any = base(views(40_000).find((v) => v.hall))
    expect(clipFor(any, false, 0, null, true)).toBe("Idle_A")
    expect(clipFor(any, true, 3.4, null)).toBe("Walking_A")
  })

  test("with no archipelago nobody goes anywhere", () => {
    setSea(null)
    expect(views(40_000).some((v) => v.hall)).toBe(false)
    setSea(split.archipelago)
  })
})
