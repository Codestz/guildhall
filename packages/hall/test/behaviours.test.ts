import { describe, expect, test } from "bun:test"
import { applyAll, emptyModel, type Session } from "@guildhall/core"
import { Script } from "@guildhall/sim"
import { AnimationClip, Bone, Group, QuaternionKeyframeTrack, VectorKeyframeTrack } from "three"
import { attachHands, CARRY_WALK, carryClip, HAND_SLOT, release, reserve } from "../src/scene/activity.ts"
import { life } from "../src/scene/life/state.ts"
import { NO_TRACES, tracesOf } from "../src/scene/life/traces.ts"
import { beats, emitBeat } from "../src/scene/life/work.ts"
import {
  type Behaviour,
  type Place,
  placeOf,
  Routine,
  SITE_WORK,
  STATION_WORK,
  type Step,
  seedOf,
  shifted,
  stepsOf,
} from "../src/world/behaviours.ts"
import { SITES, type SiteId } from "../src/world/lands.ts"
import { type Post, STATIONS, type StationId } from "../src/world/layout.ts"
import { SITE_DEFS } from "../src/world/sites.ts"
import {
  along,
  BODY,
  blocker,
  ISLAND_OBSTACLES,
  KEEP_OBSTACLES,
  placeFor,
  walks,
} from "./support/clearance.ts"
import { glbJson } from "./support/glb.ts"

/** Clips that are standing about, not working. */
const IDLE = new Set(["Idle_A", "Idle_B", "Holding_A"])

/** Every place a worker can be: each behaviour at each of its posts. */
const PLACES: { key: string; behaviour: Behaviour; posts: readonly Post[]; island: boolean }[] = [
  ...(Object.keys(SITE_WORK) as SiteId[]).map((id) => ({
    key: `site:${id}`,
    behaviour: SITE_WORK[id],
    posts: SITES[id].posts,
    island: true,
  })),
  ...(Object.keys(STATION_WORK) as StationId[]).map((id) => ({
    key: `station:${id}`,
    behaviour: STATION_WORK[id],
    posts: STATIONS[id].posts,
    island: false,
  })),
]

/** A frame-by-frame run of a routine: `arrived` once the aim was "reached" (walks take `walkS`). */
function run(
  routine: Routine,
  seconds: number,
  input: { thinking?: boolean; tool?: (t: number) => string | undefined; walkS?: number } = {},
  each?: (t: number) => void,
): void {
  const dt = 1 / 30
  let walked = 0
  let aim = routine.aim
  for (let t = 0; t < seconds; t += dt) {
    if (routine.aim !== aim) {
      aim = routine.aim
      walked = 0
    }
    walked += dt
    const walking = routine.started && routine.clip === null && walked < (input.walkS ?? 0.5)
    routine.update(dt, { thinking: input.thinking ?? false, tool: input.tool?.(t), arrived: !walking })
    each?.(t)
  }
}

const placeAt = (key: string, berth = 0): Place => {
  const entry = PLACES.find((p) => p.key === key)
  if (!entry) throw new Error(key)
  return placeFor(key, entry.behaviour, entry.posts[berth] as Post, berth)
}

/** The clips a routine plays over `seconds`, in order, repeats folded. */
function clips(routine: Routine, seconds: number, input: Parameters<typeof run>[2] = {}): string[] {
  const out: string[] = []
  run(routine, seconds, input, () => {
    const clip = routine.clip ?? "walk"
    if (out.at(-1) !== clip) out.push(clip)
  })
  return out
}

describe("behaviour scripts", () => {
  test("every site and every station has a loop that works, not one that stands idle", () => {
    expect(Object.keys(SITE_WORK).sort()).toEqual(Object.keys(SITES).sort())
    expect(Object.keys(STATION_WORK).sort()).toEqual(Object.keys(STATIONS).sort())
    for (const { key, behaviour } of PLACES) {
      const working = behaviour.loop.filter((step) => "clip" in step && !IDLE.has(step.clip))
      expect({ key, working: working.length > 0 }).toEqual({ key, working: true })
    }
  })

  test("the site registry carries each site's behaviour (ADR 0008: one record per site)", () => {
    for (const id of Object.keys(SITES) as SiteId[]) expect(SITE_DEFS[id].work).toBe(SITE_WORK[id])
  })

  test("every spot a step walks to, faces or strikes exists for every berth", () => {
    for (const { key, behaviour, posts } of PLACES)
      posts.forEach((post, berth) => {
        const { spots } = placeFor(key, behaviour, post, berth)
        const named = (step: Step): string[] =>
          "walk" in step
            ? [step.walk]
            : [step.face, step.beat?.at].filter((n): n is string => !!n && n !== "self")
        for (const step of stepsOf(behaviour))
          for (const name of named(step))
            expect({ key, berth, name, ok: !!spots[name] }).toEqual({ key, berth, name, ok: true })
        expect(spots.work).toBeDefined()
      })
  })

  test("every standing spot is clear of props, wilds, piles and furniture", () => {
    for (const { key, behaviour, posts, island } of PLACES)
      posts.forEach((post, berth) => {
        const obstacles = island ? ISLAND_OBSTACLES : KEEP_OBSTACLES
        for (const [name, spot] of Object.entries(placeFor(key, behaviour, post, berth).spots)) {
          // The post itself is the map's (lands.ts / layout.ts); marks are faced, never stood on.
          if (behaviour.marks.has(name) || name === "post") continue
          expect({ key, berth, name, blocked: blocker(spot, obstacles)?.name }).toEqual({
            key,
            berth,
            name,
            blocked: undefined,
          })
        }
      })
  })

  test("every walk of every loop and steer is reachable without crossing a prop", () => {
    for (const { key, behaviour, posts, island } of PLACES)
      posts.forEach((post, berth) => {
        const place = placeFor(key, behaviour, post, berth)
        const obstacles = island ? ISLAND_OBSTACLES : KEEP_OBSTACLES
        for (const steps of [behaviour.loop, ...(behaviour.steer ?? []).map((s) => s.steps)]) {
          // Twice round: the walk back from the last step to the first is a walk too.
          for (const walk of walks(place, [...steps, ...steps], [post[0], post[1]])) {
            const hit = along(walk.path)
              .map((at) => blocker(at, obstacles, BODY * 0.6)?.name)
              .find(Boolean)
            expect({ key, berth, to: walk.to, hit }).toEqual({ key, berth, to: walk.to, hit: undefined })
          }
        }
      })
  })

  test("each worker has their own standing spots: neighbours never queue for one", () => {
    for (const { key, behaviour, posts } of PLACES) {
      const stands = posts.map((post, berth) =>
        Object.entries(placeFor(key, behaviour, post, berth).spots).filter(
          ([name]) => !behaviour.marks.has(name),
        ),
      )
      for (let i = 0; i < stands.length; i++)
        for (let j = i + 1; j < stands.length; j++)
          for (const [a, p] of stands[i] ?? [])
            for (const [b, q] of stands[j] ?? []) {
              const apart = Math.hypot(p[0] - q[0], p[1] - q[1])
              const crowded =
                apart < 1.2 ? `${key} berth ${i} ${a} / berth ${j} ${b}: ${apart.toFixed(2)}` : ""
              expect(crowded).toBe("")
            }
    }
  })
})

describe("placeOf", () => {
  test("a site worker's berth is the index of the post the store sent them to", () => {
    const post = SITES.forest.posts[2] as Post
    const place = placeOf("forest", undefined, post)
    expect(place?.key).toBe("site:forest")
    expect(place?.berth).toBe(2)
    expect(place?.spots.post).toEqual([post[0], post[1]])
  })

  test("a keep role at a full station works the overflow bench; anywhere else has no place", () => {
    const overflow = STATIONS.overflow.posts[1] as Post
    expect(placeOf(undefined, "drafting-table", overflow)?.key).toBe("station:overflow")
    expect(placeOf(undefined, "drafting-table", STATIONS["drafting-table"].posts[0] as Post)?.key).toBe(
      "station:drafting-table",
    )
    expect(placeOf(undefined, "drafting-table", [99, 99, 0])).toBeUndefined()
    expect(placeOf(undefined, undefined, [0, 0, 0])).toBeUndefined()
  })

  test("a second worker on a taken berth (lap 1) stands beside the first, on the same marks", () => {
    const place = placeAt("site:quarry")
    const beside = shifted(place, 1)
    expect(Math.hypot(beside.post[0] - place.post[0], beside.post[1] - place.post[1])).toBeCloseTo(1.5)
    expect(beside.spots.work).toEqual(place.spots.work)
    expect(beside.spots.drop).not.toEqual(place.spots.drop)
  })

  test("berths are reserved in arrival order and freed on release", () => {
    const place = placeAt("site:river", 1)
    expect(reserve(place, "a")).toBe(0)
    expect(reserve(place, "b")).toBe(1)
    expect(reserve(place, "a")).toBe(0)
    release(place, "a")
    expect(reserve(place, "c")).toBe(1)
    release(place, "b")
    release(place, "c")
    expect(reserve(place, "d")).toBe(0)
    release(place, "d")
  })
})

describe("Routine", () => {
  test("waits at the post until the worker first arrives, then runs the loop", () => {
    const routine = new Routine(placeAt("site:forest"), 1)
    routine.update(0.1, { thinking: false, tool: undefined, arrived: false })
    expect(routine.started).toBe(false)
    expect(routine.clip).toBeNull()
    routine.update(0.1, { thinking: false, tool: undefined, arrived: true })
    expect(routine.started).toBe(true)
    expect(routine.clip).toBe("Chopping")
  })

  test("runs its steps in order: chop, pick up the log, carry it, put it down, walk back", () => {
    const routine = new Routine(placeAt("site:forest"), 7)
    const seen = clips(routine, 30)
    expect(seen.slice(0, 6)).toEqual(["Chopping", "PickUp", "walk", "PickUp", "walk", "Idle_A"])
    expect(seen[6]).toBe("Chopping")
  })

  test("a walk ends only on arrival; the load is in hand from the pick-up to the put-down", () => {
    const routine = new Routine(placeAt("site:forest"), 3)
    const held: (string | null)[] = []
    run(routine, 25, { walkS: 2 }, () => {
      const now = routine.clip === null ? `walk:${routine.held}` : `${routine.clip}:${routine.held}`
      if (held.at(-1) !== now) held.push(now)
    })
    expect(held.slice(0, 7)).toEqual([
      "Chopping:null",
      "PickUp:null",
      "PickUp:log",
      "walk:log",
      "PickUp:log",
      "PickUp:null",
      "walk:null",
    ])
  })

  test("the same seed always moves the same way; neighbours don't move in step", () => {
    const trace = (seed: number) => {
      const routine = new Routine(placeAt("site:quarry"), seed)
      const out: string[] = []
      run(routine, 40, { thinking: true }, (t) => out.push(`${t.toFixed(2)}:${routine.clip}`))
      return out.join(" ")
    }
    expect(trace(seedOf("ses_a"))).toBe(trace(seedOf("ses_a")))
    expect(trace(seedOf("ses_a"))).not.toBe(trace(seedOf("ses_b")))
  })

  test("thinking slips pauses in, never with something in the hands; not thinking, none", () => {
    for (const key of ["site:forest", "site:river", "station:forge", "station:quest-board"]) {
      const routine = new Routine(placeAt(key), 11)
      let paused = 0
      run(routine, 120, { thinking: true }, () => {
        if (routine.source !== "pause") return
        paused++
        expect(routine.held).toBeNull()
      })
      expect({ key, paused: paused > 0 }).toEqual({ key, paused: true })
      const busy = new Routine(placeAt(key), 11)
      run(busy, 120, { thinking: false }, () => expect(busy.source).not.toBe("pause"))
    }
  })

  test("a tool call steers the loop: a test run at the forge sends the smith to quench", () => {
    const routine = new Routine(placeAt("station:forge"), 5)
    run(routine, 1)
    expect(routine.clip).toBe("Hammering")
    let steered: string[] = []
    run(routine, 14, { tool: (t) => (t > 0.5 ? "bash" : undefined) }, () => {
      if (routine.source === "steer" && steered.at(-1) !== (routine.clip ?? "walk"))
        steered = [...steered, routine.clip ?? "walk"]
    })
    expect(steered).toEqual(["walk", "Use_Item", "walk", "Lockpicking"])
    // Back on the loop afterwards.
    run(routine, 3)
    expect(routine.source).toBe("loop")
  })

  test("a tool call cuts a soft wait short: the float comes in when a fetch starts", () => {
    const routine = new Routine(placeAt("site:river"), 2)
    run(routine, 30, {}, () => undefined)
    // Run until the float is bobbing, then start a fetch.
    let guard = 0
    while (routine.clip !== "Fishing_Idle" && guard++ < 3000) run(routine, 1 / 30)
    expect(routine.clip).toBe("Fishing_Idle")
    run(routine, 0.2, { tool: () => "webfetch" })
    expect(routine.source).toBe("steer")
  })

  test("a tool that matches no rule leaves the loop alone; the same call running on doesn't re-steer", () => {
    const routine = new Routine(placeAt("site:forest"), 4)
    run(routine, 1)
    run(routine, 10, { tool: () => "edit" }, () => expect(routine.source).not.toBe("steer"))
    const again = new Routine(placeAt("site:forest"), 4)
    let steers = 0
    let was = again.source
    run(again, 30, { tool: (t) => (t > 1 ? "grep" : undefined) }, () => {
      if (again.source === "steer" && was !== "steer") steers++
      was = again.source
    })
    expect(steers).toBe(1)
  })

  test("reset empties the hands and waits for the post again", () => {
    const routine = new Routine(placeAt("site:quarry"), 9)
    run(routine, 12, {}, () => undefined)
    let guard = 0
    while (routine.held === null && guard++ < 3000) run(routine, 1 / 30)
    expect(routine.held).toBe("stone")
    routine.reset()
    expect(routine.held).toBeNull()
    expect(routine.started).toBe(false)
  })

  test("beats come on the clip's rhythm: chops while chopping, none while walking", () => {
    const routine = new Routine(placeAt("site:forest"), 1)
    let chops = 0
    let last = 0
    run(routine, 30, {}, () => {
      if (routine.beats === last) return
      last = routine.beats
      expect(routine.clip).not.toBeNull()
      if (routine.beat === "chop") chops++
    })
    expect(chops).toBeGreaterThan(4)
  })
})

describe("working is not results", () => {
  /** A quest for `role` with `deeds` completed tool calls. */
  function quest(role: string, tool: string, deeds: number): Session[] {
    const script = new Script(3)
    const master = script.guildmaster("Do it")
    master.quest(role, "One quest", (child) => {
      for (let i = 0; i < deeds; i++) child.deed(tool, { pattern: "x" }, 400)
      child.finish("done")
    })
    master.finish("all done")
    return [...applyAll(emptyModel(), script.done()).sessions.values()]
  }

  test("completed deeds pile up; any amount of loop work beside them adds nothing", () => {
    const sessions = quest("guild-explorer", "grep", 3)
    const before = tracesOf(sessions)
    expect(before.logs).toBe(3)
    const written = beats.written
    // Every behaviour runs ten minutes: logs carried, fish landed, arrows loosed, books shelved.
    for (const { key } of PLACES) {
      const routine = new Routine(placeAt(key), seedOf(key))
      let last = 0
      run(routine, 600, { thinking: true }, () => {
        if (routine.beats === last || !routine.beat) return
        last = routine.beats
        emitBeat(routine.beat, 0, 0, 0)
      })
    }
    expect(beats.written).toBeGreaterThan(written)
    expect(tracesOf(sessions)).toEqual(before)
    expect(life.traces).toEqual(NO_TRACES)
  })

  test("a fourth completed deed is a fourth log", () => {
    expect(tracesOf(quest("guild-explorer", "grep", 4)).logs).toBe(4)
  })
})

describe("in the hands", () => {
  /** A rig named as three names the KayKit one (anims.glb's nodes, sanitised). */
  function rig(): Group {
    const body = new Group()
    for (const node of glbJson(`${import.meta.dir}/../public/assets/anims.glb`).nodes ?? []) {
      const bone = new Bone()
      bone.name = node.name ? node.name.replace(/[[\]./:]/g, "").replace(/\s/g, "_") : ""
      body.add(bone)
    }
    return body
  }

  test("every thing a behaviour takes, and its tool, finds a bone to ride on", () => {
    for (const { key, behaviour } of PLACES) {
      const body = rig()
      const hands = attachHands(body, behaviour)
      const takes = new Set(stepsOf(behaviour).flatMap((s) => ("clip" in s && s.take ? [s.take] : [])))
      const attached = body.children.reduce((n, bone) => n + bone.children.length, 0)
      expect({ key, attached }).toEqual({ key, attached: takes.size + (behaviour.tool ? 1 : 0) })
      hands.dispose()
      expect(body.children.reduce((n, bone) => n + bone.children.length, 0)).toBe(0)
    }
    expect(HAND_SLOT.right).toBe("handslotr")
  })

  test("only what is held shows; the tool shows while the hands are free", () => {
    const body = rig()
    const hands = attachHands(body, SITE_WORK.river)
    const shown = () =>
      body.children.flatMap((bone) => bone.children.filter((m) => m.visible).map(() => bone.name))
    hands.show(null, true)
    expect(shown()).toEqual(["handslotr"])
    hands.show("fish", true)
    expect(shown()).toEqual(["handslotr"])
    hands.show(null, false)
    expect(shown()).toEqual([])
  })

  test("the carrying walk takes the arms from Holding_A and the rest from Walking_A", () => {
    const track = (name: string, value: number) =>
      name.endsWith("quaternion")
        ? new QuaternionKeyframeTrack(name, [0], [value, 0, 0, 1])
        : new VectorKeyframeTrack(name, [0], [value, 0, 0])
    const walk = new AnimationClip("Walking_A", 1.07, [
      track("hips.position", 1),
      track("upperarml.quaternion", 1),
    ])
    const hold = new AnimationClip("Holding_A", 1, [
      track("hips.position", 2),
      track("upperarml.quaternion", 2),
    ])
    const carry = carryClip([walk, hold])
    expect(carry?.name).toBe(CARRY_WALK)
    expect(carry?.duration).toBe(1.07)
    const value = (name: string) => carry?.tracks.find((t) => t.name === name)?.values[0]
    expect(value("hips.position")).toBe(1)
    expect(value("upperarml.quaternion")).toBe(2)
    expect(carryClip([walk])).toBeNull()
  })
})
