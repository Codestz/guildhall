/**
 * Story captions (V1's hud/Captions.tsx), fed by props: one narrated line at a time, lower centre, like a
 * film's subtitles. The caller runs the sim's Narrator and hands over each caption as it is told; this
 * shows it for its `hold`, fades it, and clears it. V1's pill: 19 px serif, two balanced lines at most
 * within 576 px (balance.ts), a diamond in the beat's tone before it, names bold and underlined in their
 * banner colour, real content (a quest, an error) in italic. A chapter's title card is V1's three lines:
 * the act in small caps, its title large, its tagline in italic.
 *
 * Never takes a click. Screen readers hear a polite live region with the beats that matter (priority
 * 2 and up: quests, pleas, failures, loot, the end), the whole line, never clipped.
 */
import {
  type CSSProperties,
  memo,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { type CaptionWord, captionLines } from "./balance.ts"
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
        {line && <CaptionLine key={line.key} line={line} leaving={shown?.leaving ?? false} />}
      </div>
      <p className="ui-visually-hidden" aria-live="polite" aria-atomic="true">
        {said}
      </p>
    </>
  )
})

/** The widest a caption line runs (V1: the strip between the toasts and the act chip at 1440 px). */
export const CAPTION_MAX = 576

let ruler: CanvasRenderingContext2D | null | undefined

/** A word's width in the caption's face (its bold pieces in the bold), CSS px. */
function measurer(el: HTMLElement): {
  measure: (w: CaptionWord, parts: readonly StoryPart[]) => number
  space: number
} {
  ruler ??= document.createElement("canvas").getContext("2d")
  const css = getComputedStyle(el)
  const font = (weight: string) => `${weight} ${css.fontSize} ${css.fontFamily}`
  const width = (text: string, weight: string) => {
    if (!ruler) return text.length * Number.parseFloat(css.fontSize) * 0.5
    ruler.font = font(weight)
    return ruler.measureText(text).width
  }
  return {
    measure: (w, parts) =>
      w.pieces.reduce((sum, p) => sum + width(p.text, parts[p.part]?.color ? "600" : css.fontWeight), 0),
    space: width(" ", css.fontWeight),
  }
}

/**
 * One caption: two balanced lines at most (balance.ts), the diamond before the first. Measured before
 * paint against the room the strip gives it (at most CAPTION_MAX); a second line that still overflows is cut.
 */
function CaptionLine({ line, leaving }: { line: CaptionView; leaving: boolean }) {
  const el = useRef<HTMLParagraphElement>(null)
  const parts = useMemo(() => sentenceCase(line.parts), [line.parts])
  const [lines, setLines] = useState<StoryPart[][]>(() => [parts])

  useLayoutEffect(() => {
    const p = el.current
    if (!p || line.kind === "chapter") return
    const fit = () => {
      const css = getComputedStyle(p)
      const room = Math.min(CAPTION_MAX, p.parentElement?.clientWidth ?? CAPTION_MAX)
      const pad = Number.parseFloat(css.paddingLeft) + Number.parseFloat(css.paddingRight)
      // the diamond before the first row: 7 px and its 11 px gap
      const lead = 18
      const { measure, space } = measurer(p)
      // a hair of slack: canvas and layout round differently
      setLines(captionLines(parts, (w) => measure(w, parts), space, room - pad - 2, lead))
    }
    fit()
    const parent = p.parentElement
    if (!parent || typeof ResizeObserver === "undefined") return
    const watch = new ResizeObserver(fit)
    watch.observe(parent)
    return () => watch.disconnect()
  }, [parts, line.kind])

  if (line.kind === "chapter")
    return (
      <p className="st-caption" data-kind="chapter" data-leaving={leaving}>
        <small>{line.parts[0]?.text}</small>
        <span className="st-caption-title">{line.parts[1]?.text}</span>
        {line.parts[2] && <em>{line.parts[2].text}</em>}
      </p>
    )
  return (
    <p ref={el} className="st-caption" data-kind={line.kind} data-leaving={leaving} data-lines={lines.length}>
      {lines.map((row, r) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a caption's lines never reorder
        <span key={r} className="st-caption-row">
          {row.map((part, i) =>
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
        </span>
      ))}
    </p>
  )
}

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
  // a quote the line break cut in two: its open half runs to the line's end, its close half from its start
  const pieces = text.split(/(“[^”]*”|“[^”]*$|^[^“”]*”)/)
  if (pieces.length === 1) return text
  return pieces.map((piece, i) =>
    piece.startsWith("“") && piece.endsWith("”") ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: split pieces never reorder
      <q key={i}>{piece.slice(1, -1)}</q>
    ) : piece.startsWith("“") || piece.endsWith("”") ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: split pieces never reorder
      <i key={i}>{piece}</i>
    ) : (
      piece
    ),
  )
}
