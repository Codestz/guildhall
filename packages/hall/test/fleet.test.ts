import { describe, expect, test } from "bun:test"
import type { SeaEvent } from "@guildhall/core"
import {
  ARRIVE_MS,
  FLOURISH_MS,
  GALLEON_MS,
  harbourOf,
  LEAVE_MS,
  lampOf,
  lighthouseSpot,
  MAX_CRATES,
  MAX_SHIPS,
  MERGE_MS,
  SAIL_OUT_MS,
  type SeaSighting,
  seaAt,
  toWorld,
} from "../src/scene/seas/fleet.ts"

const base = { repo: "acme/shop", at: 0 }
const pr = (kind: "pr_opened" | "pr_merged" | "pr_closed", number = 7): SeaEvent => ({
  ...base,
  kind,
  id: `${kind}:${number}`,
  number,
  title: "t",
  author: "a",
  branch: "b",
})
const push = (id: string, commits: number): SeaEvent => ({
  ...base,
  kind: "push",
  id,
  branch: "main",
  commits,
  author: "a",
  sha: id,
})
const ci = (state: "queued" | "running" | "passed" | "failed"): SeaEvent => ({
  ...base,
  kind: "ci",
  id: `ci:${state}`,
  state,
  name: "CI",
  branch: "main",
  sha: "s",
})
const release: SeaEvent = { ...base, kind: "release", id: "release:v1", tag: "v1" }
const at = (event: SeaEvent, ms: number): SeaSighting => ({ event, at: ms })

describe("the sea at a run time", () => {
  test("nothing sighted later than the time is on the water", () => {
    const view = seaAt([at(push("p", 2), 5000), at(ci("failed"), 6000)], 4000)
    expect(view.voyages).toEqual([])
    expect(view.light.state).toBeUndefined()
  })

  test("a push sails out with a crate per commit, capped, and is gone after its passage", () => {
    const sea = [at(push("p", 40), 0)]
    const sailing = seaAt(sea, SAIL_OUT_MS / 2).voyages
    expect(sailing).toHaveLength(1)
    expect(sailing[0]).toMatchObject({ hull: "cargo", crates: MAX_CRATES, sailing: true })
    expect(seaAt(sea, SAIL_OUT_MS).voyages).toEqual([])
    expect(seaAt([at(push("q", 2), 0)], 1000).voyages[0]?.crates).toBe(2)
  })

  test("an opened pull request anchors offshore and stays while it is open", () => {
    const sea = [at(pr("pr_opened"), 0)]
    const anchored = seaAt(sea, ARRIVE_MS + 60_000).voyages[0]
    expect(anchored).toMatchObject({ hull: "pr", sailing: false, shown: 1 })
    expect(anchored?.out).toBeGreaterThan(0)
  })

  test("merged, the same ship sails in and moors by the quay, on the island's side of the anchorage", () => {
    const sea = [at(pr("pr_opened"), 0), at(pr("pr_merged"), 20_000)]
    const anchored = seaAt(sea, 19_000).voyages
    const moored = seaAt(sea, 20_000 + MERGE_MS + 1000).voyages
    expect(anchored).toHaveLength(1)
    expect(moored).toHaveLength(1)
    expect(moored[0]?.key).toBe(anchored[0]?.key)
    expect(moored[0]?.sailing).toBe(false)
    expect(moored[0]?.out ?? 0).toBeLessThan(anchored[0]?.out ?? 0)
  })

  test("closed unmerged, it sails away and is gone", () => {
    const sea = [at(pr("pr_opened"), 0), at(pr("pr_closed"), 20_000)]
    expect(seaAt(sea, 20_000 + LEAVE_MS / 2).voyages[0]?.sailing).toBe(true)
    expect(seaAt(sea, 20_000 + LEAVE_MS).voyages).toEqual([])
  })

  test("a merge seen without its opening still sails in from the anchorage", () => {
    expect(seaAt([at(pr("pr_merged"), 0)], 1000).voyages).toHaveLength(1)
  })

  test("at most MAX_SHIPS of a kind, the newest", () => {
    const sea = Array.from({ length: MAX_SHIPS + 3 }, (_, i) => at(push(`p${i}`, 1), i))
    const voyages = seaAt(sea, 100).voyages
    expect(voyages).toHaveLength(MAX_SHIPS)
    expect(voyages.at(-1)?.key).toBe(`p${MAX_SHIPS + 2}`)
  })

  test("a release brings the galleon, and its flourish plays once it anchors", () => {
    const sea = [at(release, 0)]
    expect(seaAt(sea, 1000).galleon?.sailing).toBe(true)
    expect(seaAt(sea, 1000).flourish).toBeUndefined()
    expect(seaAt(sea, GALLEON_MS + 1000).flourish).toBe(1000)
    expect(seaAt(sea, GALLEON_MS + FLOURISH_MS + 1).flourish).toBeUndefined()
    expect(seaAt(sea, GALLEON_MS + FLOURISH_MS + 1).galleon?.sailing).toBe(false)
  })
})

describe("the lighthouse", () => {
  test("follows the newest CI state", () => {
    const sea = [at(ci("running"), 0), at(ci("failed"), 5000), at(ci("passed"), 9000)]
    expect(seaAt(sea, 1000).light.state).toBe("running")
    expect(seaAt(sea, 6000).light).toEqual({ state: "failed", since: 5000 })
    expect(seaAt(sea, 9000).light.state).toBe("passed")
  })

  test("passing is a steady warm beam, failing a red pulse, running spins amber, before any run it is dark", () => {
    const passed = lampOf({ state: "passed", since: 0 }, 0)
    expect(passed).toMatchObject({ glow: 1, spin: false })
    expect(lampOf({ state: "passed", since: 0 }, 7000)).toEqual(passed)
    const red = [0, 600, 1250, 2000].map((t) => lampOf({ state: "failed", since: 0 }, t))
    expect(red.every((l) => l.color === 0xff3020 && !l.spin)).toBe(true)
    expect(new Set(red.map((l) => l.glow.toFixed(2))).size).toBeGreaterThan(1)
    const running = lampOf({ state: "running", since: 0 }, 1000)
    expect(running.spin).toBe(true)
    expect(lampOf({ state: "queued", since: 0 }, 2000).beam).toBeGreaterThan(running.beam)
    expect(lampOf({ state: undefined, since: 0 }, 0).glow).toBe(0)
  })
})

describe("the harbour", () => {
  test("out points away from the island, side along the shore", () => {
    const h = harbourOf([0, 80])
    expect(toWorld(h, 0, 10).z).toBeCloseTo(90)
    expect(Math.abs(toWorld(h, 10, 0).x)).toBeCloseTo(10)
    // A bow pointing out to sea points the way the quay faces.
    expect(toWorld(h, 0, 0, 0).heading).toBeCloseTo(0)
  })

  test("the lighthouse stands on a free beach hex, away from the quay", () => {
    const h = harbourOf([0, 80])
    const island = {
      tiles: [
        { piece: "hex_coast_A", x: 30, z: 70 },
        { piece: "hex_coast_B", x: 5, z: 75 },
        { piece: "hex_grass", x: 40, z: 60 },
        { piece: "hex_coast_C", x: -30, z: 70 },
      ],
      decor: [{ x: -30, z: 71 }],
    }
    expect(lighthouseSpot(island, h)).toEqual({ x: 30, z: 70 })
    expect(lighthouseSpot({ tiles: [], decor: [] }, h)).toBeUndefined()
  })
})
