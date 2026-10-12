import { describe, expect, test } from "bun:test"
import { applyAll, emptyModel } from "@guildhall/core"
import { rush, saga } from "@guildhall/sim"
import { type AdventurerView, viewsOf } from "../src/guild/store.ts"
import { release, reserve } from "../src/scene/activity.ts"
import {
  beside,
  LOCAL_WALK,
  type Place,
  placeOf,
  Routine,
  STATION_WORK,
  shifted,
} from "../src/world/behaviours.ts"
import { onDryLand, onKeepFloor } from "../src/world/clearance.ts"
import { STATIONS } from "../src/world/layout.ts"
import {
  along,
  BODY,
  blocker,
  ISLAND_OBSTACLES,
  KEEP_OBSTACLES,
  type Obstacle,
  walks,
} from "./support/clearance.ts"

/**
 * Crowds at a berth (Chapter 2): past a place's posts the store sends the extra workers to the posts
 * again; the scene reserves each a lap (scene/activity.ts) and spreads the laps round the post
 * (world/sharers.ts) — a few in the line beside it as ever, a crowd over the open ground round it.
 */

/** Everyone at work at a place, each with the lap the scene would reserve them, in join order. */
function workers(views: readonly AdventurerView[]): { view: AdventurerView; place: Place; lap: number }[] {
  const out: { view: AdventurerView; place: Place; lap: number }[] = []
  for (const view of views) {
    if (view.phase !== "working") continue
    const place = placeOf(view.site, view.station, view.target)
    if (place) out.push({ view, place, lap: reserve(place, view.id) })
  }
  for (const { view, place } of out) release(place, view.id)
  return out
}

function stage(changes: ReturnType<typeof rush>, t: number): AdventurerView[] {
  const start = changes[0]?.at ?? 0
  return viewsOf(
    applyAll(
      emptyModel(),
      changes.filter((c) => c.at <= start + t),
    ),
    start + t,
  )
}

/** The obstacles within `reach` of a spot: the island has thousands. */
const near = (obstacles: readonly Obstacle[], [x, z]: readonly [number, number], reach: number) =>
  obstacles.filter((o) => o.distance(x, z) < reach)

describe("a few sharers", () => {
  test("the Saga's sharers stand in the line beside the post, as they always have", () => {
    const changes = saga()
    const end = (changes.at(-1)?.at ?? 0) - (changes[0]?.at ?? 0)
    let shared = 0
    for (let t = 0; t <= end; t += 5000)
      for (const { place, lap } of workers(stage(changes, t))) {
        if (lap === 0) continue
        shared++
        const [dx, dz] = beside(place, lap)
        const [x, z] = place.post
        expect(shifted(place, lap).post).toEqual([
          Math.round((x + dx) * 100) / 100,
          Math.round((z + dz) * 100) / 100,
          place.post[2],
        ])
      }
    expect(shared).toBeGreaterThan(0)
  })
})

describe("a rush of 300", () => {
  const changes = rush(300)
  /** Its busiest moments: everyone out at work, then the first ones home. */
  const BUSIEST = [10_000, 20_000, 30_000, 40_000]

  test("at its busiest, no two workers stand within 0.7 of each other", () => {
    for (const t of BUSIEST) {
      const posts = workers(stage(changes, t)).map(({ place, lap }) => shifted(place, lap).post)
      expect(posts.length).toBeGreaterThan(150)
      let closest = Number.POSITIVE_INFINITY
      for (let i = 0; i < posts.length; i++)
        for (let j = i + 1; j < posts.length; j++) {
          const a = posts[i] ?? [0, 0]
          const b = posts[j] ?? [0, 0]
          closest = Math.min(closest, Math.hypot(a[0] - b[0], a[1] - b[1]))
        }
      expect({ t, close: closest < 0.7 }).toEqual({ t, close: false })
    }
  })

  test("every sharer's standing spot is on dry level land, clear of the island's obstacles", () => {
    for (const t of BUSIEST)
      for (const { place, lap } of workers(stage(changes, t))) {
        if (lap === 0) continue
        const moved = shifted(place, lap)
        for (const [name, spot] of Object.entries(moved.spots)) {
          if (place.behaviour.marks.has(name)) continue
          const at = `${place.key}#${place.berth} lap ${lap} ${name}`
          expect({ at, dry: onDryLand(spot), blocked: blocker(spot, ISLAND_OBSTACLES)?.name }).toEqual({
            at,
            dry: true,
            blocked: undefined,
          })
        }
      }
  })

  test("every sharer's short walks stay on dry land and never cross a prop", () => {
    const seen = new Set<string>()
    for (const { place, lap } of workers(stage(changes, BUSIEST[0] ?? 0))) {
      const key = `${place.key}#${place.berth}/${lap}`
      if (lap === 0 || seen.has(key)) continue
      seen.add(key)
      const moved = shifted(place, lap)
      const post: [number, number] = [moved.post[0], moved.post[1]]
      const obstacles = near(ISLAND_OBSTACLES, post, 30)
      for (const steps of [place.behaviour.loop, ...(place.behaviour.steer ?? []).map((s) => s.steps)])
        for (const walk of walks(moved, [...steps, ...steps], post)) {
          // The long ones take the roads (behaviours `legOf`): world/paths.ts keeps those clear.
          if (walk.path.length > 2) continue
          const points = along(walk.path)
          const hit = points.map((p) => blocker(p, obstacles, BODY * 0.6)?.name).find(Boolean)
          const wet = points.some((p) => !onDryLand(p))
          expect({ key, to: walk.to, hit, wet }).toEqual({ key, to: walk.to, hit: undefined, wet: false })
        }
    }
    expect(seen.size).toBeGreaterThan(100)
  })

  test("everyone at a berth gets their own lap and a routine that runs", () => {
    for (const t of BUSIEST) {
      const views = stage(changes, t)
      const atWork = views.filter((v) => v.phase === "working" && (v.site || v.station))
      const placed = workers(views)
      expect(placed.length).toBe(atWork.length)
      const laps = new Set(placed.map(({ place, lap }) => `${place.key}#${place.berth}/${lap}`))
      expect(laps.size).toBe(placed.length)
      for (const { view, place, lap } of placed) {
        const routine = new Routine(shifted(place, lap), 1)
        routine.update(1 / 30, { thinking: false, tool: undefined, arrived: true })
        routine.update(1 / 30, { thinking: false, tool: undefined, arrived: true })
        expect({
          id: view.id,
          started: routine.started,
          doing: routine.clip !== null || routine.aim !== null,
        }).toEqual({ id: view.id, started: true, doing: true })
      }
    }
  })
})

describe("a crowd at a keep station", () => {
  test("errands to one station spread over the keep's open floor, apart, clear of the furniture", () => {
    for (const id of ["forge", "library", "overflow"] as const) {
      const posts = STATIONS[id].posts
      const errand = posts[posts.length - 1]
      if (!errand) throw new Error(id)
      const place = placeOf(undefined, id, errand)
      if (!place) throw new Error(id)
      expect(place.behaviour).toBe(STATION_WORK[id])
      const stands = Array.from({ length: 20 }, (_, n) => shifted(place, n + 1))
      const all = [place, ...stands].map((p) => p.post)
      for (let i = 0; i < all.length; i++)
        for (let j = i + 1; j < all.length; j++) {
          const a = all[i] ?? [0, 0]
          const b = all[j] ?? [0, 0]
          expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeGreaterThanOrEqual(0.7)
        }
      for (const moved of stands)
        for (const [name, spot] of Object.entries(moved.spots)) {
          if (place.behaviour.marks.has(name)) continue
          expect({
            id,
            name,
            floor: onKeepFloor(spot),
            blocked: blocker(spot, KEEP_OBSTACLES)?.name,
          }).toEqual({
            id,
            name,
            floor: true,
            blocked: undefined,
          })
        }
      // Close by: the crowd stays round its station, not across the hall.
      for (const moved of stands)
        expect(Math.hypot(moved.post[0] - errand[0], moved.post[1] - errand[1])).toBeLessThan(LOCAL_WALK + 4)
    }
  })
})
