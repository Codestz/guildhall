/**
 * The townsfolk's day spreads them by hour and place (with the authored data/tiles, as the Studio
 * builds): no crowd round one well at noon, the tavern's garden full in the evening, every spot used
 * only in its open hours and by one person at a time.
 */
import { afterAll, describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import {
  agentLoop,
  GREAT_HALL,
  lifePlaces,
  lifePose,
  openFor,
  planFolk,
  SQUARE_CAP,
  workTiles,
} from "../src/hex/life.ts"
import {
  hexIsland,
  hexWalk,
  hexWorld,
  hexZones,
  installTilePrefabs,
  opensEvening,
  type TilePrefab,
} from "../src/index.ts"

const DIR = join(import.meta.dir, "../../../data/tiles")
installTilePrefabs(
  readdirSync(DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(DIR, f), "utf8")) as TilePrefab),
)
afterAll(() => installTilePrefabs(null))

describe("the day spreads the crowd", () => {
  const h = hexIsland({ seed: 1, files: 4000 })
  const z = hexZones(h)
  const w = hexWorld(h, z)
  const walk = hexWalk(h, z, w, { reach: workTiles(h, z) })
  const places = lifePlaces(h, z, w, walk)
  const folk = planFolk(h, z, w, walk, { seed: 1, pace: 144, places })
  const key = (x: number, zz: number) => `${x.toFixed(2)},${zz.toFixed(2)}`
  const spotAt = new Map(places.furniture.spots.map((s) => [key(s.x, s.z), s]))

  test("at lunch only a handful stand round any one square; most are elsewhere", () => {
    for (const hour of [12, 12.5, 13]) {
      for (const [zi] of z.zones.entries()) {
        const slots = new Set(places.slots(zi).map((s) => key(s.at[0], s.at[2])))
        const there = folk.filter((f) => {
          const p = lifePose(f.day, hour, 24)
          return !p.indoors && p.act !== "walk" && slots.has(key(p.at[0], p.at[2]))
        })
        expect(there.length).toBeLessThanOrEqual(SQUARE_CAP)
      }
    }
    // out to eat somewhere of their own: seats, stalls, doorsteps
    const seated = folk.filter((f) => lifePose(f.day, 12.5, 24).clip?.startsWith("Sit")).length
    expect(seated).toBeGreaterThan(folk.length * 0.12)
  })

  test("in the evening the tavern's garden fills (its seats open from five)", () => {
    const tavern = folk.filter((f) => {
      const p = lifePose(f.day, 19.5, 24)
      const s = spotAt.get(key(p.at[0], p.at[2]))
      return p.act !== "walk" && opensEvening(s?.hours)
    })
    expect(tavern.length).toBeGreaterThan(10)
  })

  test("at lunch the canteen's garden has a crowd; a plain tavern's seats stay empty till the evening", () => {
    const at = (hour: number, prefabs: string[]) =>
      folk.filter((f) => {
        const p = lifePose(f.day, hour, 24)
        const s = spotAt.get(key(p.at[0], p.at[2]))
        return (
          p.act !== "walk" && !!s && opensEvening(s.hours) && prefabs.includes(places.prefabOf(s.tile) ?? "")
        )
      }).length
    const lunch = [12, 12.25, 12.5, 12.75, 13, 13.25, 13.5]
    expect(Math.max(...lunch.map((hour) => at(hour, ["tavern-garden"])))).toBeGreaterThanOrEqual(4)
    for (const hour of lunch) expect(at(hour, ["tavern", "tavern-yard"])).toBe(0)
    expect(at(15.5, ["tavern-garden", "tavern", "tavern-yard"])).toBe(0)
  })

  test("every spot is used in its open hours, by one person at a time", () => {
    const uses = new Map<string, [number, number, number][]>()
    let checked = 0
    for (const f of folk)
      for (const s of f.day) {
        if (s.kind !== "stay" || s.indoors) continue
        const spot = spotAt.get(key(s.at[0], s.at[2]))
        if (!spot) continue
        checked++
        expect([spot.hours, s.from, s.to, openFor(spot.hours, s.from, s.to)]).toEqual([
          spot.hours,
          s.from,
          s.to,
          true,
        ])
        const k = key(s.at[0], s.at[2])
        for (const [a, b, who] of uses.get(k) ?? [])
          if (who !== f.id) expect(a < s.to && s.from < b).toBe(false)
        uses.set(k, [...(uses.get(k) ?? []), [s.from, s.to, f.id]])
      }
    expect(checked).toBeGreaterThan(folk.length * 2)
  })

  test("agents rest at the great hall's own spots, one each, before the slots round the heart", () => {
    const fresh = lifePlaces(h, z, w, walk)
    const hall = fresh.furniture.spots.filter(
      (s) => !s.roles && fresh.prefabOf(s.tile) === GREAT_HALL && s.kind !== "work",
    )
    expect(hall.length).toBeGreaterThan(0)
    const rests = [0, 1, 2].map((slot) => {
      const first = agentLoop(walk, z, [{ place: "camp", work: 20, idle: 5 }], { slot, places: fresh })
        .steps[0]!
      return first.kind === "stay" ? key(first.at[0], first.at[2]) : ""
    })
    const onHall = new Set(hall.map((s) => key(s.x, s.z)))
    const seated = rests.filter((k) => onHall.has(k))
    expect(seated.length).toBe(Math.min(3, hall.length))
    expect(new Set(seated).size).toBe(seated.length)
  })

  test("open hours wrap past midnight", () => {
    expect(openFor([17, 1], 18, 23.5)).toBe(true)
    expect(openFor([17, 1], 12, 13)).toBe(false)
    expect(openFor([8, 20], 17, 20.5)).toBe(false)
    expect(openFor(undefined, 0, 24)).toBe(true)
    // a canteen's seats: lunch and the evening, closed between
    const canteen: [number, number][] = [
      [11.5, 14],
      [17, 1],
    ]
    expect(openFor(canteen, 12, 13.5)).toBe(true)
    expect(openFor(canteen, 20, 24.5)).toBe(true)
    expect(openFor(canteen, 15, 16)).toBe(false)
    expect(openFor(canteen, 13, 18)).toBe(false)
  })
})
