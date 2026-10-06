import { type CSSProperties, memo, type ReactNode, useEffect, useRef, useState } from "react"
import type { GuildStore } from "../guild/store.ts"
import { type Caption, listen, Narrator } from "../guild/story.ts"

/** The fade out, ms (matches `.story-line` in hall.css). */
const FADE_MS = 650

/**
 * Story captions (guild/story.ts): one narrated line at a time, lower centre, like a film's
 * subtitles. It runs on moments and timers, never on the frame or the store's ~10 Hz refresh:
 * memoised, it re-renders only when a line appears or fades.
 *
 *   visible        Minimal and Hidden show the strip. Detailed hides it (the chronicle is open and
 *                  says the same), but keeps the narrator running for screen readers.
 *   announcePleas  The plea banner already speaks assertively; the strip only voices pleas when
 *                  that banner is gone (the Hidden HUD).
 *   quietMs        Nothing at first, so the showcase's own opening caption speaks alone.
 *
 * Screen readers hear a polite live region with the beats that matter (quests, pleas, failures,
 * loot, the end), at most one line per narrator gap: routine deeds are shown, not spoken.
 */
export const Captions = memo(function Captions({
  store,
  visible,
  announcePleas,
  quietMs,
}: {
  store: GuildStore
  visible: boolean
  announcePleas: boolean
  quietMs: number
}) {
  const [shown, setShown] = useState<{ caption: Caption; leaving: boolean } | undefined>()
  const [said, setSaid] = useState("")
  // Read inside the narrator's callbacks without restarting it when the HUD mode changes.
  const pleasAloud = useRef(announcePleas)
  pleasAloud.current = announcePleas

  useEffect(() => {
    const clock = () => performance.now()
    const narrator = new Narrator({
      session: (id) => store.sessionOf(id),
      actor: (id) => store.views.find((view) => view.id === id),
    })
    narrator.quietUntil = clock() + quietMs
    let timer: ReturnType<typeof setTimeout> | undefined
    let wakeAt = Number.POSITIVE_INFINITY
    let hide: ReturnType<typeof setTimeout> | undefined
    let gone: ReturnType<typeof setTimeout> | undefined

    const look = () => {
      timer = undefined
      wakeAt = Number.POSITIVE_INFINITY
      const caption = narrator.next(clock())
      if (caption) {
        clearTimeout(hide)
        clearTimeout(gone)
        setShown({ caption, leaving: false })
        if (caption.priority >= 2 && (pleasAloud.current || caption.kind !== "plea")) setSaid(caption.text)
        hide = setTimeout(() => {
          setShown((s) => (s?.caption.key === caption.key ? { caption, leaving: true } : s))
          gone = setTimeout(() => setShown((s) => (s?.caption.key === caption.key ? undefined : s)), FADE_MS)
        }, caption.hold)
      }
      schedule()
    }
    /** Look again when the narrator says something could be due; never twice for one wake. */
    const schedule = () => {
      const at = narrator.wake(clock())
      if (at === undefined || at >= wakeAt) return
      clearTimeout(timer)
      wakeAt = at
      timer = setTimeout(look, Math.max(0, at - clock()))
    }
    const off = listen(store.moments, narrator, clock, schedule, () => {
      // A seek or a load: the line on screen belongs to the old story.
      setShown((s) => (s && s.caption.kind !== "complete" ? { ...s, leaving: true } : s))
      schedule()
    })
    return () => {
      off()
      clearTimeout(timer)
      clearTimeout(hide)
      clearTimeout(gone)
    }
  }, [store, quietMs])

  const caption = shown?.caption
  return (
    <>
      <div className="story" data-visible={visible} aria-hidden="true">
        {caption && (
          <p
            key={caption.key}
            className="story-line"
            data-kind={caption.kind}
            data-leaving={shown?.leaving ?? false}
          >
            {caption.parts.map((part, i) =>
              part.color ? (
                // biome-ignore lint/suspicious/noArrayIndexKey: a caption's parts never reorder
                <b key={i} style={{ "--role": part.color } as CSSProperties}>
                  {part.text}
                </b>
              ) : (
                // biome-ignore lint/suspicious/noArrayIndexKey: a caption's parts never reorder
                <span key={i}>{quoted(part.text)}</span>
              ),
            )}
          </p>
        )}
      </div>
      <p className="visually-hidden" aria-live="polite" aria-atomic="true">
        {said}
      </p>
    </>
  )
})

/** Real content — a quest's words, an error, the loot — set in italic, the narration upright. */
function quoted(text: string): ReactNode {
  const pieces = text.split(/(“[^”]*”)/)
  if (pieces.length === 1) return text
  // biome-ignore lint/suspicious/noArrayIndexKey: split pieces never reorder
  return pieces.map((piece, i) => (piece.startsWith("“") ? <q key={i}>{piece.slice(1, -1)}</q> : piece))
}
