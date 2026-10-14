import { describe, expect, test } from "bun:test"
import type { CameraPose } from "@guildhall/core"
import { PerspectiveCamera, Vector3 } from "three"
import { poseToCamera } from "../src/camera.ts"
import { blendPose, createRig, lookVector } from "../src/rig/index.ts"
import {
  clampEye,
  clampOrbit,
  distanceRange,
  elevationRange,
  floorAt,
  type Lens,
  LIMITS,
  NEAR,
  nearPlane,
  pitchCeiling,
  restingTilt,
  seesNoCut,
  viewReach,
  type World,
  zoomFraction,
  zoomTilt,
} from "../src/rig/world.ts"

/** The rig's maths: held inside a world (never under it, never out past it), the tilt, the glide. */

const LENS: Lens = { fov: 40, aspect: 1440 / 820, far: 2000 }
const ISLAND: World = { centre: [0, 0], half: 500, water: -0.6, heightAt: () => 0 }
/** A terraced island: a 30 m shelf east of x = 50. */
const TERRACED: World = { ...ISLAND, heightAt: (x) => (x > 50 ? 30 : 0) }

const pose = (p: Partial<CameraPose> = {}): CameraPose => ({
  target: [0, 0, 0],
  azimuth: 40,
  elevation: 38,
  distance: 300,
  ...p,
})
const eyeHeight = (p: CameraPose, world: World) => {
  const [x, y, z] = poseToCamera(p)
  return y - floorAt(world, x, z)
}

describe("the floor", () => {
  test("is the ground or the water, whichever is higher, read through heightAt", () => {
    expect(floorAt(ISLAND, 0, 0)).toBe(0)
    expect(floorAt({ ...ISLAND, heightAt: () => -3 }, 0, 0)).toBe(-0.6)
    expect(floorAt(TERRACED, 80, 0)).toBe(30)
    expect(floorAt({ centre: [0, 0], half: 10, water: null }, 1, 1)).toBe(0)
  })
})

describe("the orbit, held inside a world", () => {
  test("never looks up from under the horizon, however low it is asked to go", () => {
    for (const elevation of [-89, -30, -1, 0, 1])
      expect(clampOrbit(pose({ elevation, distance: 60 }), ISLAND, LENS).elevation).toBeGreaterThanOrEqual(
        LIMITS.minElevation,
      )
  })

  test("keeps the eye over the floor under it, terraces too", () => {
    const low = clampOrbit(pose({ elevation: 0, distance: 15 }), ISLAND, LENS)
    expect(eyeHeight(low, ISLAND)).toBeGreaterThanOrEqual(LIMITS.clearance - 1e-9)
    // Looking west from up on the shelf: the eye stands over the 30 m terrace.
    const shelf = clampOrbit(
      pose({ target: [40, 0, 0], azimuth: 90, elevation: 3, distance: 60 }),
      TERRACED,
      LENS,
    )
    expect(eyeHeight(shelf, TERRACED)).toBeGreaterThanOrEqual(LIMITS.clearance - 1e-9)
  })

  test("pans only inside the site box, and the target rides the floor", () => {
    const far = clampOrbit(pose({ target: [5000, 7, -5000] }), ISLAND, LENS)
    expect(far.target).toEqual([500, 7, -500])
    const up = clampOrbit(pose({ target: [80, 0, 0] }), TERRACED, LENS)
    expect(up.target[1]).toBe(30)
  })

  test("zooms between the closest and the site filling the frame from above", () => {
    const [min, max] = distanceRange(ISLAND, LENS)
    expect(clampOrbit(pose({ distance: 0.01 }), ISLAND, LENS).distance).toBe(min)
    expect(clampOrbit(pose({ distance: 1e6 }), ISLAND, LENS).distance).toBe(max)
    // A narrower lens (with its far plane) may stand farther off: the map preset.
    expect(distanceRange(ISLAND, { fov: 24, aspect: LENS.aspect, far: 4000 })[1]).toBeGreaterThan(max)
  })

  test("a big site under the stage's lens zooms out no farther than straight down meets the far plane", () => {
    const city: World = { ...ISLAND, half: 900 }
    const [, max] = distanceRange(city, LENS)
    expect(viewReach(max, 90, LENS)).toBeLessThanOrEqual(LIMITS.reach * LENS.far + 1e-6)
  })

  test("high up, tips down until the far plane cannot cut the sea off", () => {
    for (const elevation of [3, 20, 45]) {
      const held = clampOrbit(pose({ elevation, distance: 1000 }), ISLAND, LENS)
      expect(seesNoCut(eyeHeight(held, ISLAND), held.elevation, LENS)).toBe(true)
    }
    // Low down the haze hides it: a street-level view keeps its horizon.
    expect(clampOrbit(pose({ elevation: 4, distance: 60 }), ISLAND, LENS).elevation).toBe(4)
  })

  test("a pose already inside the world comes back as it went in", () => {
    const p = pose()
    expect(clampOrbit(p, ISLAND, LENS)).toEqual(p)
  })
})

describe("tilt follows the zoom", () => {
  test("close in it may not tip to the top, far out it may not sink low", () => {
    const [closeLo, closeHi] = elevationRange(0)
    const [farLo, farHi] = elevationRange(1)
    expect(closeLo).toBe(LIMITS.minElevation)
    expect(closeHi).toBe(LIMITS.lowCeiling)
    expect(farLo).toBe(LIMITS.highFloor)
    expect(farHi).toBe(LIMITS.maxElevation)
  })

  test("a zoom eases toward the resting tilt by how far it zoomed; a full sweep arrives", () => {
    expect(restingTilt(0)).toBeLessThan(restingTilt(1))
    // The hero shot (38° about 0.7 of the way out) sits on the curve: zooming in from it only lowers.
    expect(restingTilt(0.7)).toBeCloseTo(38, 0)
    expect(zoomTilt(38, 0.7, 0.7)).toBe(38)
    const nudged = zoomTilt(38, 0.7, 0.65)
    expect(nudged).toBeLessThan(38)
    expect(nudged).toBeGreaterThan(restingTilt(0.65))
    expect(zoomTilt(38, 0.7, 0.75)).toBeGreaterThan(38)
    expect(zoomTilt(38, 1, 0)).toBeCloseTo(restingTilt(0))
  })

  test("the zoom fraction runs 0..1 on a log scale", () => {
    expect(zoomFraction(10, [10, 1000])).toBe(0)
    expect(zoomFraction(100, [10, 1000])).toBeCloseTo(0.5)
    expect(zoomFraction(5000, [10, 1000])).toBe(1)
  })
})

describe("free flight, held inside a world", () => {
  test("the eye stays over the ground and the water, inside the site, under the ceiling", () => {
    expect(clampEye([0, -40, 0], ISLAND, LENS)[1]).toBeCloseTo(LIMITS.clearance)
    expect(clampEye([80, 5, 0], TERRACED, LENS)[1]).toBeCloseTo(30 + LIMITS.clearance)
    expect(clampEye([9000, 50, -9000], ISLAND, LENS)).toEqual([500, 50, -500])
    expect(clampEye([0, 1e6, 0], ISLAND, LENS)[1]).toBe(distanceRange(ISLAND, LENS)[1])
  })

  test("looks level low down; high up it is tipped down so the far plane never shows", () => {
    expect(pitchCeiling([0, 30, 0], ISLAND, LENS)).toBe(Number.POSITIVE_INFINITY)
    const high = pitchCeiling([0, 900, 0], ISLAND, LENS)
    expect(high).toBeLessThan(0)
    expect(seesNoCut(900, -high, LENS)).toBe(true)
    expect(seesNoCut(900, -high - 2, LENS)).toBe(false)
  })
})

describe("the glide and the free camera's heading", () => {
  test("a glide starts and ends exactly on its poses and turns the short way", () => {
    const a = pose({ azimuth: 350, elevation: 10, distance: 20, target: [1, 2, 3] })
    const b = pose({ azimuth: 10, elevation: 40, distance: 300 })
    expect(blendPose(a, b, 0)).toEqual(a)
    const end = blendPose(a, b, 1)
    expect(end.azimuth).toBeCloseTo(370)
    expect(end.elevation).toBeCloseTo(40)
    expect(end.distance).toBeCloseTo(300)
    expect(blendPose(a, b, 0.5).azimuth).toBeCloseTo(360)
  })

  test("yaw and pitch as an orbit's azimuth and minus its elevation look from the eye to the target", () => {
    const p = pose({ target: [5, 1, -3], azimuth: 63, elevation: 27, distance: 40 })
    const eye = poseToCamera(p)
    const dir = lookVector(p.azimuth, -p.elevation)
    for (let i = 0; i < 3; i++) expect(eye[i] + dir[i] * p.distance).toBeCloseTo(p.target[i] as number, 9)
  })
})

describe("the leash and the free roam", () => {
  const LEASHED: World = { ...ISLAND, hold: 0.3, roam: 800 }
  test("close in the target pans the whole box; far out it is held near the middle, on a circle", () => {
    const [, far] = distanceRange(LEASHED, LENS)
    const near = clampOrbit(pose({ target: [400, 0, 0], distance: 20 }), LEASHED, LENS)
    expect(near.target[0]).toBeCloseTo(400, 6)
    const wide = clampOrbit(pose({ target: [400, 0, 400], distance: far }), LEASHED, LENS)
    expect(Math.hypot(wide.target[0], wide.target[2])).toBeCloseTo(150, 3)
    // straight toward the middle, not to a box corner
    expect(wide.target[0]).toBeCloseTo(wide.target[2], 6)
  })

  test("without a hold the orbit keeps the square box at every zoom", () => {
    const [, far] = distanceRange(ISLAND, LENS)
    const wide = clampOrbit(pose({ target: [400, 0, 400], distance: far }), ISLAND, LENS)
    expect(wide.target[0]).toBeCloseTo(400, 6)
  })

  test("free flight roams past the orbit's box, as far as `roam`", () => {
    expect(clampEye([700, 50, -700], LEASHED, LENS)[0]).toBe(700)
    expect(clampEye([900, 50, 0], LEASHED, LENS)[0]).toBe(800)
    expect(clampEye([900, 50, 0], ISLAND, LENS)[0]).toBe(500)
  })
})

describe("nearPlane", () => {
  test("a hundredth of the eye's height over the floor, never under 5 cm nor over NEAR.max", () => {
    expect(nearPlane(1.6)).toBe(NEAR.min)
    expect(nearPlane(43)).toBeCloseTo(0.43)
    expect(nearPlane(240)).toBe(NEAR.max)
    expect(nearPlane(-3)).toBe(NEAR.min)
  })

  test("from the farthest zoom a 24-bit depth step at the ground is ~30 times finer than with a 5 cm near", () => {
    // one depth step at distance z: z^2 / (near * 2^24)
    const step = (near: number, z: number) => (z * z) / (near * 2 ** 24)
    expect(step(NEAR.min, 400)).toBeGreaterThan(0.18)
    expect(step(nearPlane(240), 400)).toBeLessThan(0.007)
  })
})

describe("aiming at a subject (the follow camera)", () => {
  /** A rig on a stand-in canvas (no input arrives) over the island. */
  const aimedRig = (world: World = ISLAND) => {
    const el = {
      addEventListener() {},
      removeEventListener() {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1440, height: 820 }),
      style: {},
      isConnected: true,
    } as unknown as HTMLElement
    const camera = new PerspectiveCamera(LENS.fov, LENS.aspect, 0.1, LENS.far)
    const rig = createRig(camera, el, pose({ target: [0, 0, 0], distance: 40, elevation: 30 }))
    rig.setWorld(world)
    return { rig, camera }
  }
  const screen = (camera: PerspectiveCamera, p: [number, number, number]) => {
    camera.updateMatrixWorld()
    return new Vector3(...p).project(camera)
  }

  test("holds the subject exactly at its frame while the angles and distance ease (no drift, no pop)", () => {
    const { rig, camera } = aimedRig()
    const subject: [number, number, number] = [20, 1, -10]
    const frame = { x: -0.28, y: 0.12 }
    rig.aim(subject, frame)
    rig.update(1 / 60)
    for (let i = 0; i < 90; i++) {
      // a turn and a zoom under way every frame
      if (i % 10 === 0) rig.steer({ azimuth: rig.goal().azimuth + 25, distance: rig.goal().distance * 1.3 })
      rig.update(1 / 60)
      const p = screen(camera, subject)
      expect(Math.abs(p.x - frame.x)).toBeLessThan(1e-3)
      expect(Math.abs(p.y - frame.y)).toBeLessThan(1e-3)
    }
  })

  test("a glide lands on a subject that moves while it runs", () => {
    const { rig, camera } = aimedRig()
    const subject: [number, number, number] = [60, 1, 30]
    rig.glide(pose({ target: subject, distance: 20, elevation: 26 }), 500)
    for (let i = 0; i < 45; i++) {
      subject[0] += 0.05
      rig.aim(subject)
      rig.update(1 / 60)
    }
    const p = screen(camera, subject)
    expect(Math.abs(p.x)).toBeLessThan(1e-3)
    expect(Math.abs(p.y)).toBeLessThan(1e-3)
  })

  test("a target set off the subject over a 30 m shelf does not lift the view off the subject", () => {
    const { rig, camera } = aimedRig(TERRACED)
    const subject: [number, number, number] = [45, 1, 0]
    const frame = { x: 0.35, y: 0.25 }
    for (const azimuth of [90, 270, 0]) {
      rig.steer({ azimuth, distance: 40, elevation: 30 })
      rig.aim(subject, frame)
      for (let i = 0; i < 60; i++) rig.update(1 / 60)
      const p = screen(camera, subject)
      expect(Math.abs(p.x - frame.x)).toBeLessThan(1e-3)
      expect(Math.abs(p.y - frame.y)).toBeLessThan(1e-3)
    }
  })
})
