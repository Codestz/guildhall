/**
 * Locomotion looks natural (sim gait.ts + render crowd gait.ts + hexworld life.ts): every walk, run and
 * sprint is drawn stride-matched, its rate (speed over the clip's own ground speed) within its band and
 * never over the cap, so the feet keep to the ground (the clips' own ground speeds are the rig's:
 * render test/gait.test.ts measures them).
 */
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { RATE_MAX, strideRate, strideStep } from "@guildhall/render"
import {
  BRISK_WALK,
  GAIT_RATE_MAX,
  GAIT_RATE_MIN,
  gaitMps,
  gaitOf,
  RUN_CLIP,
  RUN_FROM,
  RUN_TOP,
  SPRINT_CLIP,
  SPRINT_FROM,
  STRIKE_RUN_MPS,
  WALK_TOP,
  walkFor,
} from "@guildhall/sim"
import { AGENT_OPTS, LIFE_MPS } from "../src/hexworld/lifePlan.ts"

const NPCS = join(import.meta.dir, "../../../data/npcs")
const walks = readdirSync(NPCS)
  .filter((f) => f.endsWith(".json"))
  .map(
    (f) => (JSON.parse(readFileSync(join(NPCS, f), "utf8")) as { activity: { walk: string } }).activity.walk,
  )

/** The clip a body at `mps` goes in (its look's walk `walk`), as life.ts draws it. */
const drawn = (walk: string, mps: number) => gaitOf(mps) ?? walkFor(walk, mps)

describe("the gaits keep their legs at their own pace", () => {
  test("the cap is the render's and the sim's both", () => {
    expect(RATE_MAX).toBe(GAIT_RATE_MAX)
  })

  test("every pace a hero can go is drawn in a clip played within its band (≤ the cap)", () => {
    for (let mps = 0.3; mps <= RUN_TOP + 1e-9; mps += 0.01) {
      // (the gap between the walk's top and the run's foot is never gone at: itineraries.ts `paced`)
      if (mps > WALK_TOP && mps < RUN_FROM) continue
      for (const walk of walks) {
        const clip = drawn(walk, mps)
        const rate = strideRate(mps, gaitMps(clip))
        expect([mps, clip, rate <= GAIT_RATE_MAX + 1e-9]).toEqual([mps, clip, true])
        if (clip === RUN_CLIP || clip === SPRINT_CLIP)
          expect([mps, clip, rate >= GAIT_RATE_MIN - 1e-9]).toEqual([mps, clip, true])
      }
    }
    expect(drawn(BRISK_WALK, SPRINT_FROM)).toBe(SPRINT_CLIP)
    expect(drawn(BRISK_WALK, RUN_FROM)).toBe(RUN_CLIP)
  })

  test("the hall's heroes and townsfolk go at paces their clips keep (hurry under the sprint's top)", () => {
    expect(AGENT_OPTS.hurry.mps).toBeLessThanOrEqual(RUN_TOP)
    expect(STRIKE_RUN_MPS).toBeGreaterThanOrEqual(RUN_FROM)
    for (const walk of walks) {
      expect(strideRate(AGENT_OPTS.mps, gaitMps(walkFor(walk, AGENT_OPTS.mps)))).toBeLessThanOrEqual(RATE_MAX)
      expect(strideRate(LIFE_MPS, gaitMps(walkFor(walk, LIFE_MPS)))).toBeLessThanOrEqual(RATE_MAX)
    }
    // a slow march (the guard's) gives way to the plain walk at a hero's pace
    expect(walkFor("Walking_C", AGENT_OPTS.mps)).toBe(BRISK_WALK)
  })

  test("stride-matched: the feet keep to the ground (speed over rate is the clip's own speed), capped", () => {
    const seconds = 0.8
    for (const scale of [0.9, 1, 1.15])
      for (const mps of [RUN_FROM, 3, SPRINT_FROM, 7]) {
        const clip = gaitOf(mps)!
        const own = gaitMps(clip)
        const dt = 1 / 60
        // a cycle per stride: the phase a second, times the clip's length, is its rate
        const rate = (strideStep(mps * dt, dt, own, seconds, scale) / dt) * seconds
        expect(rate).toBeCloseTo(strideRate(mps, own, scale), 9)
        expect(mps / rate).toBeCloseTo(own * scale, 9)
        expect(rate).toBeLessThanOrEqual(RATE_MAX)
      }
    // a leap in a frame (a shove, a seek) does not spin the legs
    expect((strideStep(5, 1 / 60, 3, 0.8) * 60 * 0.8) / 1).toBeCloseTo(RATE_MAX, 9)
    expect(strideStep(1, 0, 3, 0.8)).toBe(0)
  })
})
