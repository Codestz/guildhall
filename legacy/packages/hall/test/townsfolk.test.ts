import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { Bone, Group } from "three"
import { attachHands } from "../src/scene/activity.ts"
import {
  CALLED_AWAY,
  Day,
  DOOR_PAUSE_S,
  DOOR_STAGGER_S,
  type Errand,
  errandOf,
  nightOf,
  onQuay,
  placeOfNpc,
  raining,
  staggerOf,
  TOWNSFOLK,
  TOWNSFOLK_PER_TIER,
  type Townsperson,
} from "../src/scene/life/rounds.ts"
import { Routine, SITE_WORK, type Step, seedOf, spotsOf, stepsOf } from "../src/world/behaviours.ts"
import { MODELS } from "../src/world/cast.ts"
import { MAP_FOR_TESTS as MAP, SITES, type SiteId } from "../src/world/lands.ts"
import type { Spot } from "../src/world/layout.ts"
import { along, BODY, blocker, TOWN_OBSTACLES, walks } from "./support/clearance.ts"
import { glbJson } from "./support/glb.ts"

const ANIMS = glbJson(join(import.meta.dir, "../public/assets/anims.glb"))
const CLIPS = new Set((ANIMS.animations ?? []).map((clip) => clip.name))

/** Level dry land (or the quay): where a person can stand. */
function ground(spot: Spot): boolean {
  if (onQuay(spot[0], spot[1])) return true
  const cell = MAP.cellOf(spot)
  return !"~or#".includes(MAP.at(cell)) && MAP.level(cell) === 0
}

/** Every spot an NPC's loop walks to and plays a clip at (plus the post): where they stand. */
function stands(npc: Townsperson): { name: string; at: Spot }[] {
  const place = placeOfNpc(npc)
  const loop = npc.work.loop
  const out = [{ name: "post", at: place.spots.post as Spot }]
  loop.forEach((step, i) => {
    const next = loop[(i + 1) % loop.length]
    if ("walk" in step && next && "clip" in next)
      out.push({ name: step.walk, at: place.spots[step.walk] as Spot })
  })
  return out
}

/**
 * Every walk an NPC makes, as polylines: their loop (twice round, so the walk back to the start is
 * in), the way between door and post, and the rally to the square (both walked either way).
 */
function trips(npc: Townsperson): { to: string; path: Spot[] }[] {
  const post: Spot = [npc.post[0], npc.post[1]]
  const out = walks(placeOfNpc(npc), [...npc.work.loop, ...npc.work.loop], post)
  // Called away mid-loop: back to the post from wherever the loop had them stand.
  const place = placeOfNpc(npc)
  for (const steer of npc.work.steer ?? [])
    for (const step of npc.work.loop)
      if ("walk" in step) {
        const from = place.spots[step.walk] as Spot
        for (const walk of walks(place, steer.steps, from))
          out.push({ ...walk, to: `${walk.to} (called away from ${step.walk})` })
      }
  out.push({ to: "the post, from the door", path: [npc.door, ...npc.way, post] })
  out.push({ to: "the square, from the post", path: [post, ...npc.rally] })
  return out
}

/** Where a festival puts them: the end of their rally, or their post. */
const gatherOf = (npc: Townsperson): Spot => npc.rally.at(-1) ?? [npc.post[0], npc.post[1]]

describe("the townsfolk", () => {
  test("ten to fifteen of them, each with their own id, a real model and clips anims.glb holds", () => {
    expect(TOWNSFOLK.length).toBeGreaterThanOrEqual(10)
    expect(TOWNSFOLK.length).toBeLessThanOrEqual(15)
    expect(new Set(TOWNSFOLK.map((n) => n.id)).size).toBe(TOWNSFOLK.length)
    for (const npc of TOWNSFOLK) {
      expect(MODELS).toContain(npc.model)
      const missing = stepsOf(npc.work).flatMap((s) => ("clip" in s && !CLIPS.has(s.clip) ? [s.clip] : []))
      expect({ id: npc.id, missing }).toEqual({ id: npc.id, missing: [] })
      expect(CLIPS.has(npc.gait.clip)).toBe(true)
    }
  })

  test("each tier shows more of them, Low a few, High all; models and tints vary", () => {
    expect(TOWNSFOLK_PER_TIER[0]).toBeGreaterThan(0)
    expect(TOWNSFOLK_PER_TIER[0]).toBeLessThan(TOWNSFOLK_PER_TIER[1])
    expect(TOWNSFOLK_PER_TIER[1]).toBeLessThan(TOWNSFOLK_PER_TIER[2])
    expect(TOWNSFOLK_PER_TIER[2]).toBe(TOWNSFOLK.length)
    expect(new Set(TOWNSFOLK.map((n) => n.model)).size).toBeGreaterThanOrEqual(5)
    expect(new Set(TOWNSFOLK.map((n) => n.tint)).size).toBe(TOWNSFOLK.length)
    // Low's few are the ones you see first: the gate, the market, the farm, the well.
    expect(TOWNSFOLK.slice(0, TOWNSFOLK_PER_TIER[0]).map((n) => n.id)).toEqual([
      "guard-west",
      "merchant-blue",
      "farmer",
      "well",
    ])
  })

  test("every loop works: something other than standing about", () => {
    const idle = new Set(["Idle_A", "Idle_B"])
    for (const npc of TOWNSFOLK) {
      const working = npc.work.loop.filter((s) => "clip" in s && !idle.has(s.clip))
      // Guards and the watchman keep watch: standing is their work, walking their beat.
      const watch = npc.hours !== "day"
      expect({ id: npc.id, ok: watch || working.length > 0 }).toEqual({ id: npc.id, ok: true })
    }
  })

  test("every spot a step walks to, faces or strikes exists", () => {
    const missing: string[] = []
    for (const npc of TOWNSFOLK) {
      const { spots } = placeOfNpc(npc)
      const named = (step: Step): string[] =>
        "walk" in step
          ? [step.walk]
          : [step.face, step.beat?.at].filter((n): n is string => !!n && n !== "self")
      for (const step of stepsOf(npc.work))
        for (const name of named(step)) if (!spots[name]) missing.push(`${npc.id} ${name}`)
    }
    expect(missing).toEqual([])
  })

  test("every standing spot, door and festival spot is on open ground, clear of everything", () => {
    const bad: string[] = []
    for (const npc of TOWNSFOLK) {
      const { spots } = placeOfNpc(npc)
      const standing: [string, Spot][] = [
        ...Object.entries(spots).filter(([name]) => !npc.work.marks.has(name)),
        // Waypoints of the way and the rally are only walked through (the walk test covers them).
        ["gather", gatherOf(npc)],
      ]
      for (const [name, at] of standing) {
        const blocked = blocker(at, TOWN_OBSTACLES)?.name
        if (blocked || !ground(at)) bad.push(`${npc.id} ${name} [${at}]: ${blocked ?? "off the ground"}`)
      }
      // A door is a step off its own house's front: on it, never in it or anything else.
      const inside = blocker(npc.door, TOWN_OBSTACLES, 0.1)?.name
      if (inside) bad.push(`${npc.id} door [${npc.door}]: ${inside}`)
    }
    expect(bad).toEqual([])
  })

  test("every walk (the loop, out of the door, home, to the festival) is clear and on dry ground", () => {
    const bad: string[] = []
    for (const npc of TOWNSFOLK)
      for (const walk of trips(npc)) {
        const points = along(walk.path)
        const at = points.find((p) => blocker(p, TOWN_OBSTACLES, BODY * 0.6) || !ground(p))
        if (at)
          bad.push(
            `${npc.id} → ${walk.to} at [${at.map((v) => v.toFixed(1))}]: ${blocker(at, TOWN_OBSTACLES, BODY * 0.6)?.name ?? "off the ground"}`,
          )
      }
    expect(bad).toEqual([])
  })

  test("no two of them share a standing spot, nor stand on an agent's work spot", () => {
    const bad: string[] = []
    const all = TOWNSFOLK.flatMap((npc) => stands(npc).map((s) => ({ ...s, id: npc.id })))
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i]
        const b = all[j]
        if (!a || !b || a.id === b.id) continue
        const apart = Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1])
        if (apart < 1.2) bad.push(`${a.id} ${a.name} / ${b.id} ${b.name}: ${apart.toFixed(2)}`)
      }
    const gathers = TOWNSFOLK.map((n) => ({ id: n.id, at: gatherOf(n) }))
    for (let i = 0; i < gathers.length; i++)
      for (let j = i + 1; j < gathers.length; j++) {
        const a = gathers[i]
        const b = gathers[j]
        if (a && b && Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1]) < 1.2)
          bad.push(`gather ${a.id} / ${b.id}`)
      }
    const work: Spot[] = (Object.keys(SITES) as SiteId[]).flatMap((id) =>
      SITES[id].posts.flatMap((post, berth) => Object.values(spotsOf(SITE_WORK[id], post, berth))),
    )
    for (const s of all)
      for (const w of work)
        if (Math.hypot(s.at[0] - w[0], s.at[1] - w[1]) < 2) bad.push(`${s.id} ${s.name} on an agent's spot`)
    expect(bad).toEqual([])
  })

  test("called away (dusk, rain, a festival), a nearby loop is back at the post within seconds", () => {
    for (const npc of TOWNSFOLK.filter((n) => n.work.steer)) {
      const routine = new Routine(placeOfNpc(npc), seedOf(npc.id))
      const dt = 1 / 20
      let worst = 0
      // Called away at many moments of the loop: how long until they stand at the post, hands free?
      for (let start = 5; start < 120; start += 7) {
        routine.reset()
        let t = 0
        let aim = routine.aim
        let walked = 0
        const walking = () => routine.started && routine.clip === null && walked < 1
        for (; t < start; t += dt) {
          if (routine.aim !== aim) {
            aim = routine.aim
            walked = 0
          }
          walked += dt
          routine.update(dt, { thinking: true, tool: undefined, arrived: !walking() })
        }
        let waited = 0
        while (!(routine.atPost && !walking() && routine.held === null) && waited < 60) {
          if (routine.aim !== aim) {
            aim = routine.aim
            walked = 0
          }
          walked += dt
          routine.update(dt, { thinking: true, tool: CALLED_AWAY, arrived: !walking() })
          waited += dt
        }
        worst = Math.max(worst, waited)
      }
      expect({ id: npc.id, slow: worst > 8 }).toEqual({ id: npc.id, slow: false })
    }
  })

  test("each routine runs its whole loop: nobody gets stuck", () => {
    for (const npc of TOWNSFOLK) {
      const routine = new Routine(placeOfNpc(npc), seedOf(npc.id))
      const seen = new Set<string>()
      const dt = 1 / 20
      let aim = routine.aim
      let walked = 0
      for (let t = 0; t < 900; t += dt) {
        if (routine.aim !== aim) {
          aim = routine.aim
          walked = 0
        }
        walked += dt
        const walking = routine.started && routine.clip === null && walked < 1
        routine.update(dt, { thinking: true, tool: undefined, arrived: !walking })
        const step = routine.step
        if (step && routine.source === "loop") seen.add("walk" in step ? `walk ${step.walk}` : step.clip)
      }
      const every = new Set(npc.work.loop.map((s) => ("walk" in s ? `walk ${s.walk}` : s.clip)))
      expect({ id: npc.id, missed: [...every].filter((s) => !seen.has(s)) }).toEqual({
        id: npc.id,
        missed: [],
      })
    }
  })

  test("what they carry and the tools of their trade find a bone to ride on", () => {
    const body = new Group()
    for (const node of ANIMS.nodes ?? []) {
      const bone = new Bone()
      bone.name = node.name ? node.name.replace(/[[\]./:]/g, "").replace(/\s/g, "_") : ""
      body.add(bone)
    }
    for (const npc of TOWNSFOLK) {
      const hands = attachHands(body, npc.work)
      const takes = new Set(stepsOf(npc.work).flatMap((s) => ("clip" in s && s.take ? [s.take] : [])))
      const attached = body.children.reduce((n, bone) => n + bone.children.length, 0)
      expect({ id: npc.id, attached }).toEqual({ id: npc.id, attached: takes.size + (npc.work.tool ? 1 : 0) })
      hands.dispose()
    }
  })
})

describe("their day", () => {
  const npc = (id: string) => TOWNSFOLK.find((n) => n.id === id) as Townsperson
  const day = { night: false, rain: false, festival: false }

  test("by day they work; at night most go home, the guards stay out and the watchman comes out", () => {
    expect(errandOf(npc("farmer"), day)).toBe("work")
    expect(errandOf(npc("watchman"), day)).toBe("home")
    const night = { ...day, night: true }
    expect(errandOf(npc("farmer"), night)).toBe("home")
    expect(errandOf(npc("guard-west"), night)).toBe("work")
    expect(errandOf(npc("watchman"), night)).toBe("work")
    const out = TOWNSFOLK.filter((n) => errandOf(n, night) !== "home").map((n) => n.id)
    expect(out.sort()).toEqual(["guard-east", "guard-west", "watchman"])
    for (const id of out) expect(npc(id).lantern).toBe(true)
  })

  test("rain sends people home, the merchants under their stalls' eaves; the guards stand on", () => {
    const rain = { ...day, rain: true }
    expect(errandOf(npc("fisher"), rain)).toBe("home")
    expect(errandOf(npc("child-a"), rain)).toBe("home")
    expect(errandOf(npc("merchant-blue"), rain)).toBe("shelter")
    expect(errandOf(npc("guard-east"), rain)).toBe("work")
    expect(raining("rain")).toBe(true)
    expect(raining("storm")).toBe(true)
    expect(raining("snow")).toBe(false)
    expect(raining("cloudy")).toBe(false)
  })

  test("a festival brings everyone out, night or rain; the village gathers on the square", () => {
    for (const n of TOWNSFOLK)
      expect(errandOf(n, { night: true, rain: true, festival: true })).toBe("festival")
    const rallied = TOWNSFOLK.filter((n) => n.rally.length > 0)
    expect(rallied.length).toBeGreaterThanOrEqual(6)
    for (const n of rallied) expect(Math.hypot(gatherOf(n)[0], gatherOf(n)[1] - 33)).toBeLessThan(6)
  })

  test("night falls at dusk and lifts only once it is properly light (no flicker at dawn)", () => {
    expect(nightOf(0.5, false)).toBe(false)
    expect(nightOf(0.29, false)).toBe(true)
    expect(nightOf(0.35, true)).toBe(true)
    expect(nightOf(0.35, false)).toBe(false)
    expect(nightOf(0.43, true)).toBe(false)
  })

  /** Runs a day: each update arrives at once (walks take no time) unless `walking` says not. */
  function step(day: Day, errand: Errand, free = true): void {
    day.update(errand, true, free)
  }

  test("on load they are already about their day: at home, or at the post at work", () => {
    expect(new Day(npc("farmer"), "home").phase).toBe("indoors")
    // Indoors: inside their doorway, unseen.
    const home = new Day(npc("farmer"), "home")
    expect(home.start).toEqual(home.doorway.sill)
    expect(home.shown).toBe(false)
    expect(new Day(npc("farmer"), "work").phase).toBe("work")
    expect(new Day(npc("merchant-blue"), "shelter").phase).toBe("post")
  })

  test("they leave the loop only back at the post with empty hands, then walk the way home", () => {
    const keeper = npc("keeper")
    const day = new Day(keeper, "work")
    day.update("home", false, false)
    expect(day.phase).toBe("work")
    day.update("home", false, true)
    expect(day.phase).toBe("in")
    expect(day.path).toEqual([...[...keeper.way].reverse(), keeper.door])
    day.update("home", false, true)
    expect(day.phase).toBe("in")
    // At the door: they stop and face it (no path), still seen, until it opens.
    step(day, "home")
    expect(day.phase).toBe("enter")
    expect(day.path).toEqual([])
    expect(day.shown).toBe(true)
    day.update("home", true, true, DOOR_PAUSE_S / 2)
    expect(day.opened).toBe(0)
    expect(day.shown).toBe(true)
    // The door opens (its sound): they step in through the doorway, dissolving.
    day.update("home", true, true, DOOR_PAUSE_S)
    expect(day.opened).toBe(1)
    expect(day.path).toEqual([day.doorway.sill])
    expect(day.shown).toBe(false)
    day.update("home", false, true, 0.1)
    expect(day.phase).toBe("enter")
    step(day, "home")
    expect(day.phase).toBe("indoors")
    // Dawn: after the housemates ahead of them, the door opens again and they step out of the
    // doorway (dissolving in), then walk out.
    day.update("work", true, true, staggerOf(keeper) - 0.1)
    expect(day.phase).toBe("indoors")
    day.update("work", true, true, 0.2)
    expect(day.phase).toBe("exit")
    expect(day.opened).toBe(2)
    expect(day.path).toEqual([keeper.door])
    expect(day.shown).toBe(true)
    step(day, "work")
    expect(day.phase).toBe("out")
    expect(day.path).toEqual([...keeper.way, [keeper.post[0], keeper.post[1]]])
    step(day, "work")
    expect(day.phase).toBe("work")
  })

  test("a merchant shelters at the stall in the rain and goes back to work after", () => {
    const day = new Day(npc("merchant-blue"), "work")
    step(day, "shelter")
    expect(day.phase).toBe("post")
    step(day, "shelter")
    expect(day.phase).toBe("post")
    step(day, "work")
    expect(day.phase).toBe("work")
  })

  test("at a festival they rally to the square, cheer, and walk back when it ends", () => {
    const merchant = npc("merchant-red")
    const day = new Day(merchant, "work")
    step(day, "festival")
    expect(day.phase).toBe("rally")
    const trip = day.trip
    step(day, "festival")
    expect(day.phase).toBe("cheer")
    step(day, "festival")
    expect(day.phase).toBe("cheer")
    step(day, "work")
    expect(day.phase).toBe("back")
    expect(day.trip).toBe(trip + 1)
    expect(day.path.at(-1)).toEqual([merchant.post[0], merchant.post[1]])
    step(day, "work")
    expect(day.phase).toBe("work")
    // No rally: they cheer at their post (the farmer in the field).
    const farmer = new Day(npc("farmer"), "work")
    step(farmer, "festival")
    expect(farmer.phase).toBe("post")
    step(farmer, "festival")
    expect(farmer.phase).toBe("post")
  })

  test("housemates come out of their shared door one after another", () => {
    const house = TOWNSFOLK.filter(
      (n) => n.door === npc("well").door || String(n.door) === String(npc("well").door),
    )
    expect(house.map((n) => n.id)).toEqual(["well", "child-a", "child-b", "keeper"])
    const after = house.map(staggerOf)
    expect(after[0]).toBe(0)
    for (let i = 1; i < after.length; i++)
      expect((after[i] ?? 0) - (after[i - 1] ?? 0)).toBeCloseTo(DOOR_STAGGER_S)
    // The first out goes at once.
    const first = new Day(npc("well"), "home")
    first.update("work", true, true, 0)
    expect(first.phase).toBe("exit")
  })

  test("called back out before the door opens, they turn round without going in", () => {
    const farmer = npc("farmer")
    const day = new Day(farmer, "work")
    day.update("home", true, true)
    step(day, "home")
    expect(day.phase).toBe("enter")
    day.update("work", true, true, 0.1)
    expect(day.phase).toBe("out")
    expect(day.opened).toBe(0)
    expect(day.shown).toBe(true)
  })

  test("a festival at night brings them out of the door and on to the square", () => {
    const day = new Day(npc("well"), "home")
    step(day, "festival")
    expect(day.phase).toBe("exit")
    step(day, "festival")
    expect(day.phase).toBe("out")
    step(day, "festival")
    expect(day.phase).toBe("rally")
  })
})
