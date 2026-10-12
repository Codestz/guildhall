import { describe, expect, test } from "bun:test"
import { Euler, Group, PerspectiveCamera, Quaternion, Scene } from "three"
import { createGizmo, type GizmoPose, snapTo, snapYaw, toNdc, yawOf } from "../src/gizmo.ts"
import type { Stage } from "../src/stage.ts"

const DEG = Math.PI / 180

describe("snapTo", () => {
  test("lands on the nearest multiple of the step, absolute not relative", () => {
    expect(snapTo(1.4, 1)).toBe(1)
    expect(snapTo(1.6, 1)).toBe(2)
    expect(snapTo(0.37, 0.25)).toBe(0.25)
    expect(snapTo(-2.6, 1)).toBe(-3)
    expect(snapTo(0.123, 0.01)).toBeCloseTo(0.12, 12)
  })

  test("a zero step leaves the value free", () => {
    expect(snapTo(1.2345, 0)).toBe(1.2345)
  })

  test("never returns -0", () => {
    expect(Object.is(snapTo(-0.2, 1), 0)).toBe(true)
  })
})

describe("snapYaw", () => {
  test("snaps to whole steps in degrees", () => {
    expect(snapYaw(50 * DEG, 90)).toBeCloseTo(90 * DEG, 12)
    expect(snapYaw(37 * DEG, 15)).toBeCloseTo(30 * DEG, 12)
    expect(snapYaw(-100 * DEG, 90)).toBeCloseTo(-90 * DEG, 12)
  })

  test("wraps into (-180°, 180°], a half turn reading +180°", () => {
    expect(snapYaw(270 * DEG, 90)).toBeCloseTo(-90 * DEG, 12)
    expect(snapYaw(-180 * DEG, 90)).toBeCloseTo(180 * DEG, 12)
    expect(snapYaw(190 * DEG, 0)).toBeCloseTo(-170 * DEG, 12)
  })
})

describe("yawOf", () => {
  test("reads a pure turn about +y on both sides of ±90°", () => {
    for (const deg of [0, 45, 89, 120, 179, -60, -135]) {
      const q = new Quaternion().setFromEuler(new Euler(0, deg * DEG, 0))
      expect(yawOf(q)).toBeCloseTo(deg * DEG, 9)
    }
  })
})

describe("toNdc", () => {
  const rect = { left: 100, top: 50, width: 400, height: 200 }

  test("maps the rect's corners and centre to -1…1 with y up", () => {
    expect(toNdc(100, 50, rect)).toEqual({ x: -1, y: 1 })
    expect(toNdc(500, 250, rect)).toEqual({ x: 1, y: -1 })
    expect(toNdc(300, 150, rect)).toEqual({ x: 0, y: 0 })
  })
})

/**
 * A stage with no GL: a 200 px canvas (an EventTarget) seen by a camera 10 m out on +z, so the
 * gizmo's centre handles sit around the canvas centre. The orbit input stands in as a plain listener.
 */
function fakeStage() {
  const canvas = Object.assign(new EventTarget(), {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 }),
    setPointerCapture: () => {},
    hasPointerCapture: () => false,
    releasePointerCapture: () => {},
  })
  const camera = new PerspectiveCamera(40, 1, 0.1, 100)
  camera.position.set(0, 0, 10)
  camera.lookAt(0, 0, 0)
  const scene = new Scene()
  let orbitPresses = 0
  canvas.addEventListener("pointerdown", () => orbitPresses++)
  // Browsers report button -1 on a move; TransformControls ignores a move that says otherwise.
  const fire = (type: string, x: number) =>
    canvas.dispatchEvent(
      Object.assign(new Event(type), {
        clientX: x,
        clientY: 100,
        button: type === "pointermove" ? -1 : 0,
        pointerId: 1,
        pointerType: "mouse",
      }),
    )
  const stage = { scene, camera, renderer: { domElement: canvas } } as unknown as Stage
  return { stage, scene, fire, orbitPresses: () => orbitPresses }
}

describe("createGizmo", () => {
  test("a drag on a handle moves the object on the snap grid and never reaches the orbit", () => {
    const { stage, scene, fire, orbitPresses } = fakeStage()
    const poses: GizmoPose[] = []
    const gizmo = createGizmo(stage, { mode: "translate", snap: 1, onChange: (p) => poses.push(p) })
    const object = new Group()
    scene.add(object)
    gizmo.attach(object)
    scene.updateMatrixWorld(true)

    fire("pointermove", 115)
    fire("pointerdown", 115)
    fire("pointermove", 160)
    fire("pointermove", 175)
    fire("pointerup", 175)

    expect(orbitPresses()).toBe(0)
    expect(poses.length).toBeGreaterThan(0)
    for (const p of poses) for (const c of p.position) expect(Number.isInteger(c)).toBe(true)
    expect(object.position.x).toBeGreaterThan(0)
    expect(poses.at(-1)?.position).toEqual(object.position.toArray())
    gizmo.dispose()
  })

  test("a press off the handles, or with nothing attached, still orbits", () => {
    const { stage, scene, fire, orbitPresses } = fakeStage()
    const gizmo = createGizmo(stage, { mode: "translate", snap: 1 })
    fire("pointerdown", 115)
    expect(orbitPresses()).toBe(1)
    const object = new Group()
    scene.add(object)
    gizmo.attach(object)
    scene.updateMatrixWorld(true)
    fire("pointermove", 5)
    fire("pointerdown", 5)
    expect(orbitPresses()).toBe(2)
    gizmo.dispose()
  })

  test("dispose takes the handle out of the scene and lets go of the canvas", () => {
    const { stage, scene, fire, orbitPresses } = fakeStage()
    const gizmo = createGizmo(stage, { mode: "rotate", snap: 90 })
    expect(scene.children).toHaveLength(1)
    const object = new Group()
    scene.add(object)
    gizmo.attach(object)
    gizmo.dispose()
    expect(scene.children).toEqual([object])
    fire("pointerdown", 100)
    expect(orbitPresses()).toBe(1)
  })
})
