/**
 * Work sliced across frames (perf2-contract §2: no main-thread task over 100 ms after the first frame).
 * A build that must run on this thread (it holds three objects: geometry baking, the crowd's clip bake)
 * calls `await slicer.yield()` between its items; nothing happens until the slice's budget is spent,
 * then the rest waits for a fresh task, so the frames keep drawing in between. The work and its
 * results are the same; only when they land changes.
 *
 *   const slicer = createSlicer()
 *   for (const item of items) { work(item); await slicer.yield() }
 *
 * Callers that wait together take turns: each yield resolves after the one before it, so the work a
 * caller does when its yield resolves is counted before the next caller is let through. (Checking the
 * budget when `yield` is called would let every caller of one microtask burst through at once, their
 * work then running back to back in one task: a 420 ms bake of a few hundred pieces, measured.)
 */

export interface Slicer {
  /** Resolves (after the callers before it) while the slice has budget left, else after the next task. */
  yield(): Promise<void>
}

/** Milliseconds of work in one slice: a few of these fit in a frame's budget, none is a long task. */
export const SLICE_MS = 24

/** A slicer on a clock (performance.now by default) with a budget per slice. */
export function createSlicer(budgetMs = SLICE_MS, now: () => number = () => performance.now()): Slicer {
  let since = now()
  let pending: Promise<void> | null = null
  let turn: Promise<void> = Promise.resolve()
  const check = (): Promise<void> | undefined => {
    if (now() - since < budgetMs) return undefined
    // every caller over the budget waits on the same fresh task, then the slice starts again
    pending ??= new Promise<void>((done) =>
      setTimeout(() => {
        pending = null
        since = now()
        done()
      }, 0),
    )
    return pending
  }
  return {
    yield() {
      const mine = turn.then(check)
      turn = mine
      return mine
    },
  }
}

/** A slicer that never yields: for the synchronous paths and the tests. */
export const NO_SLICE: Slicer = { yield: () => Promise.resolve() }
