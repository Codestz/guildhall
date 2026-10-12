import { describe, expect, test } from "bun:test"
import { parseCrowdQuery } from "../src/crowd/query.ts"
import { planFolk, plazaRadius, STRIDE, sampleFolk, stationAt, WALK_MPS } from "../src/crowd/sim.ts"
import { busiest, dayClips, tierFor } from "../src/crowd/town.ts"

const ROLES = ["farmer", "smith", "guard"]
const LOOK = { clips: { work: "Hammering", idle: "Idle_A", walk: "Walking_A" }, speed: 1, phase: 0.25 }
const duration = () => 2

describe("crowd query", () => {
  test("defaults to 60 people in a real town at golden hour, the path built", () => {
    expect(parseCrowdQuery(new URLSearchParams())).toEqual({
      n: 60,
      path: "crowd",
      cam: "wide",
      hour: 17.5,
      t: 12,
      play: true,
      seed: 1,
      layout: "town",
    })
  })

  test("reads every knob, clamps n and falls back on unknown values", () => {
    const q = parseCrowdQuery(new URLSearchParams("n=5000&path=both&cam=close&layout=line&play=0&hour=21"))
    expect(q).toMatchObject({ n: 1000, path: "both", cam: "close", layout: "line", play: false, hour: 21 })
    expect(parseCrowdQuery(new URLSearchParams("path=vat&layout=moon&n=x"))).toMatchObject({
      path: "crowd",
      layout: "town",
      n: 60,
    })
  })
})

describe("plaza folk", () => {
  test("n people with ids 0..n-1, about 45% working at stations round the plaza edge", () => {
    const folk = planFolk(60, ROLES, 1)
    expect(folk.map((f) => f.id)).toEqual(Array.from({ length: 60 }, (_, i) => i))
    const workers = folk.filter((f) => f.task.kind === "work")
    expect(workers).toHaveLength(27)
    const r = plazaRadius(60)
    for (const w of workers) {
      if (w.task.kind !== "work") continue
      expect(Math.hypot(...w.task.at)).toBeGreaterThan(r)
      // The station is in front of them, further out.
      expect(Math.hypot(...stationAt(w.task))).toBeGreaterThan(Math.hypot(...w.task.at))
    }
  })

  test("is the same plan for the same seed", () => {
    expect(planFolk(20, ROLES, 3)).toEqual(planFolk(20, ROLES, 3))
  })

  test("a walker moves at its walk speed, faces where it goes and its feet keep pace", () => {
    const walker = planFolk(60, ROLES, 1).find((f) => f.task.kind === "walk" && f.task.rest === 0)!
    const a = sampleFolk(walker, LOOK, 1, duration)
    const b = sampleFolk(walker, LOOK, 1.1, duration)
    expect(a.clip).toBe("Walking_A")
    const step = Math.hypot(b.position[0] - a.position[0], b.position[2] - a.position[2])
    expect(step).toBeCloseTo(WALK_MPS * 0.1, 2)
    const facing = [Math.sin(a.heading), Math.cos(a.heading)]
    expect(
      facing[0]! * (b.position[0] - a.position[0]) + facing[1]! * (b.position[2] - a.position[2]),
    ).toBeGreaterThan(0)
    const dPhase = (b.phase - a.phase + 1) % 1
    expect(dPhase).toBeCloseTo(step / STRIDE, 3)
  })

  test("a worker stays put, works, and rests between bouts", () => {
    const worker = planFolk(10, ROLES, 1).find((f) => f.task.kind === "work")!
    if (worker.task.kind !== "work") throw new Error("no worker")
    const clips = new Set<string>()
    for (let t = 0; t < 60; t += 0.5) {
      const s = sampleFolk(worker, LOOK, t, duration)
      expect(s.position).toEqual([worker.task.at[0], 0, worker.task.at[1]])
      clips.add(s.clip)
    }
    expect([...clips].sort()).toEqual(["Hammering", "Idle_A"])
  })
})

describe("town folk", () => {
  test("a town tier big enough for the crowd", () => {
    expect([tierFor(20), tierFor(60), tierFor(300)]).toEqual(["town", "city", "city"])
  })

  test("the clips a day plays, stays and walks alike, once each", () => {
    const day = [
      { kind: "stay", from: 0, to: 8, at: [0, 0, 0], facing: 0, clip: "Idle_A", place: "home:0" },
      { kind: "walk", from: 8, to: 9, pts: [], times: [], clips: ["Walking_A", "Walking_A"], edges: [] },
      { kind: "stay", from: 9, to: 24, at: [0, 0, 0], facing: 0, clip: "Hammering", place: "forge" },
    ]
    expect(dayClips([{ day } as never])).toEqual(["Hammering", "Idle_A", "Walking_A"])
  })

  test("the busiest point is the one with the most people near it", () => {
    const at: [number, number, number][] = [
      [0, 0, 0],
      [100, 0, 100],
      [101, 0, 100],
      [102, 1, 99],
    ]
    expect(busiest(at)).toEqual([100, 0, 100])
    expect(busiest([])).toBeNull()
  })
})
