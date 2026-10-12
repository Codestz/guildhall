import { describe, expect, test } from "bun:test"
import { Object3D, type OrthographicCamera, ShaderChunk } from "three"
import { installCascadeChunks } from "../src/scene/atmosphere/cascadeChunk.ts"
import { Caster } from "../src/scene/atmosphere/cascadeShadowNode.ts"
import {
  driveCharacters,
  inReach,
  planCharacters,
  upstream,
} from "../src/scene/atmosphere/characterShadows.ts"
import { sky } from "../src/scene/atmosphere/state.ts"
import { blobOf, type Walker, walkers } from "../src/scene/Blobs.tsx"
import { DEPTH_BASE } from "../src/scene/crowd/material.ts"

/** scene/atmosphere/characterShadows.ts: who casts real shadows into the near box, and the shader halves of it. */

const BOX = { cx: 0, cz: 0, radius: 20 }
const KEY: [number, number, number] = [0.5, 0.7, 0.5]

function stand(x: number, z: number, extra: Partial<Walker> = {}): Walker & { node: Object3D } {
  const node = new Object3D()
  node.position.set(x, 0, z)
  node.updateMatrixWorld()
  const walker = { node, radius: 1, ...extra }
  walkers.add(walker)
  return walker
}

describe("who casts a real shadow", () => {
  test("a shadow is followed in from further outside the box at a lower sun", () => {
    expect(upstream(1, 0.3, 0)).toBeGreaterThan(upstream(1, 1, 0))
    expect(upstream(1, 0.001, 0)).toBeLessThanOrEqual(24)
    expect(inReach(25, 0, BOX, 6)).toBe(true)
    expect(inReach(27, 0, BOX, 6)).toBe(false)
  })

  test("walkers in the box cast and lose most of their blob; those outside keep it", () => {
    walkers.clear()
    const inside = stand(3, 4)
    const outside = stand(90, 0)
    expect(planCharacters(BOX, "heroes", 28, KEY)).toBe(1)
    expect(inside.cast).toBe(true)
    expect(outside.cast).toBe(false)
    const look = { size: 0, alpha: 0 }
    blobOf(inside, look)
    const cast = look.alpha
    blobOf(outside, look)
    expect(cast).toBeLessThan(look.alpha)
    walkers.clear()
  })

  test("nobody casts on Low, in a box wider than the tier's reach, or without a box", () => {
    walkers.clear()
    const walker = stand(0, 0)
    expect(planCharacters(BOX, "off", 28, KEY)).toBe(0)
    expect(planCharacters(BOX, "heroes", 14, KEY)).toBe(0)
    expect(planCharacters(undefined, "heroes", 28, KEY)).toBe(0)
    expect(walker.cast).toBe(false)
    walkers.clear()
  })

  test("a walker fading in or out, or hidden, does not cast", () => {
    walkers.clear()
    stand(1, 1, { opacity: () => 0.2 })
    const hidden = stand(2, 2)
    hidden.node.visible = false
    expect(planCharacters(BOX, "heroes", 28, KEY)).toBe(0)
    walkers.clear()
  })
})

describe("one frame of the characters' light, on either backend", () => {
  const tier = { casts: "heroes" as const, reach: 28, map: 1024 }
  const span = { floor: -2, ceiling: 40 }

  test("is lit and fitted to the box when someone is in it, and off when no one is", () => {
    sky.keyDirection = KEY
    sky.keyShadow = 0.8
    walkers.clear()
    const light = new Caster(1024, false)
    expect(driveCharacters(light, BOX, tier, span)).toBe(0)
    expect(light.shadow.intensity).toBe(0)
    stand(2, 2)
    expect(driveCharacters(light, BOX, tier, span)).toBe(1)
    expect(light.shadow.intensity).toBe(0.8)
    expect((light.shadow.camera as OrthographicCamera).right).toBeGreaterThan(0)
    walkers.clear()
  })
})

describe("the shader halves", () => {
  test("the crowd's depth shader drops members outside the box before reading any bone", () => {
    expect(DEPTH_BASE).toContain("crowdOut")
    expect(DEPTH_BASE).toContain("crowdOut ? vec4( 0.0 ) : skinWeight")
    expect(DEPTH_BASE).toContain("crowdOut ? vec4( 0.0 ) : vec4( 1.0, 0.0, 0.0, 0.0 )")
    expect(DEPTH_BASE).toContain("if ( ! crowdOut ) crowdPoses[ 0 ]")
  })

  test("the cascade lookup takes the darker of the cascades and the characters' map", () => {
    expect(installCascadeChunks()).toBe(true)
    const pars = ShaderChunk.shadowmap_pars_fragment
    expect(pars).toContain("shadowRadius < 0.0")
    expect(pars).toContain("return min( lit + rest, held );")
  })
})
