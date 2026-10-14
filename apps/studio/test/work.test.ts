/**
 * The townsfolk's work drawn (hexworld/work.ts): every piece a day shows is mounted once, the mask a
 * frame says which show (one to a slot, the part's own winning; the look's own off the hands at work), a
 * load carried in both arms rides the chest, turns are eased the short way round, and the entries the
 * catalog gets for the built pieces and the carries.
 */
import { describe, expect, test } from "bun:test"
import type { CatalogEntry, Mount, MountSlot, NpcLook } from "@guildhall/assets"
import { type LifeStep, PROPS } from "@guildhall/world"
import {
  afterReveal,
  beatPoint,
  CARRIED,
  carryId,
  dayPieces,
  drawnAs,
  easeAngle,
  propMask,
  workEntries,
  workLook,
} from "../src/hexworld/work.ts"

const mount = (slot: MountSlot): Mount => ({
  slot,
  hands: 1,
  handle: [0, 0, 0],
  axis: [0, 1, 0],
  edge: [1, 0, 0],
})
const SLOTS: Record<string, MountSlot> = {
  [PROPS.rod]: "hand.r",
  [PROPS.fish]: "hand.l",
  [PROPS.pickaxe]: "hand.r",
  [PROPS.ore]: "hand.r",
  [PROPS.axe]: "hand.r",
  [PROPS.log]: "hand.r",
  [carryId(PROPS.log)]: "chest",
  [carryId("built/basket")]: "chest",
  "built/basket": "hand.r",
  "kaykit-tools/lantern": "hand.l",
  "kaykit-adventurers/hat": "head",
}
const mountOf = (piece: string) => (SLOTS[piece] ? mount(SLOTS[piece]!) : undefined)

const look = (mounts: { piece: string; slot: MountSlot }[]): NpcLook => ({
  recipe: "t",
  seed: 1,
  body: "kaykit-adventurers/knight",
  hide: [],
  rampMap: {},
  mounts,
  clips: { work: "Idle_A", idle: "Idle_A", walk: "Walking_A" },
  scale: 1,
  speed: 1,
  phase: 0,
})

const stay = (routine?: string): LifeStep => ({
  kind: "stay",
  from: 8,
  to: 12,
  at: [0, 0, 0],
  facing: 0,
  act: "work",
  ground: true,
  ...(routine ? { routine: { id: routine, seed: 1 } } : {}),
})
const walk = (carry?: string): LifeStep => ({
  kind: "walk",
  from: 12,
  to: 12.1,
  pts: [
    [0, 0, 0],
    [1, 0, 0],
  ],
  times: [12, 12.1],
  ground: [true],
  ...(carry ? { carry } : {}),
})

describe("the day's pieces", () => {
  test("a fisher: the rod, the fish, the basket carried to market (on the chest, drawn as the wicker one)", () => {
    const pieces = dayPieces({ prop: PROPS.rod, day: [stay("fish"), walk(PROPS.basket), stay("deliver")] })
    const ids = pieces.map((p) => p.piece)
    expect(ids).toContain(PROPS.rod)
    expect(ids).toContain(PROPS.fish)
    expect(ids).toContain(carryId("built/basket"))
    expect(pieces.find((p) => p.piece === carryId("built/basket"))?.carried).toBe(true)
    // the stall's put-down holds it in a hand
    expect(ids).toContain("built/basket")
    expect(drawnAs(PROPS.basket)).toBe("built/basket")
  })

  test("a woodcutter's log to the pile rides the chest; a crop down the row is held in a hand", () => {
    expect(CARRIED.has(PROPS.log)).toBe(true)
    expect(CARRIED.has(PROPS.crop)).toBe(false)
    const ids = dayPieces({ day: [stay("chop"), walk(PROPS.log), stay("stack")] }).map((p) => p.piece)
    expect(ids).toEqual(expect.arrayContaining([PROPS.axe, carryId(PROPS.log), PROPS.log]))
    expect(dayPieces({ day: [stay("farm")] }).map((p) => p.piece)).toContain(PROPS.crop)
  })
})

describe("work look", () => {
  test("the look's own mounts first (its base), the day's after, each once", () => {
    const w = workLook(
      look([{ piece: "kaykit-adventurers/hat", slot: "head" }]),
      { prop: PROPS.rod, day: [stay("fish")] },
      mountOf,
    )
    expect(w.look.mounts.map((m) => m.piece)).toEqual(["kaykit-adventurers/hat", PROPS.rod, PROPS.fish])
    expect(w.base).toBe(0b1)
    expect(w.index.get(PROPS.fish)).toBe(2)
    expect(w.slots).toEqual(["head", "hand.r", "hand.l"])
  })

  test("pieces the library cannot mount are left out", () => {
    const w = workLook(look([]), { day: [stay("tavern")] }, mountOf)
    expect(w.look.mounts).toEqual([])
    expect(w.base).toBe(0)
  })
})

describe("prop mask", () => {
  const w = workLook(
    look([
      { piece: "kaykit-tools/lantern", slot: "hand.l" },
      { piece: "kaykit-adventurers/hat", slot: "head" },
    ]),
    { day: [stay("mine"), stay("fish")] },
    mountOf,
  )
  const bit = (piece: string) => 1 << w.index.get(piece)!

  test("off work: the look's own, nothing of the day's", () => {
    expect(propMask(w, [], false)).toBe(bit("kaykit-tools/lantern") | bit("kaykit-adventurers/hat"))
  })

  test("at work: the routine's props, the look's own off the hands", () => {
    expect(propMask(w, [PROPS.rod], true)).toBe(bit(PROPS.rod) | bit("kaykit-adventurers/hat"))
  })

  test("one piece to a slot: the part's own (later) wins (the ore thrown, the pick put by)", () => {
    expect(propMask(w, [PROPS.pickaxe, PROPS.ore], true)).toBe(bit(PROPS.ore) | bit("kaykit-adventurers/hat"))
    // two hands, two pieces
    expect(propMask(w, [PROPS.rod, PROPS.fish], true)).toBe(
      bit(PROPS.rod) | bit(PROPS.fish) | bit("kaykit-adventurers/hat"),
    )
  })

  test("a piece taken by the day keeps the look's own off its slot even when the hands are free", () => {
    expect(propMask(w, [PROPS.fish], false) & bit("kaykit-tools/lantern")).toBe(0)
  })
})

describe("eased turns", () => {
  test("toward the target, the shorter way round, settled in ~150 ms", () => {
    const a = easeAngle(0, 1, 0.016)
    expect(a).toBeGreaterThan(0)
    expect(a).toBeLessThan(1)
    // 3.0 → −3.0 is 0.28 rad the short way (through π), not 6 the long way
    const b = easeAngle(3, -3, 0.016)
    expect(b).toBeGreaterThan(3)
    let x = 0
    for (let t = 0; t < 0.15; t += 1 / 60) x = easeAngle(x, 1, 1 / 60)
    expect(x).toBeGreaterThan(0.9)
  })

  test("a first frame or a seek snaps", () => {
    expect(easeAngle(Number.NaN, 2, 0.016)).toBe(2)
    expect(easeAngle(0, 2, 0)).toBe(2)
    expect(easeAngle(0, 2, 1)).toBe(2)
  })
})

describe("beats and entries", () => {
  test("a smith's blow is at the anvil, higher than a chop at the log", () => {
    expect(beatPoint("hit", "smith")[1]).toBeGreaterThan(beatPoint("hit", "chop")[1])
    expect(beatPoint("dig", "farm")[1]).toBeLessThan(0.1)
  })

  test("the built pieces and a chest mount for every load, copies of a template with their own id and file", () => {
    const template = {
      id: "kaykit-tools/axe",
      files: { glb: "pieces/kaykit-tools/axe.glb", thumb: null },
      size: [0.5, 0.5, 0.5],
      compose: { mount: mount("hand.r") },
    } as unknown as CatalogEntry
    const log = {
      ...template,
      id: PROPS.log,
      size: [0.72, 0.73, 1.35],
      files: { glb: "pieces/log.glb", thumb: null },
    }
    const entries = workEntries(
      { get: (id) => (id === PROPS.log ? (log as CatalogEntry) : undefined) },
      template,
    )
    const byId = new Map(entries.map((e) => [e.id, e]))
    expect(byId.get("built/basket")?.files.glb).toBe("built/basket.glb")
    expect(byId.get("built/basket")?.compose.mount?.slot).toBe("hand.r")
    expect(byId.get("built/cart")?.compose.mount).toBeUndefined()
    const carried = byId.get(carryId(PROPS.log))
    expect(carried?.files.glb).toBe("pieces/log.glb")
    expect(carried?.compose.mount?.slot).toBe("chest")
    expect(byId.get(carryId("built/basket"))?.compose.mount?.slot).toBe("chest")
  })
})

describe("the stocks load off the ready path", () => {
  test("with no loading screen to wait for, they start at once", async () => {
    let started = false
    await afterReveal(50).then(() => {
      started = true
    })
    expect(started).toBe(true)
  })
})
