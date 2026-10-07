import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { applyAll, type Change, emptyModel, type Model } from "@guildhall/core"
import { party as partyScenario } from "@guildhall/sim"
import {
  Bone,
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  ShaderMaterial,
  Skeleton,
  SkinnedMesh,
} from "three"
import { stageOf } from "../src/guild/parties.ts"
import {
  AVENUE_END,
  DAIS_SPREAD,
  EXIT_MS,
  entranceOf,
  exitOf,
  GuildStore,
  ROAD_SPREAD,
  viewsOf,
} from "../src/guild/store.ts"
import { DISCARD_GLSL, Dissolver, ditherAt, ditherShader, Fade } from "../src/scene/dissolve.ts"
import { DOOR_OF, DOORWAYS, doorwayOf, errandOf, TOWNSFOLK } from "../src/scene/life/rounds.ts"
import { MAP_FOR_TESTS as MAP } from "../src/world/lands.ts"
import { HAND_INS, type Spot } from "../src/world/layout.ts"
import { route } from "../src/world/paths.ts"
import { along, BODY, blocker, KEEP_OBSTACLES, TOWN_OBSTACLES } from "./support/clearance.ts"

/**
 * Arrivals and departures with a reason and a path: newcomers walk in from the avenue or are
 * summoned beside their guildmaster, leavers walk out down the avenue and dissolve, townsfolk go in
 * and out by their real doors, and nothing pops or shrinks (scene/dissolve.ts).
 */

const GONE_MS = 27_000
const REST_MS = 22_000

/** The model as it stood at run time `t`. */
function at(changes: Change[], t: number): Model {
  return applyAll(
    emptyModel(),
    changes.filter((c) => c.at <= t),
  )
}

/** The far ends of a spread: a spot ± `spread` across `facing`. */
function spreadOf(x: number, z: number, facing: number, spread: number): Spot[] {
  return [-1, 1].map(
    (side): Spot => [x + Math.cos(facing) * side * spread, z - Math.sin(facing) * side * spread],
  )
}

/** Points along the walk from `from` to `to`, as an adventurer routes it. */
const walkOf = (from: Spot, to: Spot): Spot[] => along([from, ...route(from, to)])

describe("arrivals: where newcomers come from", () => {
  const changes = partyScenario()
  const first = (id: string) => changes.find((c) => c.id === id)?.at ?? 0
  const sub = changes.find((c) => c.type === "session" && c.parentID)?.id as string
  const root = changes.find((c) => c.type === "session" && !c.parentID)?.id as string
  const t = first(sub) + 200
  const m = at(changes, t)
  const stage = stageOf(m, t)

  test("a dispatched subagent is summoned beside its guildmaster, facing them", () => {
    const views = viewsOf(m, t, undefined, stage, new Set([sub]))
    const enter = views.find((v) => v.id === sub)?.enter
    expect(enter?.kind).toBe("dais")
    const [x, z, facing] = HAND_INS[0] ?? [0, 0, 0]
    expect(Math.hypot((enter?.at[0] ?? 99) - x, (enter?.at[1] ?? 99) - z)).toBeLessThanOrEqual(
      DAIS_SPREAD + 1e-9,
    )
    expect(enter?.at[2]).toBe(facing)
  })

  test("a new conversation's guildmaster walks in from out on the avenue, facing the keep", () => {
    const party = stage[0]
    if (!party) throw new Error("no party")
    const enter = entranceOf(root, party, true)
    expect(enter.kind).toBe("gate")
    expect(Math.abs(enter.at[0] - AVENUE_END[0])).toBeLessThanOrEqual(ROAD_SPREAD)
    expect(enter.at[1]).toBe(AVENUE_END[1])
    expect(enter.at[2]).toBe(Math.PI)
    // With no guildmaster on stage to send them, a subagent comes from the avenue too.
    expect(entranceOf(sub, { ...party, root: undefined }, false).kind).toBe("gate")
    expect(entranceOf(sub, { ...party, leaving: true }, false).kind).toBe("gate")
  })

  test("only those named as entering get an entrance: everyone else is at their post", () => {
    expect(viewsOf(m, t, undefined, stage).every((v) => !v.enter)).toBe(true)
  })

  test("the avenue's ends and the summoning spots are on the road / floor, clear of everything", () => {
    const bad: string[] = []
    for (const spot of spreadOf(AVENUE_END[0], AVENUE_END[1], Math.PI, ROAD_SPREAD)) {
      if (MAP.at(MAP.cellOf(spot)) !== "=") bad.push(`avenue end [${spot}] off the road`)
      const blocked = blocker(spot, TOWN_OBSTACLES)?.name
      if (blocked) bad.push(`avenue end [${spot}]: ${blocked}`)
    }
    for (const [x, z, facing] of HAND_INS)
      for (const spot of spreadOf(x, z, facing, DAIS_SPREAD)) {
        const blocked = blocker(spot, KEEP_OBSTACLES)?.name
        if (blocked) bad.push(`summoning spot [${spot}]: ${blocked}`)
      }
    expect(bad).toEqual([])
  })

  test("from the avenue they walk in through the keep's gate, along the roads, clear of the village", () => {
    const station: Spot = [-14.5, -8.4]
    for (const side of [-1, 1]) {
      const from: Spot = [AVENUE_END[0] + side * ROAD_SPREAD, AVENUE_END[1]]
      const path = route(from, station)
      expect(path.at(-1)).toEqual(station)
      expect(path.some((p) => p[0] === 0 && p[1] > 13 && p[1] < 14)).toBe(true)
      const outside = walkOf(from, station).filter((p) => p[1] > 13)
      expect(outside.find((p) => blocker(p, TOWN_OBSTACLES, BODY * 0.6))).toBeUndefined()
    }
  })
})

describe("arrivals: nobody walks in on a load or a seek", () => {
  test("loaded, then sought: everyone stands at their post; a live join later walks in", () => {
    const store = new GuildStore()
    store.setBard(false)
    store.tick(16)
    expect(store.views.every((v) => !v.enter)).toBe(true)
    store.seek(20_000)
    expect(store.views.length).toBeGreaterThan(1)
    expect(store.views.every((v) => !v.enter)).toBe(true)
    store.tick(16)
    expect(store.views.every((v) => !v.enter)).toBe(true)
    // Back to the start and played on: the next one to join is news, and comes on with an entrance.
    store.seek(0)
    const before = new Set(store.views.map((v) => v.id))
    let joined: (typeof store.views)[number] | undefined
    for (let i = 0; i < 400 && !joined; i++) {
      store.tick(100)
      joined = store.views.find((v) => !before.has(v.id))
    }
    expect(joined?.enter).toBeDefined()
    expect(store.views.filter((v) => before.has(v.id)).every((v) => !v.enter)).toBe(true)
    // A seek forgets it: rebuilt, they simply stand where they belong.
    store.seek(store.time)
    expect(store.views.every((v) => !v.enter)).toBe(true)
  })
})

describe("departures: out of the gate and down the avenue", () => {
  const changes = partyScenario()
  // The first subagent to finish.
  const leaver = changes.find(
    (c) =>
      c.type === "status" &&
      c.status === "idle" &&
      changes.some((s) => s.id === c.id && "parentID" in s && s.parentID),
  )
  const ended = leaver?.at ?? 0
  const viewAt = (t: number) => viewsOf(at(changes, t), t).find((v) => v.id === leaver?.id)

  test("a leaver walks to the avenue's end (not the gate), and stays on stage to dissolve there", () => {
    expect(leaver).toBeDefined()
    const leaving = viewAt(ended + REST_MS + 500)
    expect(leaving?.phase).toBe("leaving")
    expect(leaving?.target).toEqual(exitOf(leaver?.id ?? ""))
    expect(leaving?.target[1]).toBe(AVENUE_END[1])
    // Past GONE_MS (through the gate) still walking down the avenue; gone EXIT_MS later.
    expect(viewAt(ended + GONE_MS + 1000)?.phase).toBe("leaving")
    expect(viewAt(ended + GONE_MS + EXIT_MS + 1000)).toBeUndefined()
  })

  test("the way out from the tavern goes through the gate, clear of the village", () => {
    const from: Spot = [3.2, 6.4]
    const out = exitOf("ses_any")
    const path = route(from, [out[0], out[1]])
    expect(path.some((p) => p[0] === 0 && p[1] > 13 && p[1] < 14)).toBe(true)
    const outside = walkOf(from, [out[0], out[1]]).filter((p) => p[1] > 13)
    expect(outside.find((p) => blocker(p, TOWN_OBSTACLES, BODY * 0.6))).toBeUndefined()
  })
})

describe("the dissolve", () => {
  test("a fade eases linearly to its goal in the time given, and says which way it is going", () => {
    const fade = new Fade(0)
    expect(fade.state).toBe("gone")
    fade.step(1, 0.2, 0.4)
    expect(fade.value).toBeCloseTo(0.5)
    expect(fade.state).toBe("appearing")
    fade.step(1, 1, 0.4)
    expect(fade.value).toBe(1)
    expect(fade.state).toBe("shown")
    fade.step(0, 0.1, 0.8)
    expect(fade.value).toBeCloseTo(0.875)
    expect(fade.state).toBe("vanishing")
    // Turned round mid-fade: it goes back from where it is, never jumps.
    fade.step(1, 0.05, 0.8)
    expect(fade.value).toBeCloseTo(0.9375)
    fade.step(0, 10, 0.8)
    expect(fade.state).toBe("gone")
    // A zero-length fade (reduced motion taken to the limit) still lands, without dividing by zero.
    expect(new Fade(0).step(1, 0.016, 0)).toBe(1)
  })

  test("the dither has 16 levels in [0, 1): whole draws every pixel, gone none, half about half", () => {
    const levels = new Set<number>()
    let half = 0
    for (let x = 0; x < 4; x++)
      for (let y = 0; y < 4; y++) {
        const t = ditherAt(x + 0.5, y + 0.5)
        levels.add(t)
        expect(t).toBeGreaterThanOrEqual(0)
        expect(t).toBeLessThan(1)
        if (t < 0.5) half++
      }
    expect(levels.size).toBe(16)
    expect(half).toBe(8)
    // The pattern repeats every 4 pixels.
    expect(ditherAt(5.5, 6.5)).toBe(ditherAt(1.5, 2.5))
  })

  test("the shader discards first thing in main(), and only while not whole", () => {
    const out = ditherShader("uniform float a;\nvoid main() {\n\tgl_FragColor = vec4(1.0);\n}")
    expect(out).toContain("uniform float uDissolve;")
    expect(out.indexOf(DISCARD_GLSL)).toBeGreaterThan(out.indexOf("void main() {"))
    expect(out.indexOf(DISCARD_GLSL)).toBeLessThan(out.indexOf("gl_FragColor"))
    expect(DISCARD_GLSL).toContain("uDissolve < 1.0")
  })

  test("partly there, everything under the root wears a dithered copy; whole, its own again", () => {
    const own = new MeshStandardMaterial()
    const gear = new MeshStandardMaterial()
    const ring = new MeshBasicMaterial()
    const special = new ShaderMaterial()
    const bone = new Bone()
    const body = new SkinnedMesh(new BoxGeometry(), own)
    body.add(bone)
    body.bind(new Skeleton([bone]))
    const held = new Mesh(new BoxGeometry(), gear)
    bone.add(held)
    const root = new Group()
    root.add(body, new Mesh(new BoxGeometry(), ring), new Mesh(new BoxGeometry(), special))
    const meshes = () => root.children.map((c) => (c as Mesh).material).concat([held.material])
    const dissolver = new Dissolver()

    // Whole: nothing changes, nothing is copied.
    dissolver.set(root, 1)
    expect(meshes()).toEqual([own, ring, special, gear])
    expect(dissolver.active).toBe(false)

    dissolver.set(root, 0.5)
    const [a, b, c, d] = meshes()
    expect(a).not.toBe(own)
    expect(b).not.toBe(ring)
    expect(c).toBe(special) // its uniforms are its own: left alone
    expect(d).not.toBe(gear)
    expect(a?.customProgramCacheKey()).toContain("dissolve")
    expect(dissolver.amount.value).toBe(0.5)
    // The next frame of the fade reuses the same copies.
    dissolver.set(root, 0.3)
    expect(meshes()[0]).toBe(a as MeshStandardMaterial)

    dissolver.set(root, 1)
    expect(meshes()).toEqual([own, ring, special, gear])
    expect(dissolver.active).toBe(false)

    // Unmounted mid-fade: the originals are put back before anyone frees them.
    dissolver.set(root, 0.2)
    dissolver.dispose(root)
    expect(meshes()).toEqual([own, ring, special, gear])
  })

  test("the copy's shader gets the shared presence uniform and keeps the original's own patch", () => {
    const original = new MeshStandardMaterial()
    let patched = 0
    original.onBeforeCompile = () => {
      patched++
    }
    const dissolver = new Dissolver()
    const mesh = new Mesh(new BoxGeometry(), original)
    dissolver.set(mesh, 0.4)
    const copy = mesh.material as MeshStandardMaterial
    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      fragmentShader: "void main() {\n}",
      vertexShader: "",
    }
    copy.onBeforeCompile(shader as never, undefined as never)
    expect(patched).toBe(1)
    expect(shader.uniforms.uDissolve).toBe(dissolver.amount)
    expect(shader.fragmentShader).toContain("discard")
    dissolver.dispose(mesh)
  })
})

describe("townsfolk at their real doors", () => {
  /** Who ever goes home (their hours or the rain send them in). */
  const homebodies = TOWNSFOLK.filter(
    (npc) =>
      errandOf(npc, { night: true, rain: false, festival: false }) === "home" ||
      errandOf(npc, { night: false, rain: true, festival: false }) === "home" ||
      errandOf(npc, { night: false, rain: false, festival: false }) === "home",
  )

  test("everyone who goes indoors has a door that is a real house's door", () => {
    expect(homebodies.length).toBeGreaterThanOrEqual(10)
    const bad = homebodies.filter((npc) => !doorwayOf(npc.door)).map((npc) => `${npc.id} [${npc.door}]`)
    expect(bad).toEqual([])
  })

  test("the gate guards, whose 'door' is the keep's gate, never go in", () => {
    for (const id of ["guard-west", "guard-east"]) expect(homebodies.some((n) => n.id === id)).toBe(false)
  })

  test("a door's step is just off its house's front, on its door's side; the sill is in the doorway", () => {
    for (const door of DOORWAYS) {
      const { house } = door
      const rot = house.rot ?? 0
      const scale = house.scale ?? 1
      const type = /home_([AB])/.exec(house.piece)?.[1] as "A" | "B"
      // Back into the house's own frame.
      const local = ([x, z]: Spot): Spot => {
        const dx = (x - house.x) / scale
        const dz = (z - house.z) / scale
        return [dx * Math.cos(rot) - dz * Math.sin(rot), dx * Math.sin(rot) + dz * Math.cos(rot)]
      }
      const step = local(door.step)
      const sill = local(door.sill)
      expect(step[0]).toBeCloseTo(DOOR_OF[type].x, 1)
      expect(sill[0]).toBeCloseTo(DOOR_OF[type].x, 1)
      // The front face is +z (lands.json: home A to 0.385, home B's steps to 0.56, × HEX_SCALE 5).
      const front = type === "A" ? 0.385 * 5 : 0.56 * 5
      expect(step[1]).toBeGreaterThan(front)
      expect(step[1]).toBeLessThan(front + 0.6)
      expect(sill[1]).toBeLessThan(front)
      // Facing the door is facing back into the house.
      expect(Math.cos(door.inward - rot)).toBeCloseTo(-1)
    }
  })

  test("each door's step stands clear of its house (and everything else)", () => {
    const bad: string[] = []
    for (const npc of homebodies) {
      const blocked = blocker(npc.door, TOWN_OBSTACLES, 0.1)?.name
      if (blocked) bad.push(`${npc.id}: ${blocked}`)
    }
    expect(bad).toEqual([])
  })
})

describe("no scale tricks left", () => {
  const source = (path: string) => readFileSync(join(import.meta.dir, "../src", path), "utf8")

  test("characters come and go by dissolving: nobody's scale is driven by presence or distance", () => {
    for (const file of ["scene/Adventurer.tsx", "scene/life/Villagers.tsx", "scene/Undead.tsx"]) {
      const code = source(file)
      // The only setScalar left is the townsfolk's lantern, sized once when the body is built.
      const calls = code.match(/[\w.]+\.scale\.setScalar\(/g) ?? []
      expect({ file, calls: calls.filter((c) => c !== "lantern.scale.setScalar(") }).toEqual({
        file,
        calls: [],
      })
      expect(code).not.toMatch(/presence\s*\*\s*\(?npc\.scale|scale\.setScalar\([^)]*presence/)
      expect(code).toContain("Dissolver")
    }
  })
})
