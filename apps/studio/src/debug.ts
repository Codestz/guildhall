import { configureLog, type GuildhallDebug, logRecords } from "@guildhall/core"
import type { Stage } from "@guildhall/render"
import { canonical, here } from "./shell/router.ts"

declare global {
  interface Window {
    guildhall?: GuildhallDebug
  }
}

/** The studio's side of `window.guildhall`: the shell feeds it the live stage, loads and mounts. */
export interface DebugHost {
  api: GuildhallDebug
  /** The current screen's stage, or null between screens. */
  stage(): Stage | null
  attach(stage: Stage | null): void
  /** Tracks async work; `ready()` waits until none is left. */
  load<T>(work: Promise<T>): Promise<T>
  /** The shell calls this once a screen has mounted. */
  mounted(): void
}

const VERSION = "0.0.0"

/** Frames `ready()` waits for after the last load, so what loaded has been drawn, not just added. */
const SETTLE_FRAMES = 2

export function createDebug(): DebugHost {
  let stage: Stage | null = null
  let unsubscribe: (() => void) | null = null
  const pending = new Set<Promise<unknown>>()
  const mountWaiters = new Set<() => void>()
  const frameWaiters = new Set<{ left: number; done: () => void }>()

  const load = <T>(work: Promise<T>): Promise<T> => {
    pending.add(work)
    const forget = () => void pending.delete(work)
    work.then(forget, forget)
    return work
  }

  /** A load that settles at the next mount: the first screen at boot, the new one after `open`. */
  const expectMount = () => load(new Promise<void>((done) => mountWaiters.add(done)))

  // onFrame runs just before the stage draws, in the same task: a timeout after it lands after the draw.
  const tick = () => {
    for (const waiter of frameWaiters) {
      waiter.left -= 1
      if (waiter.left > 0) continue
      frameWaiters.delete(waiter)
      setTimeout(waiter.done, 0)
    }
  }

  /** Resolves once `n` more frames have been drawn (animation frames when no stage is up). */
  const frames = (n: number) =>
    new Promise<void>((done) => {
      if (stage) {
        frameWaiters.add({ left: n, done })
        return
      }
      const step = (left: number) => (left <= 0 ? done() : requestAnimationFrame(() => step(left - 1)))
      step(n)
    })

  const ready = async () => {
    for (;;) {
      while (pending.size > 0) await Promise.allSettled([...pending])
      await frames(SETTLE_FRAMES)
      if (pending.size === 0) return
    }
  }

  const requireStage = (): Stage => {
    if (!stage) throw new Error("guildhall: no stage is mounted")
    return stage
  }

  expectMount()

  const api: GuildhallDebug = {
    version: VERSION,
    app: "studio",
    ready,
    log: { records: logRecords, configure: configureLog },
    perf: {
      now: () => requireStage().stats(),
      sample: (ms) => requireStage().sample(ms),
    },
    camera: {
      get: () => requireStage().getCamera(),
      async set(pose) {
        requireStage().setCamera(pose)
        await frames(1)
      },
      mode: () => requireStage().rig.mode(),
      async setMode(mode) {
        const rig = requireStage().rig
        rig.setMode(mode)
        // A glide back to orbit runs for under a second: wait it out, then one more frame drawn.
        for (let i = 0; i < 240 && rig.gliding(); i++) await frames(1)
        await frames(1)
      },
      async fly(state) {
        requireStage().rig.fly(state)
        await frames(1)
      },
    },
    // A path (`/pieces/kaykit-adventurers/barbarian?clip=Chopping`) or an old query (`?screen=pieces&…`).
    async open(target) {
      const url = canonical(target)
      if (url !== here()) {
        expectMount()
        history.pushState(null, "", url)
        dispatchEvent(new PopStateEvent("popstate"))
      }
      await ready()
    },
    ext: {},
  }

  return {
    api,
    stage: () => stage,
    attach(next) {
      unsubscribe?.()
      unsubscribe = next ? next.onFrame(tick) : null
      stage = next
    },
    load,
    mounted() {
      for (const done of mountWaiters) done()
      mountWaiters.clear()
    },
  }
}
