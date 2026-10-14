/**
 * The heroes' chips (hexworld/chips.ts, V1's chips.test.ts ported): the declutter folds piles into "+N",
 * nudges overlaps up, places the followed and the pleading first, turns strict at crowd scale and on a
 * phone, keeps chips off the HUD and caps speech; the verb line says what a hero does in plain words.
 */
import { describe, expect, test } from "bun:test"
import { emptyWorld, type GuildWorld, reduce, type WorldEvent, type WorldHappening } from "@guildhall/sim"
import {
  type ChipField,
  type ChipSlot,
  CROWD_AT,
  chipSlot,
  chipViews,
  Declutter,
  MAX_SPEAKERS,
  NEAR_PX,
  shortFile,
  speechOf,
  verbOf,
} from "../src/hexworld/chips.ts"

const FIELD: ChipField = { width: 1440, height: 900, mode: "detailed", phone: false, keep: [] }

/** A chip 80 × 30 px at (x, y), `z` from the camera. */
function slot(id: string, x: number, y: number, z = 10, extra: Partial<ChipSlot> = {}): ChipSlot {
  return { ...chipSlot(id), x, y, z, shown: true, width: 80, height: 30, perUnit: 20, ...extra }
}

function laid(slots: ChipSlot[], runs = 6, field: ChipField = FIELD): Declutter {
  const d = new Declutter()
  d.slots.push(...slots)
  for (let k = 0; k < runs; k++) d.run(field)
  return d
}

describe("the declutter", () => {
  test("a pile of three overlapping chips folds into the nearest, which reads +2", () => {
    const [a, b, c] = [slot("a", 500, 400, 30), slot("b", 510, 405, 10), slot("c", 520, 395, 20)]
    laid([a!, b!, c!])
    expect([a!.folded, b!.folded, c!.folded]).toEqual([true, false, true])
    expect(b!.more).toBe(2)
  })

  test("a chip walking past does not fold at once (votes), and two overlapping chips only nudge", () => {
    const [a, b, c] = [slot("a", 500, 400, 30), slot("b", 510, 405, 10), slot("c", 520, 395, 20)]
    const d = laid([a!, b!, c!], 4)
    expect([a!.folded, c!.folded]).toEqual([false, false])
    d.run(FIELD)
    expect([a!.folded, c!.folded]).toEqual([true, true])
    const [p, q] = [slot("p", 200, 400, 5), slot("q", 220, 410, 9)]
    laid([p!, q!])
    expect([p!.folded, q!.folded]).toEqual([false, false])
    expect(p!.lift).toBe(0)
    // the farther one climbs over the nearer: its bottom GAP above the other's top
    expect(q!.lift).toBe(410 - (400 - 30) + 3)
  })

  test("the followed and the pleading are placed first and never fold", () => {
    const far = slot("far", 500, 400, 90, { plea: true })
    const mid = slot("mid", 505, 400, 50)
    const near = slot("near", 510, 400, 5)
    const picked = slot("picked", 495, 400, 70, { selected: true })
    laid([far, mid, near, picked])
    expect([far.folded, picked.folded]).toEqual([false, false])
    expect(far.lift === 0 || picked.lift === 0).toBe(true)
    // the near one, unpinned, folds into the pile under the pinned
    expect(near.folded || mid.folded).toBe(true)
  })

  test("at crowd scale two make a pile, a fall heads it, and it folds on the first run", () => {
    const slots = Array.from({ length: CROWD_AT + 1 }, (_, k) =>
      slot(`s${k}`, 60 + (k % 12) * 110, 200 + Math.floor(k / 12) * 200, k),
    )
    const a = slot("a", 700, 800, 1)
    const fallen = slot("f", 705, 800, 50, { fallen: true })
    const d = laid([...slots, a, fallen], 1)
    expect(d.crowd).toBe(true)
    expect([fallen.folded, a.folded, fallen.more]).toEqual([false, true, 1])
  })

  test("a phone is strict past three chips, and folds a chip the edge would clip", () => {
    const phone: ChipField = { ...FIELD, width: 390, height: 844, phone: true }
    const four = [
      slot("a", 100, 300, 1),
      slot("b", 300, 300, 2),
      slot("c", 200, 600, 3),
      slot("d", 380, 700, 4),
    ]
    const d = laid(four, 2, phone)
    expect(d.crowd).toBe(true)
    // `d` hangs past the right edge
    expect(four[3]!.folded).toBe(true)
    expect(four.slice(0, 3).map((s) => s.folded)).toEqual([false, false, false])
  })

  test("speech: MAX_SPEAKERS at most, nearest first, never two bubbles in one place", () => {
    const talkers = Array.from({ length: 6 }, (_, k) =>
      slot(`t${k}`, 150 + k * 240, 500, k, { bubble: true }),
    )
    laid(talkers)
    expect(talkers.filter((s) => s.speak).map((s) => s.id)).toEqual(["t0", "t1", "t2"].slice(0, MAX_SPEAKERS))
    const [x, y] = [slot("x", 500, 500, 1, { bubble: true }), slot("y", 640, 450, 2, { bubble: true })]
    laid([x!, y!])
    expect([x!.speak, y!.speak]).toEqual([true, false])
  })

  test("speech by HUD mode: Minimal only for the followed or the close, Hidden never", () => {
    const far = slot("far", 300, 500, 1, { bubble: true, perUnit: NEAR_PX / 3 })
    const close = slot("close", 800, 500, 2, { bubble: true, perUnit: NEAR_PX * 1.5 })
    const picked = slot("picked", 1200, 500, 3, { bubble: true, selected: true, perUnit: 5 })
    laid([far, close, picked], 2, { ...FIELD, mode: "minimal" })
    expect([far.speak, close.speak, picked.speak]).toEqual([false, true, true])
    expect([far.near, close.near]).toEqual([false, true])
    laid([far, close, picked], 2, { ...FIELD, mode: "hidden" })
    expect([far.speak, close.speak, picked.speak]).toEqual([false, false, false])
  })

  test("a chip under the HUD is not drawn, nor does it speak; its pile's others are", () => {
    const under = slot("under", 100, 100, 1, { bubble: true })
    const clear = slot("clear", 700, 500, 2)
    const d = laid([under, clear], 2, { ...FIELD, keep: [[0, 0, 320, 200]] })
    expect([under.out, under.speak, clear.out]).toEqual([true, false, false])
    expect(d.boxes([]).length).toBe(1)
  })

  test("20 heroes laid out 10 times a second cost well under 0.3 ms a run", () => {
    const slots = Array.from({ length: 20 }, (_, k) =>
      slot(`h${k}`, 400 + (k % 5) * 60, 300 + Math.floor(k / 5) * 25, k, { bubble: k % 3 === 0 }),
    )
    const d = laid(slots, 50)
    const n = 2000
    const t0 = performance.now()
    for (let k = 0; k < n; k++) {
      for (const s of slots) s.x += k % 2 ? 0.5 : -0.5
      d.run(FIELD)
    }
    expect((performance.now() - t0) / n).toBeLessThan(0.1)
  })
})

// ─────────────────────────────── the words ───────────────────────────────

const T0 = 1_000_000
let seq = 0
const ev = (at: number, h: WorldHappening): WorldEvent => ({ at, seq: ++seq, src: "t", ...h }) as WorldEvent
const who = (id: string, name: string, parent?: string) =>
  ({
    kind: "actor.join",
    id,
    agent: "build",
    archetype: parent ? "scout" : "guildmaster",
    body: parent ? "ranger" : "mage",
    name,
    color: parent ? "#5f9e4a" : "#d97757",
    title: "",
    ...(parent ? { parent } : {}),
  }) as WorldHappening
const fold = (evs: WorldEvent[]): GuildWorld => evs.reduce(reduce, emptyWorld())
const work = (id: string, tool: string, target: string, paths: string[] = [], craft = "edit") =>
  ({
    kind: "actor.step",
    id,
    call: `c${seq}`,
    tool,
    craft,
    target,
    paths,
    places: [],
  }) as unknown as WorldHappening

describe("the verb line", () => {
  test("from the intent: a file's folder and name, a search's plain term, a command's gist", () => {
    const edit = fold([
      ev(T0, who("m", "Guildmaster")),
      ev(T0 + 1, work("m", "Edit", "life.ts", ["/r/guildhall/packages/world/src/hex/life.ts"])),
    ])
    expect(chipViews(edit, T0 + 2).get("m")).toMatchObject({
      verb: "editing",
      target: "hex/life.ts",
      sigil: "edit",
    })
    const grep = fold([
      ev(T0, who("m", "Guildmaster")),
      ev(T0 + 1, work("m", "Bash", 'grep -rn "yardThemes\\|yards\\.set" packages', [], "search")),
    ])
    expect(chipViews(grep, T0 + 2).get("m")).toMatchObject({ verb: "searching", target: "yardThemes" })
    expect(shortFile("C:\\repo\\src\\a.ts")).toBe("src/a.ts")
  })

  test("waiting on you, fallen, returning with loot, resting, thinking", () => {
    expect(verbOf({ status: "waiting", parent: "m", intent: undefined })).toMatchObject({
      verb: "waiting on you",
      tone: "plea",
    })
    expect(verbOf({ status: "failed", parent: "m", intent: undefined })).toMatchObject({
      verb: "fallen",
      tone: "fail",
    })
    expect(verbOf({ status: "done", parent: "m", intent: undefined }, true)).toMatchObject({
      verb: "returning with loot",
      tone: "loot",
    })
    expect(verbOf({ status: "done", parent: undefined, intent: undefined })).toMatchObject({
      verb: "resting",
      tone: "idle",
    })
    expect(verbOf({ status: "working", parent: "m", intent: undefined })).toMatchObject({
      verb: "thinking",
      sigil: null,
    })
    expect(verbOf({ status: "working", parent: "m", intent: undefined }, true)).toMatchObject({
      verb: "on the way",
    })
  })

  test("a plea pins its chip; three guildmasters fly their parties' pennants; speech comes and goes", () => {
    const w = fold([
      ev(T0, who("a", "Guildmaster")),
      ev(T0 + 1, who("b", "Guildmaster II")),
      ev(T0 + 2, who("s", "Scout", "b")),
      ev(T0 + 3, { kind: "actor.quest", id: "b", call: "q", text: "Map the harbour's assets and pack them" }),
      ev(T0 + 4, { kind: "actor.plea", id: "s" }),
    ])
    const views = chipViews(w, T0 + 10)
    expect(views.get("s")).toMatchObject({ plea: true, verb: "waiting on you", party: "#d97757" })
    expect(views.get("b")?.speech).toBe("Map the harbour's assets and pack them")
    expect(speechOf(w, T0 + 10_000).size).toBe(0)
  })
})
