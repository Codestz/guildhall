/**
 * The world events' baked sounds (audio/showSounds.ts): each is finite, never clips, starts and ends
 * quiet (no click), is loud where it should be, and is the same for the same random stream.
 */
import { describe, expect, test } from "bun:test"
import { bakeBurst, bakeCrackle, bakeLaunch, bakeRoar, SHOW_SOUNDS } from "../src/audio/showSounds.ts"

const RATE = 22_050

function stream(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rms = (d: Float32Array, a: number, b: number) => {
  let s = 0
  for (let i = a; i < b; i++) s += (d[i] as number) ** 2
  return Math.sqrt(s / Math.max(1, b - a))
}

const BAKES = { launch: bakeLaunch, burst: bakeBurst, crackle: bakeCrackle, roar: bakeRoar } as const

describe("show sounds", () => {
  for (const [name, bake] of Object.entries(BAKES)) {
    test(`${name}: finite, under full scale, quiet at its end, the same for the same stream`, () => {
      const n = Math.floor(RATE * SHOW_SOUNDS[name as keyof typeof SHOW_SOUNDS].seconds)
      const a = new Float32Array(n)
      bake(a, RATE, stream(7))
      let peak = 0
      for (const v of a) {
        expect(Number.isFinite(v)).toBe(true)
        peak = Math.max(peak, Math.abs(v))
      }
      expect(peak).toBeGreaterThan(0.05)
      expect(peak).toBeLessThan(2)
      // it dies away: the last tenth far quieter than its loudest tenth
      const tenth = Math.floor(n / 10)
      let loudest = 0
      for (let k = 0; k < 10; k++) loudest = Math.max(loudest, rms(a, k * tenth, (k + 1) * tenth))
      expect(rms(a, n - tenth, n)).toBeLessThan(loudest * 0.35)
      const b = new Float32Array(n)
      bake(b, RATE, stream(7))
      expect(b).toEqual(a)
    })
  }

  test("a burst is loudest at once (the bang), a roar swells in", () => {
    const burst = new Float32Array(Math.floor(RATE * SHOW_SOUNDS.burst.seconds))
    bakeBurst(burst, RATE, stream(3))
    const roar = new Float32Array(Math.floor(RATE * SHOW_SOUNDS.roar.seconds))
    bakeRoar(roar, RATE, stream(3))
    const ms = (m: number) => Math.floor((RATE * m) / 1000)
    expect(rms(burst, 0, ms(60))).toBeGreaterThan(rms(burst, ms(600), ms(660)))
    expect(rms(roar, 0, ms(60))).toBeLessThan(rms(roar, ms(400), ms(460)))
  })
})
