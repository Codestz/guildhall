/**
 * The graveyard (Task B): a grave's state at a time (story/graveyard.ts), which skeleton it raises, and
 * the fight (life/graveStrike.ts): the hero who mends a grave walks to it and strikes it as the world
 * events say, the same whether its day is planned from the whole log or as the clock passes.
 */
import { afterAll, describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import {
  graveStrikeSpot,
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
import {
  asStruck,
  type Grave,
  graveAt,
  itineraries,
  type LifeKit,
  LifePlanner,
  poseAt,
  SHOW_RULES,
  STRIKE_LEAD_MS,
  STRIKE_RUN_MPS,
  strikeWalkMs,
  struckAt,
  undeadKind,
  worldShows,
} from "../src/index.ts"
import { Feed } from "./events-fixtures.ts"

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

describe("a grave's state", () => {
  const g: Grave = { slot: 0, cause: "fail", minion: false, rise: 1000, vigil: 3800 }
  test("rises, keeps vigil while its cause stands, is struck, sinks and is gone", () => {
    expect(graveAt(g, 999)).toBeNull()
    expect(graveAt(g, 1000)).toEqual({ phase: "rise", ms: 0 })
    expect(graveAt(g, 3799)?.phase).toBe("rise")
    expect(graveAt(g, 3800)).toEqual({ phase: "vigil", ms: 0 })
    expect(graveAt(g, 1e9)?.phase).toBe("vigil")
    const mended: Grave = { ...g, fixed: 20_000, strike: 29_000, sink: 29_600 }
    expect(graveAt(mended, 28_999)?.phase).toBe("vigil")
    expect(graveAt(mended, 29_000)).toEqual({ phase: "struck", ms: 0 })
    expect(graveAt(mended, 29_600)).toEqual({ phase: "sink", ms: 0 })
    expect(graveAt(mended, 29_600 + SHOW_RULES.sinkMs - 1)?.phase).toBe("sink")
    expect(graveAt(mended, 29_600 + SHOW_RULES.sinkMs)).toBeNull()
    // a minion (or a grave nobody mends in person) goes straight from vigil to sinking
    const minion: Grave = { ...g, minion: true, fixed: 6000, sink: 6000 }
    expect(graveAt(minion, 5999)?.phase).toBe("vigil")
    expect(graveAt(minion, 6000)?.phase).toBe("sink")
  })

  test("the skeleton is the fallen's kind", () => {
    const fall = { minion: false, cause: "fail" as const }
    expect(undeadKind(fall, { body: "knight" })).toBe("warrior")
    expect(undeadKind(fall, { body: "barbarian" })).toBe("warrior")
    expect(undeadKind(fall, { body: "mage" })).toBe("mage")
    expect(undeadKind(fall, { body: "ranger" })).toBe("rogue")
    expect(undeadKind(fall, { body: "rogue", archetype: "wanderer" })).toBe("minion")
    expect(undeadKind({ minion: true, cause: "deed" }, { body: "knight" })).toBe("minion")
    expect(undeadKind({ minion: false, cause: "ci" })).toBe("warrior")
  })

  test("a long way is run, a short one walked", () => {
    const walk = 1.32 / 1000
    expect(strikeWalkMs(5, walk)).toBeCloseTo(5 / walk, 6)
    expect(strikeWalkMs(40, walk)).toBeCloseTo((40 / STRIKE_RUN_MPS) * 1000, 6)
  })
})

describe("the fight at the graveyard", () => {
  const h = hexIsland({ seed: 1, files: 4000 })
  const z = hexZones(h)
  const w = hexWorld(h, z)
  const walk = hexWalk(h, z, w, { reach: workTiles(h, z) })
  const places = lifePlaces(h, z, w, walk, { heroSpots: 3 })
  const gy = w.graveyard!
  const node = walk.at(gy.tile)
  const kit: LifeKit = {
    walk,
    spots: (zi) => places.heroSpots(zi),
    home: guildhallZone(walk, z),
    near: places.walkNear,
    island: h,
    board: places.heroSpots.board(),
    graves: { strike: (slot) => graveStrikeSpot(gy, node, slot) },
  }
  const T0 = 1_790_000_000_000
  // a hero falls (it slumps at the Guildhall's gathering) and recovers there: its grave rises, then is mended
  const f = new Feed()
  f.start("gm", T0)
  f.start("hero", T0 + 500, "gm", "guild-implementer")
  f.change({ type: "status", id: "hero", status: "failed", at: T0 + 10_000 })
  f.change({ type: "status", id: "hero", status: "busy", at: T0 + 25_000 })
  const [shown] = worldShows(f.log, T0 + 26_000)
  const grave = shown!.params.grave!

  test("the world events say who strikes, and by when", () => {
    expect(grave.fixer?.id).toBe("hero")
    expect(grave.strike).toBe(T0 + 25_000 + SHOW_RULES.strikeMs)
  })

  test("the fixer runs to the grave, squares up, strikes it there, and goes back after", () => {
    const it = itineraries(f.log, kit, { until: T0 + 120_000 }).get("hero")!
    const spot = gy.graves[grave.slot]!.strike
    const at = struckAt(grave, it.acts)!
    expect(at).toBeGreaterThan(T0 + 25_000)
    expect(at).toBeLessThanOrEqual(grave.strike!)
    const swing = it.acts.find((a) => a.play === "strike")!
    expect(swing.from).toBe(at - STRIKE_LEAD_MS)
    // there, facing it, before the swing
    const ready = poseAt(it, swing.from - 100)!
    expect(Math.hypot(ready.at[0] - spot.x, ready.at[2] - spot.z)).toBeLessThan(0.05)
    // on its way it ran
    const running = poseAt(it, (T0 + 27_000 + swing.from) / 2)!
    expect(running.act).toBe("walk")
    expect(running.clip).toBe("Running_A")
    // the blow: the slice, sword in hand, its hit as the skeleton is struck
    const blow = poseAt(it, at)!
    expect(blow.sample?.clip).toBe("Melee_1H_Attack_Slice_Diagonal")
    expect(blow.sample?.props).toContain("kaykit-adventurers/sword-1handed")
    expect(blow.sample?.beat).toBe("hit")
    // the grave as struck: it reels at the blow and sinks after it, as the world events time it
    const struck = asStruck(grave, it.acts)
    expect(struck.strike).toBe(at)
    expect(struck.sink).toBe(at + SHOW_RULES.strikeHoldMs)
    // before the mending it was nowhere near; later it has gone back
    const before = poseAt(it, T0 + 24_000)!
    expect(Math.hypot(before.at[0] - spot.x, before.at[2] - spot.z)).toBeGreaterThan(1)
    const later = poseAt(it, at + 40_000)!
    expect(Math.hypot(later.at[0] - spot.x, later.at[2] - spot.z)).toBeGreaterThan(1)
  })

  test("a fixer with no graveyard to go to strikes nothing, and the grave sinks at its deadline", () => {
    const it = itineraries(f.log, { ...kit, graves: null }, { until: T0 + 120_000 }).get("hero")!
    expect(it.acts.some((a) => a.play === "strike")).toBe(false)
    const struck = asStruck(grave, it.acts)
    expect(struck.strike).toBeUndefined()
    expect(graveAt(struck, grave.strike! + 1)?.phase).toBe("vigil")
    expect(graveAt(struck, grave.sink!)?.phase).toBe("sink")
  })

  test("scrub = play: planned as the clock passes, every pose is the whole log's", () => {
    const whole = itineraries(f.log, kit, { until: T0 + 120_000 }).get("hero")!
    const planner = new LifePlanner(kit)
    for (const ev of f.log.events) planner.push(ev)
    const last = f.log.events[f.log.events.length - 1]!.at
    for (let t = last; t <= T0 + 120_000; t += 250) planner.advance(t)
    const played = planner.itinerary("hero")!
    for (let t = T0; t < grave.strike! + 15_000; t += 137) {
      const a = poseAt(whole, t)
      const b = poseAt(played, t)
      expect([t - T0, b?.at, b?.sample?.clip]).toEqual([t - T0, a?.at, a?.sample?.clip])
    }
  })
})
