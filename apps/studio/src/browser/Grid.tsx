import { type CatalogEntry, PALETTE } from "@guildhall/assets"
import { memo, useEffect, useLayoutEffect, useRef, useState } from "react"
import { libraryUrl } from "../catalog.ts"
import type { Previews } from "../viewer/previews.ts"
import { flagTone } from "./Rail.tsx"
import { gridWindow, scrollToShow } from "./virtual.ts"

const TILE = { minTile: 120, tileHeight: 158, gap: 8, overscan: 3 }
/** Swatches in a placeholder's colour strip, at most. */
const STRIP = 8
/** The scroll box's padding (style.ts `.gh-scroll`), so tiles start inside it. */
const PAD = { x: 12, y: 10 }

function Placeholder({ entry }: { entry: CatalogEntry }) {
  const strip = entry.swatches.slice(0, STRIP).map((id) => PALETTE.swatches[id]?.hex ?? "#000")
  return (
    <>
      <div className="gh-ph">
        <span className="cat">{entry.category}</span>
        <span className="h num">
          {entry.size[1].toFixed(1)}
          <small>m</small>
        </span>
      </div>
      <div className="gh-strip">
        {strip.map((hex, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the strip is positional and never reorders
          <i key={i} style={{ background: hex }} />
        ))}
      </div>
    </>
  )
}

interface TileProps {
  entry: CatalogEntry
  selected: boolean
  style: { left: number; top: number; width: number; height: number }
  /** A live preview's url, for a piece with no baked thumbnail. */
  preview: string | undefined
  /** Clips a character plays (0: not animated). */
  clips: number
  onSelect(id: string): void
}

const Tile = memo(function Tile({ entry, selected, style, preview, clips, onSelect }: TileProps) {
  const image = entry.files.thumb ? libraryUrl(entry.files.thumb) : preview
  const flags = [...entry.scale.flags, ...entry.flags]
  return (
    <button
      type="button"
      className="gh-tile"
      style={style}
      aria-pressed={selected}
      title={entry.id}
      onClick={() => onSelect(entry.id)}
    >
      <div className="gh-thumb">
        {image ? <img src={image} alt="" decoding="async" /> : <Placeholder entry={entry} />}
        {flags.length > 0 && (
          <div className="gh-flagmark" title={flags.join(", ")}>
            {flags.slice(0, 3).map((f) => (
              <i key={f} style={{ background: flagTone(f) }} />
            ))}
          </div>
        )}
        {clips > 0 && (
          <span className="gh-anim" title={`animated · ${clips} clips`}>
            ▶ <span className="num">{clips}</span>
          </span>
        )}
      </div>
      <div className="gh-cap">
        <span className="name">{entry.name}</span>
        <span className="meta">
          <span className="pack">{entry.pack}</span>
          <span className="h">{entry.size[1].toFixed(1)} m</span>
        </span>
      </div>
    </button>
  )
})

interface GridProps {
  entries: readonly CatalogEntry[]
  selected: string | null
  onSelect(id: string): void
  previews: Previews | null
  /** Hands async work to the screen, so `guildhall.ready()` waits for the previews in view. */
  track(work: Promise<void>): Promise<void>
  /** Clips an entry plays; a tile with any is badged as animated. */
  clipCount(entry: CatalogEntry): number
}

/** A windowed thumbnail grid: only the rows near the view are in the DOM, so 3k+ entries scroll freely. */
export function Grid({ entries, selected, onSelect, previews, track, clipCount }: GridProps) {
  const box = useRef<HTMLDivElement>(null)
  const [view, setView] = useState({ width: 0, height: 0, scrollTop: 0 })

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () =>
      setView({ width: el.clientWidth - 2 * PAD.x, height: el.clientHeight, scrollTop: el.scrollTop })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    el.addEventListener("scroll", measure, { passive: true })
    return () => {
      observer.disconnect()
      el.removeEventListener("scroll", measure)
    }
  }, [])

  const win = gridWindow({ ...view, count: entries.length, ...TILE })

  // Previews: request the tiles in the window, and re-render (once a frame at most) as they land.
  const [, setLanded] = useState(0)
  useEffect(() => {
    if (!previews) return
    let queued = false
    return previews.subscribe(() => {
      if (queued) return
      queued = true
      requestAnimationFrame(() => {
        queued = false
        setLanded((n) => n + 1)
      })
    })
  }, [previews])
  const { first, end } = win
  useEffect(() => {
    if (!previews) return
    // Requested last-first: the queue is newest-first, so the top of the view draws first.
    for (let i = end - 1; i >= first; i--) {
      const entry = entries[i]
      if (entry && !entry.files.thumb) previews.request(entry)
    }
    track(previews.idle())
  }, [previews, entries, first, end, track])

  // A new selection (a click, a deep link, `ext.studio.select`) scrolls its tile into view. Only the
  // selection or the column count moves the scroll, never a scroll itself, so the window is read live.
  const index = selected ? entries.findIndex((e) => e.id === selected) : -1
  const live = useRef(win)
  live.current = win
  const columns = win.columns
  const measured = view.width > 0
  useEffect(() => {
    const el = box.current
    if (!el || index < 0 || !measured || columns < 1) return
    const top = scrollToShow(
      index,
      live.current,
      Math.max(0, el.scrollTop - PAD.y),
      el.clientHeight - 2 * PAD.y,
    )
    if (top !== null) el.scrollTop = top
  }, [index, columns, measured])

  if (entries.length === 0) {
    return (
      <div className="gh-scroll" ref={box}>
        <div className="gh-empty">
          <h2>No pieces match</h2>
          <p>Loosen a filter or clear the search.</p>
        </div>
      </div>
    )
  }

  const tiles = []
  for (let i = win.first; i < win.end; i++) {
    const entry = entries[i]
    if (!entry) continue
    const style = {
      left: PAD.x + (i % win.columns) * (win.tileWidth + TILE.gap),
      top: PAD.y + Math.floor(i / win.columns) * win.rowHeight,
      width: win.tileWidth,
      height: TILE.tileHeight,
    }
    tiles.push(
      <Tile
        key={entry.id}
        entry={entry}
        selected={entry.id === selected}
        style={style}
        preview={previews?.get(entry.id)}
        clips={clipCount(entry)}
        onSelect={onSelect}
      />,
    )
  }
  return (
    <div className="gh-scroll" ref={box}>
      <div style={{ height: win.totalHeight }} />
      {tiles}
    </div>
  )
}
