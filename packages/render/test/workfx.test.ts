import { describe, expect, test } from "bun:test"
import { Matrix4, PerspectiveCamera } from "three"
import { siteFor, workfxOf } from "../src/workfx/debug.ts"
import { beatKinds, KIND, MAX_BURST, WORK_KINDS } from "../src/workfx/kinds.ts"
import {
  aliveAt,
  burstCount,
  burstSeed,
  createSlots,
  inView,
  MAX_PARTICLES,
  NEAR_M,
  particleSeed,
  takeSlots,
} from "../src/workfx/pool.ts"
import { FRAGMENT, VERTEX } from "../src/workfx/shader.ts"

/** The work FX (game feel C): their pure parts. */

describe("slots", () => {
  test("never more than MAX_PARTICLES alive, and a live particle is never taken", () => {
    const slots = createSlots()
    let taken = 0
    for (let i = 0; i < 100; i++) taken += takeSlots(slots, 12, 0, 1).length
    expect(taken).toBe(MAX_PARTICLES)
    expect(aliveAt(slots, 0.5)).toBe(MAX_PARTICLES)
    // full: a burst gets nothing until some are gone
    expect(takeSlots(slots, 5, 0.5, 2)).toEqual([])
    expect(takeSlots(slots, 5, 1, 2)).toHaveLength(5)
    expect(aliveAt(slots, 1)).toBe(5)
  })

  test("a burst too big for what is free is cut down, never past the free slots", () => {
    const slots = createSlots(8)
    takeSlots(slots, 6, 0, 10)
    const got = takeSlots(slots, 6, 1, 3)
    expect(got).toHaveLength(2)
    expect(new Set(got).size).toBe(2)
    expect(aliveAt(slots, 2)).toBe(8)
    expect(aliveAt(slots, 5)).toBe(6)
  })

  test("the slots go round the ring, the ones longest free first", () => {
    const slots = createSlots(6)
    expect(takeSlots(slots, 2, 0, 1)).toEqual([0, 1])
    expect(takeSlots(slots, 2, 0, 1)).toEqual([2, 3])
    expect(takeSlots(slots, 3, 2, 3)).toEqual([4, 5, 0])
  })

  test("a burst's count: the kind's, a little more for a bigger blow, capped", () => {
    for (const kind of WORK_KINDS) {
      expect(burstCount(kind)).toBe(KIND[kind].count)
      expect(burstCount(kind, 9)).toBeLessThanOrEqual(MAX_BURST)
      expect(burstCount(kind, 0)).toBeGreaterThanOrEqual(1)
    }
  })
})

describe("determinism", () => {
  test("the same kind, spot and seed give the same particles; any change gives others", () => {
    const at: [number, number, number] = [-38.46, 2.75, -15.79]
    const a = burstSeed("sparks", at, 1250)
    expect(burstSeed("sparks", [...at], 1250)).toBe(a)
    expect(burstSeed("chips", at, 1250)).not.toBe(a)
    expect(burstSeed("sparks", at, 1251)).not.toBe(a)
    expect(burstSeed("sparks", [at[0] + 0.05, at[1], at[2]], 1250)).not.toBe(a)
    const seeds = Array.from({ length: 12 }, (_, k) => particleSeed(a, k))
    expect(Array.from({ length: 12 }, (_, k) => particleSeed(a, k))).toEqual(seeds)
    // distinct, in [0, 1), on the shader's exact 2^22 grid
    expect(new Set(seeds).size).toBe(12)
    for (const s of seeds) {
      expect(s).toBeGreaterThanOrEqual(0)
      expect(s).toBeLessThan(1)
      expect(Number.isInteger(s * 4194304)).toBe(true)
    }
  })

  test("the shader draws from its inputs and the clock only (no CPU state, no random)", () => {
    expect(VERTEX).toContain("uniform float uTime")
    expect(VERTEX).not.toMatch(/Math\.random|uFrame/)
    // every kind but the last (the shader's `else`) has its branch; chips and stone share one
    const last = Math.max(...WORK_KINDS.map((k) => KIND[k].id))
    for (const kind of WORK_KINDS)
      if (KIND[kind].id < last && kind !== "chips") expect(VERTEX).toContain(`kind < ${KIND[kind].id}.5`)
    expect(FRAGMENT).toContain("gl_FragColor")
  })
})

describe("spawning", () => {
  const camera = new PerspectiveCamera(40, 16 / 9, 0.1, 2000)
  camera.position.set(0, 10, 20)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  const vp = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
  const eye = [0, 10, 20] as const

  test("near and on the screen: yes; behind, off to the side or too far: no", () => {
    expect(inView([0, 0, 0], eye, vp.elements)).toBe(true)
    expect(inView([0, 0, 40], eye, vp.elements)).toBe(false)
    expect(inView([40, 0, 0], eye, vp.elements)).toBe(false)
    expect(inView([0, 0, -NEAR_M], eye, vp.elements)).toBe(false)
    expect(inView([0, 0, -NEAR_M], eye, vp.elements, 80)).toBe(true)
  })
})

describe("beats", () => {
  test("a hit is sparks at an anvil, chips with an axe, stone with a pick, dust bare-handed", () => {
    expect(beatKinds("hit", { clip: "hammer", props: ["hammer"] })).toEqual(["sparks"])
    expect(beatKinds("hit", { props: ["axe"] })).toEqual(["chips"])
    expect(beatKinds("hit", { props: ["pickaxe"] })).toEqual(["stone"])
    expect(beatKinds("hit")).toEqual(["dust"])
  })

  test("water: a cast rings, a catch splashes; a cast with a staff is motes", () => {
    expect(beatKinds("cast", { props: ["rod"] })).toEqual(["ring"])
    expect(beatKinds("catch", { props: ["rod"] })).toEqual(["splash", "ring"])
    expect(beatKinds("cast", { props: ["staff"] })).toEqual(["motes"])
    expect(beatKinds("splash")).toEqual(["splash", "ring"])
  })

  test("the rest, and a kind's own name; unknown beats make nothing", () => {
    expect(beatKinds("quench")).toEqual(["steam"])
    expect(beatKinds("pickup")).toEqual(["dust"])
    expect(beatKinds("page")).toEqual(["pages"])
    expect(beatKinds("coin")).toEqual(["glint"])
    expect(beatKinds("sparks")).toEqual(["sparks"])
    expect(beatKinds("wave")).toEqual([])
  })
})

describe("debug driver", () => {
  test("?workfx= reads kinds and aliases, `all`, and 0 for off", () => {
    expect(workfxOf(null)).toBeNull()
    expect(workfxOf("0")).toEqual({ off: true, kinds: [] })
    expect(workfxOf("sparks,chips,splash,anvil")).toEqual({
      off: false,
      kinds: ["sparks", "chips", "splash"],
    })
    expect(workfxOf("all")?.kinds).toHaveLength(WORK_KINDS.length - 1)
  })

  test("a kind's spot: the nearest fitting piece, at its working height; a splash on the water", () => {
    const pieces = [
      { piece: "kaykit-tools/anvil", x: 10, y: 2, z: 0 },
      { piece: "kenney-survival/workbench-anvil", x: 30, y: 1, z: 0 },
      { piece: "kenney-pirate/boat-row-small", x: 0, y: -0.3, z: 50 },
    ]
    const sparks = siteFor("sparks", pieces, [25, 0])
    expect(sparks?.[0]).toBe(30)
    expect(sparks?.[1]).toBeGreaterThan(1.5)
    const splash = siteFor("splash", pieces, [0, 40], { sea: -0.05 })
    expect(splash?.[1]).toBe(-0.05)
    // a step off the boat, away from the island's middle
    expect(splash?.[2]).toBeGreaterThan(50)
    expect(siteFor("glint", pieces, [0, 0])).toBeNull()
  })
})
