import { describe, expect, test } from "bun:test"
import {
  MeshStandardMaterial,
  OrthographicCamera,
  Vector3,
  type WebGLProgramParametersWithUniforms,
} from "three"
import { ClearAngle, clearTurn } from "../src/scene/terrain/clearAngle.ts"
import { bayer4, CUT_FRAGMENT, Cutaway, cutaway, MAX_CUTS } from "../src/scene/terrain/cutaway.ts"
import { aboveGround, widestZoom } from "../src/scene/terrain/framing.ts"
import { blocked } from "../src/scene/terrain/sight.ts"
import { newSnowline, snowMaterial } from "../src/scene/terrain/snow.ts"

/** The relief's see-through cut and the camera's answers to tall ground (scene/terrain, terrain v2 §5). */

const PEAK = 40
/** A wall of rock across x = 0, 40 tall and 10 thick, running the whole length of z. */
const wall = (x: number): number | undefined => (Math.abs(x) <= 5 ? PEAK : undefined)
const heightAt = (x: number, _z: number) => wall(x)
const at = (x: number, y: number, z: number) => ({ x, y, z })

/** The isometric camera, 220 back from `target`, looking at it from +x +z. */
function isoCamera(target: Vector3): OrthographicCamera {
  const camera = new OrthographicCamera(-60, 60, 40, -40, 0.1, 900)
  camera.position.copy(target).add(new Vector3(1, 0.93, 1).normalize().multiplyScalar(220))
  camera.lookAt(target)
  camera.updateMatrixWorld()
  return camera
}

describe("sight over relief", () => {
  test("a wall between two points blocks them; the same side does not", () => {
    expect(blocked(heightAt, PEAK, at(20, 2, 0), at(-60, 12, 0))).toBe(true)
    expect(blocked(heightAt, PEAK, at(20, 2, 0), at(60, 12, 0))).toBe(false)
  })

  test("a ray that rises above the peak before the wall is clear", () => {
    expect(blocked(heightAt, PEAK, at(20, 2, 0), at(-60, 300, 0))).toBe(false)
  })

  test("the ground at the subject's own feet is no obstacle", () => {
    expect(blocked(heightAt, PEAK, at(4, PEAK + 1, 0), at(60, PEAK + 30, 0))).toBe(false)
  })
})

describe("the cut's holes", () => {
  const target = new Vector3(0, 1, 0)

  test("a figure behind the wall gets a hole that opens over a quarter second, centred on its screen place", () => {
    const camera = isoCamera(target)
    const figure = new Vector3(-12, 0, -12)
    const cut = new Cutaway()
    cut.update(0.05, camera, 1.6, [figure], heightAt, PEAK)
    expect(cut.view.y).toBe(1)
    const early = cut.dots[0]?.z ?? 0
    cut.update(0.3, camera, 1.6, [figure], heightAt, PEAK)
    const hole = cut.dots[0]
    expect(hole?.z).toBeGreaterThan(early)
    const ndc = new Vector3(figure.x, 1.1, figure.z).project(camera)
    expect(Math.abs((hole?.x ?? 9) - ndc.x)).toBeLessThan(0.05)
    // Its depth is the figure's, in front of the camera: nearer fragments are the ones cut.
    expect(hole?.w).toBeGreaterThan(200)
  })

  test("a figure in plain view gets none, and a hole closes when its figure comes out", () => {
    const camera = isoCamera(target)
    const figure = new Vector3(-12, 0, -12)
    const cut = new Cutaway()
    cut.update(0.3, camera, 1.6, [figure], heightAt, PEAK)
    expect(cut.view.y).toBe(1)
    figure.set(12, 0, 12)
    for (let i = 0; i < 6; i++) cut.update(0.1, camera, 1.6, [figure], heightAt, PEAK)
    expect(cut.view.y).toBe(0)
  })

  test("a world without relief cuts nothing", () => {
    const cut = new Cutaway()
    cut.update(0.3, isoCamera(target), 1.6, [new Vector3(-12, 0, -12)], undefined, 0)
    expect(cut.view.y).toBe(0)
  })

  test("no more than eight holes, the ones nearest the middle of the screen", () => {
    const camera = isoCamera(target)
    const crowd = Array.from({ length: 20 }, (_, i) => new Vector3(-8 - i * 0.7, 0, -8 - i * 0.7))
    const cut = new Cutaway()
    cut.update(0.3, camera, 1.6, crowd, heightAt, PEAK)
    expect(cut.view.y).toBe(MAX_CUTS)
  })
})

describe("the cut's shaders", () => {
  test("the Bayer threshold visits each of sixteen levels once per 4×4 block", () => {
    const levels = new Set<number>()
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) levels.add(bayer4(x, y))
    expect(levels.size).toBe(16)
    expect(Math.min(...levels)).toBeGreaterThan(0)
    expect(Math.max(...levels)).toBeLessThan(1)
    expect(bayer4(4, 4)).toBe(bayer4(0, 0))
  })

  test("the relief material takes the shared holes as uniforms and discards in them", () => {
    const base = new MeshStandardMaterial()
    const copy = snowMaterial(base, newSnowline()) as MeshStandardMaterial
    const shader = {
      uniforms: {},
      vertexShader: "void main() {\n#include <project_vertex>\n}",
      fragmentShader: "void main() {\n#include <map_fragment>\n}",
    } as unknown as WebGLProgramParametersWithUniforms
    copy.onBeforeCompile(shader, undefined as never)
    const uniforms = shader.uniforms as { uCutDots: { value: unknown }; uCutView: { value: unknown } }
    expect(uniforms.uCutDots.value).toBe(cutaway.dots)
    expect(uniforms.uCutView.value).toBe(cutaway.view)
    expect(shader.fragmentShader).toContain(CUT_FRAGMENT.trim())
    expect(shader.fragmentShader).toContain("discard")
    expect(shader.vertexShader).toContain("vCutClip")
  })
})

describe("the cinematic camera's clear angle", () => {
  const subject = at(-12, 1.2, 0)

  test("a subject the camera already sees needs no turn", () => {
    expect(clearTurn(heightAt, PEAK, subject, at(-40, 20, 0))).toBe(0)
  })

  test("a subject behind the wall is seen from the nearest azimuth that clears it", () => {
    const turn = clearTurn(heightAt, PEAK, at(-12, 1.2, 0), at(100, 40, 0))
    expect(turn).toBeDefined()
    expect(Math.abs(turn ?? 0)).toBeGreaterThan(0)
    // The wall runs north-south: the nearest clear side is the quarter turn, not the opposite one.
    expect(Math.abs(turn ?? 0)).toBeCloseTo(Math.PI / 2, 5)
  })

  test("a subject in a ring of rock has no clear azimuth: the cut has to do", () => {
    const ring = (x: number, z: number) => (Math.hypot(x, z) > 6 ? PEAK : undefined)
    expect(clearTurn(ring, PEAK, at(0, 1.2, 0), at(30, 20, 30))).toBeUndefined()
  })

  test("the swing turns the camera round its target a little each frame, to a view that is clear", () => {
    const swing = new ClearAngle()
    const camera = new OrthographicCamera()
    camera.position.set(100, 40, 0)
    const target = new Vector3(-12, 1.2, 0)
    const before = camera.position.clone()
    swing.update(0.1, camera, target, target, heightAt, PEAK)
    expect(camera.position.distanceTo(before)).toBeGreaterThan(0)
    expect(camera.position.distanceTo(target)).toBeCloseTo(before.distanceTo(target), 5)
    for (let i = 0; i < 40; i++) swing.update(0.1, camera, target, target, heightAt, PEAK)
    expect(blocked(heightAt, PEAK, target, camera.position)).toBe(false)
  })
})

describe("framing tall ground", () => {
  test("a world without relief keeps its zoom-out; tall ground pulls it out to hold the height", () => {
    expect(widestZoom(3, 800, 100, 0)).toBe(3)
    expect(widestZoom(30, 800, 100, 0)).toBe(30)
    expect(widestZoom(30, 800, 100, 60)).toBeLessThan(30)
    expect(widestZoom(30, 800, 100, 60)).toBeLessThan(widestZoom(30, 800, 100, 20))
  })

  test("the zoom-out holds the island's reach and half the peak in the screen's height", () => {
    const zoom = widestZoom(1000, 800, 100, 60)
    const sin = 0.93 / Math.hypot(1, 0.93, 1)
    const cos = Math.sqrt(1 - sin * sin)
    expect(800 / 2 / zoom).toBeGreaterThan(100 * sin + 30 * cos)
  })

  test("the explore camera is lifted out of rock, never lowered", () => {
    const camera = new OrthographicCamera()
    camera.position.set(0, 10, 0)
    aboveGround(camera, () => 30)
    expect(camera.position.y).toBeGreaterThan(30)
    camera.position.y = 100
    aboveGround(camera, () => 30)
    expect(camera.position.y).toBe(100)
  })
})
