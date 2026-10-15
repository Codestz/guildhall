import { describe, expect, test } from "bun:test"
import {
  initialLadder,
  ladderStep,
  qualityTier,
  startTier,
  TIER_DOWN_WINDOWS,
  TIER_MAX_UP_WINDOWS,
  TIER_UP_WINDOWS,
  TIERS,
} from "../src/governor.ts"

const bad = { pacedOut: true, over: true, dprAtFloor: true, calm: false }
const calm = { pacedOut: false, over: false, dprAtFloor: false, calm: true }
const busy = { pacedOut: false, over: true, dprAtFloor: false, calm: false }

describe("the quality ladder", () => {
  test("steps down in order, and only once pacing at 30 and the DPR at its floor cannot hold the frame", () => {
    let s = initialLadder()
    for (let k = 0; k < 10; k++) s = ladderStep(s, busy)
    expect(s.tier).toBe(0)
    for (let k = 0; k < 10; k++) s = ladderStep(s, { ...bad, pacedOut: false })
    expect(s.tier).toBe(0)
    for (let k = 0; k < 10; k++) s = ladderStep(s, { ...bad, dprAtFloor: false })
    expect(s.tier).toBe(0)
    for (let k = 0; k < TIER_DOWN_WINDOWS; k++) s = ladderStep(s, bad)
    expect(s.tier).toBe(1)
    for (let k = 0; k < TIER_DOWN_WINDOWS; k++) s = ladderStep(s, bad)
    expect(s.tier).toBe(2)
    for (let k = 0; k < 3 * TIER_DOWN_WINDOWS; k++) s = ladderStep(s, bad)
    expect(s.tier).toBe(TIERS.length - 1)
  })

  test("the tiers lower the DPR floor first, then the shadows, then the crowd's far LOD and the particles", () => {
    const [t0, t1, t2, t3] = TIERS as [
      (typeof TIERS)[0],
      (typeof TIERS)[0],
      (typeof TIERS)[0],
      (typeof TIERS)[0],
    ]
    expect(t1.dprFloor).toBeLessThan(t0.dprFloor)
    expect(t1.shadowMap).toBe(t0.shadowMap)
    expect(t2.shadowMap).toBeLessThan(t1.shadowMap)
    expect(t3.lodBias).toBeGreaterThan(t2.lodBias)
    expect(t3.particles).toBeLessThan(t2.particles)
  })

  test("steps back up only after the calm stretch, which doubles when a raise did not hold", () => {
    let s = initialLadder()
    for (let k = 0; k < TIER_DOWN_WINDOWS; k++) s = ladderStep(s, bad)
    expect(s.tier).toBe(1)
    for (let k = 0; k < TIER_UP_WINDOWS - 1; k++) s = ladderStep(s, calm)
    expect(s.tier).toBe(1)
    s = ladderStep(s, busy)
    for (let k = 0; k < TIER_UP_WINDOWS - 1; k++) s = ladderStep(s, calm)
    expect(s.tier).toBe(1)
    s = ladderStep(s, calm)
    expect(s.tier).toBe(0)
    for (let k = 0; k < TIER_DOWN_WINDOWS; k++) s = ladderStep(s, bad)
    expect(s.tier).toBe(1)
    expect(s.upWindows).toBe(TIER_UP_WINDOWS * 2)
    for (let k = 0; k < TIER_UP_WINDOWS; k++) s = ladderStep(s, calm)
    expect(s.tier).toBe(1)
    for (let k = 0; k < TIER_UP_WINDOWS; k++) s = ladderStep(s, calm)
    expect(s.tier).toBe(0)
    expect(s.upWindows).toBeLessThanOrEqual(TIER_MAX_UP_WINDOWS)
  })

  test("a device starts at a sensible tier: a strong desktop at 0, a phone a tier down, a weak phone two", () => {
    const desktop = {
      renderer: "ANGLE (Apple, Apple M1 Pro, OpenGL 4.1)",
      cores: 10,
      memory: 16,
      touch: false,
      dpr: 2,
    }
    expect(startTier(desktop)).toBe(0)
    expect(startTier({ ...desktop, renderer: "ANGLE (Intel, Intel(R) UHD Graphics 620, OpenGL 4.1)" })).toBe(
      1,
    )
    const phone = { renderer: "Apple GPU", cores: 6, memory: 0, touch: true, dpr: 3 }
    expect(startTier(phone)).toBe(1)
    expect(startTier({ ...phone, renderer: "Mali-G52", cores: 8 })).toBe(2)
    expect(startTier({ ...phone, cores: 4 })).toBe(2)
    expect(startTier({ ...phone, memory: 3 })).toBe(2)
  })

  test("a viewer's pick is a fixed tier: High the full look, Medium one down, Low the lowest; Auto none", () => {
    expect(qualityTier("high")).toBe(0)
    expect(qualityTier("medium")).toBe(1)
    expect(qualityTier("low")).toBe(TIERS.length - 1)
    expect(qualityTier("auto")).toBeNull()
  })
})
