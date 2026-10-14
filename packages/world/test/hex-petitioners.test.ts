/**
 * The petitioners at the quay (petitioners.ts): where their queue stands on an island's harbour quay
 * (clear of every solid and spot, on the quay's stone, the same for the same island), and who stands
 * where at a moment, from the queue's counts and times alone: the same however the clock got there, never
 * more than the cap in the queue, the first come served first while the rest move up.
 */
import { afterAll, describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import {
  CHEER_CLIP,
  CHEER_MS,
  hexIsland,
  hexWalk,
  hexWorld,
  hexZones,
  installTilePrefabs,
  type LifePose,
  lifePlaces,
  PETITION_CAP,
  PETITION_FIGURES,
  PETITION_GAP,
  PETITION_MPS,
  type PetitionLane,
  type PetitionQueue,
  parseTilePrefabs,
  petitionerPoses,
  petitionLane,
  workTiles,
} from "../src/index.ts"

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

/** A straight lane along +z: the front at the origin, the door 10 m behind it, the way off a metre aside. */
const LANE: PetitionLane = {
  tile: 0,
  places: Array.from({ length: PETITION_CAP }, (_, p) => ({
    at: [0, 0, p * PETITION_GAP] as [number, number, number],
    facing: Math.PI,
  })),
  approach: [
    [0, 0, 10],
    [0, 0, (PETITION_CAP - 1) * PETITION_GAP],
  ],
  exit: [
    [0, 0, 0],
    [1, 0, 0],
    [1, 0, 10],
  ],
}
const WALK_MS = (m: number) => (m / PETITION_MPS) * 1000

const out = (poses: readonly (LifePose | null)[]) => poses.filter((p) => p && !p.indoors) as LifePose[]
/** The queue's figures by where they stand along it (z), front first. */
const zs = (poses: readonly (LifePose | null)[]) =>
  out(poses)
    .filter((p) => p.at[0] === 0)
    .map((p) => Math.round(p.at[2] * 100) / 100)
    .sort((a, b) => a - b)

describe("petitionerPoses", () => {
  test("three who came long ago stand in the first three places, facing the front", () => {
    const q: PetitionQueue = { waiting: [0, 100, 200], served: 0, lately: [] }
    const poses = petitionerPoses(LANE, q, 600_000)
    expect(poses).toHaveLength(PETITION_FIGURES)
    expect(zs(poses)).toEqual([0, PETITION_GAP, 2 * PETITION_GAP])
    for (const p of out(poses)) expect(p).toMatchObject({ act: "idle", facing: Math.PI })
  })

  test("one just come walks out of the door to the back of the queue", () => {
    const q: PetitionQueue = { waiting: [0, 50_000], served: 0, lately: [] }
    const at = (t: number) => petitionerPoses(LANE, q, t)[1]!
    expect(at(50_000).indoors).toBe(true)
    const mid = at(50_000 + WALK_MS(4))
    expect(mid).toMatchObject({ act: "walk", indoors: false })
    expect(mid.at[2]).toBeCloseTo(6, 5)
    const there = at(50_000 + WALK_MS(20))
    expect(there).toMatchObject({ act: "idle" })
    expect(there.at[2]).toBeCloseTo(PETITION_GAP, 5)
  })

  test("never more than the cap in the queue: the rest wait unseen", () => {
    const q: PetitionQueue = { waiting: Array.from({ length: 13 }, (_, k) => k * 10), served: 0, lately: [] }
    const poses = petitionerPoses(LANE, q, 600_000)
    expect(out(poses)).toHaveLength(PETITION_CAP)
    expect(zs(poses)).toEqual(
      Array.from({ length: PETITION_CAP }, (_, p) => Math.round(p * PETITION_GAP * 100) / 100),
    )
    expect(out(petitionerPoses(LANE, q, 600_000, 4))).toHaveLength(4)
  })

  test("the first come is served: it cheers at the front, walks off aside, and the rest move up", () => {
    const before: PetitionQueue = { waiting: [0, 10, 20, 30], served: 0, lately: [] }
    const served = 600_000
    const after: PetitionQueue = { waiting: [10, 20, 30], served: 1, lately: [served] }
    const front = petitionerPoses(LANE, before, served - 1)
    // the figure at the front is ordinal 0's
    expect(front[0]!.at[2]).toBe(0)
    const cheer = petitionerPoses(LANE, after, served + CHEER_MS / 2)
    expect(cheer[0]).toMatchObject({ clip: CHEER_CLIP, act: "idle" })
    // while it cheers the rest keep their places: nobody steps into the front over it
    expect(cheer[1]!.at[2]).toBeCloseTo(PETITION_GAP, 5)
    expect(cheer[1]!.act).toBe("idle")
    const going = petitionerPoses(LANE, after, served + CHEER_MS + WALK_MS(3))
    expect(going[0]).toMatchObject({ act: "walk", indoors: false })
    expect(going[0]!.at[0]).toBe(1)
    // the next one has stepped up into the front place by then; the others one place each
    expect(going[1]!.at[2]).toBeCloseTo(0, 5)
    expect(zs(going)).toEqual([0, PETITION_GAP, 2 * PETITION_GAP])
    // and the one served is gone once through the door
    expect(petitionerPoses(LANE, after, served + CHEER_MS + WALK_MS(30))[0]).toBeNull()
  })

  test("served in the order they came, whatever closes: each figure keeps its ordinal's", () => {
    let q: PetitionQueue = { waiting: [0, 1, 2, 3, 4, 5, 6, 7], served: 0, lately: [] }
    const order: number[] = []
    for (let k = 0; k < 5; k++) {
      const t = 100_000 * (k + 1)
      q = { waiting: q.waiting.slice(1), served: q.served + 1, lately: [...q.lately, t] }
      const cheering = petitionerPoses(LANE, q, t + 10)
        .map((p, f) => (p?.clip === CHEER_CLIP ? f : -1))
        .filter((f) => f >= 0)
      order.push(...cheering)
    }
    expect(order).toEqual([0, 1, 2, 3, 4])
  })

  test("is the same at a moment however the clock got there (a seek, a replay)", () => {
    const q: PetitionQueue = {
      waiting: [5_000, 6_000, 7_000, 8_000, 9_000, 10_000, 11_000, 70_500],
      served: 4,
      lately: [70_000, 70_200, 71_000, 72_000],
    }
    const a = JSON.stringify(petitionerPoses(LANE, q, 73_500))
    petitionerPoses(LANE, q, 10)
    expect(JSON.stringify(petitionerPoses(LANE, q, 73_500))).toBe(a)
    // a burst of servings: the queue walks up, nobody stands in another's place
    const near = out(petitionerPoses(LANE, q, 73_500)).filter((p) => p.at[0] === 0)
    for (const [k, p] of near.entries())
      for (const o of near.slice(k + 1)) expect(Math.abs(p.at[2] - o.at[2])).toBeGreaterThan(0.3)
  })
})

describe("petitionLane", () => {
  const ISLANDS = [1, 2, 3, 4].map((seed) => {
    const h = hexIsland({ seed, files: 4000 })
    const z = hexZones(h)
    const w = hexWorld(h, z)
    const walk = hexWalk(h, z, w, { reach: workTiles(h, z) })
    const places = lifePlaces(h, z, w, walk, { heroSpots: 3 })
    return { seed, w, walk, places }
  })
  test("on a harbour quay: the cap's places, clear of every solid and spot, the same each time", () => {
    let found = 0
    for (const { seed, w, walk, places } of ISLANDS) {
      const quay = w.tiles.some((t) => t.prefab === "harbour-quay")
      const lane = petitionLane({ world: w, walk, places, doorways: w.doorways })
      if (!quay) {
        expect(lane).toBeNull()
        continue
      }
      expect(lane, `seed ${seed}`).not.toBeNull()
      if (!lane) continue
      found++
      expect(lane.places.length).toBeGreaterThanOrEqual(3)
      for (const p of lane.places) {
        expect(places.furniture.blocked(p.at[0], p.at[2], 0.28)).toBe(false)
        for (const s of places.furniture.spots)
          expect(Math.hypot(s.x - p.at[0], s.z - p.at[2])).toBeGreaterThan(0.75)
      }
      expect(lane.approach.length).toBeGreaterThanOrEqual(2)
      expect(lane.exit.length).toBeGreaterThanOrEqual(3)
      expect(JSON.stringify(petitionLane({ world: w, walk, places, doorways: w.doorways }))).toBe(
        JSON.stringify(lane),
      )
    }
    expect(found).toBeGreaterThan(0)
  })
})
