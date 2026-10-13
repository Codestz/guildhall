/**
 * The caption's two balanced lines (V1's `.story-line`, `text-wrap: balance` within 576 px): pure, so the
 * break is the same in every browser and testable. A line that fits stays one line; a longer one breaks
 * at the space that makes its two lines most nearly equal; what still overflows the second line is cut
 * (the strip never grows past two lines).
 */
import type { StoryPart } from "./types.ts"

/** One word of the caption: its span in the joined text and the parts' pieces it is made of. */
export interface CaptionWord {
  /** Offsets in the joined text, end exclusive. */
  start: number
  end: number
  pieces: readonly { part: number; text: string }[]
}

/** The caption's words, split on spaces across its parts (a name and the comma after it are one word). */
export function wordsOf(parts: readonly Pick<StoryPart, "text">[]): CaptionWord[] {
  const words: CaptionWord[] = []
  let offset = 0
  let current: { start: number; pieces: { part: number; text: string }[] } | null = null
  const close = (end: number) => {
    if (current && current.pieces.length > 0)
      words.push({ start: current.start, end, pieces: current.pieces })
    current = null
  }
  parts.forEach((part, index) => {
    for (const ch of part.text) {
      if (ch === " ") close(offset)
      else {
        current ??= { start: offset, pieces: [] }
        const last = current.pieces[current.pieces.length - 1]
        if (last && last.part === index) last.text += ch
        else current.pieces.push({ part: index, text: ch })
      }
      offset += ch.length
    }
  })
  close(offset)
  return words
}

/**
 * Where to break `widths` (each word's width) into two lines no wider than `max`, `space` apart, with
 * `lead` taken by the first line's own mark: the index of the first word of line two, or 0 for one line.
 * Of the breaks whose first line fits, the one with the narrowest wider line wins (ties: the earlier).
 */
export function balanceBreak(widths: readonly number[], space: number, max: number, lead = 0): number {
  const n = widths.length
  if (n < 2) return 0
  const total = widths.reduce((a, b) => a + b, 0) + space * (n - 1)
  if (lead + total <= max) return 0
  let best = 0
  let bestWidth = Number.POSITIVE_INFINITY
  let first = lead - space
  for (let k = 1; k < n; k++) {
    first += space + (widths[k - 1] as number)
    if (first > max) break
    const second = total - (first - lead) - space
    const wider = Math.max(first, second)
    if (wider < bestWidth) {
      bestWidth = wider
      best = k
    }
  }
  // not even the first word fits: break after it anyway, and let the lines cut
  return best === 0 ? 1 : best
}

/** The parts split at joined-text `offset` (a space, dropped): line one's parts and line two's. */
export function splitParts<P extends Pick<StoryPart, "text">>(
  parts: readonly P[],
  offset: number,
): [P[], P[]] {
  const one: P[] = []
  const two: P[] = []
  let at = 0
  for (const part of parts) {
    const end = at + part.text.length
    if (end <= offset) one.push(part)
    else if (at >= offset + 1) two.push(part)
    else {
      const head = part.text.slice(0, offset - at)
      const tail = part.text.slice(offset - at + 1)
      if (head) one.push({ ...part, text: head })
      if (tail) two.push({ ...part, text: tail })
    }
    at = end
  }
  return [one, two]
}

/** The caption's lines: one, or two balanced, given a word measure (CSS px) and the line's room. */
export function captionLines<P extends Pick<StoryPart, "text">>(
  parts: readonly P[],
  measure: (word: CaptionWord) => number,
  space: number,
  max: number,
  lead = 0,
): P[][] {
  const words = wordsOf(parts)
  const k = balanceBreak(
    words.map((w) => measure(w)),
    space,
    max,
    lead,
  )
  if (k === 0) return [[...parts]]
  const at = (words[k] as CaptionWord).start - 1
  return splitParts(parts, at)
}
