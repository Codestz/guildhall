/**
 * The heroes' choreography (the game-feel plan's task E) on the hall's own island (/hall/codestz/guildhall
 * as the Studio builds it, at the hall's pace): every stay at work is seen worked (`WORK_DWELL_MS`), a
 * seated hero gets up before it walks off, a burst of quests is one pin and its recruits are briefed
 * together, a failed hero slumps where it failed before it walks home and is seen home before it fades,
 * the moments' beats are work FX kinds; and still a pose is a pure sample (scrub = play) and no two
 * heroes stand in one another. The saga's share of hero-time at work is printed (SHARE=1) and held.
 */
import { afterAll, describe, expect, test } from "bun:test"
import { type Change, hash } from "@guildhall/core"
import { installTilePrefabs } from "@guildhall/world"
import {
  BEAT_FX,
  craftRoutine,
  FADE_AFTER_MS,
  FAIL_HOLD_MS,
  flush,
  GONE_MS,
  type Itinerary,
  itineraries,
  LifePlanner,
  normalizer,
  playRoutine,
  poseAt,
  RISE_MS,
  WORK_DWELL_MS,
} from "../src/index.ts"
import { Feed, fileIn } from "./events-fixtures.ts"
import { HALL_OPTS, installTiles, sagaIsland, shareOf } from "./life-choreo-fixtures.ts"

installTiles()
afterAll(() => installTilePrefabs(null))

const hall = await sagaIsland()
const { kit } = hall
const saga = itineraries(hall.log, kit, HALL_OPTS)
const sagaEnd = hall.log.events[hall.log.length - 1]!.at
const T0 = hall.log.events[0]!.at

const SEATED = new Set(["Sit_Floor_Idle", "Sit_Floor_Down"])
const actAt = (it: Itinerary, t: number) => {
  const a = [...it.acts].reverse().find((x) => x.from <= t)
  return a && a.to > t ? a : undefined
}

/** A guild on the hall's island: a Guildmaster sends `n` quests in a burst; each recruit works in a package. */
function guild(seed: number, n = 3, opts: { fail?: boolean } = {}): Feed {
  let k = 0
  const r = () => (hash(`choreo:${seed}:${k++}`) >>> 0) / 2 ** 32
  const feed = new Feed(64, normalizer({ placeOf: hall.placeOf }))
  const acts: { at: number; run: (at: number) => void }[] = []
  const at = (t: number, run: (at: number) => void) => acts.push({ at: T0 + Math.round(t / 100) * 100, run })
  at(0, (when) => feed.start("root", when))
  const pkgs = ["core", "sim"] as const
  let end = 0
  for (let s = 0; s < n; s++) {
    const id = `sub${s}`
    // the quests within a second of each other (one pin), their sessions seen just after
    at(3000 + s * 300, (when) =>
      feed.change({
        type: "tool",
        id: "root",
        call: `q${s}`,
        name: "task",
        state: "running",
        input: { description: `Quest ${s}`, subagent_type: "explore" },
        at: when,
      } as Change),
    )
    at(3600 + s * 300, (when) => feed.start(id, when, "root", "explore"))
    let t = 6000
    const pkg = pkgs[s % pkgs.length]!
    for (let e = 0; e < 14; e++) {
      t += 2000 + r() * 3000
      at(t, (when) =>
        feed.tool(id, e % 4 === 0 ? "read" : "edit", { filePath: fileIn(pkg), newString: "x" }, when),
      )
    }
    t += 3000
    const failed = opts.fail && s === 0
    at(t, (when) =>
      feed.change({ type: "status", id, status: failed ? "failed" : "idle", at: when } as Change),
    )
    end = Math.max(end, t)
  }
  at(end + 5000, (when) => feed.change({ type: "status", id: "root", status: "idle", at: when } as Change))
  acts.sort((a, b) => a.at - b.at)
  for (const a of acts) a.run(a.at)
  feed.log.append(...flush(feed.ctx, T0 + end + 5000 + GONE_MS + 1000))
  return feed
}

const plans = [1, 2, 3].map((seed) => ({ seed, feed: guild(seed, 3, { fail: seed === 2 }) }))
const planned = plans.map((p) => ({ ...p, its: itineraries(p.feed.log, kit, HALL_OPTS) }))
const all = [
  { its: saga, end: sagaEnd },
  ...planned.map((p) => ({ its: p.its, end: p.feed.log.events.at(-1)!.at })),
]

describe("the hall's island has its notice board", () => {
  test("the world's board, its pinning spot before it and a briefing spot", () => {
    expect(hall.world.board).toBeTruthy()
    expect(kit.board).toBeTruthy()
    expect(kit.board!.at).toEqual(hall.world.board!.at)
    expect(kit.board!.brief.length).toBeGreaterThan(0)
  })
})

describe("craft poses are seen", () => {
  test("every stay at work it walked to shows its craft for WORK_DWELL_MS before it moves on", () => {
    let stays = 0
    for (const { its } of all)
      for (const it of its.values())
        for (const [k, s] of it.steps.entries()) {
          const prev = it.steps[k - 1]
          if (s.kind !== "stay" || s.act !== "work" || !("pose" in s) || prev?.kind !== "walk") continue
          if (s.pose === "gather" || s.pose === "board") continue
          // held where it stands by a moment (a plea, a green CI's cheer): not at its craft then
          const moment = it.acts.some(
            (a) =>
              a.play !== "craft" && a.play !== "think" && a.from < s.from + WORK_DWELL_MS && a.to > s.from,
          )
          if (moment) continue
          stays++
          expect(s.to - s.from).toBeGreaterThanOrEqual(WORK_DWELL_MS - 1e-6)
          for (let t = s.from + 50; t < s.from + WORK_DWELL_MS; t += 250) {
            const act = actAt(it, t)
            expect([it.id, t - s.from, act?.play]).toEqual([it.id, t - s.from, "craft"])
            const want = craftRoutine(act!.craft!, s.pose, it.seed).moves.map((m) => m.clip)
            expect(want).toContain(poseAt(it, t)?.sample?.clip as never)
          }
        }
    expect(stays).toBeGreaterThan(8)
  })

  test("the saga's hero-time at work is at least 40% (it was 5% walking 59%)", () => {
    const share = shareOf(saga, sagaEnd)
    const pct = (n: number) => Math.round((1000 * n) / share.total) / 10
    if (process.env.SHARE)
      console.log(`saga: craft ${pct(share.craft)}%, walk ${pct(share.walk)}%, other ${pct(share.other)}%`)
    expect(share.craft / share.total).toBeGreaterThanOrEqual(0.4)
    expect(share.walk / share.total).toBeLessThan(0.35)
  })
})

describe("standing up and sitting down", () => {
  test("a seated hero gets up where it sits (RISE_MS) before every walk; at rest it sits down on arrival", () => {
    let rises = 0
    let sits = 0
    for (const { its } of all)
      for (const it of its.values())
        for (const [k, s] of it.steps.entries()) {
          if (s.kind !== "walk") continue
          const before = poseAt(it, s.from - 1)
          // never straight from the ground into a walk
          expect([it.id, SEATED.has(before?.sample?.clip ?? "")]).toEqual([it.id, false])
          const prev = it.steps[k - 1]
          if (prev?.kind === "stay" && "rise" in prev && prev.rise) {
            rises++
            expect(s.from - prev.from).toBeCloseTo(RISE_MS, 6)
            expect(poseAt(it, prev.from + RISE_MS / 2)?.sample?.clip).toBe("Sit_Floor_StandUp")
          }
          const next = it.steps[k + 1]
          if (next?.kind === "stay" && next.act === "idle" && "pose" in next && next.pose === "gather") {
            const act = actAt(it, next.from + 100)
            if (!act || act.play === "craft" || act.play === "think") {
              sits++
              expect(poseAt(it, next.from + 100)?.sample?.clip).toBe("Sit_Floor_Down")
            }
          }
        }
    expect(rises).toBeGreaterThan(2)
    expect(sits).toBeGreaterThan(2)
    // the stand-up plays whole within RISE_MS
    const rise = playRoutine("rise", undefined, undefined)
    expect(rise.moves[0]).toMatchObject({ clip: "Sit_Floor_StandUp", ms: RISE_MS, fit: true })
  })
})

describe("the dispatch", () => {
  test("a burst of quests within a second is one pin; its recruits are briefed together", () => {
    for (const { seed, its } of planned) {
      const gm = its.get("root")!
      const pins = gm.acts.filter((a) => a.play === "pin")
      expect([seed, pins.length]).toEqual([seed, 1])
      const starts = ["sub0", "sub1", "sub2"].map(
        (id) => its.get(id)!.acts.find((a) => a.play === "brief")?.from,
      )
      expect(starts.every((s) => s !== undefined)).toBe(true)
      expect(new Set(starts).size).toBe(1)
      // he beckons until it is over
      expect(actAt(gm, starts[0]! + 100)?.play).toBe("beckon")
    }
  })
})

describe("a failure", () => {
  test("it slumps where it failed for 3 s at least, walks home, and is seen home 2 s before it fades", () => {
    const { feed, its } = planned.find((p) => p.seed === 2)!
    const fail = feed.log.events.find((e) => e.kind === "actor.fail")!
    expect(fail).toBeDefined()
    const it = its.get("id" in fail ? (fail.id as string) : "")!
    const blow = it.acts.find((a) => a.play === "fail")!
    expect(blow).toBeDefined()
    // at its place (the work spot it walked to), not on its way
    const stay = [...it.steps].reverse().find((s) => s.kind === "stay" && s.from <= blow.from)!
    expect(stay.kind === "stay" && "pose" in stay && stay.pose !== "gather").toBe(true)
    let slumped = 0
    for (let t = blow.from; t < blow.from + FAIL_HOLD_MS; t += 50)
      if (SEATED.has(poseAt(it, t)?.sample?.clip ?? "")) slumped += 50
    expect(slumped).toBeGreaterThanOrEqual(3000)
    // home: up, a walk, its seat; gone FADE_AFTER_MS at least after it got there
    const home = it.steps.findLast((s) => s.kind === "walk")!
    expect(home.from).toBeGreaterThanOrEqual(blow.from + FAIL_HOLD_MS)
    const fade = it.shown[it.shown.length - 1]![1]
    expect(fade - home.to).toBeGreaterThanOrEqual(FADE_AFTER_MS - 1e-6)
    expect(SEATED.has(poseAt(it, fade - 10)?.sample?.clip ?? "")).toBe(true)
  })

  test("every leaver is seen home FADE_AFTER_MS before it fades", () => {
    let leavers = 0
    for (const { its } of all)
      for (const it of its.values()) {
        const fade = it.shown[it.shown.length - 1]![1]
        if (!Number.isFinite(fade)) continue
        leavers++
        const last = it.steps.findLast((s) => s.kind === "walk" && s.from < fade)
        if (last) expect(fade - last.to).toBeGreaterThanOrEqual(FADE_AFTER_MS - 1e-6)
      }
    expect(leavers).toBeGreaterThan(5)
  })
})

describe("beats", () => {
  test("a bow's release, a pin and a cheer beat as work FX kinds", () => {
    expect(BEAT_FX).toEqual({ shoot: "glint", pin: "pages", cheer: "motes" })
    const beats = (moves: readonly { beat?: [string, number] }[]) =>
      moves.map((m) => m.beat?.[0]).filter(Boolean)
    expect(beats(craftRoutine("test", "desk").moves)).toEqual(["glint"])
    expect(beats(playRoutine("pin", undefined, undefined).moves)).toEqual(["pages"])
    expect(beats(playRoutine("cheer", undefined, undefined).moves)).toEqual(["motes"])
    expect(beats(playRoutine("deliver", undefined, undefined).moves)).toEqual(["loot", "motes"])
  })
})

describe("still pure, still apart", () => {
  test("planned whole or as the clock passes, the same pose at 50 random times (the saga and the guilds)", () => {
    for (const [n, log] of [hall.log, ...plans.map((p) => p.feed.log)].entries()) {
      const its = n === 0 ? saga : planned[n - 1]!.its
      let k = 0
      const r = () => (hash(`choreo-scrub:${n}:${k++}`) >>> 0) / 2 ** 32
      const last = log.events[log.length - 1]!.at
      const times = Array.from({ length: 50 }, () => T0 + r() * (last + 10_000 - T0)).sort((a, b) => a - b)
      const play = new LifePlanner(kit, HALL_OPTS)
      let next = 0
      for (const t of times) {
        while (next < log.length && log.events[next]!.at <= t) play.push(log.events[next++]!)
        play.advance(t)
        for (const id of its.keys())
          expect([n, id, t, play.poseAt(id, t)]).toEqual([n, id, t, poseAt(its.get(id)!, t)])
      }
    }
  }, 60_000)

  test("no two heroes standing stand in one another (half a metre apart at least)", () => {
    let pairs = 0
    for (const { its, end } of all)
      for (let t = T0; t < end; t += 250) {
        const standing = [...its.values()].map((it) => poseAt(it, t)).filter((p) => p && p.act !== "walk")
        for (let i = 0; i < standing.length; i++)
          for (let j = i + 1; j < standing.length; j++) {
            pairs++
            const a = standing[i]!.at
            const b = standing[j]!.at
            expect(Math.hypot(a[0] - b[0], a[2] - b[2])).toBeGreaterThan(0.5)
          }
      }
    expect(pairs).toBeGreaterThan(500)
  })
})
