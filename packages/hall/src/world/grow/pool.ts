import type { Gen } from "../gen/islandFromTree.ts"
import type { Tree } from "../gen/load.ts"
import type { World } from "../world.ts"
import { growSync, worldFrom } from "./grow.ts"
import type { GrowReply, GrowRequest } from "./job.ts"

/**
 * Islands grown off the main thread: up to `size` workers (the home island and the archipelago's
 * far ones, in the order asked), each running one job at a time. Without workers (tests, node, a
 * browser that has none) or after one fails, the same job runs on this thread (`growSync`), so a
 * caller never knows the difference but in the stall.
 */

/** The part of a Worker the pool uses, so tests can stand a fake in. */
export interface WorkerLike {
  postMessage(request: GrowRequest): void
  onmessage: ((event: { data: GrowReply }) => void) | null
  onerror: ((event: unknown) => void) | null
  terminate(): void
}

interface Job extends GrowRequest {
  resolve(world: World): void
  reject(error: Error): void
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
  grow(tree: Tree, gen: Gen): Promise<World> {
    if (!this.spawn) return new Promise((resolve) => resolve(growSync(tree, gen)))
    return new Promise((resolve, reject) => {
      this.queue.push({ tree, gen, resolve, reject })
      this.pump()
    })
  }

  private pump(): void {
    while (this.queue.length > 0) {
      const worker = this.idle.pop() ?? this.start()
      if (!worker) return
      const job = this.queue.shift() as Job
      this.busy.set(worker, job)
      worker.postMessage({ tree: job.tree, gen: job.gen })
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
        if ("error" in data) job.reject(new Error(data.error))
        else job.resolve(worldFrom(data.grown))
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
      for (const job of stranded) this.grow(job.tree, job.gen).then(job.resolve, job.reject)
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
