import { afterAll, describe, expect, test } from "bun:test"
import { applyAll, type Change, emptyModel, type Model, type Session } from "@guildhall/core"
import { parties as partiesScenario, party as partyScenario, Script } from "@guildhall/sim"
import { Director, type Stage } from "../src/guild/director.ts"
import { legendOf } from "../src/guild/legends.ts"
import type { Moment } from "../src/guild/moments.ts"
import {
  BANNERS,
  GUILD_HOLD_MS,
  MAX_PARTIES,
  PARTY_IDLE_MS,
  PARTY_LEAVE_MS,
  partyNameOf,
  stageOf,
} from "../src/guild/parties.ts"
import { type AdventurerView, GuildStore, partyOf, viewsOf } from "../src/guild/store.ts"
import { listen, Narrator } from "../src/guild/story.ts"
import { SITES, type SiteId } from "../src/world/lands.ts"
import { HAND_IN, STATIONS } from "../src/world/layout.ts"

/**
 * Several conversations as parties on one island (guild/parties.ts): the stage (at most three, the
 * newest always), banners and seats that keep while a party stays, idle parties going home through
 * the gate, posts shared without collisions, captions and Legends per party, seek parity.
 */

/** A conversation: a guildmaster at `at` sending `quests` adventurers out, done after about `ms`. */
function conversation(script: Script, task: string, at: number, quests: string[], ms = 20_000): void {
  const master = script.guildmaster(task, at)
  const sent = quests.map((role, i) =>
    master.quest(
      role,
      `${task}: part ${i + 1}`,
      (child) => {
        child.deed("read", { filePath: `src/${i}.ts` }, ms / 4)
        child.deed("edit", { filePath: `src/${i}.ts` }, ms / 4)
        child.finish("done")
      },
      { wait: false },
    ),
  )
  master.waitFor(...sent)
  master.finish("all done")
}

const TASKS = [
  "Add cursor pagination to GET /users",
  "Fix the timezone bug in formatDate",
  "Move the session store from memory to Redis",
  "Write the release notes for 2.0",
]
const ROLES = ["guild-implementer", "guild-explorer", "guild-librarian"]

/** The model as it stood at run time `t` (only changes up to then). */
function at(changes: Change[], t: number): Model {
  return applyAll(
    emptyModel(),
    changes.filter((c) => c.at <= t),
  )
}

/** `n` conversations, the i-th starting at `starts[i]`, each sending three adventurers. */
function changesOf(n: number, starts: number[], ms = 20_000): Change[] {
  const script = new Script(7)
  for (let i = 0; i < n; i++) conversation(script, TASKS[i] ?? `Task ${i}`, starts[i] ?? i * 1000, ROLES, ms)
  return script.done()
}

/**
 * Nobody shares a post across parties, except at a site with more workers than posts: there posts
 * are dealt round evenly and the activity loop stands each extra worker beside the first
 * (scene/activity.ts `reserve`, ADR 0009) — so a post holds at most ceil(workers / posts).
 */
function collisions(views: readonly AdventurerView[]): string[] {
  const held = new Map<string, string[]>()
  for (const v of views) {
    if (v.phase === "leaving") continue
    const key = `${v.site ?? ""}@${v.target[0].toFixed(2)},${v.target[1].toFixed(2)}`
    held.set(key, [...(held.get(key) ?? []), `${v.title}(${v.party.slice(-4)})`])
  }
  const out: string[] = []
  for (const [key, who] of held) {
    const site = key.split("@")[0] as SiteId | ""
    const workers = site ? views.filter((v) => v.site === site).length : 1
    const allowed = site ? Math.ceil(workers / SITES[site].posts.length) : 1
    if (who.length > allowed) out.push(`${key}: ${who.join(" & ")}`)
  }
  return out
}

const S = 1000

/** A bare session, as the model holds it: working (`running`) unless it `ended`. */
function sessionOf(id: string, started: number, seen: number, more: Partial<Session> = {}): Session {
  return {
    id,
    agent: more.parentID ? "guild-implementer" : "guild-master",
    title: id,
    status: more.ended !== undefined ? "done" : "running",
    since: started,
    started,
    entries: [],
    tokens: 0,
    cost: 0,
    denied: [],
    steps: 0,
    seen,
    ...more,
  } as Session
}
const modelOf = (sessions: Session[]): Model =>
  ({ sessions: new Map(sessions.map((s) => [s.id, s])) }) as Model
const brief = (stage: readonly { id: string; seat: number }[]) =>
  stage
    .map((p) => `${p.id}@${p.seat}`)
    .sort()
    .join(",")

describe("parties: names", () => {
  test("a short name from what the conversation is about", () => {
    expect(partyNameOf("Add cursor pagination to GET /users")).toBe("Pagination")
    expect(partyNameOf("Fix the timezone bug in formatDate")).toBe("Timezone bug")
    expect(partyNameOf("Move the session store from memory to Redis")).toBe("Session store")
    expect(partyNameOf("Sweep the repo: 12 parallel quests")).toBe("Repo")
    expect(partyNameOf("")).toBe("")
    expect(partyNameOf("add")).toBe("")
  })

  test("two parties about the same thing are told apart", () => {
    const script = new Script(1)
    conversation(script, "Fix the login bug", 0, ["guild-implementer"])
    conversation(script, "Fix the login bug", 1000, ["guild-explorer"])
    const names = stageOf(applyAll(emptyModel(), script.done()), 5000).map((p) => p.name)
    expect(names.sort()).toEqual(["Login bug", "Login bug II"])
  })
})

describe("parties: the stage", () => {
  test("one conversation is the hall as it was: one party on the dais, its views unchanged", () => {
    const m = applyAll(emptyModel(), partyScenario())
    for (const t of [5000, 20_000, 40_000, 70_000]) {
      const stage = stageOf(m, t)
      expect(stage.length).toBe(1)
      expect(stage[0]?.seat).toBe(0)
      expect(stage[0]?.leaving).toBe(false)
      expect(stage[0]?.arriving).toBe(false)
    }
    // Played to its end: the guildmaster on the dais, everyone else under it, no banner shown.
    const sliced = at(partyScenario(), 31_500)
    const views = viewsOf(sliced, 31_500)
    const master = views.filter((v) => v.master)
    expect(master.length).toBe(1)
    expect(master[0]?.target).toEqual(STATIONS["quest-board"].posts[0])
    expect(new Set(views.map((v) => v.party)).size).toBe(1)
    expect(views.find((v) => v.phase === "loot")?.target ?? HAND_IN).toEqual(HAND_IN)
    expect(views.every((v) => !v.arrives)).toBe(true)
    expect(partyOf(sliced).map((s) => s.id)).toEqual(stageOf(sliced, 31_500)[0]?.sessions.map((s) => s.id))
  })

  for (const n of [1, 2, 3, 4]) {
    test(`${n} conversation(s) at once: at most ${MAX_PARTIES} parties, one guildmaster each, no shared post`, () => {
      const starts = [0, 1000, 2000, 3000]
      const m = at(changesOf(n, starts), 6000)
      const stage = stageOf(m, 6000)
      expect(stage.length).toBe(Math.min(n, MAX_PARTIES))
      // Seats and banners unique on the island.
      expect(new Set(stage.map((p) => p.seat)).size).toBe(stage.length)
      expect(new Set(stage.map((p) => p.color)).size).toBe(stage.length)
      const views = viewsOf(m, 6000, undefined, stage)
      for (const party of stage) {
        const masters = views.filter((v) => v.party === party.id && v.master)
        expect(masters.length).toBe(1)
        expect(masters[0]?.target).toEqual(STATIONS["quest-board"].posts[party.seat])
        expect(views.filter((v) => v.party === party.id).every((v) => v.banner === party.color)).toBe(true)
      }
      expect(collisions(views)).toEqual([])
      // Numbering is per party: each party's first implementer is plain "Implementer".
      for (const party of stage)
        expect(views.find((v) => v.party === party.id && v.role === "Implementer")?.ordinal).toBe(1)
    })
  }

  test("four at once: the least recently active one is left off the island", () => {
    // The first conversation goes quiet early; the other three keep working.
    const script = new Script(3)
    conversation(script, TASKS[0] as string, 0, ["guild-explorer"], 2000)
    for (let i = 1; i < 4; i++) conversation(script, TASKS[i] as string, 1000 * i, ROLES, 60_000)
    const m = at(script.done(), 20_000)
    const stage = stageOf(m, 20_000)
    expect(stage.length).toBe(3)
    expect(stage.map((p) => p.name)).not.toContain("Pagination")
  })

  test("an idle party other than the newest goes home through the gate, then is gone", () => {
    const script = new Script(5)
    conversation(script, TASKS[1] as string, 0, ["guild-explorer"], 4000)
    conversation(script, TASKS[2] as string, 2000, ROLES, 400_000)
    const changes = script.done()
    const quick = changes.find((c) => c.type === "session" && !c.parentID)?.id as string
    const ended = Math.max(...changes.filter((c) => c.id === quick && c.type === "status").map((c) => c.at))
    const look = (t: number) => stageOf(at(changes, t), t).find((p) => p.id === quick)
    expect(look(ended + 1000)?.leaving).toBe(false)
    expect(look(ended + PARTY_IDLE_MS - 1000)?.leaving).toBe(false)
    expect(look(ended + PARTY_IDLE_MS + 1000)?.leaving).toBe(true)
    const m = at(changes, ended + PARTY_IDLE_MS + 1000)
    const master = viewsOf(m, ended + PARTY_IDLE_MS + 1000).find((v) => v.id === quick)
    expect(master?.phase).toBe("leaving")
    expect(look(ended + PARTY_IDLE_MS + PARTY_LEAVE_MS + 1000)).toBeUndefined()
  })

  test("the newest party never goes home, however long it idles", () => {
    const m = applyAll(emptyModel(), partyScenario())
    const stage = stageOf(m, 10 * 60 * 60_000)
    expect(stage.length).toBe(1)
    expect(stage[0]?.leaving).toBe(false)
  })

  test("banners and seats keep while a party stays, as others come and go", () => {
    const changes = partiesScenario()
    const first = new Map<string, { color: string; seat: number }>()
    for (let t = 0; t <= 125_000; t += 500) {
      for (const p of stageOf(at(changes, t), t)) {
        const known = first.get(p.id)
        if (!known) first.set(p.id, { color: p.color, seat: p.seat })
        else if (stageOf(at(changes, t), t).length > 1)
          expect({ id: p.id, color: p.color, seat: p.seat }).toEqual({ id: p.id, ...known })
      }
    }
    expect(first.size).toBe(3)
    // The first party of the run takes the first banner and the dais.
    expect([...first.values()][0]).toEqual({ color: BANNERS[0]?.color as string, seat: 0 })
  })

  test("four busy conversations heard from in turn: the island keeps who it has (review-2 #8)", () => {
    // Each conversation is heard from every 4 s, staggered by 1 s: recency alone reshuffled the
    // island about once a second. The three already here stay while they work; the fourth waits.
    const ids = ["A", "B", "C", "D"]
    const stages = new Set<string>()
    for (let t = 4 * S; t <= 60 * S; t += 500) {
      const sessions = ids.map((id, i) =>
        sessionOf(id, i * S, Math.floor((t - i * S) / (4 * S)) * 4 * S + i * S),
      )
      stages.add(brief(stageOf(modelOf(sessions), t)))
    }
    expect([...stages]).toEqual(["A@0,B@1,C@2"])
  })

  test("a waiting conversation takes the place of one that went idle, not of a working one", () => {
    const at = (t: number) =>
      stageOf(
        modelOf([
          sessionOf("A", 0, Math.min(t, 20 * S), t >= 20 * S ? { ended: 20 * S } : {}),
          sessionOf("B", 1 * S, t),
          sessionOf("C", 2 * S, t - 500),
          sessionOf("D", 3 * S, t - 250),
        ]),
        t,
      )
    expect(brief(at(10 * S))).toBe("A@0,B@1,C@2")
    const later = at(25 * S)
    expect(later.map((p) => p.id).sort()).toEqual(["B", "C", "D"])
    // B and C keep their seats; D takes the one A left.
    expect(brief(later)).toBe("B@1,C@2,D@0")
  })

  test("two busy projects: the island stays on one, and switches only once it has gone quiet", () => {
    const guild = new Map([
      ["X", "proj-x"],
      ["Y", "proj-y"],
    ])
    const guildOf = (id: string) => guild.get(id)
    const islands = new Set<string>()
    // Both working, heard from in turn every second (the island used to swap project on each).
    for (let t = 2 * S; t <= 30 * S; t += S) {
      const seen = (i: number) => Math.floor((t - i * S) / (2 * S)) * 2 * S + i * S
      const m = modelOf([sessionOf("X", 0, seen(0)), sessionOf("Y", S, seen(1))])
      islands.add(
        stageOf(m, t, guildOf)
          .map((p) => p.id)
          .join(),
      )
    }
    expect([...islands]).toEqual(["Y"])
    // Y finishes at 40 s; X works on. The island goes to X only after GUILD_HOLD_MS of quiet.
    const after = (t: number) =>
      stageOf(modelOf([sessionOf("X", 0, t), sessionOf("Y", S, 40 * S, { ended: 40 * S })]), t, guildOf)
        .map((p) => p.id)
        .join()
    expect(after(41 * S)).toBe("Y")
    expect(after(40 * S + GUILD_HOLD_MS - S)).toBe("Y")
    expect(after(40 * S + GUILD_HOLD_MS + S)).toBe("X")
  })

  test("a party alone on the island keeps its seat; the next to come takes the free one (review-2 #14)", () => {
    // A and B together; A finishes and goes home; later C arrives while B works on.
    const at = (t: number) =>
      stageOf(
        modelOf([
          ...(t < 20 * S ? [sessionOf("A", 0, t)] : [sessionOf("A", 0, 20 * S, { ended: 20 * S })]),
          sessionOf("B", 10 * S, t),
          ...(t >= 200 * S ? [sessionOf("C", 200 * S, t)] : []),
        ]),
        t,
      )
    expect(brief(at(15 * S))).toBe("A@0,B@1")
    expect(brief(at(130 * S))).toBe("B@1")
    expect(brief(at(210 * S))).toBe("B@1,C@0")
  })

  test("a subagent whose root was never heard of joins the rootless crowd, not nowhere (review-2 #21)", () => {
    const m = modelOf([sessionOf("R", 0, 5 * S), sessionOf("x", S, 5 * S, { parentID: "MISSING" })])
    const stage = stageOf(m, 5 * S)
    expect(stage.map((p) => [p.id, p.sessions.map((s) => s.id)])).toEqual([
      ["R", ["R"]],
      ["", ["x"]],
    ])
    expect(new Set(stage.map((p) => p.seat)).size).toBe(2)
    expect(stage.find((p) => p.id === "")?.name).toMatch(/^Party /)
    // Everyone on stage has a place, the orphan with the crowd's banner.
    const views = viewsOf(m, 5 * S, undefined, stage)
    expect(views.find((v) => v.id === "x")?.party).toBe("")
  })

  test("the parties scenario: three parties on the island, the quick one goes home before the end", () => {
    const changes = partiesScenario()
    const end = changes.at(-1)?.at ?? 0
    expect(stageOf(at(changes, 30_000), 30_000).length).toBe(3)
    const names = stageOf(at(changes, 30_000), 30_000).map((p) => p.name)
    expect(names).toEqual(["Pagination", "Timezone bug", "Session store"])
    const late = stageOf(at(changes, end), end)
    expect(late.map((p) => p.name)).not.toContain("Timezone bug")
  })
})

const stores: GuildStore[] = []
function fresh(): GuildStore {
  const store = new GuildStore()
  store.load("parties")
  stores.push(store)
  return store
}
afterAll(() => {
  for (const store of stores) store.load("party")
})

describe("parties: the store", () => {
  test("seek parity: the parties and everyone's place match playing through", () => {
    const played = fresh()
    const marks = [20_000, 60_000, 112_000]
    for (const mark of marks) {
      while (played.time < mark) played.tick(50)
      const sought = fresh()
      sought.seek(played.time)
      const brief = (s: GuildStore) =>
        s.parties.map((p) => ({ id: p.id, name: p.name, color: p.color, seat: p.seat, leaving: p.leaving }))
      expect(brief(sought)).toEqual(brief(played))
      const place = (s: GuildStore) => s.views.map((v) => [v.id, v.party, v.phase, v.target, v.banner])
      expect(place(sought)).toEqual(place(played))
    }
  })

  test("Legends: one book per party, each the same after a seek", () => {
    const played = fresh()
    while (played.time < 60_000) played.tick(50)
    const sought = fresh()
    sought.seek(played.time)
    const titles: string[] = []
    for (const party of played.parties) {
      const a = legendOf(played.moments.history, played.party(party.id))
      expect(a).toBeDefined()
      titles.push(a?.title ?? "")
      expect(legendOf(sought.moments.history, sought.party(party.id))).toEqual(a)
    }
    expect(titles).toEqual([
      "Add cursor pagination to GET /users",
      "Fix the timezone bug in formatDate",
      "Move the session store from memory to Redis",
    ])
  })

  test("following a party narrows the weather and the director, never the shared traces", () => {
    const store = fresh()
    while (store.time < 50_000) store.tick(50)
    const traces = JSON.stringify(store.traces)
    const redis = store.parties.find((p) => p.name === "Session store")?.id as string
    store.follow(redis)
    expect(store.following).toBe(redis)
    expect(store.director.scope?.size).toBe(store.parties.find((p) => p.id === redis)?.sessions.length)
    expect(JSON.stringify(store.traces)).toBe(traces)
    expect(store.party().every((s) => store.parties.find((p) => p.id === redis)?.sessions.includes(s))).toBe(
      true,
    )
    store.follow(null)
    expect(store.director.scope).toBeNull()
    // A party not on the island can't be followed.
    store.follow("nobody")
    expect(store.following).toBeNull()
  })
})

describe("parties: captions", () => {
  const moment = (kind: Moment["kind"], id: string, master: string, extra: Record<string, unknown> = {}) =>
    ({
      kind,
      id,
      agent: "guild-explorer",
      title: id,
      color: "#2fa7a0",
      parent: master,
      master,
      seq: 1,
      at: 1000,
      live: true,
      ...extra,
    }) as Moment
  const PARTIES = {
    a: { name: "Pagination", color: "#e0525a" },
    b: { name: "Timezone bug", color: "#efe7d2" },
  }
  const tell = (count: number, following: string | null, moments: Moment[]) => {
    const narrator = new Narrator({
      session: () => undefined,
      party: (id) => PARTIES[id as keyof typeof PARTIES],
      parties: () => count,
      following: () => following,
    })
    for (const m of moments) narrator.hear(m, 0)
    const out: string[] = []
    for (let t = 1000; t < 40_000; t += 100) {
      const c = narrator.next(t)
      if (c) out.push(c.text)
    }
    return out
  }

  test("following a party after its beats were heard still leaves the others untold", () => {
    let following: string | null = null
    const narrator = new Narrator({
      session: () => undefined,
      party: (id) => PARTIES[id as keyof typeof PARTIES],
      parties: () => 2,
      following: () => following,
    })
    narrator.hear(moment("loot", "Verifier", "b"), 0)
    narrator.hear(moment("loot", "Explorer", "a"), 0)
    following = "a"
    const out: string[] = []
    for (let t = 1000; t < 40_000; t += 100) {
      const c = narrator.next(t)
      if (c) out.push(c.text)
    }
    expect(out).toEqual([expect.stringMatching(/^The Explorer/)])
  })

  test("a line names its party only when there are several", () => {
    const one = tell(1, null, [moment("loot", "Explorer", "a")])
    expect(one[0]?.startsWith("In the")).toBe(false)
    const two = tell(2, null, [moment("loot", "Explorer", "a")])
    expect(two[0]?.startsWith("In the Pagination quest, the Explorer")).toBe(true)
  })

  test("following one party, only its story is told, without the prefix", () => {
    const lines = tell(2, "a", [moment("loot", "Explorer", "a"), moment("loot", "Verifier", "b")])
    expect(lines.length).toBe(1)
    expect(lines[0]).toMatch(/^The Explorer/)
  })

  test("two parties' beats are never told as one line (one party's burst still is)", () => {
    const one = tell(2, null, [moment("loot", "Explorer", "a"), moment("loot", "Librarian", "a")])
    expect(one.length).toBe(1)
    const lines = tell(2, null, [moment("loot", "Explorer", "a"), moment("loot", "Librarian", "b")])
    expect(lines.length).toBe(2)
    expect(lines.some((l) => l.includes("Explorer") && l.includes("Librarian"))).toBe(false)
  })

  test("the store's narrator: several parties, captions name them", () => {
    const store = fresh()
    let clock = 0
    const narrator = new Narrator({
      session: (id) => store.sessionOf(id),
      party: (master) => store.parties.find((p) => p.id === master),
      parties: () => store.parties.length,
      following: () => store.following,
    })
    listen(store.moments, narrator, () => clock)
    const out: string[] = []
    for (let t = 0; t < 40_000; t += 50) {
      store.tick(50)
      clock += 50
      const c = narrator.next(clock)
      if (c) out.push(c.text)
    }
    expect(out.some((t) => t.startsWith("In the Session store quest,"))).toBe(true)
    expect(out.some((t) => t.startsWith("In the Pagination quest,"))).toBe(true)
  })
})

describe("parties: the director", () => {
  test("following one party, the director films only it", () => {
    const director = new Director()
    const live = (kind: Moment["kind"], id: string, master: string) =>
      ({ kind, id, agent: "x", title: id, color: "#fff", master, seq: 1, at: 0, live: true }) as Moment
    const stage: Stage = {
      views: [
        { id: "a1", phase: "waiting", master: false },
        { id: "b1", phase: "working", master: false },
      ],
      locate: (id, out) => {
        out.x = id === "a1" ? 10 : -10
        out.z = 0
        return true
      },
      walking: () => false,
      onScreen: () => true,
    }
    director.now = 0
    director.take(live("plea", "a1", "a"))
    director.take(live("deed", "b1", "b"))
    director.scope = new Set(["b1"])
    director.now = 5000
    const shot = director.update(stage)
    expect(shot.id === "a1").toBe(false)
    director.scope = null
    director.restart()
    director.now = 10_000
    expect(director.update(stage).id).toBe("a1")
  })
})
