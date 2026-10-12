/**
 * Live tile previews while the library has no baked thumbnails (`files.thumb` null): each piece in
 * view is loaded and drawn once through render's `renderThumbnail`, on the inspector's renderer, and
 * kept as an object URL for the screen's life. One draw at a time, newest request first, so the tiles
 * the user is looking at fill before the ones scrolled past.
 */
import type { CatalogEntry } from "@guildhall/assets"
import { log } from "@guildhall/core"
import { loadPiece, renderThumbnail, type Stage } from "@guildhall/render"
import { libraryUrl } from "../catalog.ts"

const logger = log("studio:previews")

/** Pixels a side: a tile is ~140 CSS px at DPR 2. */
const SIZE = 256

export interface Previews {
  /** The preview's object URL, once drawn. */
  get(id: string): string | undefined
  /** Queues a draw (no-op when drawn, queued or failed). */
  request(entry: CatalogEntry): void
  /** Called with the id of each preview as it lands; returns the unsubscribe. */
  subscribe(fn: (id: string) => void): () => void
  /** Settles when the queue is empty. */
  idle(): Promise<void>
  dispose(): void
}

export function createPreviews(stage: Stage): Previews {
  const urls = new Map<string, string>()
  const seen = new Set<string>()
  const queue: CatalogEntry[] = []
  const listeners = new Set<(id: string) => void>()
  let running: Promise<void> | null = null
  let disposed = false

  const draw = async (entry: CatalogEntry) => {
    const piece = await loadPiece(libraryUrl(entry.files.glb))
    const blob = await renderThumbnail(stage.renderer, piece, { size: SIZE })
    if (disposed) return
    urls.set(entry.id, URL.createObjectURL(blob))
    for (const fn of listeners) fn(entry.id)
  }

  const pump = async () => {
    for (let next = queue.pop(); next && !disposed; next = queue.pop()) {
      try {
        await draw(next)
      } catch (error) {
        logger.warn("preview failed", { id: next.id, error: String(error) })
      }
    }
    running = null
  }

  return {
    get: (id) => urls.get(id),
    request(entry) {
      if (disposed || seen.has(entry.id)) return
      seen.add(entry.id)
      queue.push(entry)
      running ??= pump()
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    idle: async () => {
      while (running) await running
    },
    dispose() {
      disposed = true
      queue.length = 0
      for (const url of urls.values()) URL.revokeObjectURL(url)
      urls.clear()
      listeners.clear()
    },
  }
}
