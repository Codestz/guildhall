import { describe, expect, test } from "bun:test"
import { createEvents } from "../src/hall/events.ts"
import { createSession, type HallSession } from "../src/hall/feeds/session.ts"
import { StoryFeed } from "../src/hall/feeds/story.ts"

/**
 * The hall's world events (hall/events.ts): sim's show engine run from the session at its clock. The
 * saga played through tells its shows once each, in order; a seek tells nothing; forcing, dismissing
 * and clearing; and a read, idle, costs next to nothing.
 */

const instant = {
  every: 0,
  setTimer: (fn: () => void) => {
    fn()
    return 0
  },
  clearTimer: () => {},
}

async function saga(): Promise<{ session: HallSession; told: string[] }> {
  const session = createSession(new StoryFeed("saga"), { throttle: instant })
  const told: string[] = []
  const herald = session.herald
  session.herald = (parts, about) => {
    told.push(parts.map((p) => p.text).join(""))
    herald(parts, about)
  }
  session.start()
  await Bun.sleep(0)
  return { session, told }
}

/** Plays the session `seconds` on, reading the events four times a (session) second. */
function play(session: HallSession, events: { read(): void }, seconds: number) {
  for (let k = 0; k < seconds * 4; k++) {
    session.frame(0.25)
    events.read()
  }
}

describe("the hall's world events", () => {
  test("the saga played through tells each show once, in order, and the director gets its hints", async () => {
    const { session, told } = await saga()
    const events = createEvents(session)
    const kinds: string[] = []
    const off = events.subscribe(() => {
      for (const s of events.shows()) if (!kinds.includes(s.id)) kinds.push(s.id)
    })
    let hinted = 0
    const captions = new Set<string>()
    for (let k = 0; k < 200 * 4 && session.clock.get().playing; k++) {
      session.frame(0.25)
      events.read()
      hinted = Math.max(hinted, events.hints().length)
      const c = session.snapshot().caption
      if (c?.kind === "renown") captions.add(c.text)
    }
    // the narrator says them, on the HUD's strip
    expect(captions.size).toBe(3)
    off()
    expect(kinds.map((id) => id.split(":")[0])).toEqual(["undead", "undead", "rainbow"])
    expect(told.length).toBe(3)
    expect(told[0]).toMatch(/grave|skeleton/)
    expect(told[1]).toContain("packages/world")
    expect(told[2]).toMatch(/rainbow/)
    expect(hinted).toBeGreaterThan(0)
  })

  test("a seek into a show tells nothing and shows nothing of it; seeking before it plays it again", async () => {
    const { session, told } = await saga()
    const events = createEvents(session)
    const start = session.clock.get().start
    // into the rainbow (CI green at ~124 s): nothing
    session.clock.seek(start + 130_000, { jump: true })
    session.clock.play(true)
    play(session, events, 5)
    expect(events.shows().map((s) => s.kind)).not.toContain("rainbow")
    expect(told).toEqual([])
    // before CI turns red (~70 s): its grave rises and is told
    session.clock.seek(start + 65_000, { jump: true })
    play(session, events, 10)
    expect(told.length).toBe(1)
    expect(events.shows().some((s) => s.params.grave?.cause === "ci")).toBe(true)
  })

  test("force, dismiss and clear", async () => {
    const { session } = await saga()
    session.clock.play(false)
    const events = createEvents(session)
    events.read()
    const dragon = events.force("dragon")
    expect(events.shows().map((s) => s.id)).toContain(dragon.id)
    expect(events.hints().some((h) => h.focus.id === dragon.id)).toBe(true)
    events.dismiss("dragon")
    const leaving = events.shows().find((s) => s.id === dragon.id)
    expect(leaving?.leave).toBe(session.clock.get().at)
    events.force("comet")
    events.clear()
    expect(events.shows()).toEqual([])
  })

  test("a read with nothing new costs under 0.05 ms a frame", async () => {
    const { session } = await saga()
    const events = createEvents(session)
    play(session, events, 100)
    session.clock.play(false)
    for (let k = 0; k < 400; k++) events.read()
    expect(events.cost().perFrameMs).toBeLessThan(0.05)
  })
})
