import { describe, expect, test } from "bun:test"
import { apply, applyAll, emptyModel, type Model } from "@guildhall/core"
import { rush } from "@guildhall/sim"
import { type AdventurerView, viewsOf } from "../src/guild/store.ts"
import { HEARTH_SEATS, hearthSeat, INFIRMARY, INFIRMARY_MATS, ROOM, TAVERN } from "../src/world/layout.ts"
import { BODY, blocker, KEEP_OBSTACLES } from "./support/clearance.ts"

/**
 * Crowds in the keep (Chapter 2): past the tavern's stools, the hearth's places, the infirmary's
 * beds and bedrolls, nobody shares a spot — they take free floor round the place (guild/crowd.ts).
 */

/** Resting in the tavern or lying in the infirmary. */
const kept = (views: readonly AdventurerView[]) =>
  views.filter((v) => v.phase === "resting" || v.phase === "failed")

/** How many share a spot with someone, and the closest two. */
function crowding(views: readonly AdventurerView[]): { shared: number; closest: number } {
  const spots = views.map((v) => v.target)
  const keys = new Set(spots.map(([x, z]) => `${x},${z}`))
  let closest = Number.POSITIVE_INFINITY
  for (let i = 0; i < spots.length; i++)
    for (let j = i + 1; j < spots.length; j++) {
      const a = spots[i] ?? [0, 0]
      const b = spots[j] ?? [0, 0]
      closest = Math.min(closest, Math.hypot(a[0] - b[0], a[1] - b[1]))
    }
  return { shared: spots.length - keys.size, closest }
}

/** The keep's own seats and berths: a crowd spot is anything else. */
const SEATS = new Set(
  [
    ...TAVERN,
    ...INFIRMARY,
    ...INFIRMARY_MATS,
    ...Array.from({ length: HEARTH_SEATS }, (_, n) => hearthSeat(n)),
  ].map(([x, z]) => `${x},${z}`),
)

/** A full keep: `resting` done subagents and `failed` failed ones. */
function keepCrowd(resting: number, failed: number): { model: Model; now: number } {
  const model = emptyModel()
  const now = 100_000
  apply(model, { type: "session", id: "m", agent: "guild-master", title: "t", at: 0 })
  apply(model, { type: "status", id: "m", status: "busy", at: 0 })
  let i = 0
  const join = (agent: string) => {
    const id = `k${i}`
    apply(model, { type: "session", id, parentID: "m", agent, title: "x", at: ++i })
    apply(model, { type: "status", id, status: "busy", at: i })
    return id
  }
  for (let n = 0; n < resting; n++)
    apply(model, { type: "status", id: join("guild-architect"), status: "idle", at: now - 5000 })
  for (let n = 0; n < failed; n++)
    apply(model, {
      type: "status",
      id: join("guild-designer"),
      status: "failed",
      error: "boom",
      at: now - 5000,
    })
  return { model, now }
}

describe("a full keep", () => {
  const { model, now } = keepCrowd(150, 80)
  const views = viewsOf(model, now)

  test("the tavern's stools, the hearth's places, the beds and the bedrolls fill first, in order", () => {
    const resting = views.filter((v) => v.phase === "resting")
    expect(resting.slice(0, TAVERN.length).map((v) => [v.target, v.seat])).toEqual(
      TAVERN.map((p) => [p, "stool"]),
    )
    expect(resting.slice(TAVERN.length, TAVERN.length + HEARTH_SEATS).map((v) => [v.target, v.seat])).toEqual(
      Array.from({ length: HEARTH_SEATS }, (_, n) => [hearthSeat(n), "floor"]),
    )
    const failed = views.filter((v) => v.phase === "failed")
    expect(failed.slice(0, 6).map((v) => v.target)).toEqual([...INFIRMARY, ...INFIRMARY_MATS])
  })

  test("past them nobody shares a spot, and everyone stands on the keep's open floor", () => {
    const crowd = kept(views)
    expect(crowd).toHaveLength(230)
    const { shared, closest } = crowding(crowd)
    expect(shared).toBe(0)
    expect(closest).toBeGreaterThanOrEqual(2 * BODY)
    const extra = crowd.filter(({ target: [x, z] }) => !SEATS.has(`${x},${z}`))
    expect(extra).toHaveLength(230 - TAVERN.length - HEARTH_SEATS - INFIRMARY.length - INFIRMARY_MATS.length)
    for (const { id, target, seat } of extra) {
      expect(seat).toBe("floor")
      expect(Math.abs(target[0]) < ROOM.width / 2 && Math.abs(target[1]) < ROOM.depth / 2).toBe(true)
      expect({ id, blocked: blocker([target[0], target[1]], KEEP_OBSTACLES)?.name }).toEqual({
        id,
        blocked: undefined,
      })
    }
  })

  test("each crowd gathers round its own place: the resting by the hearth, the fallen by the bedrolls", () => {
    const mean = (list: readonly AdventurerView[]) => [
      list.reduce((sum, v) => sum + v.target[0], 0) / list.length,
      list.reduce((sum, v) => sum + v.target[1], 0) / list.length,
    ]
    const [rx = 0, rz = 0] = mean(
      views.filter((v) => v.phase === "resting").slice(TAVERN.length + HEARTH_SEATS, 40),
    )
    const [fx = 0, fz = 0] = mean(views.filter((v) => v.phase === "failed").slice(6, 20))
    expect(Math.hypot(rx - 0, rz - -1.5)).toBeLessThan(6)
    expect(Math.hypot(fx - -6.5, fz - -5.4)).toBeLessThan(4)
  })

  test("the same keep gives everyone the same spot again", () => {
    expect(viewsOf(model, now).map((v) => v.target)).toEqual(views.map((v) => v.target))
  })
})

describe("a rush of 300", () => {
  test("at its busiest tavern, nobody resting or fallen shares a spot", () => {
    const changes = rush(300)
    const start = changes[0]?.at ?? 0
    for (const t of [40_000, 50_000, 60_000]) {
      const model = applyAll(
        emptyModel(),
        changes.filter((c) => c.at <= start + t),
      )
      const crowd = kept(viewsOf(model, start + t))
      expect(crowd.length).toBeGreaterThan(TAVERN.length + HEARTH_SEATS)
      expect({ t, shared: crowding(crowd).shared }).toEqual({ t, shared: 0 })
    }
  })
})
