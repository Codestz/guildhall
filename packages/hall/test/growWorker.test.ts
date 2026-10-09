import { describe, expect, test } from "bun:test"
import { populationOf } from "../src/world/folk/plan.ts"
import type { Tree } from "../src/world/gen/load.ts"
import { growSync, worldFrom } from "../src/world/grow/grow.ts"
import { answer, type GrowReply, type GrowRequest } from "../src/world/grow/job.ts"
import { GrowPool, type WorkerLike } from "../src/world/grow/pool.ts"
import type { World } from "../src/world/world.ts"
import MCPX from "./fixtures/repos/codestz__mcpx.json"
import REACT from "./fixtures/repos/facebook__react.json"

/**
 * An island grown in a Web Worker is the island grown on this thread (world/grow): the worker's
 * answer, sent through a structured clone with its buffers transferred, closes into a World equal
 * to `growSync`'s: its data, what its closures answer, and the folk planned on the other side.
 */

const tree = (fixture: { repo: string; entries: unknown[] }): Tree =>
  ({ ...fixture, source: "fixture" }) as unknown as Tree

/** What the worker's side does to a request and its answer: a clone each way, the answer's buffers moved. */
function viaWorker(request: GrowRequest): GrowReply {
  const { reply, transfer } = answer(structuredClone(request))
  return structuredClone(reply, { transfer })
}

/** A world as data: its closures replaced by what they answer over the land and a lattice of points. */
function plain(world: World): unknown {
  const { terrain, ground, relief, ...data } = world
  const cells = terrain.cells()
  const at: number[][] = []
  for (let x = -260; x <= 260; x += 13) for (let z = -260; z <= 260; z += 13) at.push([x, z])
  return {
    ...data,
    cells,
    terrain: cells.map((id) => {
      const cell = id.split(",").map(Number) as [number, number]
      return [terrain.at(cell), terrain.level(cell), terrain.district?.(cell)]
    }),
    ground: at.map(([x, z]) => ground.heightAt(x as number, z as number)),
    relief: relief && {
      tier: relief.tier,
      massifs: relief.massifs,
      keys: [...relief.keys],
      heights: at.map(([x, z]) => relief.heightAt(x as number, z as number)),
    },
  }
}

/**
 * Where two values differ, by `Object.is` (a lattice's NaN holes are equal, 0 and -0 are not); up to
 * a few, named by path. bun's `toEqual` calls NaN in a typed array unequal to itself.
 */
function differences(a: unknown, b: unknown, path = "world", out: string[] = []): string[] {
  if (out.length >= 5 || Object.is(a, b)) return out
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return [...out, `${path}: ${a} vs ${b}`]
  if (a instanceof Map && b instanceof Map) {
    if (a.size !== b.size) out.push(`${path}: ${a.size} vs ${b.size} entries`)
    for (const [k, v] of a) differences(v, b.get(k), `${path}{${k}}`, out)
  } else if (a instanceof Set && b instanceof Set) {
    if (a.size !== b.size || [...a].some((k) => !b.has(k))) out.push(`${path}: sets differ`)
  } else if (ArrayBuffer.isView(a) && ArrayBuffer.isView(b)) {
    const x = a as unknown as ArrayLike<number>
    const y = b as unknown as ArrayLike<number>
    const at = Array.from({ length: Math.max(x.length, y.length) }, (_, i) => i).find(
      (i) => !Object.is(x[i], y[i]),
    )
    if (at !== undefined) out.push(`${path}[${at}]: ${x[at]} vs ${y[at]}`)
  } else
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)]))
      differences((a as never)[k], (b as never)[k], `${path}.${k}`, out)
  return out
}

describe("a worker-grown island", () => {
  for (const [name, fixture, gen] of [
    ["react at gen 2 (mountains, rivers, trails, folk)", REACT, 2],
    ["mcpx at gen 2", MCPX, 2],
    ["mcpx at gen 1", MCPX, 1],
  ] as const) {
    test(`is the island grown here: ${name}`, () => {
      const reply = viaWorker({ tree: tree(fixture), gen })
      if (!("grown" in reply)) throw new Error(reply.error)
      const world = worldFrom(reply.grown)
      const here = growSync(tree(fixture), gen)
      expect(differences(plain(world), plain(here))).toEqual([])
      expect(differences(populationOf(world), populationOf(here))).toEqual([])
    })
  }

  test("brings its mountains' heights as typed arrays that were moved, not copied", () => {
    const { reply, transfer } = answer({ tree: tree(REACT), gen: 2 })
    if (!("grown" in reply)) throw new Error(reply.error)
    const [massif] = reply.grown.parts.relief?.massifs ?? []
    expect(transfer).toContain(massif?.grid.data.buffer)
    structuredClone(reply, { transfer })
    expect(massif?.grid.data.byteLength).toBe(0)
  })

  test("answers a tree it cannot grow with the reason, not a throw", () => {
    const { reply } = answer({ tree: { repo: "a/b", source: "fixture", entries: null } as never, gen: 2 })
    expect("error" in reply).toBe(true)
  })
})

/** A worker that is a clone away: the pool's messages go through `answer` and a structured clone. */
class FakeWorker implements WorkerLike {
  onmessage: WorkerLike["onmessage"] = null
  onerror: WorkerLike["onerror"] = null
  terminated = false
  constructor(private readonly breaks = false) {}
  postMessage(request: GrowRequest): void {
    setTimeout(() => {
      if (this.breaks) this.onerror?.(new Error("script failed"))
      else this.onmessage?.({ data: viaWorker(request) })
    })
  }
  terminate(): void {
    this.terminated = true
  }
}

describe("the grow pool", () => {
  test("grows islands in at most `size` workers, each as the main thread would", async () => {
    const workers: FakeWorker[] = []
    const pool = new GrowPool(() => {
      const worker = new FakeWorker()
      workers.push(worker)
      return worker
    }, 2)
    const fixtures = [MCPX, REACT, MCPX]
    const worlds = await Promise.all(fixtures.map((fixture) => pool.grow(tree(fixture), 2)))
    expect(workers.length).toBe(2)
    for (const [i, world] of worlds.entries())
      expect(differences(plain(world), plain(growSync(tree(fixtures[i] as typeof MCPX), 2)))).toEqual([])
  })

  test("rejects with the worker's reason when an island cannot be grown", async () => {
    const pool = new GrowPool(() => new FakeWorker(), 1)
    await expect(pool.grow({ repo: "a/b", source: "fixture", entries: null } as never, 2)).rejects.toThrow()
  })

  test("grows on this thread when it has no workers, or when its worker cannot run", async () => {
    const want = plain(growSync(tree(MCPX), 2))
    expect(differences(plain(await new GrowPool(undefined).grow(tree(MCPX), 2)), want)).toEqual([])
    const broken = new FakeWorker(true)
    const pool = new GrowPool(() => broken, 1)
    expect(differences(plain(await pool.grow(tree(MCPX), 2)), want)).toEqual([])
    expect(broken.terminated).toBe(true)
  })
})
