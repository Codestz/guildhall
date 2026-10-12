/**
 * Leavers stay on stage until they have dissolved (scene/Adventurer.tsx). The store lets a leaving
 * adventurer go by story time (guild/store.ts GONE_MS + EXIT_MS); replay fast-forward runs story
 * time several times faster than anyone walks, so a leaver could vanish mid-avenue. The stage keeps
 * the last view of anyone the store let go of while leaving, until their dissolve reports done
 * (`gone`) — or, as a safety, KEEP_MAX_MS later. A rebuild (a seek, a restart) forgets them all:
 * the story jumped, nobody is mid-walk any more.
 *
 * Pure (no React, no three): Scene.tsx's Cast calls `stage` while rendering (idempotent, so a
 * StrictMode double render is harmless) and `gone` from the figure's frame.
 */
export const KEEP_MAX_MS = 20_000

interface Staged {
  id: string
  phase: string
}

export class Exits<V extends Staged> {
  private readonly last = new Map<string, V>()
  private readonly kept = new Map<string, { view: V; since: number }>()
  private readonly present = new Set<string>()
  private epoch = Number.NaN

  /** The views to mount: the store's, then leavers it let go of whose dissolve isn't done. */
  stage(views: readonly V[], epoch: number, now: number): V[] {
    if (epoch !== this.epoch) {
      this.epoch = epoch
      this.kept.clear()
      this.last.clear()
    }
    this.present.clear()
    for (const view of views) {
      this.present.add(view.id)
      this.kept.delete(view.id)
    }
    for (const [id, view] of this.last)
      if (!this.present.has(id) && view.phase === "leaving" && !this.kept.has(id))
        this.kept.set(id, { view, since: now })
    this.last.clear()
    for (const view of views) this.last.set(view.id, view)
    if (this.kept.size === 0) return views as V[]
    const out = views.slice()
    for (const [id, entry] of this.kept) {
      if (now - entry.since > KEEP_MAX_MS) this.kept.delete(id)
      else out.push(entry.view)
    }
    return out
  }

  /** A leaver's dissolve is done. True when the stage was keeping them (so it should re-render). */
  gone(id: string): boolean {
    return this.kept.delete(id)
  }

  /** Is `id` on stage only because its dissolve isn't done? */
  keeps(id: string): boolean {
    return this.kept.has(id)
  }
}
