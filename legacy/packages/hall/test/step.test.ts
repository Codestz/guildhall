import { describe, expect, test } from "bun:test"
import { Clock } from "three"
import { stepFrame } from "../src/scene/step.ts"

/**
 * R3F 9's `advance(t)` under frameloop "never" (fiber's `update`): the running clock's getDelta()
 * first, then the frame's delta measured from `elapsedTime`, which it overwrites with `t`.
 */
function r3fAdvance(clock: Clock, deltas: number[]): (timestamp: number) => void {
  return (timestamp) => {
    clock.getDelta()
    deltas.push(timestamp - clock.elapsedTime)
    clock.oldTime = clock.elapsedTime
    clock.elapsedTime = timestamp
  }
}

describe("stepFrame: the recorder's hand-stepped frames", () => {
  test("every frame is exactly dt, the first included, after the loop ran on its own", async () => {
    const clock = new Clock()
    clock.getDelta() // the "always" loop has been running: the clock is started
    await Bun.sleep(20)
    const deltas: number[] = []
    const advance = r3fAdvance(clock, deltas)
    for (let i = 0; i < 4; i++) stepFrame(clock, advance, 1 / 30)
    for (const delta of deltas) expect(delta).toBeCloseTo(1 / 30, 9)
  })

  test("regression: advancing a running clock by hand gives a wrong, unstable first delta", async () => {
    const clock = new Clock()
    clock.getDelta()
    await Bun.sleep(20)
    const deltas: number[] = []
    const advance = r3fAdvance(clock, deltas)
    advance(clock.elapsedTime + 1 / 30)
    advance(clock.elapsedTime + 1 / 30)
    // The second frame mixes performance.now() ms with seconds: far from 1/30, negative.
    expect(deltas[1]).toBeLessThan(0)
  })
})
