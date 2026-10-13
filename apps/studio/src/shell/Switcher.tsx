import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react"
import { jumpable, type Placed, search } from "./directory.ts"
import { SearchIcon } from "./icons.tsx"

/**
 * The quick switcher (Cmd/Ctrl+K): a filtered list of every screen. The input keeps focus the whole
 * time (arrows move the highlighted option, Enter opens it, Escape or a click outside closes), so the
 * dialog has one tab stop and no way to lose focus behind it.
 */
export function Switcher({
  current,
  onOpen,
  onClose,
}: {
  current: string
  onOpen(id: string): void
  onClose(): void
}) {
  const [text, setText] = useState("")
  const results = useMemo(() => search(text, jumpable()), [text])
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const base = useId()
  const optionId = (i: number) => `${base}-opt-${i}`

  useEffect(() => input.current?.focus(), [])
  // A new filter starts at the top; with no filter, at the screen you are on.
  useEffect(() => {
    const here = results.findIndex((p) => p.tool.id === current)
    setActive(text === "" && here >= 0 ? here : 0)
  }, [results, text, current])
  useEffect(() => {
    list.current?.querySelector(`#${CSS.escape(optionId(active))}`)?.scrollIntoView({ block: "nearest" })
  })

  const pick = (p: Placed | undefined) => {
    if (p) onOpen(p.tool.id)
  }

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    const n = results.length
    if (e.key === "ArrowDown" || (e.key === "n" && e.ctrlKey)) {
      e.preventDefault()
      if (n) setActive((a) => (a + 1) % n)
    } else if (e.key === "ArrowUp" || (e.key === "p" && e.ctrlKey)) {
      e.preventDefault()
      if (n) setActive((a) => (a - 1 + n) % n)
    } else if (e.key === "Home" && e.ctrlKey) {
      setActive(0)
    } else if (e.key === "Enter") {
      e.preventDefault()
      pick(results[active])
    } else if (e.key === "Escape") {
      e.preventDefault()
      onClose()
    } else if (e.key === "Tab") {
      e.preventDefault()
    }
  }

  // With no filter the list is grouped under headings; a filtered list is flat, best match first.
  let lastGroup: string | undefined
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the backdrop's click is the pointer twin of Escape, which the input handles.
    <div
      className="gh gh-switch-back"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="gh-switch" role="dialog" aria-modal="true" aria-label="Jump to a place">
        <div className="gh-switch-head">
          <SearchIcon size={16} />
          <input
            ref={input}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            placeholder="Jump to a place or a tool…"
            role="combobox"
            aria-expanded="true"
            aria-controls={`${base}-list`}
            aria-activedescendant={results.length ? optionId(active) : undefined}
            aria-autocomplete="list"
            spellCheck={false}
            autoComplete="off"
          />
          <span className="gh-kbd">esc</span>
        </div>
        {results.length === 0 ? (
          <p className="gh-switch-empty">Nothing matches “{text}”.</p>
        ) : (
          <div ref={list} id={`${base}-list`} className="gh-switch-list" role="listbox" aria-label="Places">
            {results.map((p, i) => {
              const groupName = p.group?.name ?? "Studio"
              const heading = text === "" && groupName !== lastGroup
              lastGroup = groupName
              return [
                heading && (
                  <div key={`h-${groupName}`} aria-hidden="true" className="head">
                    <p className="gh-eyebrow">{groupName}</p>
                  </div>
                ),
                // biome-ignore lint/a11y/useKeyWithClickEvents: options are chosen from the input (arrows + Enter); the click is the pointer path.
                <div
                  key={p.tool.id}
                  id={optionId(i)}
                  role="option"
                  tabIndex={-1}
                  aria-selected={i === active}
                  className="gh-switch-opt"
                  onMouseMove={() => setActive(i)}
                  onClick={() => pick(p)}
                >
                  <span className="name">{p.tool.name}</span>
                  <span className="purpose">{p.tool.purpose}</span>
                  <span className="where">
                    {p.tool.id === current ? "you are here" : text === "" ? "" : groupName}
                  </span>
                </div>,
              ]
            })}
          </div>
        )}
        <div className="gh-switch-foot" aria-hidden="true">
          <span>
            <i className="gh-kbd">↑</i>
            <i className="gh-kbd">↓</i> move
          </span>
          <span>
            <i className="gh-kbd">↵</i> open
          </span>
          <span>
            <i className="gh-kbd">esc</i> close
          </span>
        </div>
      </div>
    </div>
  )
}
