import { describe, expect, test } from "bun:test"
import { patchesOf } from "../src/scene/archipelago/footprint.ts"
import type { Tree } from "../src/world/gen/load.ts"
import type { RepoEntry } from "../src/world/gen/repo.ts"
import { splitRepo } from "../src/world/gen/split.ts"
import { growSyncParts } from "../src/world/grow/grow.ts"
import { answer, type GrowRequest, type LayoutReply, type LayoutRequest } from "../src/world/grow/job.ts"
import { type LayoutInput, layoutOf } from "../src/world/grow/layout.ts"
import { GrowPool, type WorkerLike } from "../src/world/grow/pool.ts"
import { layoutSplit } from "../src/world/repoArchipelago.ts"
import { sliceTree } from "../src/world/splitArchipelago.ts"
import { reachOf } from "../src/world/world.ts"
import SELF from "./fixtures/repos/guildhall.json"
import { SLOW } from "./support/slow.ts"

/**
 * A split repo's layout runs in a worker (world/grow/layout.ts), off the page's thread: the answer, sent
 * through a structured clone, is the layout computed here, whichever thread runs it.
 */

const tree = { repo: "codestz/guildhall", source: "fixture", entries: SELF.entries } as unknown as Tree
const split = splitRepo(SELF.entries as RepoEntry[], tree.repo)
if (!split) throw new Error("guildhall did not split")
const grown = split.slices.map((slice) => growSyncParts(sliceTree(tree, slice), 2))
const input: LayoutInput = {
  islands: split.slices.map((slice, i) => ({
    id: slice.id,
    parts: (grown[i] as (typeof grown)[number]).parts,
    patches: patchesOf((grown[i] as (typeof grown)[number]).world, i > 0, true),
  })),
  coupling: [...split.coupling],
}
const here = layoutSplit(
  split.slices.map((slice, i) => {
    const world = (grown[i] as (typeof grown)[number]).world
    return {
      id: slice.id,
      world,
      footprint: { reach: reachOf(world), patches: patchesOf(world, i > 0, true) },
    }
  }),
  split.coupling,
)

/** What the worker's side does to a request and its answer: a clone each way. */
const viaWorker = (request: LayoutRequest): LayoutReply =>
  structuredClone(answer(structuredClone(request)).reply)

describe("a split repo's layout in a worker", () => {
  test("has islands to lay out and links to join them", () => {
    expect(split.slices.length).toBeGreaterThan(2)
    expect(here.links.length).toBeGreaterThan(0)
  })

  test(
    "is the layout computed here: the same centres, links and quays, through a structured clone",
    () => {
      const reply = viaWorker({ layout: input })
      if (!("layout" in reply)) throw new Error(reply.error)
      expect(reply.layout).toEqual(here)
      expect(layoutOf(input)).toEqual(here)
    },
    30_000 * SLOW,
  )

  test("answers islands it cannot lay out with the reason, not a throw", () => {
    const { reply } = answer({ layout: { islands: [], coupling: [] } })
    expect("error" in reply).toBe(true)
  })

  test(
    "the pool sends it to a worker, and without one runs it on this thread",
    async () => {
      const sent: unknown[] = []
      class FakeWorker implements WorkerLike {
        onmessage: WorkerLike["onmessage"] = null
        onerror: WorkerLike["onerror"] = null
        postMessage(request: GrowRequest | LayoutRequest): void {
          sent.push(request)
          setTimeout(() => this.onmessage?.({ data: viaWorker(request as LayoutRequest) }))
        }
        terminate(): void {}
      }
      expect(await new GrowPool(() => new FakeWorker(), 1).layout(input)).toEqual(here)
      expect(sent.length).toBe(1)
      expect(await new GrowPool(undefined).layout(input)).toEqual(here)
    },
    30_000 * SLOW,
  )

  test("a worker that cannot run falls back to this thread, its job not lost", async () => {
    class BrokenWorker implements WorkerLike {
      onmessage: WorkerLike["onmessage"] = null
      onerror: WorkerLike["onerror"] = null
      postMessage(): void {
        setTimeout(() => this.onerror?.(new Error("script failed")))
      }
      terminate(): void {}
    }
    expect(await new GrowPool(() => new BrokenWorker(), 1).layout(input)).toEqual(here)
  })
})
