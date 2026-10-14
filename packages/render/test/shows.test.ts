import { describe, expect, test } from "bun:test"
import { hexIsland, hexWorld, hexZones } from "@guildhall/world"
import { PerspectiveCamera, Scene } from "three"
import { eventSites } from "../src/events/sites.ts"
import type { DayLight } from "../src/light.ts"
import {
  BREATH_EVERY,
  breathAt,
  buildBunting,
  createShows,
  DRAGON_ARRIVE_S,
  DRAGON_LEAVE_S,
  dragonOrbit,
  envelope,
  rainbowSize,
  SHOW_KINDS,
  SHOW_S,
} from "../src/shows/index.ts"
import type { Stage } from "../src/stage.ts"

const island = hexIsland({ seed: 1, files: 4000 })
const zones = hexZones(island, {})
const world = hexWorld(island, zones, {})
const sites = eventSites(island, zones, world, { sea: 0 })

/** Just enough stage for the shows: a scene, a camera, frame hooks run by hand (no GL: nothing links). */
function fakeStage() {
  const hooks = new Set<(dt: number) => void>()
  const camera = new PerspectiveCamera(40, 1.5, 0.05, 2000)
  camera.position.set(60, 60, 60)
  camera.lookAt(0, 0, 0)
  const stage = {
    scene: new Scene(),
    camera,
    renderer: {},
    onFrame(fn: (dt: number) => void) {
      hooks.add(fn)
      return () => hooks.delete(fn)
    },
    getCamera: () => ({ target: [0, 0, 0], azimuth: 45, elevation: 35, distance: 100 }),
  } as unknown as Stage
  const step = (dt: number) => {
    for (const fn of [...hooks]) fn(dt)
  }
  return { stage, hooks, step }
}

const light = (night: number) => () => ({ night }) as DayLight

describe("show sites", () => {
  test("the peak sits on the island's rock, with an orbit round it", () => {
    expect(sites.peak).toBeTruthy()
    const { centre, r } = dragonOrbit({ sites })
    expect(centre.y).toBeGreaterThan((sites.peak?.at[1] ?? 0) + 20)
    expect(r).toBeGreaterThanOrEqual(24)
    expect(r).toBeLessThanOrEqual(36)
  })

  test("the busiest square has poles, apart, and cords between real poles", () => {
    const square = sites.square
    expect(square).toBeTruthy()
    if (!square) return
    expect(square.poles.length).toBeGreaterThanOrEqual(6)
    for (let i = 0; i < square.poles.length; i++)
      for (let j = i + 1; j < square.poles.length; j++) {
        const a = square.poles[i] as number[]
        const b = square.poles[j] as number[]
        expect(
          Math.hypot((a[0] as number) - (b[0] as number), (a[2] as number) - (b[2] as number)),
        ).toBeGreaterThan(1)
      }
    expect(square.cords.some((c) => c.hang === "pennants")).toBe(true)
    expect(square.cords.some((c) => c.hang === "lanterns")).toBe(true)
    for (const c of square.cords) {
      expect(square.poles[c.a]).toBeDefined()
      expect(square.poles[c.b]).toBeDefined()
    }
  })
})

describe("show timings", () => {
  test("the dragon breathes only once circling, every BREATH_EVERY seconds", () => {
    expect(breathAt(DRAGON_ARRIVE_S, false)).toBe(0)
    const t = DRAGON_ARRIVE_S + 1 + 0.6
    expect(breathAt(t, false)).toBeGreaterThan(0.9)
    expect(breathAt(t + BREATH_EVERY, false)).toBeCloseTo(breathAt(t, false), 5)
    expect(breathAt(t + 3, false)).toBe(0)
    expect(breathAt(t, true)).toBe(0)
  })

  test("envelope rises and falls, zero at both ends", () => {
    expect(envelope(0, 10, 1, 2)).toBe(0)
    expect(envelope(5, 10, 1, 2)).toBe(1)
    expect(envelope(10, 10, 1, 2)).toBe(0)
  })

  test("the rainbow grows with the island, never smaller than V1's", () => {
    expect(rainbowSize(10).radius).toBe(60)
    expect(rainbowSize(300).radius).toBeGreaterThan(rainbowSize(200).radius)
  })

  test("the bunting is one geometry with the lit material's attributes", () => {
    const g = buildBunting({ sites })
    expect(g).toBeTruthy()
    for (const name of ["position", "normal", "color", "aAnchor", "aOrder", "aSway", "_glow"])
      expect(g?.getAttribute(name)).toBeDefined()
    g?.dispose()
  })
})

describe("createShows", () => {
  test("idle: nothing in the scene and no frame hook", () => {
    const { stage, hooks } = fakeStage()
    const shows = createShows(stage, { sites, span: 160, light: light(0) })
    expect(stage.scene.children.length).toBe(0)
    expect(hooks.size).toBe(0)
    expect(shows.stats()).toMatchObject({ playing: [], draws: 0, hooked: false })
    shows.dispose()
  })

  test("each kind plays in 1–2 draws and is gone, hook and all, when over", async () => {
    for (const kind of SHOW_KINDS) {
      for (const night of [0, 1]) {
        const { stage, hooks, step } = fakeStage()
        const shows = createShows(stage, { sites, span: 160, light: light(night) })
        shows.play(kind)
        await shows.ready()
        step(1 / 60)
        const draws = shows.stats().draws
        expect(draws).toBeGreaterThanOrEqual(1)
        expect(draws).toBeLessThanOrEqual(kind === "festival" ? 3 : 2)
        expect(hooks.size).toBe(1)
        for (let t = 0; t < SHOW_S[kind] + 1; t += 0.1) step(0.1)
        expect(shows.stats().playing).toEqual([])
        expect(stage.scene.children.length).toBe(0)
        expect(hooks.size).toBe(0)
        shows.dispose()
      }
    }
  })

  test("a show from the engine plays on its clock; the same kind again is re-timed, not doubled", async () => {
    let clock = 100
    const { stage, step } = fakeStage()
    const shows = createShows(stage, { sites, span: 160, light: light(0), clock: () => clock })
    shows.play({ kind: "festival", start: 102, end: 120 })
    await shows.ready()
    step(0.016)
    const group = stage.scene.getObjectByName("show festival")
    expect(group?.visible).toBe(false)
    clock = 103
    step(0.016)
    expect(group?.visible).toBe(true)
    shows.play({ kind: "festival", start: 103, end: 130 })
    expect(shows.playing()).toHaveLength(1)
    expect(shows.playing()[0]?.end).toBe(130)
    clock = 131
    step(0.016)
    expect(shows.stats().playing).toEqual([])
    shows.dispose()
  })

  test("a dragon told to stay circles until stopped, then leaves over its own time", async () => {
    let clock = 0
    const { stage, step } = fakeStage()
    const shows = createShows(stage, { sites, span: 160, light: light(0), clock: () => clock })
    shows.play({ kind: "dragon", start: 0, end: Number.POSITIVE_INFINITY })
    await shows.ready()
    clock = 500
    step(0.016)
    expect(shows.stats().playing).toEqual(["dragon"])
    shows.stop("dragon")
    clock = 500 + DRAGON_LEAVE_S - 0.1
    step(0.016)
    expect(shows.stats().playing).toEqual(["dragon"])
    clock = 500 + DRAGON_LEAVE_S + 0.1
    step(0.016)
    expect(shows.stats().playing).toEqual([])
    shows.dispose()
  })
})
