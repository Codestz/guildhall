/**
 * What heroes do where they stand (life/craft.ts, the acts of life/itineraries.ts; the game-feel plan,
 * task D): the routine by craft and spot, never a hammer away from an anvil, crates or a scaffold; the
 * Guildmaster pinning a quest at the notice board and beckoning, the recruit's briefing, the loot carried
 * home and set down, a failure's slump, a plea's wave, a green CI's cheer; a sample the same played or
 * sought; the scaffold's progress.
 */
import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { type Change, CRAFTS, hash, type SeaEvent } from "@guildhall/core"
import {
  guildhallZone,
  type HeroPose,
  hexIsland,
  hexWalk,
  hexWorld,
  hexZones,
  installTilePrefabs,
  lifePlaces,
  type PlaceSpec,
  parseTilePrefabs,
  workTiles,
} from "@guildhall/world"
import {
  type AgentPose,
  BECKON_MS,
  BRIEF_MS,
  bindPlaces,
  CHEER_MS,
  CLIP_SECONDS,
  craftRoutine,
  deedLook,
  FAIL_HOLD_MS,
  flush,
  GONE_MS,
  HAMMER_POSES,
  HERO_CLIPS,
  HERO_PROP_STANDIN,
  HERO_PROPS,
  type HeroStay,
  type Itinerary,
  itineraries,
  type LifeKit,
  LifePlanner,
  normalizer,
  PIN_MS,
  playRoutine,
  poseAt,
  routineAt,
  routineMs,
  SCAFFOLD_EDITS,
  SETDOWN_MS,
  scaffoldProgress,
} from "../src/index.ts"
import { Feed, fileIn, PACKAGES } from "./events-fixtures.ts"

const DIR = join(import.meta.dir, "../../../data/tiles")
installTilePrefabs(
  parseTilePrefabs(
    Object.fromEntries(
      readdirSync(DIR)
        .filter((f) => f.endsWith(".json"))
        .map((f) => [f.slice(0, -5), JSON.parse(readFileSync(join(DIR, f), "utf8")) as unknown]),
    ),
  ).prefabs,
)
afterAll(() => installTilePrefabs(null))

const spec = (id: string, files: number, extra: Partial<PlaceSpec> = {}): PlaceSpec => ({
  id,
  label: id.split("/").pop() ?? id,
  kind: "settlement",
  tier: files >= 1000 ? 3 : files >= 60 ? 2 : 1,
  files,
  ...extra,
})
const REPO: PlaceSpec[] = [
  spec("packages/hall", 2400, { capital: true }),
  spec("/", 20, { kind: "harbour", label: "guildhall" }),
  spec("test", 300, { kind: "camp" }),
  spec("packages/core", 400),
  spec("packages/world", 900),
  spec("packages/sim", 120),
  spec("packages/render", 300),
]
const FILES = REPO.reduce((n, s) => n + s.files, 0)
const h = hexIsland({ seed: 2, files: FILES })
const z = hexZones(h, { places: REPO })
const w = hexWorld(h, z)
const walk = hexWalk(h, z, w, { reach: workTiles(h, z) })
const places = lifePlaces(h, z, w, walk, { heroSpots: 3 })
const home = guildhallZone(walk, z)
const binding = bindPlaces(REPO, z)
const board = places.heroSpots.board()!
const kit: LifeKit = {
  walk,
  spots: (zi) => places.heroSpots(zi),
  home,
  near: places.walkNear,
  island: h,
  board,
}

const T0 = 1_790_000_000_000
const near = (a: readonly number[], b: readonly number[], r = 1e-6) =>
  Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[2] ?? 0) - (b[2] ?? 0)) < r

const feedOf = () => new Feed(64, normalizer({ placeOf: binding.placeOf }))
let calls = 0
/** A quest: the Guildmaster's `task` call starts (the subagent's session follows). */
const quest = (feed: Feed, id: string, at: number) =>
  feed.change({
    type: "tool",
    id,
    call: `q${++calls}`,
    name: "task",
    state: "running",
    input: { description: "Mend the core", subagent_type: "explore" },
    at,
  } as Change)
const status = (feed: Feed, id: string, s: "busy" | "idle" | "failed" | "waiting", at: number) =>
  feed.change({ type: "status", id, status: s, at } as Change)
const read = (feed: Feed, id: string, pkg: (typeof PACKAGES)[number], at: number) =>
  feed.tool(id, "read", { filePath: fileIn(pkg, "a.ts") }, at)
const ci = (state: "failed" | "passed", at: number): SeaEvent =>
  ({
    repo: "o/r",
    kind: "ci",
    id: `ci-${state}-${at}`,
    state,
    name: "check",
    branch: "main",
    sha: "s",
    at,
  }) as SeaEvent

/** The stays of an itinerary at a point (to 1 µm). */
const staysAt = (it: Itinerary, at: readonly number[]) =>
  it.steps.filter((s): s is HeroStay => s.kind === "stay" && near(s.at, at))
const clipAt = (it: Itinerary, t: number) => poseAt(it, t)?.sample?.clip

describe("a hero works by craft and where it stands", () => {
  const POSES: (HeroPose | undefined)[] = [
    "anvil",
    "desk",
    "board",
    "dock",
    "crates",
    "dig",
    "chop",
    "field",
    "drill",
    "scaffold",
    "gather",
    undefined,
  ]
  const first = (craft: (typeof CRAFTS)[number], pose?: HeroPose, seed = 0) => {
    const r = craftRoutine(craft, pose, seed)
    return { clip: r.moves[0]!.clip, props: [...r.props] }
  }

  test("the craft → clip and props table", () => {
    const P = HERO_PROPS
    expect(first("read", "desk")).toEqual({ clip: "Working_B", props: [P.book] })
    expect(first("read", "anvil")).toEqual({ clip: "Working_B", props: [P.book] })
    expect(first("edit", "anvil")).toEqual({ clip: "Hammering", props: [P.hammer] })
    expect(first("write", "crates")).toEqual({ clip: "Hammering", props: [P.hammer] })
    expect(first("edit", "scaffold")).toEqual({ clip: "Hammering", props: [P.hammer] })
    expect(first("edit", "desk")).toEqual({ clip: "Working_A", props: [P.pencil] })
    expect(first("search", "dock")).toEqual({ clip: "Working_B", props: [P.map, P.magnifier] })
    expect(first("fetch", undefined)).toEqual({ clip: "Working_B", props: [P.map, P.magnifier] })
    // a volley: draw, aim, release
    const volley = craftRoutine("test", "desk").moves.map((m) => m.clip)
    expect(volley).toEqual(["Ranged_Bow_Draw", "Ranged_Bow_Aiming_Idle", "Ranged_Bow_Release"])
    expect(craftRoutine("lint", "desk").props).toEqual([P.bow])
    // at the camp's targets, some heroes spar instead
    expect(first("test", "drill", 1).clip).toBe("Melee_1H_Attack_Slice_Diagonal")
    expect(first("test", "drill", 0).clip).toBe("Ranged_Bow_Draw")
    expect(first("run", "anvil")).toEqual({ clip: "Use_Item", props: [P.file] })
    expect(first("run", "dock")).toEqual({ clip: "Lockpicking", props: [P.file] })
    expect(first("plan", "desk").clip).toBe("Idle_B")
    expect(first("consult", "desk")).toEqual({ clip: "Ranged_Magic_Spellcasting_Long", props: [P.staff] })
    expect(first("delegate", "board")).toEqual({ clip: "Ranged_Magic_Summon", props: [P.staff] })
  })

  test("never a hammer away from an anvil, crates or a scaffold", () => {
    for (const craft of CRAFTS)
      for (const pose of POSES)
        for (const seed of [0, 1]) {
          const hammers = craftRoutine(craft, pose, seed).moves.some((m) => m.clip === "Hammering")
          if (hammers)
            expect([craft, pose, pose !== undefined && HAMMER_POSES.has(pose)]).toEqual([craft, pose, true])
          const props = [...craftRoutine(craft, pose, seed).props]
          if (props.includes(HERO_PROPS.hammer)) expect(hammers).toBe(true)
        }
    expect([...HAMMER_POSES].sort()).toEqual(["anvil", "crates", "scaffold"])
  })

  test("every clip a routine plays is the rig's, at its length; the deeds' looks name rig clips", () => {
    const plays = [
      "think",
      "pin",
      "beckon",
      "brief",
      "carry",
      "deliver",
      "plea",
      "fail",
      "slump",
      "standup",
      "cheer",
      "rest",
    ] as const
    const used = new Set<string>()
    for (const craft of CRAFTS)
      for (const pose of POSES) for (const m of craftRoutine(craft, pose, 1).moves) used.add(m.clip)
    for (const p of plays) for (const m of playRoutine(p, undefined, undefined).moves) used.add(m.clip)
    for (const c of used) expect(HERO_CLIPS).toContain(c as never)
    for (const craft of CRAFTS) expect(HERO_CLIPS).toContain(deedLook(craft).clip as never)
    const index = join(import.meta.dir, "../../../library/catalog/index.json")
    if (!existsSync(index)) return
    const rigs = (
      JSON.parse(readFileSync(index, "utf8")) as {
        rigs: { id: string; clips: { name: string; seconds: number }[] }[]
      }
    ).rigs
    const rig = new Map(rigs.find((r) => r.id === "rig-medium")!.clips.map((c) => [c.name, c.seconds]))
    for (const [clip, secs] of Object.entries(CLIP_SECONDS))
      expect([clip, rig.get(clip)]).toEqual([clip, secs])
  })

  test("a stand-in is shown for each prop the library cannot mount yet (a mounted one), never for one it can", () => {
    const file = join(import.meta.dir, "../../../data/mounts.json")
    const mounts = (JSON.parse(readFileSync(file, "utf8")) as { mounts: Record<string, unknown> }).mounts
    // the catalog's own mounts (the adventurers' book, staff, bow) besides data/mounts.json's
    const own = new Set<string>([HERO_PROPS.book, HERO_PROPS.staff, HERO_PROPS.bow])
    const mounted = (id: string) => own.has(id) || id in mounts
    for (const id of Object.values(HERO_PROPS)) {
      const stand = HERO_PROP_STANDIN[id]
      if (mounted(id)) expect([id, stand]).toEqual([id, undefined])
      else expect([id, stand !== undefined && mounted(stand)]).toEqual([id, true])
    }
  })

  test("a routine is a pure function of the time since it began: phases wrap, beats fall on their cue", () => {
    const hammer = craftRoutine("edit", "anvil")
    const cycle = CLIP_SECONDS.Hammering * 1000
    expect(routineAt(hammer, 0)).toMatchObject({ clip: "Hammering", phase: 0 })
    expect(routineAt(hammer, cycle * 2.5).phase).toBeCloseTo(0.5, 9)
    expect(routineAt(hammer, cycle * 0.45).beat).toBe("hit")
    expect(routineAt(hammer, cycle * 0.9).beat).toBeUndefined()
    // a volley loops whole; thinking steps away and comes back to its spot
    const volley = craftRoutine("test", "desk")
    expect(routineAt(volley, routineMs(volley) + 10).clip).toBe("Ranged_Bow_Draw")
    const think = playRoutine("think", undefined, undefined)
    const away = routineAt(think, CLIP_SECONDS.Idle_B * 1000 + CLIP_SECONDS.Walking_A * 1000 + 100, 0)
    expect(Math.hypot(away.dx, away.dz)).toBeCloseTo(0.6, 6)
    const back = routineAt(think, routineMs(think) - 1, 0)
    expect(Math.hypot(back.dx, back.dz)).toBeLessThan(0.01)
    // a moment holds its last move
    const fail = playRoutine("fail", undefined, undefined)
    expect(routineAt(fail, 100).clip).toBe("Hit_A")
    expect(routineAt(fail, 60_000).clip).toBe("Sit_Floor_Idle")
  })
})

/**
 * The dispatch: the Guildmaster at work in the hall sends a quest at +3 s; the recruit's session is seen
 * at +3.6 s, reads, then edits the core from +12 s, and finishes at +120 s (its loot comes home).
 */
function dispatch() {
  const feed = feedOf()
  status(feed, "root", "busy", T0)
  feed.change({ type: "session", id: "root", agent: "build", at: T0 } as Change)
  const q = T0 + 3000
  quest(feed, "root", q)
  feed.start("sub", q + 600, "root", "explore")
  read(feed, "sub", "core", q + 2500)
  for (let k = 0; k < 30; k++) feed.edit("sub", "core", T0 + 12_000 + k * 3000)
  status(feed, "sub", "idle", T0 + 120_000)
  feed.log.append(...flush(feed.ctx, T0 + 120_000 + GONE_MS + 1000))
  return { feed, q, its: itineraries(feed.log, kit) }
}

describe("the Guildmaster's dispatch at the notice board", () => {
  const { its, q } = dispatch()
  const gm = its.get("root")!
  const sub = its.get("sub")!

  test("he walks to the board, pins the quest, beckons; back to his seat after the briefing", () => {
    const [atBoard] = staysAt(gm, board.spot.at)
    expect(atBoard).toBeDefined()
    const arrive = atBoard!.from
    // he set off when the quest was sent (a walk from then to the board)
    const walk = gm.steps.find((s) => s.kind === "walk" && s.from === q)
    expect(walk?.to).toBe(arrive)
    expect(arrive - q).toBeLessThan(15_000)
    expect(clipAt(gm, arrive + 100)).toBe("Interact")
    expect(poseAt(gm, arrive + 100)?.sample?.props).toEqual([HERO_PROPS.scroll])
    expect(poseAt(gm, arrive + PIN_MS * 0.6)?.sample?.beat).toBe("pin")
    expect(clipAt(gm, arrive + PIN_MS + 100)).toBe("Waving")
    // facing the recruit's briefing spot while he beckons
    const beckon = poseAt(gm, arrive + PIN_MS + 100)!
    const want = Math.atan2(
      board.brief[0]!.at[0] - board.spot.at[0],
      board.brief[0]!.at[2] - board.spot.at[2],
    )
    expect(Math.cos(beckon.facing - want)).toBeCloseTo(1, 6)
    // the recruit is briefed before him once the pin is up, for BRIEF_MS, a scroll in hand
    const briefed = sub.steps.find(
      (s): s is HeroStay => s.kind === "stay" && board.brief.some((b) => near(b.at, s.at)),
    )!
    expect(briefed).toBeDefined()
    const start = Math.max(briefed.from, arrive + PIN_MS)
    expect(clipAt(sub, start + 100)).toBe("PickUp")
    expect(poseAt(sub, start + 100)?.sample?.beat).toBeUndefined()
    expect(poseAt(sub, start + BRIEF_MS * 0.55)?.sample?.beat).toBe("pickup")
    expect(clipAt(sub, start + BRIEF_MS + 100)).not.toBe("PickUp")
    // the recruit faces him
    const at = poseAt(sub, start + 100)!
    expect(
      Math.cos(at.facing - Math.atan2(board.spot.at[0] - at.at[0], board.spot.at[2] - at.at[2])),
    ).toBeCloseTo(1, 6)
    // he beckons on until the briefing is over (and half a second), then walks back to his seat
    expect(clipAt(gm, start + BRIEF_MS)).toBe("Waving")
    const back = gm.steps.find((s) => s.kind === "walk" && s.from > arrive)!
    expect(back.from).toBe(start + BRIEF_MS + 500)
    expect(poseAt(gm, back.from + 10)?.act).toBe("walk")
    // and sits at his seat in the gathering while the recruit works (a gathering spot: rest)
    const seat = gm.steps[gm.steps.indexOf(back) + 1]! as HeroStay
    expect(places.heroSpots(home).some((g) => near(g.at, seat.at))).toBe(true)
    expect(clipAt(gm, seat.from + 3000)).toBe("Sit_Floor_Idle")
    // nobody comes for BECKON_MS: alone he would have gone back then
    expect(BECKON_MS).toBeGreaterThan(BRIEF_MS)
  })

  test("the recruit sets off to its work from the gathering, and works by craft there", () => {
    const work = sub.steps.find((s): s is HeroStay => s.kind === "stay" && s.act === "work" && !!s.pose)!
    expect(work).toBeDefined()
    const t = work.from + 2000
    const sample = poseAt(sub, t)?.sample
    const hammer = work.pose && HAMMER_POSES.has(work.pose)
    expect(sample?.clip).toBe(hammer ? "Hammering" : "Working_A")
  })

  test("the loot comes home: carried to him, set down, cheered", () => {
    const carry = sub.steps.find((s) => s.kind === "walk" && s.from === T0 + 120_000)!
    expect(carry).toBeDefined()
    const mid = (carry.from + carry.to) / 2
    expect(poseAt(sub, mid)?.act).toBe("walk")
    expect(poseAt(sub, mid)?.sample?.props).toEqual([HERO_PROPS.chest])
    const at = carry.to
    // before him (0.9 m off his seat), facing him
    const gmAt = poseAt(gm, at + 100)!
    const there = poseAt(sub, at + 100)!
    expect(Math.hypot(there.at[0] - gmAt.at[0], there.at[2] - gmAt.at[2])).toBeCloseTo(0.9, 3)
    expect(there.sample?.clip).toBe("PickUp")
    expect(there.sample?.props).toEqual([HERO_PROPS.chest])
    expect(clipAt(sub, at + SETDOWN_MS + 100)).toBe("Cheering")
    expect(poseAt(sub, at + SETDOWN_MS + 100)?.sample?.props).toEqual([])
    // then it takes its seat (or, its time on the island up, fades there)
    const after = poseAt(sub, at + SETDOWN_MS + CHEER_MS + 400)
    if (after) expect(after.act).toBe("walk")
    else expect(sub.shown[0]![1]).toBe(at + SETDOWN_MS + CHEER_MS)
  })

  test("two Guildmasters share the board one at a time: the second's quest goes unpinned", () => {
    const feed = feedOf()
    status(feed, "a", "busy", T0)
    status(feed, "b", "busy", T0 + 100)
    quest(feed, "a", T0 + 2000)
    quest(feed, "b", T0 + 2500)
    feed.start("a1", T0 + 2600, "a", "explore")
    feed.start("b1", T0 + 2700, "b", "explore")
    feed.log.append(...flush(feed.ctx, T0 + 40_000))
    const its = itineraries(feed.log, kit)
    expect(staysAt(its.get("a")!, board.spot.at)).toHaveLength(1)
    expect(staysAt(its.get("b")!, board.spot.at)).toHaveLength(0)
    // a's recruit is briefed, b's is not
    const briefed = (id: string) => its.get(id)!.acts.some((x) => x.play === "brief")
    expect([briefed("a1"), briefed("b1")]).toEqual([true, false])
  })
})

describe("failure, a plea and a green CI", () => {
  const feed = feedOf()
  status(feed, "root", "busy", T0)
  quest(feed, "root", T0 + 1000)
  feed.start("sub", T0 + 1500, "root", "explore")
  for (let k = 0; k < 45; k++) feed.edit("sub", "world", T0 + 5000 + k * 3000)
  // it asks a human at +150 s and is answered at +160 s; the CI goes red, then green at +170 s
  status(feed, "sub", "waiting", T0 + 150_000)
  status(feed, "sub", "busy", T0 + 160_000)
  feed.sea(ci("failed", T0 + 165_000))
  feed.sea(ci("passed", T0 + 170_000))
  feed.edit("sub", "world", T0 + 172_000)
  status(feed, "sub", "failed", T0 + 180_000)
  status(feed, "sub", "busy", T0 + 420_000)
  feed.edit("sub", "world", T0 + 421_000)
  status(feed, "sub", "idle", T0 + 480_000)
  feed.log.append(...flush(feed.ctx, T0 + 480_000 + GONE_MS + 1000))
  const its = itineraries(feed.log, kit)
  const sub = its.get("sub")!
  const gm = its.get("root")!

  test("a plea is a wave until answered", () => {
    expect(poseAt(sub, T0 + 150_000)?.act).not.toBe("walk")
    expect(clipAt(sub, T0 + 152_000)).toBe("Waving")
    expect(clipAt(sub, T0 + 162_000)).not.toBe("Waving")
  })

  test("a green CI: everyone standing cheers for a while, then goes on", () => {
    expect(clipAt(sub, T0 + 170_500)).toBe("Cheering")
    expect(clipAt(gm, T0 + 170_500)).toBe("Cheering")
    expect(clipAt(sub, T0 + 170_000 + CHEER_MS + 500)).not.toBe("Cheering")
  })

  test("a failure: the blow, a slump where it stands, then home to slump at its seat; it stands up when it recovers", () => {
    const t = T0 + 180_000
    const where = poseAt(sub, t - 1)!
    expect(clipAt(sub, t + 100)).toBe("Hit_A")
    expect(clipAt(sub, t + 1200)).toBe("Sit_Floor_Down")
    expect(clipAt(sub, t + 3000)).toBe("Sit_Floor_Idle")
    const stay = sub.steps.find((s) => s.kind === "stay" && s.from === t) as HeroStay
    expect(poseAt(sub, t + FAIL_HOLD_MS - 10)?.at).toEqual(stay.at)
    expect(near(stay.at, where.at, 0.7)).toBe(true)
    expect(poseAt(sub, t + FAIL_HOLD_MS + 500)?.act).toBe("walk")
    const seat = sub.steps.find((s): s is HeroStay => s.kind === "stay" && s.from > t + FAIL_HOLD_MS)!
    expect(places.heroSpots(home).some((g) => near(g.at, seat.at))).toBe(true)
    const gone = Math.min(T0 + 420_000, sub.shown[0]![1])
    if (seat.from + 3000 < gone) expect(clipAt(sub, seat.from + 3000)).toBe("Sit_Floor_Idle")
    else expect(sub.acts.find((a) => a.from === t + FAIL_HOLD_MS)?.play).toBe("slump")
    expect(clipAt(sub, T0 + 420_100)).toBe("Sit_Floor_StandUp")
  })
})

/** A busier guild: quests, reads, edits, tests, pleas, a failure, the CI; on a seeded random. */
function busy(seed: number): Feed {
  let k = 0
  const r = () => (hash(`craft:${seed}:${k++}`) >>> 0) / 2 ** 32
  const feed = feedOf()
  const acts: { at: number; run: (at: number) => void }[] = []
  const at = (t: number, run: (at: number) => void) => acts.push({ at: T0 + Math.round(t / 250) * 250, run })
  at(0, (when) => status(feed, "root", "busy", when))
  let end = 0
  for (let s = 0; s < 3; s++) {
    const id = `sub${s}`
    let t = 2000 + s * 9000
    at(t, (when) => quest(feed, "root", when))
    at(t + 500, (when) => feed.start(id, when, "root", "explore"))
    t += 2000
    // the first works in the capital (the town's forge), the others in a package's place
    const pkg = PACKAGES[Math.floor(r() * PACKAGES.length)]!
    const filePath = s === 0 ? "/Users/me/guildhall/packages/hall/src/a.ts" : fileIn(pkg)
    for (let e = 0; e < 40; e++) {
      t += 2000 + r() * 3000
      const roll = r()
      if (roll < 0.2) at(t, (when) => feed.tool(id, "read", { filePath }, when))
      else if (roll < 0.3) at(t, (when) => feed.tool(id, "bash", { command: "bun test" }, when))
      else at(t, (when) => feed.tool(id, "edit", { filePath, newString: "x" }, when))
    }
    if (r() < 0.5) {
      t += 2000
      at(t, (when) => status(feed, id, "waiting", when))
      t += 3000
      at(t, (when) => status(feed, id, "busy", when))
    }
    t += 3000
    const failed = r() < 0.4
    at(t, (when) => status(feed, id, failed ? "failed" : "idle", when))
    end = Math.max(end, t)
  }
  at(end / 2, (when) => feed.sea(ci("failed", when)))
  at(end / 2 + 4000, (when) => feed.sea(ci("passed", when)))
  at(end + 5000, (when) => status(feed, "root", "idle", when))
  acts.sort((a, b) => a.at - b.at)
  for (const a of acts) a.run(a.at)
  feed.log.append(...flush(feed.ctx, T0 + end + 5000 + GONE_MS + 1000))
  return feed
}

describe("a sample is pure: scrub = play", () => {
  test("planned whole or as the clock passes, the same pose and sample at 50 random times", () => {
    let samples = 0
    for (const seed of [1, 2, 3]) {
      const feed = busy(seed)
      const its = itineraries(feed.log, kit)
      let k = 0
      const r = () => (hash(`scrub:${seed}:${k++}`) >>> 0) / 2 ** 32
      const last = feed.log.events[feed.log.length - 1]!.at
      const times = Array.from({ length: 50 }, () => T0 + r() * (last + 10_000 - T0)).sort((a, b) => a - b)
      const play = new LifePlanner(kit)
      let next = 0
      const events = feed.log.events
      for (const t of times) {
        while (next < events.length && events[next]!.at <= t) play.push(events[next++]!)
        play.advance(t)
        for (const id of its.keys()) {
          const seek: AgentPose | null = poseAt(its.get(id)!, t)
          expect([seed, id, t, play.poseAt(id, t)]).toEqual([seed, id, t, seek])
          if (seek?.sample) samples++
        }
      }
    }
    expect(samples).toBeGreaterThan(60)
  }, 120_000)

  test("in a busy guild, every hammer stands at an anvil, crates or a scaffold", () => {
    let hammers = 0
    let crafts = 0
    for (const seed of [1, 2, 3, 4]) {
      const its = itineraries(busy(seed).log, kit)
      for (const it of its.values())
        for (const s of it.steps) {
          if (s.kind !== "stay") continue
          const end = Math.min(s.to, s.from + 120_000)
          for (let t = s.from; t < end; t += 700) {
            const p = poseAt(it, t)
            if (!p?.sample) continue
            crafts++
            if (p.sample.clip !== "Hammering") continue
            hammers++
            expect(s.pose !== undefined && HAMMER_POSES.has(s.pose)).toBe(true)
          }
        }
    }
    expect(crafts).toBeGreaterThan(200)
    expect(hammers).toBeGreaterThan(20)
  }, 60_000)
})

describe("the scaffold's progress", () => {
  test("edits at a place build it, 0..1, shared among the places a call names; a failed one counts for nothing", () => {
    const feed = feedOf()
    status(feed, "a", "busy", T0)
    const core = binding.placeOf(fileIn("core"))!
    for (let k = 0; k < 6; k++) feed.edit("a", "core", T0 + 1000 + k * 1000)
    feed.tool("a", "read", { filePath: fileIn("core") }, T0 + 9000)
    feed.tool("a", "edit", { filePath: fileIn("core"), newString: "x" }, T0 + 10_000, {
      state: "failed",
      error: "no",
    } as never)
    expect(scaffoldProgress(feed.log, core, T0)).toBe(0)
    expect(scaffoldProgress(feed.log, core, T0 + 1500)).toBeCloseTo(1 / SCAFFOLD_EDITS, 9)
    expect(scaffoldProgress(feed.log, core, T0 + 20_000)).toBeCloseTo(6 / SCAFFOLD_EDITS, 9)
    expect(scaffoldProgress(feed.log, core, T0 + 20_000, { from: T0 + 3500 })).toBeCloseTo(
      3 / SCAFFOLD_EDITS,
      9,
    )
    expect(scaffoldProgress(feed.log, core, T0 + 20_000, { edits: 4 })).toBe(1)
    const world = binding.placeOf(fileIn("world"))!
    expect(scaffoldProgress(feed.log, world, T0 + 20_000)).toBe(0)
  })
})
