import { describe, expect, test } from "bun:test"
import type { PrStatus, SeaEvent } from "@guildhall/core"
import { CAPS, docketAt, sizeOf, tintOf } from "../src/guild/docket.ts"
import { petitionersOf, queueSpot, WALK_IN_MS, WALK_OFF_MS } from "../src/guild/petitions.ts"
import type { Sighting } from "../src/guild/sea.ts"
import { ARRIVE_MS, LEAVE_MS, seaAt } from "../src/scene/seas/fleet.ts"
import type { World } from "../src/world/world.ts"

/** The docket: open PRs to berths, open issues to places in the queue (guild/docket.ts, petitions.ts). */

const base = { repo: "acme/shop", at: 0, title: "t", author: "a" }
const opened = (n: number, extra: { status?: PrStatus; size?: number } = {}): SeaEvent => ({
  ...base,
  kind: "pr_opened",
  id: `o${n}`,
  number: n,
  branch: "b",
  ...extra,
})
const ended = (kind: "pr_merged" | "pr_closed", n: number): SeaEvent => ({
  ...base,
  kind,
  id: `${kind}${n}`,
  number: n,
  branch: "b",
})
const updated = (n: number, status: PrStatus): SeaEvent => ({
  ...base,
  kind: "pr_updated",
  id: `u${n}${status}`,
  number: n,
  branch: "b",
  status,
})
const issue = (n: number, labels?: string[]): SeaEvent => ({
  ...base,
  kind: "issue_opened",
  id: `i${n}`,
  number: n,
  ...(labels ? { labels } : {}),
})
const closes = (n: number): SeaEvent => ({ ...base, kind: "issue_closed", id: `c${n}`, number: n })
const at = (event: SeaEvent, ms: number): Sighting => ({ event, at: ms })
const caps = { berths: 2, places: 3 }

describe("berths at the anchorage", () => {
  test("open pull requests take berths first-fit, in the order they opened", () => {
    const { pulls } = docketAt([at(opened(1), 0), at(opened(2), 10), at(opened(3), 20)], 100, caps)
    expect(pulls.map((p) => [p.number, p.berth])).toEqual([
      [1, 0],
      [2, 1],
      [3, -1],
    ])
  })

  test("one over the cap waits unseen, counted, and takes the berth a merge frees", () => {
    const sea = [at(opened(1), 0), at(opened(2), 10), at(opened(3), 20)]
    expect(docketAt(sea, 100, caps).waitingPulls).toBe(1)
    const after = docketAt([...sea, at(ended("pr_merged", 1), 500)], 600, caps)
    expect(after.waitingPulls).toBe(0)
    const third = after.pulls.find((p) => p.number === 3)
    expect(third).toMatchObject({ berth: 0, seated: 500 })
  })

  test("a berth freed by a close is reused by the next to open; the leaver keeps where it lay", () => {
    const sea = [at(opened(1), 0), at(opened(2), 10), at(ended("pr_closed", 1), 200), at(opened(4), 300)]
    const { pulls } = docketAt(sea, 400, caps)
    expect(pulls.find((p) => p.number === 4)?.berth).toBe(0)
    expect(pulls.find((p) => p.number === 1)).toMatchObject({ berth: 0, ended: { kind: "pr_closed" } })
  })

  test("a pull request that ends before it ever had a berth leaves no ship", () => {
    const sea = [at(opened(1), 0), at(opened(2), 1), at(opened(3), 2), at(ended("pr_closed", 3), 50)]
    const ship = seaAt(sea, 60, caps).voyages.find((v) => v.key.endsWith("#3"))
    expect(ship).toBeUndefined()
  })

  test("one found at anchor as it ends (opened before the hall watched) sails from a berth", () => {
    const { pulls } = docketAt([at(ended("pr_merged", 9), 1000)], 1000, caps)
    expect(pulls[0]).toMatchObject({ number: 9, berth: 0, ended: { at: 1000 } })
    expect(pulls[0]?.seated).toBeLessThan(1000 - ARRIVE_MS)
  })

  test("status follows pr_updated while open; a size is a log scale; none given is a middling hull", () => {
    const sea = [at(opened(1, { status: "draft", size: 100 }), 0), at(updated(1, "ready"), 50)]
    expect(docketAt(sea, 10, caps).pulls[0]?.status).toBe("draft")
    expect(docketAt(sea, 60, caps).pulls[0]?.status).toBe("ready")
    expect(sizeOf(1)).toBeLessThan(sizeOf(100))
    expect(sizeOf(100)).toBeLessThan(sizeOf(10_000))
    expect(sizeOf(10_000_000)).toBe(1)
    expect(sizeOf(undefined)).toBeGreaterThan(0)
    expect(docketAt(sea, 60, caps).pulls[0]?.size).toBe(sizeOf(100))
  })

  test("the same sightings always give the same docket", () => {
    const sea = [at(opened(1), 0), at(issue(2), 5), at(opened(3), 9), at(closes(2), 20)]
    expect(docketAt(sea, 50, caps)).toEqual(docketAt(sea, 50, caps))
  })

  test("quality tiers widen the anchorage and the queue", () => {
    expect(CAPS[0].berths).toBeLessThan(CAPS[2].berths)
    expect(CAPS[2].places).toBeLessThanOrEqual(CAPS[3].places)
  })
})

describe("pull request ships", () => {
  const sea = [at(opened(1, { status: "review", size: 5000 }), 0)]

  test("a ship flies its status, grows with its diff, and keeps its berth", () => {
    const [ship] = seaAt(sea, ARRIVE_MS + 1000, caps).voyages
    expect(ship).toMatchObject({ hull: "pr", mark: "review", sailing: false })
    expect(ship?.size).toBe(sizeOf(5000))
  })

  test("merged it flies the merge colour; closed it sails away and is gone", () => {
    const merged = seaAt([...sea, at(ended("pr_merged", 1), 20_000)], 21_000, caps).voyages[0]
    expect(merged?.mark).toBe("merged")
    const closing = [...sea, at(ended("pr_closed", 1), 20_000)]
    expect(seaAt(closing, 21_000, caps).voyages[0]?.mark).toBe("closed")
    expect(seaAt(closing, 20_000 + LEAVE_MS, caps).voyages).toEqual([])
  })

  test("ships beyond the tier's berths are not drawn", () => {
    const many = Array.from({ length: 5 }, (_, i) => at(opened(i + 1), i))
    expect(seaAt(many, 60_000, caps).voyages.filter((v) => v.hull === "pr")).toHaveLength(2)
  })
})

describe("petitioners", () => {
  const world = {
    kind: "hand",
    island: { landmarks: [{ kind: "dock", x: 0, z: 66 }] },
  } as unknown as World

  test("open issues are seated in order and tinted by their labels", () => {
    const sea = [at(issue(1, ["bug"]), 0), at(issue(2, ["enhancement"]), 1), at(issue(3), 2)]
    const docket = docketAt(sea, 10, caps)
    expect(docket.petitions.map((p) => [p.number, p.place, p.tint])).toEqual([
      [1, 0, "bug"],
      [2, 1, "feature"],
      [3, 2, "other"],
    ])
    expect(tintOf(["Bug", "enhancement"])).toBe("bug")
  })

  test("more issues than places: the extras wait, all are counted, only seated ones are figures", () => {
    const sea = Array.from({ length: 5 }, (_, i) => at(issue(i + 1), i))
    const docket = docketAt(sea, 50_000, caps)
    expect(docket.open).toBe(5)
    expect(docket.petitions).toHaveLength(3)
    expect(petitionersOf(docket, 50_000, world, "world")).toHaveLength(3)
  })

  test("a closed issue's petitioner is leaving for a while, then gone; its place goes to the next", () => {
    const sea = [...[1, 2, 3, 4].map((n) => at(issue(n), n)), at(closes(1), 1000)]
    const docket = docketAt(sea, 1000 + 1, caps)
    expect(docket.petitions.find((p) => p.number === 4)).toMatchObject({ place: 0, since: 1000 })
    const leaving = petitionersOf(docket, 2000, world, "world").find((v) => v.id.endsWith("#1"))
    expect(leaving?.phase).toBe("leaving")
    const later = petitionersOf(docket, 1000 + WALK_OFF_MS + 1, world, "world")
    expect(later.find((v) => v.id.endsWith("#1"))).toBeUndefined()
  })

  test("a newcomer walks in; one that was there already simply stands in its place", () => {
    const sea = [at(issue(1), 10_000)]
    const docket = docketAt(sea, 10_000, caps)
    const [fresh] = petitionersOf(docket, 10_000 + 100, world, "world")
    expect(fresh?.enter?.kind).toBe("gate")
    const [settled] = petitionersOf(docket, 10_000 + WALK_IN_MS, world, "world")
    expect(settled?.enter).toBeUndefined()
    expect(settled?.target).toEqual(queueSpot(world, 0))
  })

  test("the queue stands inland of the quay, facing it, two abreast", () => {
    const a = queueSpot(world, 0)
    const b = queueSpot(world, 1)
    const c = queueSpot(world, 2)
    expect(a[1]).toBeLessThan(66)
    expect(a[0]).not.toBe(b[0])
    expect(c[1]).toBeLessThan(a[1])
    expect(a[2]).toBeCloseTo(0)
  })

  test("a view whose figure did not change is handed back as the same object", () => {
    const docket = docketAt([at(issue(1), 0)], 100_000, caps)
    const first = petitionersOf(docket, 100_000, world, "world")
    const again = petitionersOf(docket, 100_001, world, "world", new Map(first.map((v) => [v.id, v])))
    expect(again[0]).toBe(first[0])
  })
})
