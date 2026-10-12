import { useRef } from "react"
import { chapterLabel, type GuildStore } from "../guild/store.ts"

/**
 * The chapter chip (showcase): which act of the told story is playing (`III · The storm`), and a
 * short list to jump to the start of another, where its title card is told again. Shown only for
 * a story with chapters (the Saga); nothing for the others or live.
 */
export function ChapterChip({ store }: { store: GuildStore }) {
  const menu = useRef<HTMLDetailsElement>(null)
  const chapter = store.chapter
  if (store.mode !== "sim" || !chapter) return null
  const current = store.chapters.indexOf(chapter)
  return (
    <details className="plaque chapter-chip" ref={menu}>
      <summary aria-label={`${chapterLabel(chapter)}. Jump to another act`} title="Chapters">
        <span className="chapter-numeral">{chapter.numeral}</span>
        <span className="chapter-title">{chapter.title}</span>
      </summary>
      <ol className="chapter-list">
        {store.chapters.map((c, i) => (
          <li key={c.numeral}>
            <button
              type="button"
              aria-current={i === current ? "step" : undefined}
              onClick={() => {
                store.seekChapter(i)
                menu.current?.removeAttribute("open")
              }}
            >
              <span className="chapter-numeral">{c.numeral}</span>
              <span className="chapter-title">{c.title}</span>
              <small>{c.tagline}</small>
            </button>
          </li>
        ))}
      </ol>
    </details>
  )
}
