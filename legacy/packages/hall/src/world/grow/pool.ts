import type { Gen } from "../gen/islandFromTree.ts"
import type { Tree } from "../gen/load.ts"
import type { SplitLayout } from "../repoArchipelago.ts"
import type { World, WorldParts } from "../world.ts"
import { growSyncParts, worldFrom } from "./grow.ts"
import type { GrowReply, GrowRequest, LayoutReply, LayoutRequest } from "./job.ts"
import { type LayoutInput, layoutOf } from "./layout.ts"

/**
 * Islands grown off the main thread: up to `size` workers (the home island and the archipelago's
 * far ones, in the order asked), each running one job at a time. A job is an island to grow, or a
 * split repo's islands to lay out (grow/layout.ts). Without workers (tests, node, a browser that has
 * none) or after one fails, the same job runs on this thread, so a caller never knows the difference
 * but in the stall.
 */

/** The part of a Worker the pool uses, so tests can stand a fake in. */
export interface WorkerLike {
  postMessage(request: GrowRequest | LayoutRequest): void
  onmessage: ((event: { data: GrowReply | LayoutReply }) => void) | null
  onerror: ((event: unknown) => void) | null
  terminate(): void
}

/** An island with the data it was grown from (what a layout job is sent). */
export interface GrownIsland {
  world: World
  parts: WorldParts
}

interface Job {
  request: GrowRequest | LayoutRequest
  /** The reply, taken as the caller wants it (throws for a reply that is not its kind). */
  settle(reply: GrowReply | LayoutReply): void
  reject(error: Error): void
  /** The same job on this thread, if no worker can run it. */
  local(): void
}

export class GrowPool {
  private idle: WorkerLike[] = []
  private busy = new Map<WorkerLike, Job>()
  private queue: Job[] = []
  private spawned = 0

  constructor(
    private spawn: (() => WorkerLike) | undefined,
    private readonly size = 2,
  ) {}

  /** The island of `tree` as generator `gen` grows it. */
  async grow(tree: Tree, gen: Gen): Promise<World> {
    return (await this.growParts(tree, gen)).world
  }

  /** The island, and the data it was made of: a split repo's layout needs the latter. */
  growParts(tree: Tree, gen: Gen): Promise<GrownIsland> {
    return this.run(
      { tree, gen },
      (reply) => {
        if (!("grown" in reply)) throw new Error("error" in reply ? reply.error : "no island came back")
        return { world: worldFrom(reply.grown), parts: reply.grown.parts }
      },
      () => growSyncParts(tree, gen),
    )
  }

  /** A split repo's islands laid out (grow/layout.ts), in a worker: the sea the loader waits for, off the main thread. */
  layout(input: LayoutInput): Promise<SplitLayout> {
    return this.run(
      { layout: input },
      (reply) => {
        if (!("layout" in reply)) throw new Error("error" in reply ? reply.error : "no layout came back")
        return reply.layout
      },
      () => layoutOf(input),
    )
  }

  private run<T>(
    request: Job["request"],
    read: (reply: GrowReply | LayoutReply) => T,
    local: () => T,
  ): Promise<T> {
    if (!this.spawn) return new Promise((resolve) => resolve(local()))
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        request,
        settle: (reply) => {
          if ("error" in reply) reject(new Error(reply.error))
          else resolve(read(reply))
        },
        reject,
        local: () => resolve(local()),
      })
      this.pump()
    })
  }

  private pump(): void {
    while (this.queue.length > 0) {
      const worker = this.idle.pop() ?? this.start()
      if (!worker) return
      const job = this.queue.shift() as Job
      this.busy.set(worker, job)
      worker.postMessage(job.request)
    }
  }

  private start(): WorkerLike | undefined {
    if (!this.spawn || this.spawned >= this.size) return undefined
    const worker = this.spawn()
    this.spawned++
    worker.onmessage = ({ data }) => {
      const job = this.busy.get(worker) as Job
      this.busy.delete(worker)
      this.idle.push(worker)
      try {
        job.settle(data)
      } catch (error) {
        job.reject(error as Error)
      }
      this.pump()
    }
    // A worker that cannot run at all (its script failed to load): every job from here on is this thread's.
    worker.onerror = () => {
      this.spawn = undefined
      worker.terminate()
      const stranded = [...(this.busy.get(worker) ? [this.busy.get(worker) as Job] : []), ...this.queue]
      this.busy.delete(worker)
      this.queue = []
      for (const job of stranded)
        try {
          job.local()
        } catch (error) {
          job.reject(error as Error)
        }
    }
    return worker
  }
}

/** The hall's pool: workers when the browser has them, else this thread. */
export const growPool = new GrowPool(
  typeof Worker !== "undefined" && typeof document !== "undefined"
    ? () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }) as unknown as WorkerLike
    : undefined,
)
