import { describe, expect, test } from "bun:test"
import type { LivingField } from "@guildhall/render"
import { EventLog, LIVING, type Show, type WorldEvent } from "@guildhall/sim"
import { hexDistance, hexGrid } from "@guildhall/world"
import type { HallEvents } from "../src/hall/events.ts"
import type { HallSession } from "../src/hall/feeds/index.ts"
import { CORE_RINGS, FALL_RINGS, mountLiving, reachOf, zoneTiles } from "../src/hall/living.ts"

/**
 * Living work on the tiles (hall/living.ts): a session's events in, each tile's glow and blight out, as
 * the field the shaders read takes them, with their timings; an island at rest writes nothing.
 */

const RADIUS = 9
const grid = hexGrid(RADIUS)
/** Two places: zone 0 round (0,0), zone 1 round (5,0), each every tile within 4 rings of its heart. */
const HEARTS = [grid.index(0, 0), grid.index(5, 0)]
const zoneOf = new Int16Array(grid.size)
for (let i = 0; i < grid.size; i++) {
  const at = { q: grid.q[i] as number, r: grid.r[i] as number }
  HEARTS.forEach((h, z) => {
    if (zoneOf[i] === 0 && hexDistance(at, { q: grid.q[h] as number, r: grid.r[h] as number }) <= 4)
      zoneOf[i] = z + 1
  })
}
const TILES = { radius: RADIUS, zoneOf, hearts: Int32Array.from(HEARTS) }

/** The field as a map of tiles, "q,r" → [glow, blight] (0 … 1), and how often it was written. */
function fakeField() {
  const tiles = new Map<string, [number, number]>()
  let sets = 0
  let commits = 0
  const field: LivingField = {
    radius: RADIUS,
    set(q, r, g, b) {
      sets++
      if (g + b > 0) tiles.set(`${q},${r}`, [g, b])
      else tiles.delete(`${q},${r}`)
    },
    clear: () => tiles.clear(),
    commit() {
      commits++
      return tiles.size > 0
    },
    dispose() {},
  }
  return { field, tiles, counts: () => ({ sets, commits }) }
}

let seq = 0
const work = (
  kind: "actor.step" | "actor.deed",
  at: number,
  craft: "read" | "edit",
  place: number,
  call: string,
) =>
  ({
    at,
    seq: ++seq,
    src: `g#${seq}`,
    kind,
    id: "h",
    call,
    tool: craft,
    craft,
    target: "x.ts",
    paths: ["x.ts"],
    places: [place],
    ...(kind === "actor.deed" ? { failed: false, stepped: true } : {}),
  }) as WorldEvent

function rig(events: WorldEvent[], shows: () => Show[] = () => []) {
  const log = new EventLog()
  log.append(...events)
  let now = 0
  let frame = () => {}
  const fake = fakeField()
  const listeners = new Set<() => void>()
  const living = mountLiving({
    stage: {
      onFrame(fn) {
        frame = () => fn(1 / 60)
        return () => {}
      },
    },
    session: { log: () => log, lifeAt: () => now } as unknown as HallSession,
    field: fake.field,
    tiles: TILES,
    events: () =>
      ({
        shows: () => shows(),
        subscribe(fn: () => void) {
          listeners.add(fn)
          return () => listeners.delete(fn)
        },
      }) as unknown as HallEvents,
    still: () => false,
    // real time runs with the session's here (the busy log's throttle never holds a step back)
    now: () => now * 1000,
  })
  const at = (t: number) => {
    now = t
    frame()
    return fake.tiles
  }
  return {
    at,
    living,
    fake,
    moved: () => {
      for (const fn of listeners) fn()
    },
  }
}

const heart0 = "0,0"
const heart1 = "5,0"

describe("living work on the tiles", () => {
  test("a read lights its place's tiles: up, held while it runs, out after", () => {
    const { at } = rig([work("actor.step", 1000, "read", 0, "r"), work("actor.deed", 3000, "read", 0, "r")])
    expect(at(999).size).toBe(0)
    const rising = at(1000 + LIVING.readRiseMs / 2).get(heart0)?.[0] ?? 0
    expect(rising).toBeGreaterThan(0)
    expect(rising).toBeLessThan(1)
    expect(at(2000).get(heart0)).toEqual([1, 0])
    expect(at(3000).get(heart0)).toEqual([1, 0])
    // only its own place: the other heart is dark
    expect(at(3000).has(heart1)).toBe(false)
    const fading = at(3000 + LIVING.readFadeMs / 2).get(heart0)?.[0] ?? 0
    expect(fading).toBeGreaterThan(0.2)
    expect(fading).toBeLessThan(0.8)
    // gone: every tile written back to nothing
    expect(at(3000 + LIVING.readFadeMs).size).toBe(0)
  })

  test("the core glows whole, the rim less, nothing past the place", () => {
    const { at } = rig([work("actor.step", 0, "read", 0, "r")])
    const tiles = at(5000)
    expect(tiles.get(heart0)?.[0]).toBe(1)
    expect(tiles.get(`${CORE_RINGS},0`)?.[0]).toBe(1)
    expect(tiles.get("4,0")?.[0]).toBeCloseTo(reachOf(4), 5)
    expect(reachOf(4)).toBeLessThan(1)
    // ring 5 from the heart is no tile of zone 0's (it holds 4 rings): never written
    expect(tiles.has("-5,0")).toBe(false)
    expect(reachOf(CORE_RINGS + FALL_RINGS + 1)).toBe(0)
  })

  test("an edit lights nothing (its scaffold is the FX's)", () => {
    const { at } = rig([work("actor.step", 0, "edit", 1, "e"), work("actor.deed", 500, "edit", 1, "e")])
    expect(at(600).size).toBe(0)
  })

  test("a grave at a place blights it until the fix lands, then it heals and is cleared", () => {
    const grave = { slot: 0, cause: "fail" as const, minion: false, rise: 2000, vigil: 4800 }
    let fixed: number | undefined
    const show = (): Show[] => [
      {
        id: "undead:h#1",
        kind: "undead",
        start: 2000,
        end: Number.POSITIVE_INFINITY,
        weight: 8,
        quiet: false,
        params: {
          where: { place: 1 },
          who: { id: "h", name: "Artisan", color: "#fff" },
          grave: { ...grave, ...(fixed !== undefined ? { fixed } : {}) },
        },
      },
    ]
    const { at, moved } = rig([], show)
    expect(at(1999).size).toBe(0)
    expect(at(2000 + LIVING.blightInMs).get(heart1)).toEqual([0, 1])
    expect(at(10_000).get(heart1)).toEqual([0, 1])
    // the fix lands at 10 s: the events say so (their subscribe), and it heals
    fixed = 10_000
    moved()
    const healing = at(10_000 + LIVING.healMs / 2).get(heart1)?.[1] ?? 0
    expect(healing).toBeGreaterThan(0.2)
    expect(healing).toBeLessThan(0.8)
    expect(at(10_000 + LIVING.healMs).size).toBe(0)
  })

  test("at rest it writes nothing, frame after frame", () => {
    const { at, fake } = rig([])
    for (let t = 0; t < 10_000; t += 16) at(t)
    expect(fake.counts()).toEqual({ sets: 0, commits: 0 })
  })

  test("the zones' tiles come from the island's lookup", () => {
    const zones = zoneTiles(TILES)
    expect(zones).toHaveLength(2)
    const count = (z: number) => zoneOf.filter((v) => v === z + 1).length
    expect(zones[0]?.q.length).toBe(count(0))
    expect(zones[1]?.q.length).toBe(count(1))
  })
})
