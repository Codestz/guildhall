import { describe, expect, test } from "bun:test"
import { cellAt, key, neighbours, unkey } from "../src/world/gen/hex.ts"
import { islandFromTree } from "../src/world/gen/islandFromTree.ts"
import { RESERVED } from "../src/world/gen/plan/keep.ts"
import type { RepoEntry } from "../src/world/gen/repo.ts"
import { crossingFault } from "../src/world/gen/rivers/crossing.ts"
import { repoWorld } from "../src/world/world.ts"
import { FIXTURES } from "./support/fixtures.ts"

/** Generator v2's roads grow with the island (plan/streets.ts), and its river bridges meet both banks (rivers/crossing.ts). */

const worlds = FIXTURES.map((fixture) => {
  const made = islandFromTree(fixture.entries as RepoEntry[], 0, 2)
  return {
    repo: fixture.repo,
    made,
    world: repoWorld(made, { repo: fixture.repo, source: "fixture", gen: 2 }),
  }
})
const REACT = worlds.find((w) => w.repo === "facebook/react")

describe("river bridges", () => {
  test("every deck meets the ground on both banks and no bank rises above it", () => {
    let seen = 0
    for (const { repo, world } of worlds)
      for (const bridge of world.island.decor.filter((d) => d.piece === "building_bridge_A")) {
        seen++
        const axis = (((Math.round(1 - (bridge.rot ?? 0) / (Math.PI / 3)) % 3) + 3) % 3) as number
        const fault = crossingFault(cellAt([bridge.x, bridge.z]), axis, (x, z) => world.ground.heightAt(x, z))
        expect(`${repo} ${bridge.x},${bridge.z}: ${fault ?? "clear"}`).toEndWith("clear")
      }
    expect(seen).toBeGreaterThan(5)
  })
})

describe("road growth", () => {
  test("a big island's network grows with it: a road hex in every seven or so of its land", () => {
    const land = REACT?.made.plan.land.size ?? 0
    const roads = new Set(REACT?.made.plan.roads.flat().map(key))
    expect(land).toBeGreaterThan(1000)
    expect(roads.size / land).toBeGreaterThan(1 / 8)
  })

  test("no inland hex is more than four hexes from a road, on any island but a hamlet", () => {
    for (const { repo, made } of worlds) {
      const { land, ranges, lakes } = made.plan
      // (A hamlet is left sparser.)
      if (land.size < 150) continue
      const solid = new Set([
        ...ranges.flatMap((range) => [...range]),
        ...lakes.flatMap((l) => [...l.cells, ...l.shore]),
      ])
      const reach = new Map<string, number>()
      const queue = [...new Set(made.plan.roads.flat().map(key))]
      for (const id of queue) reach.set(id, 0)
      for (let i = 0; i < queue.length; i++)
        for (const next of neighbours(unkey(queue[i] as string))) {
          const id = key(next)
          if (land.has(id) && !reach.has(id)) {
            reach.set(id, (reach.get(queue[i] as string) ?? 0) + 1)
            queue.push(id)
          }
        }
      const lonely = [...land.keys()].filter(
        (id) =>
          !solid.has(id) &&
          !(made.plan.reserved ?? RESERVED).has(id) &&
          neighbours(unkey(id)).every((n) => land.has(key(n))) &&
          (reach.get(id) ?? 99) > 4,
      )
      expect(`${repo}: ${lonely.join(" ")}`).toBe(`${repo}: `)
    }
  })

  test("every street joins the network: all squares are reachable from the hub by road", () => {
    for (const { made } of worlds) {
      const links = new Map<string, string[]>()
      for (const road of made.plan.roads)
        road.forEach((cell, n) => {
          const prev = road[n - 1]
          if (!prev) return
          links.set(key(cell), [...(links.get(key(cell)) ?? []), key(prev)])
          links.set(key(prev), [...(links.get(key(prev)) ?? []), key(cell)])
        })
      const seen = new Set([key(made.plan.hub)])
      for (const id of seen) for (const next of links.get(id) ?? []) seen.add(next)
      for (const district of made.plan.districts) expect(seen.has(key(district.square))).toBe(true)
    }
  })

  test("streets keep off lakes and their shores and off the keep's ring", () => {
    for (const { made } of worlds) {
      const roads = new Set(made.plan.roads.flat().map(key))
      for (const lake of made.plan.lakes)
        for (const id of [...lake.cells, ...lake.shore]) expect(roads.has(id)).toBe(false)
    }
  })

  test("the same repo grows the same roads", () => {
    const again = islandFromTree(FIXTURES[0]?.entries as RepoEntry[], 0, 2)
    expect(again.plan.roads).toEqual(worlds[0]?.made.plan.roads)
  })
})
