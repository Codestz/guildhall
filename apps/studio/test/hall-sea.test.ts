/**
 * The sea's life on an island (hexworld/sea.ts) and the session that drives it (hall/sea.ts): `?sea=`
 * read as a look asks, and a session's pushes, release and CI told to the sea at the session's clock.
 */
import { describe, expect, test } from "bun:test"
import type { SeaLife } from "@guildhall/render"
import type { HallSession } from "../src/hall/feeds/index.ts"
import { driveSea } from "../src/hall/sea.ts"
import { seaOf, seaOn } from "../src/hexworld/sea.ts"

const q = (s: string) => new URLSearchParams(s)

describe("?sea=", () => {
  test("absent, off, at rest, and each thing asked for", () => {
    expect(seaOf(q(""))).toBeNull()
    expect(seaOf(q("sea=0"))).toBe("off")
    expect(seaOf(q("sea=1"))).toEqual({
      merchants: true,
      cargo: 0,
      galleon: false,
      ghost: false,
      raid: false,
      lighthouse: null,
    })
    const all = seaOf(q("sea=merchants,cargo=5,galleon;ghost,raid,lighthouse=red"))
    expect(all).toEqual({
      merchants: true,
      cargo: 5,
      galleon: true,
      ghost: true,
      raid: true,
      lighthouse: "failed",
    })
    // naming one thing shows it alone; the lamp's words
    expect(seaOf(q("sea=cargo"))).toMatchObject({ merchants: false, cargo: 3 })
    expect(seaOf(q("sea=lighthouse=amber"))).toMatchObject({ lighthouse: "running" })
    expect(seaOf(q("sea=lighthouse=warm"))).toMatchObject({ lighthouse: "passed" })
  })
  test("on with `?sea=` or with the event FX, never with `?sea=0`", () => {
    expect(seaOn(null, false)).toBe(false)
    expect(seaOn(null, true)).toBe(true)
    expect(seaOn(seaOf(q("sea=1")), false)).toBe(true)
    expect(seaOn("off", true)).toBe(false)
  })
})

/** A sea that writes down what it is told. */
function fakeSea() {
  const told: string[] = []
  const sea = {
    sync: (at: number, rate?: number) => told.push(`sync ${at} ${rate}`),
    push: (o: { at?: number; key?: string }) => told.push(`push ${o.key} ${o.at}`),
    release: (o: { at?: number; key?: string }) => told.push(`release ${o.key} ${o.at}`),
    setLighthouse: (state: string | null, since?: number) => told.push(`lamp ${state} ${since}`),
    reset: () => told.push("reset"),
    setRate: (r: number) => told.push(`rate ${r}`),
  }
  return { sea: sea as unknown as SeaLife, told }
}

/** A session whose world at any time is `world`, at `at`. */
function fakeSession(state: { at: number; world: unknown }) {
  const resets: (() => void)[] = []
  const session = {
    clock: {
      get: () => ({ mode: "replay", at: state.at, playing: true, rate: 2, jumps: 0 }),
      subscribe: () => () => {},
    },
    log: () => ({ stateAt: () => state.world }),
    onReset: (fn: () => void) => {
      resets.push(fn)
      return () => {}
    },
  }
  return {
    session: session as unknown as HallSession,
    reset: () => {
      for (const fn of resets) fn()
    },
  }
}

const world = (pushes: number, extra: Record<string, unknown> = {}) => ({
  sea: { prs: new Map(), ci: new Map(), pushes, merged: 0, ...extra },
})

describe("driveSea", () => {
  test("the session's clock, a push's cargo, the release's galleon and the newest run's lamp", async () => {
    const { sea, told } = fakeSea()
    const state = { at: 10_000, world: world(2) as unknown }
    const { session } = fakeSession(state)
    const stop = driveSea(sea, session)
    // the first read: the clock, no cargo for the pushes already made, a dark lamp
    expect(told).toContain("sync 10000 2")
    expect(told.some((t) => t.startsWith("push"))).toBe(false)
    expect(told).toContain("lamp null undefined")
    told.length = 0
    state.at = 12_000
    state.world = world(3, {
      lastPush: 11_500,
      lastRelease: { repo: "o/r", tag: "v1.4.0", at: 11_800 },
      ci: new Map([["main", { state: "failed", at: 11_900 }]]),
    })
    await new Promise((done) => setTimeout(done, 650))
    stop()
    expect(told).toContain("push push-3 11500")
    expect(told).toContain("release o/r@v1.4.0 11800")
    expect(told).toContain("lamp failed 11900")
    expect(told).toContain("rate 1")
  })
  test("a seek back sends no ships, and a new log starts over", async () => {
    const { sea, told } = fakeSea()
    const state = { at: 10_000, world: world(5, { lastPush: 9000 }) as unknown }
    const { session, reset } = fakeSession(state)
    const stop = driveSea(sea, session)
    state.world = world(2, { lastPush: 4000 })
    await new Promise((done) => setTimeout(done, 650))
    expect(told.some((t) => t.startsWith("push"))).toBe(false)
    reset()
    stop()
    expect(told).toContain("reset")
  })
})
