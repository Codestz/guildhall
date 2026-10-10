import { describe, expect, test } from "bun:test"
import { patchesOf } from "../src/scene/archipelago/footprint.ts"
import { partsOf } from "../src/scene/nature/waterParts.ts"
import { archipelagoSource } from "../src/world/archipelagoSource.ts"
import type { Tree } from "../src/world/gen/load.ts"
import { handWorld } from "../src/world/world.ts"
import { FIXTURES } from "./support/fixtures.ts"

/**
 * An archipelago whose far islands come as they are grown (world/archipelagoSource.ts): each is added
 * when ready, the sea is cut only for the ones drawn, and one that can't be had leaves no hole.
 */

const treeOf = (repo: string): Tree => {
  const fixture = FIXTURES.find((one) => one.repo.toLowerCase() === repo.toLowerCase())
  if (!fixture) throw new Error(`no tree for ${repo}`)
  return { repo: fixture.repo, source: "fixture", entries: fixture.entries } as unknown as Tree
}

let offline = true
const fetchTree = async (repo: string): Promise<Tree> => {
  if (repo === "nobody/missing" && offline) throw new Error("GitHub has no public repo called nobody/missing")
  return treeOf(repo === "nobody/missing" ? "Codestz/Mintroot" : repo)
}

const holesOf = (drawn: ReadonlySet<string>) => {
  const [part] = partsOf(handWorld(), archipelagoSource.archipelago, 0, drawn)
  return part && "radius" in part.sea ? part.sea.holes : []
}

describe("a progressive archipelago", () => {
  const seen: number[] = []
  archipelagoSource.subscribe(() => {
    const count = archipelagoSource.archipelago?.islands.length ?? 0
    if (seen.at(-1) !== count) seen.push(count)
  })

  test("adds each island as it is grown, and names the one that failed", async () => {
    const done = await archipelagoSource.load(
      ["Codestz/mcpx", "nobody/missing", "Codestz/claude-hindsight"],
      fetchTree,
      patchesOf,
    )
    expect(done?.islands.map((island) => island.repo)).toEqual(["Codestz/mcpx", "Codestz/claude-hindsight"])
    expect(seen).toEqual([0, 1, 2])
    expect(archipelagoSource.status).toEqual({
      state: "ready",
      failed: [
        { repo: "nobody/missing", reason: "GitHub has no public repo called nobody/missing", retry: true },
      ],
    })
  })

  test("the sea has a hole for an island only once it is drawn: never one for a failed or pending island", () => {
    const [mcpx, hindsight] = archipelagoSource.archipelago?.islands ?? []
    expect(holesOf(new Set())).toEqual([])
    const one = holesOf(new Set([mcpx?.id as string]))
    expect(one.length).toBeGreaterThan(0)
    for (const hole of one) {
      expect(Math.abs(hole.at[0] - (mcpx?.at[0] as number))).toBeLessThanOrEqual(hole.half)
      expect(Math.abs(hole.at[1] - (mcpx?.at[1] as number))).toBeLessThanOrEqual(hole.half)
    }
    // A name that is no island of the archipelago (the failed one) cuts nothing.
    expect(holesOf(new Set(["nobody/missing"]))).toEqual([])
    const both = holesOf(new Set([mcpx?.id as string, hindsight?.id as string]))
    expect(both.length).toBe(2 * one.length)
  })

  test("a drawn island is what the source reports, and leaving takes it back", () => {
    const leave = archipelagoSource.markDrawn("Codestz/mcpx")
    expect(archipelagoSource.drawn.has("Codestz/mcpx")).toBe(true)
    leave()
    expect(archipelagoSource.drawn.has("Codestz/mcpx")).toBe(false)
  })

  test("a retry brings the failed island in without moving the others", async () => {
    const before = archipelagoSource.archipelago?.islands.map((island) => island.at)
    offline = false
    archipelagoSource.retry("nobody/missing")
    await new Promise<void>((resolve) => {
      const stop = archipelagoSource.subscribe(() => {
        if (archipelagoSource.status.state === "ready" && archipelagoSource.status.failed.length === 0) {
          stop()
          resolve()
        }
      })
    })
    const islands = archipelagoSource.archipelago?.islands ?? []
    expect(islands.length).toBe(3)
    expect(islands.slice(0, 2).map((island) => island.at)).toEqual(before as never)
  })
})
