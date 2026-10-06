import { afterAll, describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { Session } from "@guildhall/core"
import { AudioEngine } from "../src/audio/engine.ts"
import { keyOf, renownMotifOf } from "../src/audio/music.ts"
import {
  EVENT_KINDS,
  type EventKind,
  type LedgerContext,
  type Renown,
  RenownLedger,
  RULES,
  renownOf,
  skyAt,
  WorldEvents,
  worldEventsOf,
} from "../src/guild/events.ts"
import { legendMarkdown, legendOf } from "../src/guild/legends.ts"
import { type Moment, MomentStream } from "../src/guild/moments.ts"
import { GuildStore } from "../src/guild/store.ts"
import { listen, Narrator, proclaim, renownLine } from "../src/guild/story.ts"

// ─────────────────────────────── helpers ───────────────────────────────

const MIN = 60_000

/** A bare session (what a lookup returns). */
function session(id: string, patch: Partial<Session> = {}): Session {
  return {
    id,
    agent: "guild-implementer",
    title: id,
    status: "running",
    since: 0,
    started: 0,
    entries: [],
    tokens: 0,
    cost: 0,
    denied: [],
    steps: 0,
    seen: 0,
    ...patch,
  }
}

/** A run of moments for a party under guildmaster "m", in run-time order, live unless told. */
class Script {
  readonly moments: Moment[] = []
  private seq = 0
  constructor(private readonly live = true) {}

  add(kind: Moment["kind"], id: string, at: number, extra: Record<string, unknown> = {}): this {
    this.moments.push({
      kind,
      id,
      agent: id === "m" ? "guild-master" : "guild-implementer",
      title: id === "m" ? "Guildmaster" : `Hero ${id}`,
      color: "#c9a",
      ...(id === "m" ? {} : { parent: "m" }),
      master: "m",
      seq: ++this.seq,
      at,
      live: this.live,
      ...extra,
    } as Moment)
    return this
  }
  deeds(id: string, from: number, n: number, every = 1000, tool = "read"): this {
    for (let i = 0; i < n; i++) this.add("deed", id, from + i * every, { tool, call: `${id}-${from}-${i}` })
    return this
  }
  failed(id: string, at: number, tool = "bash"): this {
    return this.add("deed-failed", id, at, { tool, call: `${id}-f-${at}`, error: "1 failed" })
  }
}

const noParty: LedgerContext = { session: () => undefined, party: () => [] }

/** Everything a ledger earns over a script. */
function earned(script: Script, ctx: LedgerContext = noParty) {
  const ledger = new RenownLedger()
  const over: string[] = []
  for (const m of script.moments)
    for (const h of ledger.take(m, ctx)) if (h.type === "over") over.push(h.kind)
  return { earned: ledger.earned, kinds: ledger.earned.map((r) => r.kind), over }
}

const kindsOf = (script: Script, ctx?: LedgerContext) => earned(script, ctx).kinds

// ─────────────────────────────── the rules ───────────────────────────────

describe("events: festival (a clean sweep)", () => {
  test("a quest that finishes with ≥ 15 deeds and none failed earns a festival", () => {
    const s = new Script().add("join", "a", 0).deeds("a", 1000, RULES.festivalDeeds).add("loot", "a", 30_000)
    const { earned: list } = earned(s)
    expect(list.map((r) => r.kind)).toEqual(["festival"])
    expect(list[0]?.facts.deeds).toBe(15)
    expect(list[0]?.hero?.id).toBe("a")
  })
  test("one deed short, or one failed deed, earns nothing", () => {
    const short = new Script()
      .add("join", "a", 0)
      .deeds("a", 1000, RULES.festivalDeeds - 1)
      .add("loot", "a", 30_000)
    expect(kindsOf(short)).toEqual([])
    const flawed = new Script()
      .add("join", "a", 0)
      .deeds("a", 1000, 20)
      .failed("a", 25_000, "edit")
      .add("loot", "a", 30_000)
    expect(kindsOf(flawed)).toEqual([])
  })
  test("the whole quest clean (no failures, no falls) is a festival for the guild", () => {
    const s = new Script()
      .deeds("m", 0, 8)
      .add("join", "a", 9000)
      .deeds("a", 10_000, 9)
      .add("loot", "m", 40_000)
    const { earned: list } = earned(s)
    expect(list.map((r) => r.kind)).toEqual(["festival"])
    expect(list[0]?.facts.whole).toBe(true)
    const fell = new Script()
      .deeds("m", 0, 20)
      .add("join", "a", 21_000)
      .add("fail", "a", 22_000)
      .add("loot", "m", 40_000)
    expect(kindsOf(fell)).not.toContain("festival")
  })
})

describe("events: ghost ship (lost after a long run, or several fallen)", () => {
  test("two falls within two minutes in one quest", () => {
    const s = new Script()
      .add("join", "a", 0)
      .add("join", "b", 0)
      .add("fail", "a", 10_000)
      .add("fail", "b", 70_000)
    expect(kindsOf(s)).toEqual(["ghost-ship"])
    expect(earned(s).earned[0]?.facts.fallen).toBe(2)
  })
  test("one fall after a long run (≥ 6 min)", () => {
    const s = new Script()
      .add("join", "a", 0)
      .deeds("a", 1000, 3, 2 * MIN)
      .add("fail", "a", 7 * MIN)
    expect(kindsOf(s)).toEqual(["ghost-ship"])
  })
  test("a single quick fall, or two falls far apart, summon nothing", () => {
    expect(kindsOf(new Script().add("join", "a", 0).add("fail", "a", 30_000))).toEqual([])
    const apart = new Script()
      .add("join", "a", 0)
      .add("join", "b", 0)
      .add("fail", "a", 10_000)
      .add("fail", "b", 10_000 + RULES.ghostWindowMs + 1000)
    expect(kindsOf(apart)).toEqual([])
  })
})

describe("events: rainbow (the sky clears after the storm)", () => {
  test("the mirrored sky: a fall is a storm, a run of clean deeds is clear", () => {
    expect(skyAt(10_000, [], [5_000])).toBe("storm")
    expect(skyAt(10_000, [{ at: 9000, ok: true }], [])).toBe("clear")
    const bad = [1, 2, 3].map((i) => ({ at: 9000 - i * 2000, ok: false }))
    expect(["rain", "storm"]).toContain(skyAt(10_000, bad, []))
  })
  test("a storm then clean work earns a rainbow once the sky reads clear", () => {
    const s = new Script()
      .add("join", "a", 0)
      .deeds("a", 1000, 5)
      .add("fail", "m", 10_000)
      .deeds("a", 20_000, 40, 5000)
    const { earned: list } = earned(s)
    expect(list.map((r) => r.kind)).toEqual(["rainbow"])
    // Not before the storm has blown over: a fall's storm pressure drops under the storm line
    // ~72.5 s after it, and the sky holds its worst for 10 s more (environment.ts).
    expect(list[0]?.at).toBeGreaterThanOrEqual(10_000 + 72_500 + 10_000)
  })
  test("no rainbow while it keeps failing, and none from a sky that was never stormy", () => {
    const stormy = new Script().add("join", "a", 0)
    for (let i = 0; i < 30; i++) stormy.failed("a", 1000 + i * 8000, "edit").deeds("a", 2000 + i * 8000, 1)
    expect(kindsOf(stormy)).not.toContain("rainbow")
    expect(kindsOf(new Script().add("join", "a", 0).deeds("a", 0, 60, 2000))).toEqual([])
  })
  test("a sky that clears only after the window earns nothing", () => {
    // The storm, then silence past the window: the next clean deeds come too late for a rainbow.
    const late = new Script()
      .add("join", "a", 0)
      .add("fail", "m", 1000)
      .deeds("a", 2000, 1)
      .deeds("a", 1000 + RULES.rainbowWindowMs + 60_000, 3, 1000)
    expect(kindsOf(late)).toEqual([])
  })
})

describe("events: raid (the treasury)", () => {
  const spent = (tokens: number, cost = 0): LedgerContext => {
    const root = session("m", { agent: "guild-master", tokens, cost })
    return { session: (id) => (id === "m" ? root : undefined), party: () => [root] }
  }
  test("past two million tokens, or ten in gold, pirates anchor — and leave when the quest ends", () => {
    const s = new Script().deeds("m", 0, 3).add("loot", "m", 9000)
    const rich = earned(s, spent(RULES.raidTokens))
    expect(rich.kinds).toEqual(["raid"])
    expect(rich.earned[0]?.facts.spent).toBe("tokens")
    expect(rich.over).toContain("raid")
    expect(earned(new Script().deeds("m", 0, 2), spent(0, RULES.raidCost)).kinds).toEqual(["raid"])
  })
  test("a modest purse and a short run: no raid", () => {
    expect(kindsOf(new Script().deeds("m", 0, 10), spent(RULES.raidTokens - 1, 1))).toEqual([])
  })
  test("a very long run raids even a thrifty guild", () => {
    const s = new Script().deeds("m", 0, 1).deeds("m", RULES.raidRunMs + 1000, 1)
    const { earned: list } = earned(s, spent(10))
    expect(list.map((r) => r.kind)).toEqual(["raid"])
    expect(list[0]?.facts.spent).toBe("time")
  })
  test("once per party: the treasury is raided once", () => {
    expect(kindsOf(new Script().deeds("m", 0, 50), spent(RULES.raidTokens * 3))).toEqual(["raid"])
  })
})

describe("events: comet (milestones)", () => {
  test("the 100th deed, and not the 99th", () => {
    expect(kindsOf(new Script().deeds("m", 0, 99))).toEqual([])
    const list = earned(new Script().deeds("m", 0, 100)).earned
    expect(list.map((r) => r.kind)).toEqual(["comet"])
    expect(list[0]?.facts.deeds).toBe(100)
  })
  test("the 1000th line written", () => {
    const s = new Script()
    for (let i = 0; i < 12; i++) s.add("deed", "m", i * 1000, { tool: "write", call: `w${i}`, size: 90 })
    const list = earned(s).earned
    expect(list.map((r) => r.facts.lines)).toEqual([1000])
  })
  test("quests sent are not deeds", () => {
    const s = new Script()
    for (let i = 0; i < 120; i++) s.add("deed", "m", i, { tool: "task", call: `t${i}` })
    expect(kindsOf(s)).toEqual([])
  })
  test("settle reconciles from the sessions when history was clipped", () => {
    const entries = Array.from({ length: 100 }, (_, i) => ({
      kind: "tool" as const,
      call: `c${i}`,
      name: "read",
      state: "completed" as const,
      input: {},
      output: "",
      at: i,
      ended: i,
    }))
    const root = session("m", { agent: "guild-master", entries })
    const ledger = new RenownLedger()
    const ctx = { session: () => root, party: () => [root] }
    for (const m of new Script().deeds("m", 0, 3).moments) ledger.take(m, ctx)
    const out = ledger.settle(ctx)
    expect(out.filter((h) => h.type === "earned").map((h) => h.type === "earned" && h.renown.kind)).toEqual([
      "comet",
    ])
    // And never twice.
    expect(ledger.settle(ctx)).toEqual([])
  })
})

describe("events: dragon (a red streak)", () => {
  test("three failed commands in a row from one adventurer wake the dragon; a passing one sends it off", () => {
    const s = new Script().add("join", "a", 0).failed("a", 1000).failed("a", 2000).failed("a", 3000)
    expect(kindsOf(s)).toEqual(["dragon"])
    s.add("deed", "a", 4000, { tool: "bash", call: "ok" })
    expect(earned(s).over).toEqual(["dragon"])
  })
  test("a success between the failures breaks the streak", () => {
    const s = new Script()
      .add("join", "a", 0)
      .failed("a", 1000)
      .failed("a", 2000)
      .add("deed", "a", 2500, { tool: "bash", call: "ok" })
      .failed("a", 3000)
    expect(kindsOf(s)).toEqual([])
  })
  test("five failed deeds across the party in three minutes", () => {
    const s = new Script().add("join", "a", 0).add("join", "b", 0)
    for (let i = 0; i < 5; i++) s.failed(i % 2 ? "a" : "b", 1000 + i * 20_000, "edit")
    expect(kindsOf(s)).toContain("dragon")
    const slow = new Script().add("join", "a", 0)
    for (let i = 0; i < 5; i++) slow.failed("a", 1000 + i * 60_000, "edit")
    expect(kindsOf(slow)).not.toContain("dragon")
  })
})

// ─────────────────────────────── rarity ───────────────────────────────

describe("events: cooldowns and rarity", () => {
  test("one kind is earned at most once per cooldown in a party", () => {
    const quick = new Script()
    for (const [id, at] of [
      ["a", 0],
      ["b", 2 * MIN],
    ] as const)
      quick
        .add("join", id, at)
        .deeds(id, at + 1000, 15)
        .add("loot", id, at + 30_000)
    expect(kindsOf(quick)).toEqual(["festival"])
    const later = new Script()
    for (const [id, at] of [
      ["a", 0],
      ["b", RULES.cooldownMs.festival + MIN],
    ] as const)
      later
        .add("join", id, at)
        .deeds(id, at + 1000, 15)
        .add("loot", id, at + 30_000)
    expect(kindsOf(later)).toEqual(["festival", "festival"])
  })

  /** A scheduler on a real moment stream, with a hand-wound clock. */
  function stage(gap = 150_000) {
    const stream = new MomentStream()
    let now = 0
    const events = new WorldEvents(noParty, () => now, { gap })
    events.attach(stream)
    const started: EventKind[] = []
    events.onStart((show) => started.push(show.kind))
    const feed = (script: Script) => {
      for (const m of script.moments) {
        const { seq: _s, ...rest } = m
        stream.add(rest)
      }
    }
    return {
      stream,
      events,
      started,
      feed,
      advance: (ms: number) => {
        now += ms
        events.tick(stream)
      },
    }
  }

  test("at most one big event every few minutes: the second waits for the gap, then goes stale", () => {
    const s = stage()
    s.feed(new Script().add("join", "a", 0).add("join", "b", 0).add("fail", "a", 1000).add("fail", "b", 2000))
    s.advance(10)
    expect(s.started).toEqual(["ghost-ship"])
    s.feed(new Script().add("join", "c", 3000).failed("c", 4000).failed("c", 5000).failed("c", 6000))
    s.advance(10)
    expect(s.started).toEqual(["ghost-ship"]) // the dragon waits: the ghost is on stage, the gap not run
    // The dragon is lasting: it waits for the gap rather than going stale.
    s.events.done(s.events.shows[0]?.id ?? 0)
    s.advance(149_000)
    expect(s.started).toEqual(["ghost-ship"])
    s.advance(2000)
    expect(s.started).toEqual(["ghost-ship", "dragon"])
  })

  test("a timed event that cannot start inside its stale window is dropped", () => {
    const s = stage()
    s.feed(new Script().add("join", "a", 0).add("join", "b", 0).add("fail", "a", 1000).add("fail", "b", 2000))
    s.advance(10)
    s.events.done(s.events.shows[0]?.id ?? 0)
    s.feed(new Script().add("join", "c", 0).deeds("c", 1000, 15).add("loot", "c", 20_000))
    s.advance(60_000)
    s.advance(100_000)
    expect(s.started).toEqual(["ghost-ship"])
  })

  test("the probe's force starts any event at once, past the gap, and is never earned", () => {
    const s = stage()
    for (const kind of EVENT_KINDS) s.events.force(kind)
    expect(s.started).toEqual([...EVENT_KINDS])
    expect(s.events.ledger.earned).toEqual([])
    expect(s.events.forced).toHaveLength(EVENT_KINDS.length)
  })

  test("a lasting show leaves when its cause is over, and at its cap", () => {
    const s = stage(0)
    s.feed(new Script().add("join", "a", 0).failed("a", 1000).failed("a", 2000).failed("a", 3000))
    s.advance(10)
    expect(s.events.shows.map((x) => [x.kind, x.leaving])).toEqual([["dragon", false]])
    s.feed(new Script().add("deed", "a", 4000, { tool: "bash", call: "fixed" }))
    expect(s.events.shows[0]?.leaving).toBe(true)
  })
})

// ─────────────────────────────── never from history ───────────────────────────────

describe("events: rebuilt moments never fire", () => {
  test("history added silently (a seek) earns in the ledger but starts no show", () => {
    const stream = new MomentStream()
    const events = new WorldEvents(noParty, () => 0, { gap: 0 })
    events.attach(stream)
    const started: string[] = []
    events.onStart((show) => started.push(show.kind))
    stream.rebuild()
    for (const m of new Script(false)
      .add("join", "a", 0)
      .add("join", "b", 0)
      .add("fail", "a", 1)
      .add("fail", "b", 2).moments) {
      const { seq: _s, ...rest } = m
      stream.add(rest)
    }
    events.tick(stream)
    expect(started).toEqual([])
    expect(events.ledger.earned.map((r) => r.kind)).toEqual(["ghost-ship"])
    // And a live moment after it does not replay the old earning.
    const { seq: _s, ...deed } = new Script().deeds("a", 10, 1).moments[0] as Moment
    stream.add(deed)
    expect(started).toEqual([])
  })

  /** Deeds by `id` under guildmaster `master`, one per `every` ms of run time from `from`. */
  const deedsOf = (master: string, id: string, from: number, n: number, every: number, live: boolean) =>
    Array.from({ length: n }, (_, i) => ({
      kind: "deed" as const,
      id,
      agent: "guild-implementer",
      title: id,
      color: "#fff",
      parent: master,
      master,
      tool: "read",
      call: `${id}-${from + i * every}`,
      at: from + i * every,
      live,
    }))

  test("a live hello with more than 1000 moments: the raid already shown does not sail in again (review-2 #9)", async () => {
    let clock = 0
    const stream = new MomentStream()
    const party = [session("R", { agent: "guild-master" }), session("S", { parentID: "R" })]
    const events = new WorldEvents({ session: () => undefined, party: () => party }, () => clock, { gap: 0 })
    events.attach(stream)
    const started: string[] = []
    events.onStart((show) => {
      started.push(`${show.kind}@${Math.round(show.renown.at / MIN)}`)
      queueMicrotask(() => events.done(show.id))
    })
    const step = async () => {
      clock += 1000
      events.tick(stream)
      await Promise.resolve()
    }
    // 2000 deeds over 50 min, live: the raid (a 45-min run) is earned and shown once.
    const run = deedsOf("R", "S", 0, 3000, 1500, true)
    for (const [i, m] of run.slice(0, 2000).entries()) {
      stream.add(m)
      if (i % 40 === 0) await step()
    }
    await step()
    // The socket reconnects: the hello is everything so far, rebuilt (the stream keeps the last 1000).
    stream.rebuild(true)
    for (const m of run.slice(0, 2000)) stream.add({ ...m, live: false })
    await step()
    // The run goes on live for 25 more minutes.
    for (const [i, m] of run.slice(2000).entries()) {
      stream.add(m)
      if (i % 40 === 0) await step()
    }
    expect(started.filter((s) => s.startsWith("raid"))).toEqual(["raid@45"])
    expect(new Set(started).size).toBe(started.length)
  })

  test("a live hello: another party's comet milestone does not fire twice (review-2 #9)", async () => {
    let clock = 0
    const stream = new MomentStream()
    const focal = [session("A", { agent: "guild-master" }), session("a", { parentID: "A" })]
    const events = new WorldEvents({ session: () => undefined, party: () => focal }, () => clock, { gap: 0 })
    events.attach(stream)
    const started: string[] = []
    events.onStart((show) => {
      started.push(show.renown.key)
      queueMicrotask(() => events.done(show.id))
    })
    const feed = async (moments: ReturnType<typeof deedsOf>) => {
      for (const m of moments) {
        stream.add(m)
        clock += 200
        events.tick(stream)
        await Promise.resolve()
      }
    }
    const before = [...deedsOf("B", "b", 0, 600, 100, true), ...deedsOf("A", "a", 60_000, 600, 100, true)]
    await feed(before)
    stream.rebuild(true)
    for (const m of before) stream.add({ ...m, live: false })
    clock += 1000
    events.tick(stream)
    await feed(deedsOf("B", "b", 260_000, 200, 100, true))
    expect(started.filter((key) => key === "comet:B:deeds-500")).toHaveLength(1)
    expect(new Set(started).size).toBe(started.length)
  })

  test("a seek (not a live hello) still starts over: played again, an earning shows again", async () => {
    let clock = 0
    const stream = new MomentStream()
    const events = new WorldEvents(noParty, () => clock, { gap: 0 })
    events.attach(stream)
    const started: string[] = []
    events.onStart((show) => {
      started.push(show.renown.key)
      queueMicrotask(() => events.done(show.id))
    })
    for (let round = 0; round < 2; round++) {
      stream.rebuild()
      for (const m of deedsOf("m", "x", 0, 120, 100, true)) {
        stream.add(m)
        clock += 200
        events.tick(stream)
        await Promise.resolve()
      }
    }
    expect(started).toEqual(["comet:m:deeds-100", "comet:m:deeds-100"])
  })

  test("the store: a seek past the rush's falls shows nothing; playing through shows the ghost ship", () => {
    const seeker = fresh("rush")
    const sought = worldEventsOf(seeker)
    const seen: string[] = []
    sought.onStart((show) => seen.push(show.kind))
    seeker.seek(30_000)
    sought.tick(seeker.moments)
    expect(seen).toEqual([])
    expect(sought.ledger.earned.map((r) => r.kind)).toContain("ghost-ship")

    const player = fresh("rush")
    const played = worldEventsOf(player)
    const shown: string[] = []
    played.onStart((show) => shown.push(show.kind))
    for (let t = 0; t < 30_000; t += 50) {
      player.tick(50)
      played.tick(player.moments)
    }
    expect(shown).toEqual(["ghost-ship"])
  })
})

// ─────────────────────────────── the book ───────────────────────────────

const stores: GuildStore[] = []
function fresh(scenario: "party" | "rush" | "solo"): GuildStore {
  const store = new GuildStore()
  store.load(scenario)
  stores.push(store)
  return store
}
afterAll(() => {
  for (const store of stores) store.load("party")
})

describe("events: Deeds of Renown in the Legends book", () => {
  test("the rush earns the Ghost Ship, and the book lists it with the rest unsung", () => {
    const store = fresh("rush")
    for (let t = 0; t < 30_000; t += 50) store.tick(50)
    const legend = legendOf(store.moments.history, store.party())
    expect(legend?.renown.map((r) => r.title)).toEqual(["The Ghost Ship"])
    expect(legend?.unsung.map((u) => u.kind)).toEqual(EVENT_KINDS.filter((k) => k !== "ghost-ship"))
    expect(legendMarkdown(legend as NonNullable<typeof legend>)).toContain("## Deeds of Renown")
    // The fallen's chapter says what passed for them.
    expect(legend?.chapters.some((c) => c.notables.some((n) => n.kind === "renown"))).toBe(true)
  })

  test("identical after a seek: the same deeds as playing through to the same moment", () => {
    for (const at of [10_000, 20_000, 30_000]) {
      const played = fresh("rush")
      while (played.time < at) played.tick(50)
      const sought = fresh("rush")
      sought.seek(played.time)
      const a = legendOf(played.moments.history, played.party())
      const b = legendOf(sought.moments.history, sought.party())
      expect(b?.renown).toEqual(a?.renown)
      expect(b?.unsung).toEqual(a?.unsung)
      expect(renownOf(sought.moments.history, sought.party())).toEqual(
        renownOf(played.moments.history, played.party()),
      )
    }
  })

  test("forced shows are listed, marked forced, and never counted as earned", () => {
    const store = fresh("party")
    for (let t = 0; t < 5000; t += 50) store.tick(50)
    const root = store.party().find((s) => !s.parentID)
    const forced: Renown = {
      kind: "dragon",
      key: "forced:dragon:1",
      at: 0,
      master: root?.id ?? "",
      anchored: false,
      facts: { streak: 3, tool: "bash" },
    }
    const legend = legendOf(store.moments.history, store.party(), [forced])
    expect(legend?.renown).toEqual([
      expect.objectContaining({ kind: "dragon", forced: true, title: "The Dragon of the Peaks" }),
    ])
  })
})

// ─────────────────────────────── captions and sound ───────────────────────────────

const ALL: Renown[] = EVENT_KINDS.map((kind) => ({
  kind,
  key: `${kind}:m:1`,
  at: 1000,
  master: "m",
  anchored: true,
  hero: { id: "a", title: "Implementer", color: "#4a8" },
  facts: { deeds: 18, fallen: 2, minutes: 9, spent: "tokens", streak: 3, tool: "bash" },
}))

describe("events: captions", () => {
  test("every event has its words, the same each time", () => {
    for (const r of ALL) {
      const a = renownLine(r)
      expect(a.map((p) => p.text).join("").length).toBeGreaterThan(20)
      expect(renownLine(r)).toEqual(a)
    }
  })
  test("a proclaimed event is told before anything waiting, alone", () => {
    const narrator = new Narrator({ session: () => undefined })
    const plea = new Script().add("plea", "a", 0).moments[0] as Moment
    narrator.hear(plea, 0)
    narrator.proclaim(ALL[0] as Renown, 0)
    const first = narrator.next(5000)
    expect(first?.kind).toBe("renown")
    expect(narrator.next(9000)?.kind).toBe("plea")
  })
  test("proclaim reaches every narrator listening to the stream; a rebuild forgets it", () => {
    const stream = new MomentStream()
    const narrator = new Narrator({ session: () => undefined })
    let clock = 0
    const off = listen(stream, narrator, () => clock)
    proclaim(stream, ALL[1] as Renown)
    stream.rebuild()
    clock = 5000
    expect(narrator.next(clock)).toBeUndefined()
    proclaim(stream, ALL[1] as Renown)
    expect(narrator.next(10_000)?.kind).toBe("renown")
    off()
    proclaim(stream, ALL[1] as Renown)
    expect(narrator.next(20_000)).toBeUndefined()
  })
})

describe("events: sound", () => {
  test("every event has a motif in the guild's key, a handful of notes", () => {
    for (const kind of EVENT_KINDS)
      for (const key of [keyOf("keep", 1), keyOf("moonstone", 0)]) {
        const notes = renownMotifOf(kind, key)
        expect(notes.length).toBeGreaterThan(2)
        expect(notes.length).toBeLessThanOrEqual(8)
        for (const n of notes) expect(n.gain).toBeLessThanOrEqual(0.5)
      }
  })
  test("muted (locked) it plays nothing and records nothing", () => {
    const engine = new AudioEngine()
    engine.probe = []
    engine.renown("festival")
    expect(engine.probe).toEqual([])
  })
})

// ─────────────────────────────── lazy ───────────────────────────────

describe("events: lazy, nothing when idle", () => {
  const dir = join(import.meta.dir, "../src/scene/events")
  const scenes = readdirSync(dir).filter((f) => f.endsWith(".tsx") && f !== "EventsLayer.tsx")

  test("no event scene is in the initial preload: none preloads, each is a dynamic import", () => {
    const layer = readFileSync(join(dir, "EventsLayer.tsx"), "utf8")
    expect(scenes).toHaveLength(EVENT_KINDS.length)
    for (const file of scenes) {
      const source = readFileSync(join(dir, file), "utf8")
      expect(source).not.toContain(".preload(")
      expect(layer).toContain(`import("./${file}")`)
      expect(layer).not.toMatch(new RegExp(`from "\\./${file.replace(".", "\\.")}"`))
    }
  })

  test("nothing outside the layer imports an event scene statically", () => {
    const root = join(import.meta.dir, "../src")
    const walk = (d: string): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(d, e.name)) : /\.tsx?$/.test(e.name) ? [join(d, e.name)] : [],
      )
    for (const file of walk(root)) {
      if (file.startsWith(dir)) continue
      const source = readFileSync(file, "utf8")
      for (const scene of scenes) expect(source).not.toContain(`events/${scene}`)
    }
  })

  test("an idle scheduler has no shows (the layer renders nothing)", () => {
    const store = fresh("party")
    const events = worldEventsOf(store)
    for (let t = 0; t < 20_000; t += 50) {
      store.tick(50)
      events.tick(store.moments)
    }
    expect(events.shows).toEqual([])
  })
})
