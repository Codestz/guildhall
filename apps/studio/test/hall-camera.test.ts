/**
 * The hall's camera (hall/camera.ts): the framing that keeps a subject clear of the HUD, the tracking
 * that smooths a walker, the rules that let a follow go and hold the director off for 10 s, and the
 * controller on a stand-in rig.
 */
import { describe, expect, test } from "bun:test"
import type { CameraPose } from "@guildhall/core"
import { poseToCamera, type RigMove, type Stage } from "@guildhall/render"
import { emptyWorld, type GuildWorld, HOLD_MS, type WorldActor } from "@guildhall/sim"
import type { ViewerHud } from "@guildhall/ui"
import {
  arrivedHold,
  type Box,
  biasStep,
  CLOSE,
  clearAzimuth,
  clearFrame,
  createHallCamera,
  directorDefault,
  directorFree,
  easeFrame,
  fitShift,
  framedTarget,
  glideMs,
  insetsOf,
  isClick,
  MIN_CUT_MS,
  mayCut,
  NO_INSETS,
  releases,
  SHOW_BEATS,
  shotPose,
  showBeatAt,
  TRACK,
  trackStep,
  USER_WAIT_MS,
  viewClear,
} from "../src/hall/camera.ts"
import type { ViewBlocker } from "../src/hall/events.ts"
import type { HallSession } from "../src/hall/feeds/index.ts"
import { graveBlockers } from "../src/hexworld/undead.ts"

type Vec3 = [number, number, number]
const W = 1440
const H = 900
const LENS = { fov: 40, aspect: W / H }

/** Where a world point lands on screen, NDC, for a camera at `pose` (the rig's own lookAt). */
function project(p: Vec3, pose: CameraPose, lens = LENS): [number, number] {
  const eye = poseToCamera(pose)
  const f = norm(sub(pose.target, eye))
  const r = norm(cross(f, [0, 1, 0]))
  const u = cross(r, f)
  const d = sub(p, eye)
  const z = dot(d, f)
  const ty = Math.tan(((lens.fov / 2) * Math.PI) / 180)
  return [dot(d, r) / z / (ty * lens.aspect), dot(d, u) / z / ty]
}
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a)
  return [a[0] / l, a[1] / l, a[2] / l]
}

describe("framing: clear of the HUD", () => {
  const sheet: Box = { left: W - 400, top: 0, right: W, bottom: H }
  const bottomSheet: Box = { left: 0, top: 500, right: 390, bottom: 844 }
  const brand: Box = { left: 16, top: 16, right: 220, bottom: 64 }
  const list: Box = { left: 16, top: 80, right: 330, bottom: 700 }

  test("a right-hand sheet is cleared from the right, a phone's bottom sheet from the bottom", () => {
    expect(insetsOf([sheet], W, H)).toEqual({ ...NO_INSETS, right: 400 })
    expect(insetsOf([bottomSheet], 390, 844)).toEqual({ ...NO_INSETS, bottom: 344 })
  })

  test("a tall list on the left from the left; the brand chip is too small to move the frame", () => {
    expect(insetsOf([brand, list], W, H)).toEqual({ ...NO_INSETS, left: 330 })
    expect(insetsOf([brand], W, H)).toEqual(NO_INSETS)
  })

  test("the clear area's middle sits left of centre beside a sheet; no side gives up more than about half", () => {
    const f = clearFrame(W, H, { ...NO_INSETS, right: 400 })
    expect(f.x).toBeCloseTo(-400 / W, 6)
    expect(f.y).toBe(0)
    expect(f.w).toBeCloseTo((W - 400) / W, 6)
    const wide = clearFrame(W, H, { ...NO_INSETS, right: W })
    expect(wide.w).toBeCloseTo(0.55, 6)
    expect(clearFrame(W, H, NO_INSETS)).toEqual({ x: 0, y: 0, w: 1, h: 1 })
  })

  test("the framed target puts the subject in the clear area's middle, from any side and tilt", () => {
    const subject: Vec3 = [40, 3, -25]
    for (const azimuth of [0, 37, 140, -95])
      for (const elevation of [24, 38, 60])
        for (const insets of [
          { ...NO_INSETS, right: 400 },
          { ...NO_INSETS, bottom: 300 },
          { ...NO_INSETS, left: 330, bottom: 120 },
        ]) {
          const frame = clearFrame(W, H, insets)
          const pose: CameraPose = { target: subject, azimuth, elevation, distance: 30 }
          pose.target = framedTarget(subject, pose, LENS, frame)
          const [x, y] = project(subject, pose)
          expect(Math.abs(x - frame.x)).toBeLessThan(1e-3)
          expect(Math.abs(y - frame.y)).toBeLessThan(1e-3)
        }
  })

  test("nothing covered: the target is the subject", () => {
    const pose = { azimuth: 30, elevation: 30, distance: 20 }
    expect(framedTarget([1, 2, 3], pose, LENS, clearFrame(W, H, NO_INSETS))).toEqual([1, 2, 3])
  })
})

describe("a panel opening slides the frame, never jumps it", () => {
  test("the held frame moves at most ~10% of the way a frame and arrives in about half a second", () => {
    const shown = clearFrame(W, H, NO_INSETS)
    const to = clearFrame(390, 844, { ...NO_INSETS, bottom: 422 })
    let worst = 0
    for (let i = 0; i < 40; i++) {
      const before = shown.y
      easeFrame(shown, to, 1 / 60)
      worst = Math.max(worst, Math.abs(shown.y - before))
    }
    expect(worst).toBeLessThan(Math.abs(to.y) * 0.11)
    expect(Math.abs(shown.y - to.y)).toBeLessThan(Math.abs(to.y) * 0.05)
  })
})

describe("tracking a walker", () => {
  test("eases toward the hero, faster across the ground than up a terrace", () => {
    const next = trackStep([0, 0, 0], [1, 4, 0], 1 / 60)
    expect(next[0]).toBeCloseTo(1 - Math.exp(-TRACK.ground / 60), 6)
    expect(next[1] / 4).toBeCloseTo(1 - Math.exp(-TRACK.height / 60), 6)
    expect(next[1] / 4).toBeLessThan(next[0])
  })

  test("a walk at 1.4 m/s stays within half a metre of the hero (never leaves the frame)", () => {
    let p: Vec3 | null = null
    let worst = 0
    for (let i = 0; i < 600; i++) {
      const hero: Vec3 = [1.4 * (i / 60), 0, 0]
      p = trackStep(p, hero, 1 / 60)
      worst = Math.max(worst, Math.hypot(hero[0] - p[0], hero[2] - p[2]))
    }
    expect(worst).toBeLessThan(0.5)
  })

  test("a step per frame never jumps more than the hero moved; a far jump (a scrub) is taken at once", () => {
    const a = trackStep([0, 0, 0], [0.05, 0, 0], 1 / 60)
    expect(a[0]).toBeLessThanOrEqual(0.05)
    expect(trackStep([0, 0, 0], [TRACK.snap + 1, 0, 0], 1 / 60)).toEqual([TRACK.snap + 1, 0, 0])
    expect(trackStep(null, [3, 2, 1], 1 / 60)).toEqual([3, 2, 1])
  })
})

describe("the rules", () => {
  test("a click: under 6 px of travel and 600 ms", () => {
    expect(isClick(2, 3, 150)).toBe(true)
    expect(isClick(5, 4, 150)).toBe(false)
    expect(isClick(0, 0, 700)).toBe(false)
  })

  test("a pan, free flight and a glide or set from elsewhere let go; turning and zooming keep the hero", () => {
    const kept: RigMove[] = ["orbit", "zoom"]
    const let_: RigMove[] = ["pan", "free", "glide", "set", "mode"]
    for (const m of kept) expect(releases(m)).toBe(false)
    for (const m of let_) expect(releases(m)).toBe(true)
  })

  test("the director waits 10 s after any input and never takes a followed hero", () => {
    expect(directorFree(true, false, 50_000, null)).toBe(true)
    expect(directorFree(true, false, 50_000, 50_000 - USER_WAIT_MS + 1)).toBe(false)
    expect(directorFree(true, false, 50_000, 50_000 - USER_WAIT_MS)).toBe(true)
    expect(directorFree(true, true, 50_000, null)).toBe(false)
    expect(directorFree(false, false, 50_000, null)).toBe(false)
  })

  test("cuts are at least MIN_CUT_MS apart (wall clock)", () => {
    expect(mayCut(1000, null)).toBe(true)
    expect(mayCut(1000 + MIN_CUT_MS - 1, 1000)).toBe(false)
    expect(mayCut(1000 + MIN_CUT_MS, 1000)).toBe(true)
    expect(mayCut(1001, 1000, true)).toBe(true) // a world event off the idle overview: at once
  })

  test("on by default for a story, off for live and replay; ?director= wins", () => {
    const q = (s: string) => new URLSearchParams(s)
    expect(directorDefault(q("feed=story"))).toBe(true)
    expect(directorDefault(q("feed=replay"))).toBe(false)
    expect(directorDefault(q("feed=live"))).toBe(false)
    expect(directorDefault(q("feed=replay&director=1"))).toBe(true)
    expect(directorDefault(q("feed=story&director=0"))).toBe(false)
  })

  test("shot sizes: close for a hero, mid for a place by its size, the map far out", () => {
    const from = { azimuth: 12 }
    expect(shotPose("hero", "close", [0, 0, 0], from, { map: 400 }).distance).toBe(CLOSE.distance)
    const small = shotPose("place", "mid", [0, 0, 0], from, { map: 400, tiles: 16 }).distance
    const big = shotPose("place", "mid", [0, 0, 0], from, { map: 400, tiles: 400 }).distance
    expect(big).toBeGreaterThan(small)
    expect(shotPose("overview", "map", [0, 0, 0], from, { map: 400 }).distance).toBe(400)
    expect(shotPose("harbour", "mid", [0, 0, 0], from, { map: 400 }).azimuth).toBe(12)
  })

  test("a show is framed in beats: established wide, then closer once seen whole", () => {
    expect(showBeatAt("dragon", 0)).toBe(0)
    expect(showBeatAt("dragon", 7999)).toBe(0)
    expect(showBeatAt("dragon", 8000)).toBe(1)
    expect(showBeatAt("comet", 60_000)).toBe(0) // one beat: it stays where it was laid out
    for (const kind of Object.keys(SHOW_BEATS) as (keyof typeof SHOW_BEATS)[]) {
      const beats = SHOW_BEATS[kind] ?? []
      expect(beats[0]?.at).toBe(0)
      // every later beat closer and no higher: an establishing shot, then in
      for (let i = 1; i < beats.length; i++) {
        expect(beats[i]?.distance).toBeLessThan(beats[i - 1]?.distance as number)
        expect(beats[i]?.elevation).toBeLessThanOrEqual(beats[i - 1]?.elevation as number)
      }
    }
    const from = { azimuth: 12 }
    const wide = shotPose("show", "map", [0, 30, 0], from, { map: 400, show: "dragon", beat: 0 })
    const near = shotPose("show", "map", [0, 30, 0], from, { map: 400, show: "dragon", beat: 9000 })
    expect(near.distance).toBeLessThan(wide.distance)
    // a phone held upright stands further back, so the show still fits across
    const upright = shotPose("show", "map", [0, 30, 0], from, { map: 400, show: "dragon", aspect: 0.46 })
    expect(upright.distance).toBeGreaterThan(wide.distance * 1.3)
    expect(
      shotPose("show", "map", [0, 30, 0], from, { map: 400, show: "dragon", aspect: 1.6 }).distance,
    ).toBe(wide.distance)
    // the rainbow is sized by the map view; a galleon is filmed from the island looking out at it
    expect(shotPose("show", "map", [0, 0, 0], from, { map: 400, show: "rainbow" }).distance).toBe(320)
    const galleon = shotPose("harbour", "mid", [100, 0, 0], from, {
      map: 400,
      show: "galleon",
      centre: [0, 0],
    })
    expect(galleon.azimuth).toBeCloseTo(-90, 6)
  })

  test("a held beat's hold runs from when the camera arrives; a plain cut keeps its own", () => {
    expect(arrivedHold({ since: 1000, holdUntil: 1000 + 18_000 }, 2000)).toBe(21_000)
    expect(arrivedHold({ since: 1000, holdUntil: 1000 + HOLD_MS }, 2000)).toBe(1000 + HOLD_MS)
  })

  test("glides: 1.1 to 2.4 s, longer for farther; a follow's quicker", () => {
    const a: CameraPose = { target: [0, 0, 0], azimuth: 0, elevation: 30, distance: 30 }
    const near = glideMs(a, { ...a, target: [5, 0, 0] })
    const far = glideMs(a, { ...a, target: [300, 0, 0] })
    expect(near).toBeGreaterThanOrEqual(1100)
    expect(far).toBeLessThanOrEqual(2400)
    expect(far).toBeGreaterThan(near)
    expect(glideMs(a, { ...a, target: [300, 0, 0] }, true)).toBeLessThan(far)
  })
})

// ---------------------------------------------------------------------------------------------------
// The controller on a stand-in rig, stage, HUD and session.

function standIn(world: () => GuildWorld) {
  let pose: CameraPose = { target: [0, 0, 0], azimuth: 30, elevation: 45, distance: 200 }
  let goal = { ...pose }
  let aimed: Vec3 | null = null
  let driver: ((dt: number) => void) | null = null
  const movers = new Set<(m: RigMove) => void>()
  const glides: CameraPose[] = []
  const emit = (m: RigMove) => {
    for (const fn of movers) fn(m)
  }
  const rig = {
    get: () => ({ ...pose }),
    goal: () => ({ ...goal }),
    set(p: CameraPose) {
      emit("set")
      pose = { ...p }
      goal = { ...p }
    },
    glide(p: CameraPose) {
      emit("glide")
      glides.push(p)
      goal = { ...p }
    },
    aim(t: Vec3 | null) {
      aimed = t
    },
    steer(c: Partial<CameraPose>) {
      goal = { ...goal, ...c, target: goal.target }
    },
    onMove(fn: (m: RigMove) => void) {
      movers.add(fn)
      return () => movers.delete(fn)
    },
    drive(fn: ((dt: number) => void) | null) {
      driver = fn
    },
    gliding: () => false,
    world: () => ({ centre: [0, 0] as [number, number], half: 300, water: 0 }),
  }
  const rect =
    (r: Partial<DOMRect> = {}) =>
    () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, ...r })
  const el = () => ({ getBoundingClientRect: rect(), children: [] })
  const hud = { corner: el(), feed: el(), bottom: el(), rail: el(), sheet: el() } as unknown as ViewerHud
  const listeners = new Map<string, (e: unknown) => void>()
  /** Chips: Ada's stands at (700, 400)–(760, 430). */
  let selected: string | null = null
  let chipBox: [number, number, number, number] | null = null
  const chips = {
    hit: (x: number, y: number) => (x >= 700 && x <= 760 && y >= 400 && y <= 430 ? "ada" : null),
    extent: (): [number, number, number, number] | null => chipBox,
    select: (id: string | null) => {
      selected = id
    },
  }
  const host = {
    getBoundingClientRect: rect({ width: W, height: H, right: W, bottom: H }),
    clientWidth: W,
    clientHeight: H,
    isConnected: true,
    addEventListener: (type: string, fn: (e: unknown) => void) => listeners.set(type, fn),
    removeEventListener: (type: string) => listeners.delete(type),
  } as unknown as HTMLElement
  const session = {
    snapshot: () => ({ events: 3, world: world(), clock: { at: world().at } }),
  } as unknown as HallSession
  let clock = 0
  const heroes = new Map<string, Vec3>([["ada", [50, 2, 10]]])
  const camera = createHallCamera({
    stage: { rig, camera: { fov: 40, aspect: W / H, far: 2000 } } as unknown as Stage,
    hud,
    host,
    places: [{ id: "p", label: "P", kind: "town", files: 1, tiles: 25, tier: 3, at: [100, 0, 100], zone: 2 }],
    heroAt: (id) => heroes.get(id) ?? null,
    session,
    sessionPlaces: null,
    query: new URLSearchParams("feed=story"),
    chips,
    now: () => clock,
    reducedMotion: () => false,
  })
  return {
    camera,
    glides,
    heroes,
    aimed: () => aimed,
    user: emit,
    chipSelected: () => selected,
    /** Where the pleading hero's chip stands (with its mark), or off screen. */
    chipAt(box: [number, number, number, number] | null) {
      chipBox = box
    },
    /** A press and release on the stage (`travel` px apart, `ms` long). */
    press(x: number, y: number, travel = 0, ms = 120) {
      listeners.get("pointerdown")?.({ button: 0, isPrimary: true, clientX: x, clientY: y, pointerId: 1 })
      clock += ms
      listeners.get("pointerup")?.({ clientX: x + travel, clientY: y, pointerId: 1 })
    },
    /** Runs `ms` of frames at 60 fps. */
    run(ms: number) {
      for (let t = 0; t < ms; t += 1000 / 60) {
        clock += 1000 / 60
        driver?.(1 / 60)
        if (aimed) goal = { ...goal, target: aimed }
        pose = { ...goal }
      }
    },
  }
}

/** A guild at `at` with one hero waiting on a human (a plea) at zone 2. */
function pleading(at: number, id = "ada"): GuildWorld {
  const actor = { id, status: "waiting", plea: at - 100, joined: 0, moved: 0, place: 2, since: 0 }
  return { ...emptyWorld(), at, actors: new Map([[id, actor as unknown as WorldActor]]) }
}

describe("the controller", () => {
  test("a plain click on a hero's chip follows them and pins their chip; a drag over it does not", () => {
    const s = standIn(() => emptyWorld())
    s.camera.director(false)
    s.press(720, 415, 30)
    expect(s.camera.state().following).toBe(null)
    s.press(100, 100)
    expect(s.camera.state().following).toBe(null)
    s.press(720, 415)
    expect(s.camera.state().following).toBe("ada")
    expect(s.chipSelected()).toBe("ada")
    s.user("pan")
    expect(s.chipSelected()).toBe(null)
  })

  test("a story's director takes the camera at once and cuts to the plea, close", () => {
    const s = standIn(() => pleading(60_000))
    s.run(300)
    const st = s.camera.state()
    expect(st.director).toBe(true)
    expect(st.mode).toBe("director")
    expect(st.shot).toEqual({ key: "hero:ada", reason: "plea", distance: "close" })
    expect(s.glides.at(-1)?.distance).toBe(CLOSE.distance)
  })

  test("a pleading hero's chip poking out of the clear area nudges the frame in, and the nudge goes once it fits", () => {
    const s = standIn(() => pleading(60_000))
    s.run(300)
    expect(s.camera.frame().x).toBe(0)
    s.chipAt([-30, 300, 60, 340])
    s.run(1500)
    expect(s.camera.frame().x).toBeGreaterThan(0.05)
    s.chipAt([300, 300, 390, 340])
    s.run(4000)
    expect(Math.abs(s.camera.frame().x)).toBeLessThan(0.02)
  })

  test("follow flies close and tracks the hero as they walk; a turn keeps them, a pan lets go", () => {
    const s = standIn(() => emptyWorld())
    s.camera.director(false)
    s.camera.follow("ada")
    expect(s.camera.state().mode).toBe("follow")
    expect(s.glides.at(-1)?.distance).toBe(CLOSE.distance)
    s.heroes.set("ada", [60, 2, 10])
    s.run(1500)
    const aim = s.aimed() as Vec3
    expect(Math.hypot(aim[0] - 60, aim[2] - 10)).toBeLessThan(0.2)
    s.user("orbit")
    s.user("zoom")
    expect(s.camera.state().following).toBe("ada")
    s.user("pan")
    expect(s.camera.state().following).toBe(null)
    expect(s.aimed()).toBe(null)
  })

  test("Esc lets go; the director waits 10 s after the last input, then takes over", () => {
    const s = standIn(() => pleading(60_000))
    s.camera.follow("ada")
    s.run(500)
    expect(s.camera.state().mode).toBe("follow")
    s.user("orbit")
    s.camera.release()
    s.run(USER_WAIT_MS - 1000)
    expect(s.camera.state().mode).toBe("free")
    expect(s.camera.state().waitMs).toBeGreaterThan(0)
    s.run(1500)
    expect(s.camera.state().mode).toBe("director")
  })

  test("B (director(false)) stops the director; on again it takes the camera without the wait", () => {
    const s = standIn(() => pleading(60_000))
    s.run(300)
    s.user("zoom")
    expect(s.camera.state().mode).toBe("free")
    expect(s.camera.director(false)).toBe(false)
    s.run(USER_WAIT_MS + 500)
    expect(s.camera.state().mode).toBe("free")
    expect(s.camera.director()).toBe(true)
    s.run(300)
    expect(s.camera.state().mode).toBe("director")
  })

  test("no thrash: a subject changing every 400 ms is cut to at most once per MIN_CUT_MS", () => {
    let n = 0
    const s = standIn(() => pleading(60_000 + n * 400, `h${Math.floor(n / 24) % 2}`))
    const cuts: string[] = []
    s.camera.subscribe(() => {
      const k = s.camera.state().shot?.key
      if (k && cuts.at(-1) !== k) cuts.push(k)
    })
    for (let i = 0; i < 300; i++) {
      n = i
      s.run(1000 / 60)
    }
    // 5 s of picks that flip subject every 400 ms: the first cut plus at most one per MIN_CUT_MS
    expect(cuts.length).toBeLessThanOrEqual(1 + Math.floor(5000 / MIN_CUT_MS))
  })
})

describe("a pleading hero's chip stays in the clear area", () => {
  const rect: Box = { left: 0, top: 120, right: 390, bottom: 780 }
  const box = (l: number, t: number, r: number, b: number): Box => ({ left: l, top: t, right: r, bottom: b })

  test("a chip that fits asks for nothing", () => {
    expect(fitShift(box(150, 300, 240, 400), rect, 10)).toEqual({ dx: 0, dy: 0 })
  })
  test("a chip clipped by an edge is brought in by its margin", () => {
    expect(fitShift(box(-40, 300, 50, 400), rect, 10)).toEqual({ dx: 50, dy: 0 })
    expect(fitShift(box(330, 300, 420, 400), rect, 10)).toEqual({ dx: -40, dy: 0 })
    expect(fitShift(box(150, 60, 240, 160), rect, 10)).toEqual({ dx: 0, dy: 70 })
  })
  test("a box wider than the area is centred", () => {
    expect(fitShift(box(-30, 300, 440, 400), rect, 10).dx).toBe(-10)
  })
  test("a nudge that is no longer needed unwinds only as far as the margin allows", () => {
    // pushed 60 px right and now centred: all of it unwinds
    expect(biasStep(box(150, 300, 240, 400), rect, 10, { x: 60, y: 0 })).toEqual({ dx: -60, dy: 0 })
    // the chip sits 20 px from the left margin: it may only give back 20
    expect(biasStep(box(30, 300, 120, 400), rect, 10, { x: 60, y: 0 })).toEqual({ dx: -20, dy: 0 })
    // no nudge, nothing to do
    expect(biasStep(box(150, 300, 240, 400), rect, 10, { x: 0, y: 0 })).toEqual({ dx: 0, dy: 0 })
  })
})

describe("a rise filmed past what stands round the grave", () => {
  const grave: Vec3 = [0, 0, 0]
  // a pine 2 m off the grave toward +x (azimuth 90°): its crown from 2 m to 6 m up
  const pine: ViewBlocker = { x: 2, z: 0, r: 0.8, bottom: 2, top: 6, what: "kaykit-forest/tree-4-a" }

  test("a view straight through the pine's crown is not clear; one from the side is", () => {
    expect(viewClear(grave, 12, 30, 90, [pine])).toBe(false)
    expect(viewClear(grave, 12, 30, 0, [pine])).toBe(true)
    expect(viewClear(grave, 12, 30, 270, [pine])).toBe(true)
    // nothing in the way: always clear
    expect(viewClear(grave, 12, 30, 90, [])).toBe(true)
  })

  test("the eye standing in a crown is not clear", () => {
    const over: ViewBlocker = { x: 10.4, z: 0, r: 1.5, bottom: 4, top: 9 }
    expect(viewClear(grave, 12, 30, 90, [over])).toBe(false)
  })

  test("the director turns to the nearest clear way round, with room for its drift", () => {
    const az = clearAzimuth(grave, 12, 30, 90, [pine])
    expect(az).not.toBe(90)
    expect(Math.abs(az - 90)).toBeLessThanOrEqual(60)
    for (const d of [-10, 0, 10]) expect(viewClear(grave, 12, 30, az + d, [pine])).toBe(true)
    // already clear: it keeps its way
    expect(clearAzimuth(grave, 12, 30, 200, [pine])).toBe(200)
    // nowhere clear (a ring of trees): it keeps its way rather than spin
    const ring: ViewBlocker[] = Array.from({ length: 12 }, (_, k) => ({
      x: Math.sin((k * Math.PI) / 6) * 3,
      z: Math.cos((k * Math.PI) / 6) * 3,
      r: 1.6,
      bottom: 0,
      top: 9,
    }))
    expect(clearAzimuth(grave, 12, 30, 45, ring)).toBe(45)
  })

  test("a rise's shot takes the clear way when its site says what stands round it", () => {
    const pose = shotPose(
      "show",
      "mid",
      grave,
      { azimuth: 90 },
      { map: 400, show: "undead", blockers: [pine] },
    )
    expect(pose.azimuth).not.toBe(90)
    expect(viewClear(grave, pose.distance, pose.elevation, pose.azimuth, [pine])).toBe(true)
    expect(shotPose("show", "mid", grave, { azimuth: 90 }, { map: 400, show: "undead" }).azimuth).toBe(90)
  })

  test("the graveyard's blockers: solid things near the graves, a tree by its crown, an arch by its posts", () => {
    const size = (id: string): [number, number, number] | undefined =>
      id.includes("tree")
        ? [2, 6, 2]
        : id.includes("arch")
          ? [4, 4.4, 0.8]
          : id.includes("fence")
            ? [2.4, 1.3, 0.3]
            : id.includes("rock")
              ? [3, 2.5, 3]
              : undefined
    const at = (piece: string, x: number, z = 0, rot = 0) => ({ piece, x, y: 1, z, rot, scale: 1 })
    const out = graveBlockers(
      [{ x: 0, z: 0 }],
      [
        at("kaykit-forest/tree-4-a", 2),
        at("kaykit-halloween/fence", 1),
        at("kaykit-halloween/tree-dead-large", 1),
        at("kaykit-halloween/arch", 0, 2),
        at("kaykit-nature/rock-big", -4),
        at("kaykit-forest/tree-4-a", 40),
        at("mystery/piece", 3),
      ],
      size,
    )
    const tree = out.find((b) => b.what?.includes("tree-4-a"))
    expect(tree?.bottom).toBeGreaterThan(1)
    expect(tree?.top).toBe(7)
    expect(out.filter((b) => b.what?.includes("tree-4-a"))).toHaveLength(1) // the far one is out of reach
    expect(out.some((b) => /fence|dead/.test(b.what ?? ""))).toBe(false)
    const posts = out.filter((b) => b.what?.includes("arch"))
    expect(posts).toHaveLength(2)
    expect(Math.abs((posts[0]?.x ?? 0) - (posts[1]?.x ?? 0))).toBeGreaterThan(2.5)
    expect(out.find((b) => b.what?.includes("rock"))?.bottom).toBe(1)
    expect(graveBlockers([], [at("kaykit-forest/tree-4-a", 2)], size)).toEqual([])
  })
})
