/**
 * Stride-matched locomotion (crowd/gait.ts): a cycle per stride, so the speed over the rate is the
 * clip's own ground speed (the feet keep to the ground), and never past `RATE_MAX`; and the clips' own
 * ground speeds (sim gait.ts `GAIT_MPS`) are the rig's, its planted feet measured on rig-medium when the
 * library is here.
 */
import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { AnimationMixer, Vector3 } from "three"
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
// (sim's gait table: dependency-free, read straight from its source; render does not depend on sim)
import { GAIT_MPS } from "../../sim/src/life/gait.ts"
import { RATE_MAX, strideRate, strideStep } from "../src/crowd/gait.ts"

describe("stride-matched", () => {
  test("a cycle per stride: speed over rate is the clip's own speed, at any scale", () => {
    const dt = 1 / 60
    for (const [own, seconds] of [
      [0.78, 1.067],
      [3, 0.8],
      [5, 0.8],
    ] as const)
      for (const scale of [0.85, 1, 1.2])
        for (const rate of [0.6, 1, 1.4, RATE_MAX]) {
          const mps = own * scale * rate
          const played = (strideStep(mps * dt, dt, own, seconds, scale) / dt) * seconds
          expect(played).toBeCloseTo(rate, 9)
          expect(played).toBeCloseTo(strideRate(mps, own, scale), 9)
          expect(mps / played).toBeCloseTo(own * scale, 9)
        }
  })

  test("never past RATE_MAX: a frame's leap does not spin the legs", () => {
    const step = strideStep(4, 1 / 60, 3, 0.8)
    expect(step * 60 * 0.8).toBeCloseTo(RATE_MAX, 9)
    expect(strideStep(1, 0, 3, 0.8)).toBe(0)
    expect(strideStep(1, 1 / 60, 0, 0.8)).toBe(0)
  })
})

const RIG = join(import.meta.dir, "../../../library/rigs/rig-medium.glb")

describe("the clips' ground speeds are the rig's", () => {
  test.skipIf(!existsSync(RIG))("each gait clip's planted feet go back at its GAIT_MPS (±15%)", async () => {
    await MeshoptDecoder.ready
    const buf = readFileSync(RIG)
    const gltf = await new GLTFLoader()
      .setMeshoptDecoder(MeshoptDecoder)
      .parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, "")
    const root = gltf.scene
    const feet = [root.getObjectByName("footl"), root.getObjectByName("footr")]
    const v = new Vector3()
    let measured = 0
    for (const [name, mps] of Object.entries(GAIT_MPS)) {
      const clip = gltf.animations.find((c) => c.name === name)
      if (!clip) continue // (the carrying walk is made at load, with Walking_A's legs)
      const mixer = new AnimationMixer(root)
      mixer.clipAction(clip).play()
      const N = 480
      const ys = feet.map(() => [] as number[])
      const zs = feet.map(() => [] as number[])
      for (let i = 0; i <= N; i++) {
        mixer.setTime((clip.duration * i) / N)
        root.updateMatrixWorld(true)
        for (const [k, f] of feet.entries()) {
          f?.getWorldPosition(v)
          ys[k]?.push(v.y)
          zs[k]?.push(v.z)
        }
      }
      // a foot within 3 cm of its lowest is planted: the ground goes back under it at the body's speed
      let metres = 0
      let secs = 0
      for (let k = 0; k < feet.length; k++) {
        const y = ys[k] as number[]
        const z = zs[k] as number[]
        const low = Math.min(...y) + 0.03
        for (let i = 1; i <= N; i++)
          if ((y[i] as number) < low && (y[i - 1] as number) < low) {
            metres += (z[i - 1] as number) - (z[i] as number)
            secs += clip.duration / N
          }
      }
      const speed = metres / secs
      expect([name, Math.abs(speed / mps - 1) < 0.15]).toEqual([name, true])
      mixer.uncacheRoot(root)
      measured++
    }
    expect(measured).toBeGreaterThanOrEqual(5)
  })
})
