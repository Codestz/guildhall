/**
 * The chapter chip (V1's hud/Chapter.tsx), fed by props: which act of a told story is playing
 * (`III · The storm`), and a short list to jump to the start of another. Collapsed it is a chip; on a
 * phone (or `compact`) just the numeral. The list is a popover above it: ↑ ↓ move, Enter jumps, Esc
 * (or a click elsewhere) closes it and focus returns to the chip. Nothing for a story without acts.
 */
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react"
import type { ChapterView } from "./types.ts"

export interface ChapterChipProps {
  chapters: readonly ChapterView[]
  /** The act playing, an index into `chapters`. */
  current: number
  onJump: (index: number) => void
  /** The numeral alone. */
  compact?: boolean
  /** Open on mount (the lab, shots). */
  open?: boolean
  className?: string
}

export function ChapterChip({
  chapters,
  current,
  onJump,
  compact,
  open: opened = false,
  className,
}: ChapterChipProps) {
  const id = useId()
  const [open, setOpen] = useState(opened)
  const root = useRef<HTMLDivElement>(null)
  const chip = useRef<HTMLButtonElement>(null)
  const items = useRef<(HTMLButtonElement | null)[]>([])
  const chapter = chapters[current]

  // biome-ignore lint/correctness/useExhaustiveDependencies: focus the playing act as the list opens
  useEffect(() => {
    if (!open) return
    items.current[current]?.focus({ preventScroll: true })
    const away = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("pointerdown", away)
    return () => document.removeEventListener("pointerdown", away)
  }, [open])

  if (!chapter) return null

  function close() {
    setOpen(false)
    chip.current?.focus()
  }

  function onListKey(event: KeyboardEvent) {
    const at = items.current.indexOf(document.activeElement as HTMLButtonElement)
    const last = chapters.length - 1
    const to =
      event.key === "ArrowDown"
        ? at >= last
          ? 0
          : at + 1
        : event.key === "ArrowUp"
          ? at <= 0
            ? last
            : at - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : -1
    if (event.key === "Escape") {
      event.stopPropagation()
      close()
      return
    }
    if (event.key === "Tab") {
      setOpen(false)
      return
    }
    if (to < 0) return
    event.preventDefault()
    items.current[to]?.focus()
  }

  return (
    <div
      ref={root}
      className={`st-chapter-chip${className ? ` ${className}` : ""}`}
      data-compact={compact ?? false}
    >
      <button
        ref={chip}
        type="button"
        className="st-chapter-btn"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-label={`Act ${chapter.numeral}, ${chapter.title}. Jump to another act`}
        title="Chapters"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="st-chapter-numeral">{chapter.numeral}</span>
        <span className="st-chapter-title">{chapter.title}</span>
      </button>
      {open && (
        // biome-ignore lint/a11y/noStaticElementInteractions: the list's arrow keys move between its buttons
        <div className="ui-panel st-chapter-pop" id={`${id}-list`} onKeyDown={onListKey}>
          <p className="ui-eyebrow st-chapter-pop-h">Acts</p>
          <ol className="st-chapter-list">
            {chapters.map((c, i) => (
              <li key={c.numeral}>
                <button
                  ref={(el) => {
                    items.current[i] = el
                  }}
                  type="button"
                  aria-current={i === current ? "step" : undefined}
                  onClick={() => {
                    onJump(i)
                    close()
                  }}
                >
                  <span className="st-chapter-numeral">{c.numeral}</span>
                  <span className="st-chapter-title">{c.title}</span>
                  <small>{c.tagline}</small>
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}
