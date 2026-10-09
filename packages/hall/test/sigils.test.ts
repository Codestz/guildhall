import { afterAll, afterEach, describe, expect, test } from "bun:test"
import { CRAFTS, craftOf } from "@guildhall/core"
import { Object3D, OrthographicCamera, Vector3 } from "three"
import type { Moment } from "../src/guild/moments.ts"
import { type AdventurerView, GuildStore } from "../src/guild/store.ts"
import { verbOf } from "../src/hud/format.ts"
import { addChip, chipSlot, layout, resetChips } from "../src/scene/chips.ts"
import {
  MAX_BURSTS,
  MAX_PARTICLES,
  MAX_SIGILS,
  PER_BURST,
  SigilBoard,
  sigilOf,
  sigilOfCraft,
} from "../src/scene/sigilBoard.ts"
import { SIGIL_MAX_PX, SIGIL_MIN_PX, sigilRoom, sizeFor } from "../src/scene/sigilSize.ts"

/** A view with just what the sigils read; working on nothing unless told (a tool's craft as the store reads it). */
function view(id: string, patch: Partial<AdventurerView> = {}): AdventurerView {
  return {
    ...(patch.tool ? { craft: craftOf(patch.tool) } : {}),
    id,
    agent: "guild-implementer",
    title: id,
    role: "Implementer",
    ordinal: 1,
    color: "#e0884a",
    character: "barbarian",
    master: false,
    phase: "working",
    target: [0, 0, 0],
    thinking: false,
    doing: "",
    stung: false,
    ...patch,
  }
}

function deed(id: string, tool: string, failed = false): Moment {
  return {
    id,
    agent: "guild-implementer",
    title: id,
    color: "#e0884a",
    master: "m",
    seq: 1,
    at: 0,
    live: true,
    kind: failed ? "deed-failed" : "deed",
    tool,
    call: "c",
  } as Moment
}

// 20 world units across 200 px, looking down -z.
const camera = new OrthographicCamera(-10, 10, 10, -10, 0.1, 100)
camera.position.set(0, 0, 50)
camera.updateMatrixWorld()
camera.updateProjectionMatrix()

/** A board with every view placed on the ground, and synced. */
function boardWith(views: AdventurerView[]): { board: SigilBoard; positions: Map<string, Vector3> } {
  const positions = new Map<string, Vector3>()
  views.forEach((v, i) => {
    positions.set(v.id, new Vector3(i % 10, 0, -Math.floor(i / 10)))
  })
  const board = new SigilBoard(positions)
  board.sync(views)
  return { board, positions }
}

/** Runs the board for `seconds` in 1/60 s frames. */
function run(board: SigilBoard, seconds: number, from = board.now): void {
  for (let t = 0; t < seconds; t += 1 / 60) board.step(1 / 60, from + t)
}

afterEach(resetChips)

describe("sigils: which kind a view shows", () => {
  test("each craft maps to the sigil the brief names", () => {
    const sigil = (tool: string, command?: string) => sigilOfCraft(craftOf(tool, command ? { command } : {}))
    expect(sigil("read")).toBe("read")
    expect(sigil("edit")).toBe("edit")
    expect(sigil("write")).toBe("edit")
    expect(sigil("grep")).toBe("search")
    expect(sigil("glob")).toBe("search")
    expect(sigil("bash", "bun test src")).toBe("test")
    expect(sigil("bash", "bun run typecheck")).toBe("test")
    expect(sigil("bash", "git status")).toBe("run")
    expect(sigil("task")).toBe("dispatch")
    expect(sigil("webfetch")).toBe("consult")
    expect(sigil("websearch")).toBe("consult")
    expect(sigil("context7_query-docs")).toBe("consult")
    expect(sigil("todowrite")).toBe("think")
    expect(sigil("something-new")).toBe("work")
  })

  test("thinking with no deed shows the thought cloud", () => {
    expect(sigilOf(view("a", { thinking: true }))).toBe("think")
  })

  test("the sigil always agrees with the name chip's glyph (one language)", () => {
    const pairs: Record<string, string> = {
      read: "read",
      edit: "edit",
      search: "search",
      test: "test",
      run: "run",
      summon: "dispatch",
      thought: "think",
      globe: "consult",
      work: "work",
    }
    for (const craft of CRAFTS) {
      const v = view("a", { tool: "t", craft })
      expect(sigilOf(v)).toBe(pairs[verbOf(v).glyph] as never)
    }
  })
})

describe("sigils: when they show", () => {
  test("only at work on a deed or thinking", () => {
    expect(sigilOf(view("a", { tool: "read" }))).toBe("read")
    // Walking to a station with no deed, or just arriving: nothing.
    expect(sigilOf(view("a"))).toBeNull()
    expect(sigilOf(view("a", { doing: "starting" }))).toBeNull()
  })

  test("never while resting, idle, leaving, bringing loot, fallen or pleading", () => {
    for (const phase of ["resting", "idle", "leaving", "loot", "failed", "waiting"] as const) {
      expect(sigilOf(view("a", { phase, tool: "read", thinking: true }))).toBeNull()
    }
  })

  test("fades in and out, never pops in", () => {
    const { board } = boardWith([view("a", { tool: "read" })])
    run(board, 1 / 60)
    board.write(camera)
    const first = board.sigils.state[1] ?? 0
    expect(first).toBeGreaterThan(0)
    expect(first).toBeLessThan(0.2)
    run(board, 0.5)
    board.write(camera)
    expect(board.sigils.state[1]).toBe(1)
    board.sync([view("a", { phase: "resting" })])
    run(board, 0.1)
    expect(board.write(camera)).toBe(1)
    expect(board.sigils.state[1]).toBeLessThan(1)
    run(board, 0.5)
    expect(board.write(camera)).toBe(0)
  })

  test("a new deed swaps the glyph quickly, so a busy agent's sigil is never left dim", () => {
    const { board } = boardWith([view("a", { tool: "read" })])
    run(board, 0.5)
    board.sync([view("a", { tool: "edit" })])
    run(board, 0.3)
    board.write(camera)
    expect(board.sigils.state[0]).toBe(1) // edit's cell
    expect(board.sigils.state[1]).toBeGreaterThan(0.9)
  })

  test("the Settings toggle hides them all, and no deed pops while off", () => {
    const { board } = boardWith([view("a", { tool: "read" }), view("b", { thinking: true })])
    run(board, 0.5)
    expect(board.write(camera)).toBe(2)
    board.on = false
    board.take(deed("a", "read"))
    run(board, 0.5)
    expect(board.write(camera)).toBe(0)
    expect(board.liveParticles()).toBe(0)
  })

  test("a failure that ends the session still puffs, then the sigil fades", () => {
    const { board } = boardWith([view("a", { tool: "bash", craft: "test", doing: "bash · bun test" })])
    run(board, 0.5)
    board.take(deed("a", "bash", true))
    board.sync([view("a", { phase: "failed" })])
    run(board, 0.1)
    expect(board.write(camera)).toBe(1)
    // The failed deed's own kind (a test run), washed in the failure colour.
    expect(board.sigils.state[0]).toBe(3)
    expect(board.sigils.flash[3]).toBeGreaterThan(0)
    expect(board.liveParticles()).toBeGreaterThan(0)
    run(board, 1.5)
    expect(board.write(camera)).toBe(0)
  })
})

describe("sigils: pops are news only", () => {
  const stores: GuildStore[] = []
  afterAll(() => {
    for (const store of stores) store.load("party")
  })

  /** A store playing `party`, with a board hung on its live moments as the scene does. */
  function watched() {
    const store = new GuildStore()
    stores.push(store)
    const positions = new Map<string, Vector3>()
    const board = new SigilBoard(positions)
    let pops = 0
    store.moments.on((moment) => {
      if (moment.kind === "deed" || moment.kind === "deed-failed") pops++
      board.take(moment)
    })
    store.moments.onRebuild(() => board.rebuild())
    const place = () => {
      for (const v of store.views) if (!positions.has(v.id)) positions.set(v.id, new Vector3())
      board.sync(store.views)
    }
    return { store, board, place, pops: () => pops }
  }

  test("a seek rebuilds history without a single burst; live play does burst", () => {
    const { store, board, place, pops } = watched()
    place()
    store.seek(store.duration * 0.8)
    place()
    run(board, 0.05, 10)
    expect(pops()).toBe(0)
    expect(board.liveParticles()).toBe(0)

    // Back to the start and played live: deeds finish as the hall watches, and pop.
    store.seek(0)
    let now = 20
    while (pops() === 0 && store.time < store.duration) {
      store.tick(50)
      place()
      now += 0.05
      board.step(0.05, now)
    }
    expect(pops()).toBeGreaterThan(0)
  })

  test("a seek mid-burst clears what is in the air", () => {
    const { board } = boardWith([view("a", { tool: "read" })])
    run(board, 0.5)
    board.take(deed("a", "read"))
    expect(board.liveParticles()).toBeGreaterThan(0)
    board.rebuild()
    expect(board.liveParticles()).toBe(0)
    board.write(camera)
    expect(board.sigils.flash[3]).toBe(0)
  })
})

describe("sigils: instance caps", () => {
  test("never more sigils than the mesh holds, the nearest kept", () => {
    const views = Array.from({ length: 45 }, (_, i) => view(`v${i}`, { tool: "read" }))
    const { board } = boardWith(views)
    run(board, 0.5)
    expect(board.write(camera)).toBe(MAX_SIGILS)
    expect(board.sigils.state.length).toBe(MAX_SIGILS * 4)
  })

  test("bursts reuse a fixed pool: never more particles than the mesh holds", () => {
    const views = Array.from({ length: 30 }, (_, i) => view(`v${i}`, { tool: "edit" }))
    const { board } = boardWith(views)
    run(board, 0.5)
    for (const v of views) board.take(deed(v.id, "edit"))
    for (const v of views) board.take(deed(v.id, "edit", true))
    expect(board.liveParticles()).toBeLessThanOrEqual(MAX_PARTICLES)
    // The pool holds the newest MAX_BURSTS bursts: here twelve failure puffs (0.8 × sparks each).
    expect(board.liveParticles()).toBe(MAX_BURSTS * Math.min(PER_BURST, Math.round(board.sparks * 0.8)))
    expect(board.bursts.motion.length).toBe(MAX_PARTICLES * 4)
  })

  test("the Low tier spends fewer particles a burst", () => {
    const { board } = boardWith([view("a", { tool: "edit" })])
    board.sparks = 6
    board.take(deed("a", "edit"))
    expect(board.liveParticles()).toBe(6)
  })

  test("reduced motion: the rim still flashes, but nothing bursts", () => {
    const { board } = boardWith([view("a", { tool: "edit" })])
    run(board, 0.5)
    board.still = true
    board.take(deed("a", "edit"))
    run(board, 0.1)
    board.write(camera)
    expect(board.liveParticles()).toBe(0)
    expect(board.sigils.state[2]).toBe(1)
    expect(board.sigils.flash[3]).toBeGreaterThan(0)
  })
})

describe("sigils: room under the name chip", () => {
  test("on screen the medallion is clamped between its min and max size", () => {
    expect(sizeFor(1)).toBe(SIGIL_MIN_PX)
    expect(sizeFor(1000)).toBe(SIGIL_MAX_PX)
  })

  test("far away the chip lifts clear of the medallion; close up it fits under the chip unmoved", () => {
    expect(sigilRoom(sizeFor(10), 10, 3.2)).toBeGreaterThan(0)
    expect(sigilRoom(sizeFor(80), 80, 3.2)).toBe(0)
  })

  test("a chip with a sigil keeps room for it, and the declutter counts it", () => {
    const place = (y: number, z: number, sigil: boolean) => {
      const style = new Map<string, string>()
      const attrs = new Set<string>()
      const anchor = new Object3D()
      anchor.position.set(0, y, z)
      anchor.updateMatrixWorld()
      const slot = chipSlot()
      slot.anchor = anchor
      slot.el = {
        offsetWidth: 60,
        offsetHeight: 20,
        style: { setProperty: (k: string, v: string) => style.set(k, v) },
        hasAttribute: (k: string) => attrs.has(k),
        toggleAttribute: (k: string, on: boolean) => (on ? attrs.add(k) : attrs.delete(k)),
      } as unknown as HTMLElement
      slot.sigil = sigil
      addChip(slot)
      return style
    }
    const settle = () => {
      for (let i = 0; i < 4; i++) layout(camera, 200, 200)
    }
    // 10 px a unit: a plate 3 units below another, nearer the camera, sits 10 px clear of it.
    let upper = place(0, -5, false)
    place(-3, 5, false)
    settle()
    expect(upper.get("--lift") ?? "0px").toBe("0px")

    // Give the lower one a sigil: its plate rises over the medallion, into the upper chip, which
    // the declutter lifts clear.
    resetChips()
    upper = place(0, -5, false)
    const lower = place(-3, 5, true)
    settle()
    expect(Number.parseInt(lower.get("--room") ?? "0", 10)).toBeGreaterThan(0)
    expect(upper.get("--room") ?? "0px").toBe("0px")
    expect(Number.parseInt(upper.get("--lift") ?? "0", 10)).toBeGreaterThan(0)
  })
})
