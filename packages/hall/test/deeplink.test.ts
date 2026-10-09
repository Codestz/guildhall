import { afterEach, describe, expect, test } from "bun:test"
import { applyDeepLink, type Hall, lookOf, parseDeepLink, pick } from "../src/guild/deeplink.ts"
import { GuildStore, RUSH } from "../src/guild/store.ts"
import { genOf, islandFromTree } from "../src/world/gen/islandFromTree.ts"
import type { RepoEntry } from "../src/world/gen/repo.ts"
import { SITES } from "../src/world/lands.ts"
import { sitesOf } from "../src/world/siteMap.ts"
import { handWorld, reachOf, repoWorld } from "../src/world/world.ts"
import REACT from "./fixtures/repos/facebook__react.json"

const parse = (search: string, probe = false) => parseDeepLink(search, probe)

describe("deep links: parsing", () => {
  test("a full link reads every param", () => {
    const { link, ignored } = parse(
      "?story=saga&t=11:53&hour=23&weather=storm&quality=2&hud=hidden&bard=0&view=explore&select=Implementer II&look=quarry&paused=1",
    )
    expect(ignored).toEqual([])
    expect(link).toMatchObject({
      story: "saga",
      t: (11 * 60 + 53) * 1000,
      hour: 23,
      weather: "storm",
      quality: 2,
      hud: "hidden",
      bard: false,
      view: "explore",
      select: "Implementer II",
      paused: true,
    })
    expect(link.look).toMatchObject({ x: SITES.quarry.at[0], z: SITES.quarry.at[1] })
  })

  test("an empty search is an empty link", () => {
    expect(parse("")).toEqual({ link: {}, ignored: [] })
  })

  test("invalid values are ignored and reported, valid ones beside them kept", () => {
    const { link, ignored } = parse(
      "story=epic&t=1:75&hour=25&weather=fog&quality=4&hud=full&bard=yes&paused=2&look=atlantis&view=top&select=<b>",
    )
    expect(link).toEqual({})
    expect(ignored).toHaveLength(11)
  })

  test("boundaries: hour 0 and 24 and decimals; t 0:00 and 999:59; quality 0 and 3", () => {
    expect(parse("hour=0").link.hour).toBe(0)
    expect(parse("hour=24").link.hour).toBe(24)
    expect(parse("hour=18.6").link.hour).toBe(18.6)
    expect(parse("hour=24.5").link.hour).toBeUndefined()
    expect(parse("hour=-1").link.hour).toBeUndefined()
    expect(parse("t=0:00").link.t).toBe(0)
    expect(parse("t=999:59").link.t).toBe((999 * 60 + 59) * 1000)
    expect(parse("t=12").link.t).toBeUndefined()
    expect(parse("quality=0").link.quality).toBe(0)
    expect(parse("quality=3").link.quality).toBe(3)
    expect(parse("quality=1.5").link.quality).toBeUndefined()
    expect(["low", "medium", "high", "ultra"].map((name) => parse(`quality=${name}`).link.quality)).toEqual([
      0, 1, 2, 3,
    ])
    expect(parse("quality=auto").link.quality).toBeUndefined()
    expect(parse("quality=auto").ignored).toEqual([])
    expect(parse("quality=toString").ignored).toEqual(["quality=toString"])
  })

  test("hud=off is hidden", () => {
    expect(parse("hud=off").link.hud).toBe("hidden")
  })

  test("act implies the Saga; with another story it is dropped", () => {
    expect(parse("act=3").link).toEqual({ act: 3, story: "saga" })
    const other = parse("story=party&act=2")
    expect(other.link).toEqual({ story: "party" })
    expect(other.ignored).toEqual(["act=2"])
    expect(parse("act=6").link.act).toBeUndefined()
    expect(parse("act=0").link.act).toBeUndefined()
  })

  test("n sizes the rush: 1–500, whole numbers only", () => {
    expect(parse("story=rush&n=100")).toEqual({ link: { story: "rush", n: 100 }, ignored: [] })
    expect(parse("story=rush&n=1").link.n).toBe(1)
    expect(parse("story=rush&n=500").link.n).toBe(500)
    for (const bad of ["0", "501", "1.5", "-3", "1e2", "lots", ""]) {
      const { link, ignored } = parse(`story=rush&n=${bad}`)
      expect(link).toEqual({ story: "rush" })
      expect(ignored).toEqual([`n=${bad}`])
    }
  })

  test("n with another story, or none, is dropped and reported", () => {
    expect(parse("story=party&n=50")).toEqual({ link: { story: "party" }, ignored: ["n=50"] })
    expect(parse("n=50")).toEqual({ link: {}, ignored: ["n=50"] })
  })

  test("event is honoured only in dev and probe builds", () => {
    expect(parse("event=dragon", true).link.event).toBe("dragon")
    const shipped = parse("event=dragon", false)
    expect(shipped.link.event).toBeUndefined()
    expect(shipped.ignored).toEqual(["event=dragon"])
    expect(parse("event=kraken", true).link.event).toBeUndefined()
  })

  test("other features' params are neither read nor reported", () => {
    expect(parse("live&showcase&lab=prop&piece=axe&grips")).toEqual({ link: {}, ignored: [] })
  })
})

describe("deep links: gen", () => {
  test("repo islands get generator 2 unless the link opts out with gen=1", () => {
    expect(genOf("")).toBe(2)
    expect(genOf("?repo=facebook/react&grow")).toBe(2)
    expect(genOf("?repo=facebook/react&gen=2")).toBe(2)
    expect(genOf("?repo=facebook/react&gen=1")).toBe(1)
    expect(genOf("?gen=nonsense")).toBe(2)
  })
})

describe("deep links: look", () => {
  test("every job site, the graveyard, the keep and the named landmarks resolve", () => {
    for (const id of Object.keys(SITES)) expect(lookOf(id)).toBeDefined()
    for (const name of ["graveyard", "keep", "island", "square", "windmill", "watermill", "well", "dock"])
      expect(lookOf(name)).toBeDefined()
  })

  test("names are case-insensitive; x,z points within the sea", () => {
    expect(lookOf("Quarry")).toMatchObject({ x: SITES.quarry.at[0] })
    expect(lookOf("12.5,-40")).toMatchObject({ x: 12.5, z: -40 })
    expect(lookOf("201,0")).toBeUndefined()
    expect(lookOf("1,2,3")).toBeUndefined()
    expect(lookOf("x,z")).toBeUndefined()
  })
})

describe("deep links: look on a repo's island", () => {
  const react = repoWorld(islandFromTree(REACT.entries as RepoEntry[]), {
    repo: REACT.repo,
    source: "fixture",
  })
  const district = (id: string) => react.repo?.districts.find((d) => d.id === id)

  test("a site is the world's mapped district, not the hand map's spot", () => {
    const quarry = sitesOf(react).quarry.at
    expect(lookOf("quarry", react)).toMatchObject({ x: quarry[0], z: quarry[1] })
    expect(quarry).not.toEqual(SITES.quarry.at)
    expect(lookOf("quarry", handWorld())).toMatchObject({ x: SITES.quarry.at[0], z: SITES.quarry.at[1] })
  })

  test("districts answer to their name and their folder, any case", () => {
    const at = district("packages/react-dom")?.at ?? [Number.NaN, Number.NaN]
    for (const name of ["react-dom", "React-DOM", "packages/react-dom"])
      expect(lookOf(name, react)).toMatchObject({ x: at[0], z: at[1] })
    expect(lookOf("react-dom", handWorld())).toBeUndefined()
  })

  test("the island is framed whole round the keep; the hand map's own places are not there", () => {
    expect(lookOf("island", react)).toMatchObject({ x: 0, z: 0, radius: reachOf(react) })
    expect(lookOf("graveyard", react)).toBeUndefined()
    expect(lookOf("square", react)).toBeUndefined()
  })

  test("with a repo, a name waits for the island; a point doesn't; nonsense is still ignored", () => {
    expect(parse("repo=facebook/react&look=react-dom")).toEqual({
      link: { repo: "facebook/react", lookName: "react-dom" },
      ignored: [],
    })
    // The order of the params doesn't matter.
    expect(parse("look=quarry&repo=facebook/react").link).toEqual({
      repo: "facebook/react",
      lookName: "quarry",
    })
    expect(parse("repo=facebook/react&look=12,-40").link).toMatchObject({ look: { x: 12, z: -40 } })
    expect(parse("repo=facebook/react&look=<b>")).toEqual({
      link: { repo: "facebook/react" },
      ignored: ["look=<b>"],
    })
    // Without one, an unknown name is ignored at once.
    expect(parse("look=react-dom")).toEqual({ link: {}, ignored: ["look=react-dom"] })
  })
})

describe("deep links: applying", () => {
  afterEach(() => {
    delete RUSH.count
  })

  function hallOf(store = new GuildStore()) {
    const levers = { quality: [] as number[], hud: [] as string[], forced: [] as string[] }
    const hall: Hall = {
      store,
      quality: (tier) => levers.quality.push(tier),
      hud: (mode) => levers.hud.push(mode),
      force: (kind) => levers.forced.push(kind),
    }
    return { store, hall, levers }
  }

  test("story, seek, clock, weather, levers and framing land on the store", () => {
    const { store, hall, levers } = hallOf()
    const { link } = parse(
      "story=saga&t=2:00&hour=23&weather=snow&quality=1&hud=hidden&paused=1&look=tower",
      true,
    )
    expect(applyDeepLink(link, hall)).toEqual([])
    expect(store.scenario).toBe("saga")
    expect(store.time).toBe(120_000)
    // …and the showcase's reveal starts the story there, not at 0 (scene/OpeningCue.tsx).
    expect(store.startAt).toBe(120_000)
    expect(store.environmentSettings).toMatchObject({ time: "fixed", hour: 23, weather: "snow" })
    expect(store.speed).toBe(0)
    expect(store.framing).toMatchObject({ x: SITES.tower.at[0], z: SITES.tower.at[1] })
    expect(store.bard).toBe(false)
    expect(levers).toEqual({ quality: [1], hud: ["hidden"], forced: [] })
  })

  test("n reloads the rush with that many adventurers; a rush link without n goes back to 12", () => {
    const { store, hall } = hallOf()
    const quests = () => store.markers.filter((m) => m.kind === "quest").length
    applyDeepLink(parse("story=rush").link, hall)
    const twelve = quests()
    // Already playing rush: a new n still reloads it.
    applyDeepLink(parse("story=rush&n=40").link, hall)
    expect(store.scenario).toBe("rush")
    expect(quests() - twelve).toBe(28)
    applyDeepLink(parse("story=rush").link, hall)
    expect(quests()).toBe(twelve)
  })

  test("act seeks to the chapter, t counting from its start", () => {
    const { store, hall } = hallOf()
    applyDeepLink(parse("act=3&t=0:10").link, hall)
    const third = store.chapters[2]
    expect(third).toBeDefined()
    expect(store.time).toBe((third?.at ?? 0) + 10_000)
  })

  test("an explicit bard=1 wins over a look's hand-off", () => {
    const { store, hall } = hallOf()
    applyDeepLink(parse("look=quarry&bard=1").link, hall)
    expect(store.bard).toBe(true)
  })

  test("a repo's island keeps the Bard on unless bard=0", () => {
    const { store, hall } = hallOf()
    applyDeepLink(parse("repo=facebook/react").link, hall)
    expect(store.bard).toBe(true)
    applyDeepLink(parse("repo=facebook/react&bard=0").link, hall)
    expect(store.bard).toBe(false)
  })

  test("event goes to the hall's force lever", () => {
    const { hall, levers } = hallOf()
    applyDeepLink(parse("event=festival", true).link, hall)
    expect(levers.forced).toEqual(["festival"])
  })

  test("select picks someone on stage by title", () => {
    const { store, hall } = hallOf()
    applyDeepLink(parse("story=rush&t=0:30").link, hall)
    const someone = store.views[0]
    expect(someone).toBeDefined()
    applyDeepLink({ select: someone?.title.toUpperCase() ?? "" }, hall)
    expect(store.selected).toBe(someone?.id ?? "")
  })

  test("select of someone not yet on stage waits for them, and says so", () => {
    const { store, hall } = hallOf()
    applyDeepLink(parse("story=rush").link, hall)
    const problems = applyDeepLink({ select: "nobody-by-this-name" }, hall)
    expect(problems[0]).toContain("waiting")
    expect(store.selected).toBeNull()
  })
})

describe("deep links: pick", () => {
  const views = [
    { id: "ses_a", title: "Implementer" },
    { id: "ses_b", title: "Implementer II" },
    { id: "ses_c", title: "Verifier" },
  ]
  test("by id, then exact title, then title prefix", () => {
    expect(pick(views, "ses_c")).toBe("ses_c")
    expect(pick(views, "implementer ii")).toBe("ses_b")
    expect(pick(views, "Implementer")).toBe("ses_a")
    expect(pick(views, "Veri")).toBe("ses_c")
    expect(pick(views, "Bard")).toBeUndefined()
  })
})
