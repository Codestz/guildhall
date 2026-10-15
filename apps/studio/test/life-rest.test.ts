/**
 * The world never freezes (decisions.md "User review notes (10-14 evening)"): a told story played to its
 * end leaves its heroes going about their rest on life's free-running time (session `lifeAt`, sim
 * rest.ts), never standing frozen mid-road; a fallen hero that leaves rises as a ghost and drifts to the
 * graveyard; the home's next demo counts down and any input cancels it; a repo's hall with no session
 * has a resident guild of its busiest hands whose day is the same every time.
 */
import { afterAll, describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import {
  type AgentPose,
  GHOST_FADE_MS,
  GHOST_RISE_MS,
  type Itinerary,
  poseAt,
  readChronicle,
  type StoryId,
  shownAt,
} from "@guildhall/sim"
import {
  hexIsland,
  hexWalk,
  hexWorld,
  hexZones,
  installTilePrefabs,
  lifePlaces,
  parseTilePrefabs,
  workTiles,
} from "@guildhall/world"
import { createSession, type HallSession } from "../src/hall/feeds/session.ts"
import { hallBuild, repoOf } from "../src/hexworld/hall.ts"
import { agentDesk, HERO_SPOTS, kitOf } from "../src/hexworld/lifePlan.ts"
import {
  RESIDENT_EPOCH,
  residentAgents,
  residentJoins,
  residentsOf,
  residentVerb,
} from "../src/hexworld/residents.ts"
import { sessionAgents } from "../src/hexworld/sessionAgents.ts"
import { autoNext, autoNextAt, DEMO_ORDER, NEXT_AT_MS, nextStory, PILL_AT_MS } from "../src/site/autoNext.ts"
import { HomeFeed } from "../src/site/homeFeed.ts"
import { homePlaces } from "../src/site/homePlaces.ts"
import { hallSeed } from "../src/site/routes.ts"

const TILES = join(import.meta.dir, "../../../data/tiles")
installTilePrefabs(
  parseTilePrefabs(
    Object.fromEntries(
      readdirSync(TILES)
        .filter((f) => f.endsWith(".json"))
        .map((f) => [f.slice(0, -5), JSON.parse(readFileSync(join(TILES, f), "utf8")) as unknown]),
    ),
  ).prefabs,
)
afterAll(() => installTilePrefabs(null))

/** The home's island (seed 1), its desk with the rest kit (as the worker keeps it), and a story's session on it. */
function homeIsland(seed = 1) {
  const h = hexIsland({ seed, files: 4000 })
  const z = hexZones(h, {})
  const w = hexWorld(h, z)
  const walk = hexWalk(h, z, w, { reach: workTiles(h, z) })
  const places = lifePlaces(h, z, w, walk, { heroSpots: HERO_SPOTS })
  const kit = kitOf(h, z, walk, places, w.graveyard, w)
  return { h, z, w, walk, places, kit }
}
const island = homeIsland()

/** A demo story's session on the home island, played through to its end. */
function playedTo(pick: StoryId): HallSession {
  const session = createSession(new HomeFeed(pick), {})
  session.start(homePlaces(island.z.zones.map((q) => q.kind)).placeOf)
  const c = session.clock.get()
  // the story plays to its end (8× per frame, as a skip would), then the frames go on in real time
  for (let k = 0; k < 100_000 && session.clock.get().playing; k++) session.frame(0.25 * 8)
  expect(session.clock.get().at).toBe(c.end)
  return session
}

/** Real time on a played-out session: `secs` of frames; the agents asked and answered between frames. */
async function rest(
  session: HallSession,
  agents: ReturnType<typeof sessionAgents>,
  secs: number,
  each?: () => void,
) {
  for (let k = 0; k < secs * 4; k++) {
    session.frame(0.25)
    agents.tick()
    await Promise.resolve()
    await Promise.resolve()
    each?.()
  }
}

describe("the world never freezes after a story's end", () => {
  test("a played-out session's life runs on in real time past its end; a seek back is the clock again", () => {
    const session = playedTo("solo")
    const end = session.clock.get().end
    expect(session.restedMs()).toBe(0)
    session.frame(0.25)
    session.frame(0.25)
    for (let k = 0; k < 40; k++) session.frame(0.25)
    expect(session.restedMs()).toBeGreaterThan(9000)
    expect(session.lifeAt()).toBe(end + session.restedMs())
    session.clock.seek(end - 5000, { jump: true })
    session.frame(0.25)
    expect(session.restedMs()).toBe(0)
    expect(session.lifeAt()).toBe(end - 5000)
  })

  for (const pick of ["solo", "party"] as const)
    test(`${pick}: every hero on the island at the end moves or changes clip within 60 s, and none stands idle mid-road`, async () => {
      const session = playedTo(pick)
      const desk = agentDesk(island.kit)
      const agents = sessionAgents(
        session,
        async (req) => desk.plan(req),
        Date.now,
        () => 19,
      )
      const states = new Map<string, Set<string>>()
      const last = new Map<string, string>()
      const still = new Map<string, number>()
      let worst = 0
      const look = () => {
        for (const a of agents.list()) {
          const p = agents.poseAt(a.id, 0)
          if (!p) {
            last.delete(a.id)
            still.set(a.id, 0)
            continue
          }
          const key = `${p.at[0].toFixed(2)},${p.at[2].toFixed(2)},${p.act},${p.sample?.clip ?? "-"}`
          const seen = states.get(a.id) ?? new Set<string>()
          states.set(a.id, seen)
          seen.add(key)

          // idle mid-road: standing with nothing to do (no routine at all), or a walk that does not go on
          const blank = p.act !== "walk" && !p.sample
          const stuck = blank || (p.act === "walk" && last.get(a.id) === key)
          const n = stuck ? (still.get(a.id) ?? 0) + 0.25 : 0
          still.set(a.id, n)
          last.set(a.id, key)
          worst = Math.max(worst, n)
        }
      }
      agents.tick()
      await Promise.resolve()
      await Promise.resolve()
      look()
      const atEnd = agents.list().filter((a) => agents.poseAt(a.id, 0))
      expect(atEnd.length).toBeGreaterThan(0)
      await rest(session, agents, 60, look)
      for (const a of atEnd) expect(states.get(a.id)!.size).toBeGreaterThan(1)
      // and on for the evening and into the night: never idle mid-road more than 5 s
      await rest(session, agents, 600, look)
      expect(worst).toBeLessThanOrEqual(5)
      agents.dispose()
    }, 120_000)

  test("the Guildmaster at rest goes about the evening: the tavern, then in at a door at night", async () => {
    const session = playedTo("party")
    const desk = agentDesk(island.kit)
    // the island's day goes on at life's pace (20 day-hours an hour) from 20:00 at the story's end
    const agents = sessionAgents(
      session,
      async (req) => desk.plan(req),
      Date.now,
      () => 20 + (session.restedMs() / 3_600_000) * 20,
    )
    await rest(session, agents, 1, undefined)
    const gm = agents.list()[0]!.id
    let toasted = false
    let gone = false
    await rest(session, agents, 900, () => {
      const p = agents.poseAt(gm, 0)
      if (p?.sample?.clip === "Cheering" && p.act !== "walk") toasted = true
      if (!p) gone = true
    })
    const it = agents.itinerary?.(gm) as Itinerary
    // a toast at the tavern in the evening; at 22:00 (two hours on at life's pace: 6 min) in at a door
    expect(toasted).toBe(true)
    expect(gone).toBe(true)
    const doors = island.kit.rest!.doors.map((d) => d.at)
    const last = [...it.steps].reverse().find((s) => s.kind === "stay") as { at: number[] }
    expect(doors.some((d) => Math.hypot(d[0] - last.at[0]!, d[2] - last.at[2]!) < 0.01)).toBe(true)
    agents.dispose()
  }, 120_000)
})

describe("the fallen", () => {
  test("rush: a hero who gives up and leaves slumps, rises as a ghost, drifts to a grave and fades there", async () => {
    const session = playedTo("rush")
    const desk = agentDesk(island.kit)
    const agents = sessionAgents(
      session,
      async (req) => desk.plan(req),
      Date.now,
      () => 15,
    )
    agents.tick()
    await Promise.resolve()
    await Promise.resolve()
    const ghosts = agents
      .list()
      .map((a) => agents.itinerary?.(a.id))
      .filter((it): it is Itinerary => !!it?.ghost)
    expect(ghosts.length).toBeGreaterThan(0)
    const graves = island.kit.rest!.graves
    expect(graves.length).toBeGreaterThan(0)
    for (const it of ghosts) {
      const g = it.ghost!
      // slumped where it fell, not yet a ghost
      const before = poseAt(it, g.from - 1)!
      expect(before.ghost).toBeUndefined()
      expect(before.sample?.clip.startsWith("Sit_Floor")).toBe(true)
      // risen: a ghost, see-through, off the ground
      const risen = poseAt(it, g.from + GHOST_RISE_MS)!
      expect(risen.ghost).toBeCloseTo(1, 5)
      expect(risen.lift ?? 0).toBeGreaterThan(0.1)
      // it drifts (walks) to a grave and stays there, fading out; then it is gone
      expect(it.steps.some((s) => s.kind === "walk" && s.from >= g.from)).toBe(true)
      const there = poseAt(it, g.fade)!
      expect(graves.some((s) => Math.hypot(s.at[0] - there.at[0], s.at[2] - there.at[2]) < 0.6)).toBe(true)
      expect(poseAt(it, g.fade + GHOST_FADE_MS / 2)!.ghost!).toBeLessThan(0.6)
      expect(shownAt(it, g.fade + GHOST_FADE_MS + 1)).toBe(false)
    }
    agents.dispose()
  }, 120_000)
})

describe("the home's next demo", () => {
  test("the demos in the Demos page's order, round again after the last", () => {
    expect(DEMO_ORDER[0]).toBe("saga")
    expect(DEMO_ORDER).toContain("solo")
    expect(nextStory("solo")).toBe(DEMO_ORDER[DEMO_ORDER.indexOf("solo") + 1]!)
    expect(nextStory(DEMO_ORDER.at(-1)!)).toBe("saga")
  })

  test("the pill shows after a rest, counts down and plays the next story; the demo guild never asks", () => {
    expect(autoNextAt(PILL_AT_MS - 1, false).show).toBe(false)
    expect(autoNextAt(PILL_AT_MS, false)).toEqual({
      show: true,
      left: (NEXT_AT_MS - PILL_AT_MS) / 1000,
      go: false,
    })
    const played: StoryId[] = []
    const count = autoNext((id) => played.push(id))
    expect(count.frame(null, NEXT_AT_MS + 1)).toBeNull()
    expect(count.frame("solo", 0)).toBeNull()
    expect(count.frame("solo", 5000)).toBeNull()
    expect(count.frame("solo", PILL_AT_MS + 500)).toEqual({ title: expect.any(String), left: 8 })
    expect(count.frame("solo", NEXT_AT_MS)).toBeNull()
    expect(played).toEqual([nextStory("solo")])
    // once
    count.frame("solo", NEXT_AT_MS + 1000)
    expect(played).toHaveLength(1)
  })

  test("any input during the rest cancels it (until the story ends again); the pill plays at once", () => {
    const played: StoryId[] = []
    const count = autoNext((id) => played.push(id))
    // input while the story plays is watching it
    count.frame("party", 0)
    count.input(false)
    count.frame("party", PILL_AT_MS + 10)
    count.input(false)
    expect(count.frame("party", PILL_AT_MS + 20)).toBeNull()
    expect(count.frame("party", NEXT_AT_MS + 10)).toBeNull()
    expect(played).toEqual([])
    // played again from its start and over again: a fresh countdown
    count.frame("party", 0)
    expect(count.frame("party", PILL_AT_MS + 10)).not.toBeNull()
    count.input(true)
    expect(played).toEqual([nextStory("party")])
  })
})

describe("a repo's hall with no session: its resident guild", async () => {
  // opencode: five busy hands (the guildhall's chronicle has one)
  const bytes = await Bun.file(
    join(import.meta.dir, "../../../packages/sim/test/fixtures/repo/opencode.json.gz"),
  ).arrayBuffer()
  const repo = repoOf(await readChronicle(new Uint8Array(bytes)), "local")
  if (repo.kind !== "chronicled") throw new Error("the opencode chronicle")
  const built = hallBuild(repo, 4000)
  const h = hexIsland({ seed: hallSeed("anomalyco/opencode"), files: built.files })
  const z = hexZones(h, { places: built.places! })
  const w = hexWorld(h, z)
  const walk = hexWalk(h, z, w, { reach: workTiles(h, z) })
  const places = lifePlaces(h, z, w, walk, { heroSpots: HERO_SPOTS })
  const kit = kitOf(h, z, walk, places, w.graveyard, w)
  const builtPlaces = z.zones.flatMap((zone, zi) =>
    zone.place ? [{ id: zone.place.id, zone: zi, files: zone.place.files }] : [],
  )
  const residents = residentsOf(repo.hands ?? [], builtPlaces, repo.places)

  /** A day of the residents' life on a desk: from 07:00 for `hours` hours of life's day (20 a real hour). */
  async function day(hours: number) {
    const desk = agentDesk(kit)
    let secs = 0
    let hour = 7
    const src = residentAgents(
      residents,
      async (req) => desk.plan(req),
      () => hour,
    )
    const seen: { secs: number; id: string; pose: ReturnType<typeof poseAt> }[] = []
    for (; secs < (hours * 3600) / 20; secs += 1) {
      hour = (7 + (secs * 20) / 3600) % 24
      src.tick?.()
      await Promise.resolve()
      await Promise.resolve()
      for (const r of residents) seen.push({ secs, id: r.id, pose: src.poseAt(r.id, secs) as never })
    }
    return { src, seen }
  }

  test("three to five of the repo's busiest hands, each with places of its own", () => {
    expect(residents.length).toBeGreaterThanOrEqual(3)
    expect(residents.length).toBeLessThanOrEqual(5)
    expect(residents[0]!.name).toBe("Dax Raad")
    for (const r of residents) {
      expect(r.zones.length).toBeGreaterThan(0)
      expect(r.name.length).toBeGreaterThan(0)
    }
    expect(residentJoins(residents).every((e) => e.at === RESIDENT_EPOCH && e.kind === "actor.join")).toBe(
      true,
    )
  })

  test("their day is deterministic, works by day at their places, the tavern in the evening, a door at night", async () => {
    const a = await day(16)
    const b = await day(16)
    expect(JSON.stringify(a.seen)).toBe(JSON.stringify(b.seen))
    const home = kit.home
    for (const r of residents) {
      const mine = a.seen.filter((s) => s.id === r.id)
      // by day at work at one of its own places' hero spots
      const working = mine.filter((s) => s.pose?.act === "work" && s.secs < (10 * 3600) / 20)
      expect(working.length).toBeGreaterThan(0)
      expect(
        working.some((s) =>
          r.zones.some((zi) =>
            kit.spots(zi).some((g) => Math.hypot(g.at[0] - s.pose!.at[0], g.at[2] - s.pose!.at[2]) < 0.8),
          ),
        ),
      ).toBe(true)
      // walking between places
      expect(mine.some((s) => s.pose?.act === "walk")).toBe(true)
      // the evening (18:30–21:30: an hour and a half into the evening, past any work begun before 17:00): never at work
      const evening = mine.filter((s) => s.secs > (11.5 * 3600) / 20 && s.secs < (14.5 * 3600) / 20)
      expect(evening.some((s) => s.pose?.act === "work")).toBe(false)
      // at night (past 22:00) in at a door
      const night = mine.filter((s) => s.secs > (15.6 * 3600) / 20)
      expect(night.some((s) => s.pose === null)).toBe(true)
    }
    expect(home).toBeGreaterThanOrEqual(0)
    // the island's tavern fills in the evening: some of them toast there (their chips say so)
    if (kit.rest?.haunts.some((x) => x.kind === "tavern")) {
      const evening = a.seen.filter((s) => s.secs > (11 * 3600) / 20 && s.secs < (14.5 * 3600) / 20)
      const verbs = evening.map(
        (s) =>
          residentVerb(a.src.itinerary!(s.id)!, s.pose as AgentPose | null, RESIDENT_EPOCH + s.secs * 1000)
            .verb,
      )
      expect(verbs).toContain("at the tavern")
    }
  }, 300_000)
})
