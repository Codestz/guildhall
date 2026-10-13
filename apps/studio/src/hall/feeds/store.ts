/**
 * A snapshot for React at most `every` ms apart (plan §3.4: the HUD reads a snapshot at ~10 Hz, never
 * every frame; V1's `useSyncExternalStore` pattern). `invalidate()` says something changed; the
 * snapshot is computed again once the interval since the last one has run out, and every listener
 * hears of it once. `get()` returns the same object between recomputes, as `useSyncExternalStore` asks.
 */

export interface Throttled<T> {
  get(): T
  /** Something changed: a fresh snapshot within `every` ms. */
  invalidate(): void
  /** A fresh snapshot now (a seek the reader should see at once), then the interval again. */
  flush(): void
  subscribe(fn: () => void): () => void
  /** Stops a pending recompute (the session is gone). */
  dispose(): void
}

export interface ThrottleOptions {
  /** ms between snapshots (100: 10 Hz). */
  every?: number
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (timer: unknown) => void
}

export const SNAPSHOT_MS = 100

export function throttled<T>(compute: () => T, opts: ThrottleOptions = {}): Throttled<T> {
  const every = opts.every ?? SNAPSHOT_MS
  const now = opts.now ?? (() => performance.now())
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = opts.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>))
  let value = compute()
  let last = Number.NEGATIVE_INFINITY
  let timer: unknown = null
  let gone = false
  const listeners = new Set<() => void>()
  /** A recompute is scheduled (a flag, not the handle: a timer may run before its handle is returned). */
  let pending = false
  const run = () => {
    pending = false
    timer = null
    if (gone) return
    value = compute()
    last = now()
    for (const fn of [...listeners]) fn()
  }
  return {
    get: () => value,
    invalidate() {
      if (gone || pending) return
      pending = true
      const handle = setTimer(run, Math.max(0, last + every - now()))
      if (pending) timer = handle
    },
    flush() {
      if (gone) return
      if (pending && timer !== null) clearTimer(timer)
      run()
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    dispose() {
      gone = true
      if (pending && timer !== null) clearTimer(timer)
      pending = false
      timer = null
      listeners.clear()
    },
  }
}
