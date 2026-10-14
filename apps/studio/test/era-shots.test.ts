/**
 * The Legends' era pictures (hall/eraShots.ts): nothing is drawn until asked, the eras are drawn one at
 * a time in book order, a picture is cached per repo and era (a second hall finds it), a failure is
 * not retried, and a dispose stops the queue. Plus the fixed frame and render's GL-rows flip.
 */
import { describe, expect, test } from "bun:test"
import { flipRows } from "@guildhall/render"
import {
  createEraShots,
  ERA_SHOT,
  type EraCapture,
  eraPose,
  eraShotKey,
  goldenAzimuth,
} from "../src/hall/eraShots.ts"

/** A capture the test resolves by hand: each shot waits until `land(at)` (or `fail(at)`). */
function handCapture() {
  const waiting = new Map<number, { resolve: (u: string) => void; reject: (e: unknown) => void }>()
  const shot: number[] = []
  let disposed = false
  const capture: EraCapture = {
    shoot(at) {
      shot.push(at)
      return new Promise((resolve, reject) => waiting.set(at, { resolve, reject }))
    },
    stats: () => null,
    dispose() {
      disposed = true
    },
  }
  const tick = () => new Promise((r) => setTimeout(r, 0))
  return {
    capture,
    shot,
    disposed: () => disposed,
    async land(at: number) {
      waiting.get(at)?.resolve(`data:era-${at}`)
      waiting.delete(at)
      await tick()
    },
    async fail(at: number) {
      waiting.get(at)?.reject(new Error("no"))
      waiting.delete(at)
      await tick()
    },
  }
}

const jobs = (...ats: number[]) => ats.map((at) => ({ key: `r#e${at}@${at}`, at }))

describe("era shots: the queue", () => {
  test("nothing is drawn until the book asks", () => {
    const hand = handCapture()
    const shots = createEraShots(hand.capture, new Map())
    expect(hand.shot).toEqual([])
    expect(shots.stats().queued).toBe(0)
    expect(shots.get("r#e1@1")).toBeUndefined()
  })

  test("the eras are drawn one at a time, in book order", async () => {
    const hand = handCapture()
    const shots = createEraShots(hand.capture, new Map())
    let heard = 0
    shots.subscribe(() => heard++)
    shots.want(jobs(1, 2, 3))
    expect(hand.shot).toEqual([1])
    expect(shots.waiting("r#e1@1")).toBe(true)
    expect(shots.waiting("r#e3@3")).toBe(true)
    expect(shots.stats().queued).toBe(3)
    await hand.land(1)
    expect(shots.get("r#e1@1")).toBe("data:era-1")
    expect(shots.waiting("r#e1@1")).toBe(false)
    expect(hand.shot).toEqual([1, 2])
    await hand.land(2)
    await hand.land(3)
    expect(hand.shot).toEqual([1, 2, 3])
    expect(shots.stats()).toMatchObject({ drawn: 3, failed: 0, queued: 0 })
    expect(heard).toBeGreaterThanOrEqual(3)
  })

  test("asking again queues nothing twice, and a drawn era is never drawn again", async () => {
    const hand = handCapture()
    const shots = createEraShots(hand.capture, new Map())
    shots.want(jobs(1, 2))
    shots.want(jobs(1, 2))
    await hand.land(1)
    shots.want(jobs(1, 2))
    await hand.land(2)
    shots.want(jobs(1, 2))
    expect(hand.shot).toEqual([1, 2])
  })

  test("the cache outlives the hall: a hall opened again shows its pictures at once", async () => {
    const cache = new Map<string, string>()
    const first = handCapture()
    const a = createEraShots(first.capture, cache)
    a.want(jobs(1))
    await first.land(1)
    a.dispose()
    expect(first.disposed()).toBe(true)
    const second = handCapture()
    const b = createEraShots(second.capture, cache)
    expect(b.get("r#e1@1")).toBe("data:era-1")
    b.want(jobs(1, 2))
    expect(second.shot).toEqual([2])
  })

  test("a failed picture is left to the count, not retried, and the queue goes on", async () => {
    const hand = handCapture()
    const shots = createEraShots(hand.capture, new Map())
    shots.want(jobs(1, 2))
    await hand.fail(1)
    expect(shots.waiting("r#e1@1")).toBe(false)
    expect(shots.get("r#e1@1")).toBeUndefined()
    expect(hand.shot).toEqual([1, 2])
    await hand.land(2)
    shots.want(jobs(1, 2))
    expect(hand.shot).toEqual([1, 2])
    expect(shots.stats()).toMatchObject({ drawn: 1, failed: 1 })
  })

  test("a dispose stops the queue and drops the picture under way", async () => {
    const cache = new Map<string, string>()
    const hand = handCapture()
    const shots = createEraShots(hand.capture, cache)
    shots.want(jobs(1, 2))
    shots.dispose()
    await hand.land(1)
    expect(cache.size).toBe(0)
    expect(hand.shot).toEqual([1])
    shots.want(jobs(3))
    expect(hand.shot).toEqual([1])
  })

  test("a hall that cannot film never waits", () => {
    const shots = createEraShots(null, new Map())
    shots.want(jobs(1))
    expect(shots.waiting("r#e1@1")).toBe(false)
    expect(shots.stats().queued).toBe(0)
  })
})

describe("era shots: the frame", () => {
  test("a key names the repo, the era and its end", () => {
    expect(eraShotKey("facebook/react", { id: "e2", end: 1_500_000_000_000 })).toBe(
      "facebook/react#e2@1500000000000",
    )
  })

  test("every era is framed the same: the island's middle, from the map view, the sun from the side", () => {
    const pose = eraPose({ centre: [4, -2], half: 100 })
    expect(pose.target).toEqual([4, 0, -2])
    expect(pose.elevation).toBe(ERA_SHOT.elevation)
    expect(pose.distance).toBe(100 * ERA_SHOT.reach)
    expect(pose.azimuth).toBe(goldenAzimuth())
    expect(eraPose({ centre: [4, -2], half: 100 })).toEqual(pose)
    expect(ERA_SHOT.width / ERA_SHOT.height).toBeCloseTo(16 / 9)
  })

  test("render's read-back flips GL's bottom-up rows and makes every pixel opaque", () => {
    // 1×2: the bottom row (first in GL) red, the top green
    const gl = new Uint8Array([255, 0, 0, 0, 0, 255, 0, 10])
    expect([...flipRows(gl, 1, 2)]).toEqual([0, 255, 0, 255, 255, 0, 0, 255])
  })
})
