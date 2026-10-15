import { describe, expect, test } from "bun:test"
import { hexIsland, hexWorld, hexZones } from "@guildhall/world"
import { PerspectiveCamera, Scene } from "three"
import { eventSites } from "../src/events/sites.ts"
import type { DayLight } from "../src/light.ts"
import {
  BEAT_S,
  bankAt,
  beatAngle,
  breathAt,
  buildBunting,
  CRUISE_CLEAR,
  createShows,
  DRAGON_ARRIVE_S,
  DRAGON_LEAVE_S,
  dragonAt,
  dragonFlight,
  dragonOrbit,
  envelope,
  FINALE_S,
  fireworksProgramme,
  highestUnder,
  ROCKET_S,
  rainbowSize,
  SHOW_KINDS,
  SHOW_S,
  STAR_S,
  SWOOP_CLEAR,
  shadowLook,
  wingAngle,
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
  test("the dragon breathes only on the route, at the bottom of a swoop, more than once a cycle", () => {
    const plan = dragonFlight({ sites })
    expect(breathAt(plan, DRAGON_ARRIVE_S, false)).toBe(0)
    expect(breathAt(plan, DRAGON_ARRIVE_S + 9, true)).toBe(0)
    let breaths = 0
    let was = false
    for (let t = DRAGON_ARRIVE_S; t < DRAGON_ARRIVE_S + plan.cycle; t += 0.05) {
      const b = breathAt(plan, t, false)
      if (b > 0.9 && !was) breaths++
      was = b > 0.9
      // fire comes low: in the lower half of its band, never while beating hard
      if (b > 0.9) {
        const s = plan.at(t - DRAGON_ARRIVE_S)
        expect(s.alt).toBeLessThan(-2)
        expect(s.beating).toBeLessThan(0.2)
      }
    }
    expect(breaths).toBeGreaterThanOrEqual(2)
    // the cycle repeats
    expect(breathAt(plan, 20 + plan.cycle, false)).toBeCloseTo(breathAt(plan, 20, false), 9)
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

describe("the dragon's flight", () => {
  const plan = dragonFlight({ sites })
  const total = SHOW_S.dragon

  test("bursts of three to five beats, then glides of more than two seconds on still wings", () => {
    const runs: { beating: boolean; s: number }[] = []
    let cur: { beating: boolean; s: number } | null = null
    for (let tau = 0; tau < plan.cycle; tau += 0.01) {
      const b = plan.at(tau).beating > 0.5
      if (!cur || cur.beating !== b) {
        cur = { beating: b, s: 0 }
        runs.push(cur)
      }
      cur.s += 0.01
    }
    const bursts = runs.filter((r) => r.beating).map((r) => r.s / BEAT_S)
    expect(bursts.length).toBeGreaterThanOrEqual(4)
    for (const n of bursts) {
      expect(n).toBeGreaterThan(2.6)
      expect(n).toBeLessThan(6.4)
    }
    const glides = runs.filter((r) => !r.beating).map((r) => r.s)
    expect(Math.max(...glides)).toBeGreaterThan(2.5)
    // gliding, the wings are held still and a little up
    for (let tau = 0; tau < plan.cycle; tau += 0.1) {
      const s = plan.at(tau)
      if (s.beating === 0) expect(wingAngle(s)).toBeGreaterThan(0)
    }
  })

  test("it climbs on its beats and sinks on its glides", () => {
    let up = 0
    let down = 0
    for (let tau = 0; tau < plan.cycle; tau += 0.05) {
      const s = plan.at(tau)
      const rate = (plan.at(tau + 0.05).alt - s.alt) / 0.05
      if (s.beating > 0.95) up += rate
      if (s.beating < 0.05) down += rate
    }
    expect(up).toBeGreaterThan(0)
    expect(down).toBeLessThan(0)
  })

  test("a downstroke is quicker than the recovery", () => {
    // from the top (beat 0) to the bottom takes two fifths of the beat
    expect(beatAngle(0)).toBeGreaterThan(beatAngle(0.4) + 1)
    expect(beatAngle(0.4)).toBeLessThan(beatAngle(0.2))
    expect(beatAngle(0.4)).toBeLessThan(beatAngle(0.7))
  })

  test("its route is uneven: its distance from the peaks and its height vary", () => {
    const { centre } = dragonOrbit({ sites })
    let near = Number.POSITIVE_INFINITY
    let far = 0
    let lo = Number.POSITIVE_INFINITY
    let hi = Number.NEGATIVE_INFINITY
    for (let t = DRAGON_ARRIVE_S; t < total - DRAGON_LEAVE_S; t += 0.1) {
      const [x, y, z] = dragonAt(plan, t, total)
      const r = Math.hypot(x - centre.x, z - centre.z)
      near = Math.min(near, r)
      far = Math.max(far, r)
      lo = Math.min(lo, y)
      hi = Math.max(hi, y)
    }
    expect(far - near).toBeGreaterThan(5)
    expect(hi - lo).toBeGreaterThan(8)
  })

  test("its flight never jumps: in, round, out (and when told to go mid-route)", () => {
    for (const end of [total, 31.3 + DRAGON_LEAVE_S]) {
      let last: number[] | null = null
      let jump = 0
      const F = 1 / 60
      for (let t = 0; t < end - 2 * F; t += F) {
        const a = dragonAt(plan, t, end)
        const b = dragonAt(plan, t + F, end)
        const v = [0, 1, 2].map((k) => ((b[k] as number) - (a[k] as number)) / F)
        if (last) jump = Math.max(jump, Math.hypot(...v.map((x, k) => (x - (last as number[])[k]) as number)))
        last = v
      }
      // under a metre a second from one frame to the next (≈ 6 g at its speed: a swoop, not a jerk)
      expect(jump).toBeLessThan(1)
      let bankJump = 0
      for (let t = 0; t < end; t += F)
        bankJump = Math.max(bankJump, Math.abs(bankAt(plan, t + F, end) - bankAt(plan, t, end)))
      // a roll of at most about 2.5 rad/s (a quick roll out for home when told to go mid-turn)
      expect(bankJump).toBeLessThan(0.045)
    }
  })

  test("it banks into its turns", () => {
    let banked = 0
    for (let t = DRAGON_ARRIVE_S; t < total - DRAGON_LEAVE_S; t += 0.2)
      banked = Math.max(banked, Math.abs(bankAt(plan, t, total)))
    expect(banked).toBeGreaterThan(0.25)
  })

  test("a pose at a time is the same whatever came before (seek = play)", async () => {
    const pose = async (history: number[]) => {
      const { stage, step } = fakeStage()
      let clock = 0
      const shows = createShows(stage, { sites, span: 160, light: light(0), clock: () => clock })
      shows.play({ kind: "dragon", start: 0, end: total })
      await shows.ready()
      for (const t of history) {
        clock = t
        step(0.016)
      }
      const group = stage.scene.getObjectByName("dragon flying")
      group?.updateMatrixWorld(true)
      const m = group?.matrixWorld.elements.slice() ?? []
      shows.dispose()
      return m
    }
    const seek = await pose([23.4])
    const play = await pose(Array.from({ length: 200 }, (_, i) => i * 0.117).concat([23.4]))
    for (let k = 0; k < 16; k++) expect(play[k] as number).toBeCloseTo(seek[k] as number, 9)
  })
})

describe("the dragon over the land", () => {
  // a hill under the route's north side, and the island's own sites (a keep, places)
  const hill = (x: number, z: number) =>
    Math.max(0, 14 - Math.hypot(x - (sites.peak?.at[0] ?? 0), z - ((sites.peak?.at[2] ?? 0) - 30)) * 0.3)
  const ground = (x: number, z: number) =>
    Math.max(
      sites.peak && Math.hypot(x - sites.peak.at[0], z - sites.peak.at[2]) < 10 ? sites.peak.at[1] : 0,
      hill(x, z),
    )
  const plan = dragonFlight({ sites, ground })
  const total = SHOW_S.dragon
  const high = highestUnder(plan.route, plan.length, { sites, ground }) as number

  test("the highest thing under the route counts the ground, the keep and the buildings", () => {
    expect(high).toBeGreaterThanOrEqual(13)
    if (sites.castle) {
      const keep = {
        sites: { ...sites, castle: [plan.centre[0], 60, plan.centre[2] + 30] as [number, number, number] },
        ground,
      }
      // a keep the route passes over raises it
      expect(highestUnder(plan.route, plan.length, keep)).toBeGreaterThanOrEqual(high)
    }
    expect(highestUnder(plan.route, plan.length, { sites })).toBeNull()
  })

  test("it cruises at least 25 m over the highest ground under its route, swoops no lower than 12 m", () => {
    expect(plan.centre[1] + plan.low.cruise).toBeGreaterThanOrEqual(high + CRUISE_CLEAR - 1e-6)
    expect(plan.centre[1] + plan.low.all).toBeGreaterThanOrEqual(high + SWOOP_CLEAR - 1e-6)
    // flown, in, round and out: never closer than a swoop's clearance to the ground under it
    for (let t = 0; t < total; t += 0.05) {
      const [x, y, z] = dragonAt(plan, t, total)
      expect(y - ground(x, z)).toBeGreaterThanOrEqual(SWOOP_CLEAR)
    }
    // it still swoops: its lowest well under its cruise
    expect(plan.low.cruise - plan.low.all).toBeGreaterThan(4)
  })

  test("the same route raised: its ground track and acts do not move", () => {
    const flat = dragonFlight({ sites })
    for (const d of [0, 40, 123])
      for (const k of [0, 1]) expect(plan.route(d)[k]).toBeCloseTo(flat.route(d)[k] as number, 9)
    expect(plan.cycle).toBe(flat.cycle)
    expect(plan.centre[1]).toBeGreaterThanOrEqual(flat.centre[1])
  })

  test("its shadow: wider and fainter the higher it flies, gone far up, faint by night", () => {
    const near = shadowLook(15, 0)
    const far = shadowLook(45, 0)
    expect(far.across).toBeGreaterThan(near.across)
    expect(far.alpha).toBeLessThan(near.alpha)
    expect(near.along).toBeLessThan(near.across)
    expect(shadowLook(200, 0).alpha).toBe(0)
    expect(shadowLook(15, 1).alpha).toBeLessThan(near.alpha / 2)
  })

  test("with the ground known it casts one more draw while it flies, laid on the ground", async () => {
    let clock = 0
    const { stage, step } = fakeStage()
    const shows = createShows(stage, { sites, span: 160, light: light(0), clock: () => clock, ground })
    shows.play({ kind: "dragon", start: 0, end: total })
    await shows.ready()
    clock = 20
    step(0.016)
    const shadow = stage.scene.getObjectByName("dragon shadow")
    expect(shadow?.visible).toBe(true)
    const draws = shows.stats().draws
    expect(draws).toBeGreaterThanOrEqual(2)
    expect(draws).toBeLessThanOrEqual(3)
    const pos = (
      shadow as unknown as {
        geometry: {
          getAttribute(n: string): {
            getX(i: number): number
            getY(i: number): number
            getZ(i: number): number
            count: number
          }
        }
      }
    ).geometry.getAttribute("position")
    for (let i = 0; i < pos.count; i += 7)
      expect(pos.getY(i)).toBeCloseTo(ground(pos.getX(i), pos.getZ(i)) + 0.12, 4)
    shows.dispose()
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

describe("the fireworks' programme", () => {
  const shells = fireworksProgramme()

  test("every kind of shell, in many colours, each turning to another", () => {
    expect(new Set(shells.map((s) => s.style))).toEqual(new Set(["peony", "willow", "crackle", "ring"]))
    expect(new Set(shells.map((s) => s.colour)).size).toBeGreaterThanOrEqual(6)
    for (const s of shells) if (s.style !== "willow") expect(s.turn).not.toBe(s.colour)
    expect(fireworksProgramme()).toEqual(shells) // the same every time
  })

  test("a finale: the salvo is the busiest stretch, crowned by willows, and all burns out inside the festival", () => {
    const within = (a: number, b: number) => shells.filter((s) => s.launch >= a && s.launch < b).length
    const finale = within(FINALE_S, FINALE_S + 6)
    for (let a = 0; a + 6 <= FINALE_S; a += 1) expect(within(a, a + 6)).toBeLessThan(finale)
    expect(shells.filter((s) => s.style === "willow" && s.launch >= FINALE_S).length).toBeGreaterThanOrEqual(
      3,
    )
    for (const s of shells) expect(s.launch + ROCKET_S + STAR_S[s.style]).toBeLessThan(SHOW_S.festival - 1)
  })
})
