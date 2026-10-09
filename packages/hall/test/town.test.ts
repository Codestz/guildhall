import { afterAll, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { gunzipSync } from "node:zlib"
import { landingOf, TOWN_PARTY, townViewsOf } from "../src/guild/town/views.ts"
import { activeWorld, setActiveWorld } from "../src/world/active.ts"
import { placeOf, SITE_WORK } from "../src/world/behaviours.ts"
import { type Chronicle, type Contributor, dayOf, decodeChronicle } from "../src/world/chronicle/format.ts"
import {
  districtById,
  districtKey,
  districtPlaceOf,
  siteOfDistrict,
  tradeOf,
} from "../src/world/districtWork.ts"
import { islandFromTree } from "../src/world/gen/islandFromTree.ts"
import type { RepoEntry } from "../src/world/gen/repo.ts"
import { spread } from "../src/world/sharers.ts"
import { callingOf } from "../src/world/town/calling.ts"
import {
  activityBuckets,
  busiestWeek,
  commitsBy,
  ferryAt,
  presenceAt,
  STAY_DAYS,
  WINDOW_DAYS,
} from "../src/world/town/presence.ts"
import { filmWindow, HARBOUR, MAX_RESIDENTS, townsfolkAt } from "../src/world/town/townsfolk.ts"
import { repoWorld, type World } from "../src/world/world.ts"

/**
 * Contributors as townsfolk (ADR 0022): the pure reading of a chronicle on a day (world/town), the
 * district places they work at (world/districtWork.ts) and the views the cast draws (guild/town).
 * Against react's real chronicle and tree.
 */

const HERE = import.meta.dir
const react: Chronicle = decodeChronicle(
  gunzipSync(readFileSync(join(HERE, "../public/chronicles/react__react.json.gz"))).toString(),
)
const tree = JSON.parse(readFileSync(join(HERE, "fixtures/repos/facebook__react.json"), "utf8")) as {
  repo: string
  entries: RepoEntry[]
}
const world: World = repoWorld(islandFromTree(tree.entries), { repo: tree.repo, source: "fixture" })
const before = activeWorld()
setActiveWorld(world)
afterAll(() => setActiveWorld(before))

const person = (login: string): Contributor => {
  const found = react.contributors.find((c) => c.login === login)
  if (!found) throw new Error(`${login} is not in react's chronicle`)
  return found
}
const today = townsfolkAt(react, world, react.end)

describe("a contributor's calling: the archetype of the folder they commit to", () => {
  test("by what the folder holds, a package by its own name", () => {
    expect(callingOf("packages/internal-test-utils")).toBe("warden")
    expect(callingOf("docs")).toBe("archivist")
    expect(callingOf("compiler")).toBe("architect")
    expect(callingOf("packages/react-devtools-core")).toBe("architect")
    expect(callingOf("fixtures")).toBe("scout")
    expect(callingOf("scripts")).toBe("herald")
    expect(callingOf(".github")).toBe("herald")
    expect(callingOf("packages/ui")).toBe("illuminator")
    expect(callingOf("benchmarks")).toBe("scholar")
    expect(callingOf("/")).toBe("herald")
    expect(callingOf("src")).toBe("artisan")
    expect(callingOf("packages/react-reconciler")).toBe("artisan")
  })

  test("stylesheets make an unnamed folder an Illuminator's, never a named one", () => {
    expect(callingOf("site-theme-x", "CSS")).toBe("illuminator")
    expect(callingOf("web", "SCSS")).toBe("illuminator")
    expect(callingOf("docs", "CSS")).toBe("archivist")
  })
})

describe("presence: in town from the first commit until a year of quiet", () => {
  const dan = person("gaearon")

  test("nobody before their first commit; arriving for a window after it", () => {
    expect(presenceAt(react, dan, dan.first - 1)).toBeUndefined()
    expect(presenceAt(react, dan, dan.first)?.arriving).toBe(true)
    expect(presenceAt(react, dan, dan.first + WINDOW_DAYS)?.arriving).toBe(false)
  })

  test("leaving STAY_DAYS past the last commit, gone a window later", () => {
    const old = person("bvaughn")
    expect(presenceAt(react, old, old.last + STAY_DAYS - 1)?.presence).not.toBe("leaving")
    expect(presenceAt(react, old, old.last + STAY_DAYS)?.presence).toBe("leaving")
    expect(presenceAt(react, old, old.last + STAY_DAYS + WINDOW_DAYS)).toBeUndefined()
  })

  test("busy with a commit in the window, quiet without", () => {
    const busy = react.contributors.find((c) => presenceAt(react, c, react.end)?.presence === "busy")
    const quiet = react.contributors.find((c) => presenceAt(react, c, react.end)?.presence === "quiet")
    expect(busy && presenceAt(react, busy, react.end)?.recent).toBeGreaterThan(0)
    expect(quiet && presenceAt(react, quiet, react.end)?.recent).toBe(0)
  })

  test("commits grow week by week and end on the real total", () => {
    const mid = Math.round((dan.first + dan.last) / 2)
    expect(commitsBy(react, dan, dan.first - 1)).toBe(0)
    expect(commitsBy(react, dan, mid)).toBeGreaterThan(0)
    expect(commitsBy(react, dan, mid)).toBeLessThan(dan.commits)
    expect(commitsBy(react, dan, dan.last)).toBe(dan.commits)
  })
})

describe("the town on a day", () => {
  test("today: the contributors with a commit in the last year, in the chronicle's order", () => {
    const wanted = react.contributors.filter((c) => c.last + STAY_DAYS > react.end).length
    expect(today.length).toBe(wanted)
    expect(today.map((r) => r.index)).toEqual([...today.map((r) => r.index)].sort((a, b) => a - b))
    expect(new Set(today.map((r) => r.id)).size).toBe(today.length)
    expect(today.every((r) => r.id.startsWith("town:"))).toBe(true)
  })

  test("is deterministic: the same day reads the same town", () => {
    const day = dayOf("2017-06-01")
    expect(townsfolkAt(react, world, day)).toEqual(townsfolkAt(react, world, day))
  })

  test("a bot is an Automaton; a compiler hand an Architect, ranked a master", () => {
    const bot = today.find((r) => r.bot)
    expect(bot?.archetype).toBe("automaton")
    const joe = today.find((r) => r.login === "josephsavona")
    expect(joe?.archetype).toBe("architect")
    expect(joe?.rank).toBe("master")
  })

  test("everyone works in a district of today's island that stands that day", () => {
    const ids = new Set(world.repo?.districts.map((d) => d.id))
    for (const day of [react.start + 10, dayOf("2015-01-01"), dayOf("2019-01-01"), react.end])
      for (const r of townsfolkAt(react, world, day)) expect(ids.has(r.district)).toBe(true)
    // In 2013 only the harbour stands (src/ and docs/ are folders gone by today).
    expect(townsfolkAt(react, world, react.start + 30).every((r) => r.district === HARBOUR)).toBe(true)
  })

  test("a folder gone by today sends its people to their other folders' districts", () => {
    const dan = today.find((r) => r.login === "gaearon")
    expect(dan?.home).toBe("src")
    expect(dan?.district).toBe("scripts")
  })

  test("the cap keeps the busiest by commits so far, still in the chronicle's order", () => {
    const day = dayOf("2017-06-01")
    const all = townsfolkAt(react, world, day)
    const few = townsfolkAt(react, world, day, { cap: 10 })
    expect(all.length).toBeGreaterThan(10)
    expect(few.length).toBe(10)
    expect(few.every((r) => all.some((a) => a.id === r.id))).toBe(true)
    expect(townsfolkAt(react, world, day, { cap: 10_000 }).length).toBeLessThanOrEqual(MAX_RESIDENTS)
  })

  test("ranks grow as the film plays", () => {
    const early = townsfolkAt(react, world, dayOf("2014-06-01")).find((r) => r.login === "sebmarkbage")
    const later = today.find((r) => r.login === "sebmarkbage")
    expect(early && later && early.commits < later.commits).toBe(true)
  })

  test("the film's window is a month at least, and two seconds of film", () => {
    expect(filmWindow(1)).toBe(WINDOW_DAYS)
    expect(filmWindow(70)).toBe(140)
  })
})

describe("the history around them", () => {
  test("the busiest week is the weekly series' peak", () => {
    const week = busiestWeek(react)
    const series = react.weekly.commits ?? []
    expect(week?.commits).toBe(Math.max(...series))
    expect(week?.day).toBe(react.start + (week?.week ?? 0) * 7)
  })

  test("the ferry is in near anyone's coming or going, out of sight far from it", () => {
    const days = [100, 400]
    expect(ferryAt(days, 100, 28)).toBe(1)
    expect(ferryAt(days, 128, 28)).toBe(1)
    expect(ferryAt(days, 142, 28)).toBeCloseTo(0.5, 5)
    expect(ferryAt(days, 250, 28)).toBe(0)
    expect(ferryAt([], 250, 28)).toBe(0)
  })

  test("a sparkline sums every week into its span", () => {
    const dan = person("gaearon")
    const buckets = activityBuckets(react, dan, 48)
    expect(buckets).toHaveLength(48)
    let all = 0
    for (const char of dan.weeks) all += Number.parseInt(char, 36)
    expect(buckets.reduce((a, b) => a + b, 0)).toBe(all)
  })
})

describe("district places: work in any district", () => {
  const plain = world.repo?.districts.find((d) => d.posts.length > 0 && !siteOfDistrict(d.id, world))

  test("a district without a story site works its landmark's trade round its own posts", () => {
    expect(plain).toBeDefined()
    if (!plain) return
    const place = districtPlaceOf(plain.id, plain.posts[0] as [number, number, number], world)
    expect(place?.key).toBe(districtKey(plain.id))
    expect(place?.berth).toBe(0)
    expect(place?.behaviour.loop).toBe(SITE_WORK[tradeOf(plain)].loop)
    expect(districtPlaceOf(plain.id, [999, 999, 0], world)).toBeUndefined()
  })

  test("sharers spread round a district's post on open ground, each their own spot", () => {
    if (!plain) return
    const place = districtPlaceOf(plain.id, plain.posts[0] as [number, number, number], world)
    if (!place) throw new Error("no place")
    const spots = [1, 2, 3, 4, 5, 6].map((lap) => spread(place, lap).join(","))
    expect(new Set(spots).size).toBe(spots.length)
  })
})

describe("the townsfolk as figures", () => {
  const views = townViewsOf(today, world, "world", true)

  test("named 'Archetype · login', in the town's party, ranked", () => {
    const joe = views.find((v) => v.id === "town:josephsavona")
    expect(joe?.title).toBe("Architect · josephsavona")
    expect(joe?.subtitle).toBe("josephsavona")
    expect(joe?.party).toBe(TOWN_PARTY)
    expect(joe?.rank).toBe("master")
    const source = townViewsOf(today, world, "source", true).find((v) => v.id === "town:josephsavona")
    expect(source?.title).toBe("josephsavona")
  })

  test("the busy work at one of their district's posts, with a place to run a routine", () => {
    const busy = views.filter((v) => v.phase === "working")
    expect(busy.length).toBe(today.filter((r) => r.presence === "busy").length)
    for (const view of busy) {
      const resident = today.find((r) => r.id === view.id)
      const posts = districtById(resident?.district ?? "", world)?.posts ?? []
      expect(posts.some((p) => p[0] === view.target[0] && p[1] === view.target[1])).toBe(true)
      const place = view.district
        ? districtPlaceOf(view.district, view.target, world)
        : placeOf(view.site, undefined, view.target, world)
      expect(place).toBeDefined()
    }
  })

  test("the quiet rest about a district's square, each on their own spot", () => {
    const quiet = views.filter((v) => v.phase === "resting" || v.phase === "idle")
    expect(quiet.length).toBe(today.filter((r) => r.presence === "quiet").length)
    expect(districtById(HARBOUR, world)).toBeDefined()
    const squares = (world.repo?.districts ?? []).map((district) => district.at)
    for (const view of quiet)
      expect(
        Math.min(...squares.map((at) => Math.hypot(view.target[0] - at[0], view.target[1] - at[1]))),
      ).toBeLessThan(20)
    expect(new Set(quiet.map((v) => `${v.target[0]},${v.target[1]}`)).size).toBe(quiet.length)
  })

  test("newcomers step off the ferry, only when the town moved on smoothly", () => {
    const day = react.contributors[10]?.first ?? react.start
    const arriving = townsfolkAt(react, world, day).filter((r) => r.arriving)
    expect(arriving.length).toBeGreaterThan(0)
    const smooth = townViewsOf(arriving, world, "world", true)
    expect(smooth.every((v) => v.enter?.at[0] === landingOf(world)[0])).toBe(true)
    expect(townViewsOf(arriving, world, "world", false).every((v) => v.enter === undefined)).toBe(true)
  })

  test("leavers walk down to the quay", () => {
    const old = person("bvaughn")
    const leaving = townsfolkAt(react, world, old.last + STAY_DAYS).find((r) => r.login === "bvaughn")
    expect(leaving?.presence).toBe("leaving")
    const [view] = townViewsOf(leaving ? [leaving] : [], world, "world", true)
    expect(view?.phase).toBe("leaving")
    expect(
      Math.hypot((view?.target[0] ?? 0) - landingOf(world)[0], (view?.target[1] ?? 0) - landingOf(world)[1]),
    ).toBeLessThan(3)
  })

  test("an unchanged view keeps its identity", () => {
    const previous = new Map(views.map((v) => [v.id, v]))
    const again = townViewsOf(today, world, "world", true, previous)
    expect(again.every((v, i) => v === views[i])).toBe(true)
  })
})
