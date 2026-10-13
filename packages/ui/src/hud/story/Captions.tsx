/**
 * Story captions (V1's hud/Captions.tsx), fed by props: one narrated line at a time, lower centre, like a
 * film's subtitles. The caller runs the sim's Narrator and hands over each caption as it is told; this
 * shows it for its `hold`, fades it, and clears it. One short line (it never wraps: the HUD keeps the
 * world the hero), names underlined in their banner colour, real content (a quest, an error) in italic.
 * A chapter's title card is the same single line: `Act III · The storm — The tests turn red`.
 *
 * Never takes a click. Screen readers hear a polite live region with the beats that matter (priority
 * 2 and up: quests, pleas, failures, loot, the end), the whole line, never clipped.
 */
import { type CSSProperties, memo, type ReactNode, useEffect, useState } from "react"
import type { CaptionView, StoryPart } from "./types.ts"

/** The fade out, ms (matches `.st-caption` in the sheet). */
export const CAPTION_FADE_MS = 650

export interface CaptionsProps {
  /** The line just told (a new `key` is a new line); undefined says nothing new. */
  caption?: CaptionView
  /** Show the strip (Detailed HUD hides it: the chronicle says the same); the live region speaks anyway. */
  visible?: boolean
  /** Voice pleas too: off while the plea banner already speaks them. */
  announcePleas?: boolean
  /** Hold the line on screen (shots, the lab). */
  still?: boolean
}

export const Captions = memo(function Captions({
  caption,
  visible = true,
  announcePleas = true,
  still = false,
}: CaptionsProps) {
  const [shown, setShown] = useState<{ caption: CaptionView; leaving: boolean } | undefined>()
  const [said, setSaid] = useState("")

  // biome-ignore lint/correctness/useExhaustiveDependencies: one schedule per line, keyed by its key
  useEffect(() => {
    if (!caption) return
    setShown({ caption, leaving: false })
    if (caption.priority >= 2 && (announcePleas || caption.kind !== "plea")) setSaid(caption.text)
    if (still) return
    let gone: ReturnType<typeof setTimeout> | undefined
    const hide = setTimeout(() => {
      setShown((s) => (s?.caption.key === caption.key ? { caption, leaving: true } : s))
      gone = setTimeout(
        () => setShown((s) => (s?.caption.key === caption.key ? undefined : s)),
        CAPTION_FADE_MS,
      )
    }, caption.hold)
    return () => {
      clearTimeout(hide)
      clearTimeout(gone)
    }
  }, [caption?.key, still])

  const line = shown?.caption
  return (
    <>
      <div className="st-captions" data-visible={visible} aria-hidden="true">
        {line && (
          <p
            key={line.key}
            className="st-caption"
            data-kind={line.kind}
            data-leaving={shown?.leaving ?? false}
          >
            {line.kind === "chapter" ? (
              <>
                <small>{line.parts[0]?.text}</small>
                <span className="st-caption-title">{line.parts[1]?.text}</span>
                {line.parts[2] && <em> — {line.parts[2].text}</em>}
              </>
            ) : (
              sentenceCase(line.parts).map((part, i) =>
                part.color ? (
                  // biome-ignore lint/suspicious/noArrayIndexKey: a caption's parts never reorder
                  <b key={i} style={{ "--role": part.color } as CSSProperties}>
                    {part.text}
                  </b>
                ) : (
                  // biome-ignore lint/suspicious/noArrayIndexKey: a caption's parts never reorder
                  <span key={i}>{quoted(part.text)}</span>
                ),
              )
            )}
          </p>
        )}
      </div>
      <p className="ui-visually-hidden" aria-live="polite" aria-atomic="true">
        {said}
      </p>
    </>
  )
})

/**
 * A name that opens a sentence takes its capital (`complete. The Guildmaster`): the narrator capitalises
 * only a line's first part (the sim's `sentenceCase`, which the recap applies, does the same).
 */
function sentenceCase(parts: readonly StoryPart[]): StoryPart[] {
  return parts.map((part, i) => {
    const before = i === 0 ? "" : (parts[i - 1] as StoryPart).text
    return (i === 0 || /[.!?]\s*$/.test(before)) && /^[a-z]/.test(part.text)
      ? { ...part, text: (part.text[0] ?? "").toUpperCase() + part.text.slice(1) }
      : part
  })
}

/** Real content (a quest's words, an error, the loot) set in italic, the narration upright. */
function quoted(text: string): ReactNode {
  const pieces = text.split(/(“[^”]*”)/)
  if (pieces.length === 1) return text
  // biome-ignore lint/suspicious/noArrayIndexKey: split pieces never reorder
  return pieces.map((piece, i) => (piece.startsWith("“") ? <q key={i}>{piece.slice(1, -1)}</q> : piece))
}
