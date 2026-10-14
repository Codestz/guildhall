/**
 * The agents on the island (hexworld lifeAgents.ts + lifePlan.ts, plan-hud-events.md L2): the demo is
 * a StoryFeed preset, a scripted guild's wire through normalize → EventLog → itineraries, planned with
 * the island's life in the worker, that shows the three demo heroes with their bodies and banners; a
 * recorded guild (`?agents=fixture`) binds to a hall's places; `?agents=0` shows none.
 */
import { afterAll, describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { GuildEvent } from "@guildhall/core"
import {
  bindPlaces,
  EventLog,
  flush,
  GONE_MS,
  normalize,
  normalizer,
  poseAt,
  readChronicle,
} from "@guildhall/sim"
import {
  guildhallZone,
  hexIsland,
  hexWalk,
  hexWorld,
  hexZones,
  installTilePrefabs,
  lifePlaces,
  parseTilePrefabs,
  workTiles,
} from "@guildhall/world"
import { hallBuild, repoOf } from "../src/hexworld/hall.ts"
import { agentSource, DEMO_AGENTS, demoStory } from "../src/hexworld/lifeAgents.ts"
import { agentDesk, HERO_SPOTS, kitOf, planGuild, planLife } from "../src/hexworld/lifePlan.ts"
import { sessionAgents } from "../src/hexworld/sessionAgents.ts"
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

const town = (seed: number, files = 4000) => {
  const h = hexIsland({ seed, files })
  const z = hexZones(h, {})
  const w = hexWorld(h, z)
  return { h, z, w }
}

describe("the demo story", () => {
  test("its wire is in order, one guild, seq by one", () => {
    const wire = demoStory()
    expect(wire.length).toBeGreaterThan(100)
    for (const [k, ev] of wire.entries()) {
      expect(ev.seq).toBe(k + 1)
      expect(ev.guild).toBe("demo")
      if (k) expect(ev.change.at).toBeGreaterThanOrEqual(wire[k - 1]!.change.at)
    }
  })

  for (const seed of [1, 2])
    test(`town ${seed}: the three demo heroes, event-driven, walk to their places and home, and loop`, () => {
      const { h, z, w } = town(seed)
      const plan = planLife(h, z, w, seed, undefined, { agents: { kind: "story" } })
      const agents = plan.agents!
      const source = agentSource(agents)
      // the bodies and banners they always had, in the story's join order, under its session ids
      expect(source.list().map(({ id: _, ...look }) => look)).toEqual(
        DEMO_AGENTS.map(({ id: _, ...look }) => look),
      )
      const id = Object.fromEntries(source.list().map((l) => [l.name.toLowerCase(), l.id]))
      expect(agents.cast.filter((c) => c.root).map((c) => c.id)).toEqual([id.claude])
      // everyone walks out and back: the subagents to their places, Claude after them
      for (const it of agents.itineraries)
        expect([it.id, it.steps.filter((s) => s.kind === "walk").length >= 2]).toEqual([it.id, true])
      // all three are out within seconds of the start, the subagents gone by the round's end
      for (const a of source.list()) expect(source.poseAt(a.id, 3)).not.toBeNull()
      const end = agents.period / 1000
      expect(source.poseAt(id.warden, end - 1)).toBeNull()
      expect(source.poseAt(id.scout, end - 1)).toBeNull()
      expect(source.poseAt(id.claude, end - 1)).not.toBeNull()
      // the round loops: the same pose a round later, and Claude ends where it began
      for (const s of [0, 37, 90, 160, 250])
        for (const a of source.list()) {
          const now = source.poseAt(a.id, s)
          const later = source.poseAt(a.id, s + end)
          expect(later?.act).toBe(now?.act)
          if (now && later)
            expect(Math.hypot(now.at[0] - later.at[0], now.at[2] - later.at[2])).toBeLessThan(1e-6)
        }
      expect(source.poseAt(id.claude, end - 0.001)?.at).toEqual(source.poseAt(id.claude, 0)?.at)
      // while Warden and Scout work, Claude keeps to the Guildhall's gathering (once back from the notice board)
      const walk = hexWalk(h, z, w, { reach: workTiles(h, z) })
      const places = lifePlaces(h, z, w, walk, { heroSpots: HERO_SPOTS })
      const gather = places.heroSpots(guildhallZone(walk, z))
      for (const s of [30, 60, 120]) {
        const p = source.poseAt(id.claude, s)!
        expect(p.act).not.toBe("walk")
        expect(gather.some((g) => g.at[0] === p.at[0] && g.at[2] === p.at[2])).toBe(true)
      }
      expect(plan.stats.agentsMs).toBeLessThan(2000)
    }, 60_000)

  test("`?agents=0`: no agents planned", () => {
    const { h, z, w } = town(1, 1500)
    expect(planLife(h, z, w, 1, undefined, { agents: null }).agents).toBeNull()
  }, 30_000)
})

describe("a recorded guild in its repo's hall", () => {
  test("the guildhall review: five heroes walk to the packages they read", async () => {
    const bytes = await Bun.file(join(import.meta.dir, "../public/lab/repo/guildhall.json.gz")).arrayBuffer()
    const repo = repoOf(await readChronicle(new Uint8Array(bytes)), "local")
    const built = hallBuild(repo, 4000)
    const seed = hallSeed("codestz/guildhall")
    const h = hexIsland({ seed, files: built.files })
    const z = hexZones(h, { places: built.places! })
    const w = hexWorld(h, z)
    const walk = hexWalk(h, z, w, { reach: workTiles(h, z) })
    const places = lifePlaces(h, z, w, walk, { heroSpots: HERO_SPOTS })
    const text = readFileSync(join(import.meta.dir, "../public/lab/feeds/guildhall-review.jsonl"), "utf8")
    const wire = text
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as GuildEvent)
    const plan = planGuild(
      z,
      walk,
      kitOf(h, z, walk, places),
      { kind: "wire", name: "fixture", wire },
      {
        places: built.places!,
        repo: repo.kind === "chronicled" ? repo.name : "",
      },
    )
    expect(plan.cast.length).toBe(5)
    expect(plan.cast.filter((c) => c.root)).toHaveLength(1)
    // somebody walks off to a package's place (not every one: some only read across the repo)
    const home = guildhallZone(walk, z)
    const out = plan.itineraries.filter((it) =>
      it.steps.some(
        (s) =>
          s.kind === "stay" &&
          s.act === "work" &&
          z.zones.some((_, zi) => zi !== home && places.heroSpots(zi).some((g) => g.at === s.at)),
      ),
    )
    expect(out.length).toBeGreaterThan(0)

    // the same guild as a hall's session (sessionAgents.ts): its log planned on the worker's desk, posed
    // at the session clock, the same as planned whole
    const binding = bindPlaces(built.places!, z, { repo: repo.kind === "chronicled" ? repo.name : "" })
    const ctx = normalizer({ placeOf: binding.placeOf })
    const log = new EventLog()
    for (const ev of wire) log.append(...normalize(ev, ctx))
    log.append(...flush(ctx, log.head.at + GONE_MS + 1))
    const desk = agentDesk(kitOf(h, z, walk, places))
    let at = log.events[0]!.at
    let resets: (() => void)[] = []
    const agents = sessionAgents(
      {
        log: () => log,
        clock: { get: () => ({ at }) } as never,
        feed: { kind: "replay" } as never,
        onReset: (fn) => {
          resets.push(fn)
          return () => {
            resets = resets.filter((f) => f !== fn)
          }
        },
      },
      async (req) => desk.plan(req),
    )
    agents.tick()
    await Promise.resolve()
    await Promise.resolve()
    expect(agents.list().map((l) => l.id)).toEqual(plan.cast.map((c) => c.id))
    expect(agents.version?.()).toBe(1)
    const whole = new Map(plan.itineraries.map((it) => [it.id, it]))
    for (let k = 0; k < 40; k++) {
      at = plan.span[0] + ((plan.span[1] - plan.span[0]) * k) / 39
      for (const a of agents.list()) expect(agents.poseAt(a.id, 0)).toEqual(poseAt(whole.get(a.id)!, at))
    }
    // nothing new: no new request
    agents.tick()
    expect(resets).toHaveLength(1)
    agents.dispose()
    expect(resets).toHaveLength(0)
  }, 60_000)
})
