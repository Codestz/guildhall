import type { Recap } from "../guild/recap.ts"
import type { CaptionPart } from "../guild/story.ts"

/**
 * The Chronicle card, drawn: the hero frame (hud/RecapCapture.ts) with the recap (guild/recap.ts)
 * set over it in the hall's own voice — the og card's ink wash, brass corner ticks and hairline,
 * Marcellus SC for the marks, Alegreya for the tale, JetBrains Mono for the numbers (as /how sets
 * them). Two shapes: landscape 1200×630 (Open Graph's) and portrait 1080×1350 (a feed's).
 *
 * The layout helpers (`wrapRuns`, `readable`) are pure and take a measure function, so they are
 * tested without a canvas (test/recap.test.ts).
 */

export type Format = "landscape" | "portrait"
export const SIZES: Record<Format, { width: number; height: number }> = {
  landscape: { width: 1200, height: 630 },
  portrait: { width: 1080, height: 1350 },
}

// hall.css :root, as the card needs it (a canvas reads no CSS variables).
const C = {
  ink: "#15110d",
  paper: "#f3e9d4",
  muted: "#cdbfa3",
  faint: "#ab9e85",
  brass: "#dcb662",
  brassHi: "#f1d590",
  brassLine: "rgba(220, 182, 98, 0.42)",
  hair: "rgba(243, 233, 212, 0.14)",
}
const F = {
  display: '"Marcellus SC", "Cormorant SC", Georgia, serif',
  serif: '"Alegreya", "Iowan Old Style", Georgia, serif',
  body: '"Alegreya Sans", "Gill Sans", "Trebuchet MS", sans-serif',
  mono: '"JetBrains Mono", ui-monospace, Menlo, monospace',
}
/** The faces the card draws with: loaded before the first card, or the canvas falls back silently. */
export const FACES = [
  `400 20px ${F.display}`,
  `600 20px ${F.serif}`,
  `italic 400 20px ${F.serif}`,
  `400 20px ${F.body}`,
  `500 20px ${F.body}`,
  `400 20px ${F.mono}`,
]

export async function loadFaces(): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return
  await Promise.all(FACES.map((face) => document.fonts.load(face).catch(() => [])))
}

// ── pure layout ──

/** A run of text in one colour, on one line. */
export interface Run {
  text: string
  color?: string
}

/**
 * Words wrapped into lines no wider than `width`, keeping each part's colour; at most `max` lines,
 * the last ending in `…` when the text goes on. `measure` gives a string's width in the font used.
 */
export function wrapRuns(
  parts: readonly CaptionPart[],
  measure: (text: string) => number,
  width: number,
  max: number,
): Run[][] {
  // Words, each remembering its colour; a space belongs to the word before it.
  const words: Run[] = []
  for (const part of parts)
    for (const piece of part.text.split(/(?<=\s)/)) {
      if (piece === "") continue
      words.push(part.color ? { text: piece, color: part.color } : { text: piece })
    }
  const lines: Run[][] = []
  let line: Run[] = []
  let used = 0
  const push = () => {
    lines.push(merge(line))
    line = []
    used = 0
  }
  for (const word of words) {
    const w = measure(word.text.trimEnd())
    if (used > 0 && used + w > width) push()
    line.push(word)
    used += measure(word.text)
  }
  if (line.length) push()
  if (lines.length <= max) return lines.map(trimEnd)
  const kept = lines.slice(0, max)
  const last = kept[max - 1] as Run[]
  // Shorten the last kept line until it fits with its ellipsis.
  let text = last.map((r) => r.text).join("")
  while (text.length > 1 && measure(`${text.trimEnd()}…`) > width) text = text.slice(0, -1)
  kept[max - 1] = cut(last, text.trimEnd().replace(/[\s,;:—-]+$/, ""), "…")
  return kept.map(trimEnd)
}

/** Neighbouring runs of one colour as one. */
function merge(runs: readonly Run[]): Run[] {
  const out: Run[] = []
  for (const run of runs) {
    const prev = out.at(-1)
    if (prev && prev.color === run.color) prev.text += run.text
    else out.push({ ...run })
  }
  return out
}

function trimEnd(runs: Run[]): Run[] {
  const last = runs.at(-1)
  if (last) last.text = last.text.trimEnd()
  return runs.filter((r) => r.text !== "")
}

/** The runs cut to the first `length` characters of `text`, with `tail` added. */
function cut(runs: readonly Run[], text: string, tail: string): Run[] {
  const out: Run[] = []
  let left = text.length
  for (const run of runs) {
    if (left <= 0) break
    out.push({ ...run, text: run.text.slice(0, left) })
    left -= run.text.length
  }
  const end = out.at(-1)
  if (end) end.text += tail
  return out
}

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16)
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]
}

/** WCAG contrast of two `#rrggbb` colours. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

/** A role's colour lifted toward paper until it reads at ≥ 4.5:1 on the card's ink. */
export function readable(color: string | undefined, on = C.ink): string {
  if (!color || !/^#[0-9a-f]{6}$/i.test(color)) return C.paper
  let out = color
  for (let k = 0.15; contrast(out, on) < 4.5 && k <= 1; k += 0.15) out = mix(color, C.paper, k)
  return out
}

function mix(a: string, b: string, k: number): string {
  const x = Number.parseInt(a.slice(1), 16)
  const y = Number.parseInt(b.slice(1), 16)
  const ch = (shift: number) => Math.round(((x >> shift) & 255) * (1 - k) + ((y >> shift) & 255) * k)
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, "0")).join("")}`
}

// ── drawing ──

type Ctx = CanvasRenderingContext2D

/**
 * The card as a canvas. `frame` is the hero shot, its subject at `focus` (shares of its size);
 * undefined draws the card on ink alone (the hall couldn't be filmed).
 */
export function drawCard(
  recap: Recap,
  format: Format,
  frame: (CanvasImageSource & { width: number; height: number }) | undefined,
  focus = { x: 0.5, y: 0.5 },
): HTMLCanvasElement {
  const { width, height } = SIZES[format]
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d")
  if (!ctx) return canvas
  ctx.fillStyle = C.ink
  ctx.fillRect(0, 0, width, height)
  ctx.textBaseline = "alphabetic"
  if (format === "landscape") landscape(ctx, recap, frame, focus)
  else portrait(ctx, recap, frame, focus)
  return canvas
}

/** Draws `frame` covering the box, its focus put at (`fx`, `fy`) of the box where the crop allows. */
function cover(
  ctx: Ctx,
  frame: CanvasImageSource & { width: number; height: number },
  box: { x: number; y: number; w: number; h: number },
  focus: { x: number; y: number },
  at: { x: number; y: number },
  zoom = 1,
) {
  const scale = Math.max(box.w / frame.width, box.h / frame.height) * zoom
  const sw = box.w / scale
  const sh = box.h / scale
  const sx = Math.min(frame.width - sw, Math.max(0, focus.x * frame.width - at.x * sw))
  const sy = Math.min(frame.height - sh, Math.max(0, focus.y * frame.height - at.y * sh))
  ctx.imageSmoothingQuality = "high"
  ctx.drawImage(frame, sx, sy, sw, sh, box.x, box.y, box.w, box.h)
}

/** The og card's brass corner ticks, `inset` from the edges. */
function ticks(ctx: Ctx, width: number, height: number, inset: number, arm: number) {
  ctx.strokeStyle = C.brassLine
  ctx.lineWidth = 1.5
  ctx.beginPath()
  for (const [x, y, dx, dy] of [
    [inset, inset, 1, 1],
    [width - inset, inset, -1, 1],
    [inset, height - inset, 1, -1],
    [width - inset, height - inset, -1, -1],
  ] as const) {
    ctx.moveTo(x, y + dy * arm)
    ctx.lineTo(x, y)
    ctx.lineTo(x + dx * arm, y)
  }
  ctx.stroke()
}

/** Letter-spaced small caps (Marcellus SC), left-aligned at x. Returns its width. */
function caps(ctx: Ctx, text: string, x: number, y: number, size: number, color: string, spacing = 0.18) {
  ctx.font = `400 ${size}px ${F.display}`
  ctx.fillStyle = color
  ;(ctx as Ctx & { letterSpacing?: string }).letterSpacing = `${(size * spacing).toFixed(1)}px`
  ctx.fillText(text, x, y)
  const w = ctx.measureText(text).width
  ;(ctx as Ctx & { letterSpacing?: string }).letterSpacing = "0px"
  return w
}

/** Wrapped, coloured text; returns the y below its last line. */
function prose(
  ctx: Ctx,
  parts: readonly CaptionPart[],
  font: string,
  color: string,
  box: { x: number; y: number; w: number },
  lineHeight: number,
  max: number,
): number {
  ctx.font = font
  const lines = wrapRuns(parts, (t) => ctx.measureText(t).width, box.w, max)
  let y = box.y
  for (const line of lines) {
    let x = box.x
    for (const run of line) {
      ctx.fillStyle = run.color ? readable(run.color) : color
      ctx.fillText(run.text, x, y)
      x += ctx.measureText(run.text).width
    }
    y += lineHeight
  }
  return y - lineHeight
}

/** The guild's crest (hud/icons.tsx `crest`), a brass shield, at (x, y) top-left, `size` px. */
function crest(ctx: Ctx, x: number, y: number, size: number) {
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(size / 16, size / 16)
  ctx.strokeStyle = C.brass
  ctx.lineWidth = 1.4
  ctx.lineCap = "round"
  ctx.lineJoin = "round"
  // hud/icons.tsx `crest`, stroke for stroke.
  for (const d of [
    "M8 1.5 13.5 4v4.2c0 3-2.3 5.3-5.5 6.3-3.2-1-5.5-3.3-5.5-6.3V4z",
    "M5.2 9.5V7.2L8 5.4l2.8 1.8v2.3",
    "M6.6 9.5V8.3h2.8v1.2",
  ])
    ctx.stroke(new Path2D(d))
  ctx.restore()
}

/** The numbers, a grid of `cols`: value (mono, brass) over label (body, muted). Returns the y below. */
function numbers(
  ctx: Ctx,
  recap: Recap,
  box: { x: number; y: number; w: number },
  cols: number,
  size: { value: number; label: number; row: number },
): number {
  const colW = box.w / cols
  const items = recap.numbers.slice(0, cols * 2)
  items.forEach((n, i) => {
    const x = box.x + (i % cols) * colW
    const top = box.y + Math.floor(i / cols) * size.row
    ctx.font = `400 ${size.value}px ${F.mono}`
    ctx.fillStyle = C.brassHi
    ctx.fillText(n.value, x, top + size.value)
    ctx.font = `400 ${size.label}px ${F.body}`
    ctx.fillStyle = C.muted
    ctx.fillText(n.label, x, top + size.value + size.label + 6)
  })
  return box.y + Math.ceil(items.length / cols) * size.row
}

/** The three lines, each after a brass lozenge. Returns the y below. */
function tale(
  ctx: Ctx,
  recap: Recap,
  box: { x: number; y: number; w: number },
  size: number,
  lineHeight: number,
  gap: number,
  /** The lowest baseline the tale may reach (the footer's top). */
  bottom: number,
): number {
  // Two lines each where they fit above the footer; one each (cut with …) where they don't.
  ctx.font = `italic 400 ${size}px ${F.serif}`
  const measure = (t: string) => ctx.measureText(t).width
  const tall = (max: number) =>
    recap.lines.reduce(
      (h, l) => h + wrapRuns(l.parts, measure, box.w - 22, max).length * lineHeight + gap,
      0,
    ) -
    lineHeight -
    gap
  const maxLines = box.y + tall(2) <= bottom ? 2 : 1
  let y = box.y
  for (const line of recap.lines) {
    if (y > bottom) break
    ctx.save()
    ctx.translate(box.x + 4, y - size * 0.32)
    ctx.rotate(Math.PI / 4)
    ctx.fillStyle = C.brass
    const d = Math.round(size * 0.36)
    ctx.fillRect(-d / 2, -d / 2, d, d)
    ctx.restore()
    y = prose(
      ctx,
      line.parts,
      `italic 400 ${size}px ${F.serif}`,
      C.paper,
      { x: box.x + 22, y, w: box.w - 22 },
      lineHeight,
      maxLines,
    )
    y += lineHeight + gap
  }
  return y
}

/** The hero's tag: a small ink plaque on the picture, `◆ 1:48  v1.4.0: a galleon comes in`. */
function tag(ctx: Ctx, recap: Recap, right: number, bottom: number, size: number) {
  const hero = recap.hero
  if (!hero) return
  const clock = (() => {
    const s = Math.floor(hero.at / 1000)
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
  })()
  ctx.font = `500 ${size}px ${F.body}`
  const words = hero.label
  const clockFont = `400 ${size - 2}px ${F.mono}`
  const ww = ctx.measureText(words).width
  ctx.font = clockFont
  const cw = ctx.measureText(clock).width
  const padX = size * 0.8
  const h = size * 2.1
  const w = padX * 2 + cw + size * 0.8 + ww
  const x = right - w
  const y = bottom - h
  ctx.fillStyle = "rgba(20, 15, 11, 0.82)"
  ctx.strokeStyle = C.brassLine
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, 6)
  ctx.fill()
  ctx.stroke()
  const base = y + h / 2 + size * 0.34
  ctx.font = clockFont
  ctx.fillStyle = C.brassHi
  ctx.fillText(clock, x + padX, base)
  ctx.font = `500 ${size}px ${F.body}`
  ctx.fillStyle = C.paper
  ctx.fillText(words, x + padX + cw + size * 0.8, base)
}

function footer(ctx: Ctx, x: number, y: number, size: number) {
  crest(ctx, x, y - size * 1.05, size * 1.3)
  const w = caps(ctx, "Guildhall", x + size * 1.9, y, size, C.brass, 0.14)
  ctx.font = `400 ${size * 0.88}px ${F.body}`
  ctx.fillStyle = C.faint
  ctx.fillText("guildhall.codestz.dev", x + size * 1.9 + w + size * 1.1, y)
}

function landscape(
  ctx: Ctx,
  recap: Recap,
  frame: Parameters<typeof cover>[1] | undefined,
  focus: { x: number; y: number },
) {
  const W = 1200
  const H = 630
  // The picture, its subject right of centre, clear of the text.
  if (frame) cover(ctx, frame, { x: 0, y: 0, w: W, h: H }, focus, { x: 0.68, y: 0.5 }, 1.2)
  // The og card's wash: ink at the left, the picture breathing out at the right.
  const wash = ctx.createLinearGradient(0, 0, W, 0)
  wash.addColorStop(0, "rgba(14, 10, 7, 0.96)")
  wash.addColorStop(0.36, "rgba(14, 10, 7, 0.9)")
  wash.addColorStop(0.55, "rgba(14, 10, 7, 0.45)")
  wash.addColorStop(0.72, "rgba(14, 10, 7, 0)")
  ctx.fillStyle = wash
  ctx.fillRect(0, 0, W, H)
  const shade = ctx.createLinearGradient(0, H * 0.7, 0, H)
  shade.addColorStop(0, "rgba(14, 10, 7, 0)")
  shade.addColorStop(1, "rgba(14, 10, 7, 0.5)")
  ctx.fillStyle = shade
  ctx.fillRect(0, 0, W, H)
  ticks(ctx, W, H, 22, 24)

  const x = 64
  const w = 470
  caps(ctx, "The Chronicle of", x, 82, 15, C.brass)
  let y = prose(ctx, [{ text: recap.title }], `600 36px ${F.serif}`, C.paper, { x, y: 126, w }, 42, 2)
  ctx.font = `400 17px ${F.body}`
  ctx.fillStyle = C.muted
  y += 32
  ctx.fillText(clipTo(ctx, `${recap.guild}  ·  ${recap.story}`, w), x, y)
  y += 22
  ctx.fillStyle = C.brassLine
  ctx.fillRect(x, y, 220, 1)
  y = numbers(ctx, recap, { x, y: y + 20, w }, 3, { value: 26, label: 14, row: 58 })
  tale(ctx, recap, { x, y: y + 28, w }, 16.5, 21, 10, H - 84)
  footer(ctx, x, H - 46, 14)
  tag(ctx, recap, W - 52, H - 44, 15)
}

function portrait(
  ctx: Ctx,
  recap: Recap,
  frame: Parameters<typeof cover>[1] | undefined,
  focus: { x: number; y: number },
) {
  const W = 1080
  const H = 1350
  const picture = 660
  if (frame) cover(ctx, frame, { x: 0, y: 0, w: W, h: picture }, focus, { x: 0.5, y: 0.52 }, 1.15)
  // The picture sinks into ink: the tale reads below on solid ground.
  const fade = ctx.createLinearGradient(0, picture * 0.62, 0, picture + 2)
  fade.addColorStop(0, "rgba(21, 17, 13, 0)")
  fade.addColorStop(1, C.ink)
  ctx.fillStyle = fade
  ctx.fillRect(0, 0, W, picture + 2)
  const top = ctx.createLinearGradient(0, 0, 0, 160)
  top.addColorStop(0, "rgba(14, 10, 7, 0.45)")
  top.addColorStop(1, "rgba(14, 10, 7, 0)")
  ctx.fillStyle = top
  ctx.fillRect(0, 0, W, 160)
  ticks(ctx, W, H, 28, 30)
  tag(ctx, recap, W - 64, picture - 70, 22)

  const x = 72
  const w = W - 144
  caps(ctx, "The Chronicle of", x, picture + 16, 22, C.brass)
  let y = prose(
    ctx,
    [{ text: recap.title }],
    `600 52px ${F.serif}`,
    C.paper,
    { x, y: picture + 82, w },
    60,
    2,
  )
  ctx.font = `400 25px ${F.body}`
  ctx.fillStyle = C.muted
  y += 48
  ctx.fillText(clipTo(ctx, `${recap.guild}  ·  ${recap.story}`, w), x, y)
  y += 30
  ctx.fillStyle = C.brassLine
  ctx.fillRect(x, y, 300, 1.5)
  y = numbers(ctx, recap, { x, y: y + 30, w }, 3, { value: 40, label: 20, row: 78 })
  tale(ctx, recap, { x, y: y + 44, w }, 25, 32, 16, H - 90)
  footer(ctx, x, H - 60, 21)
}

/** `text` shortened with `…` to fit `width` in the context's font. */
function clipTo(ctx: Ctx, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text
  let out = text
  while (out.length > 1 && ctx.measureText(`${out}…`).width > width) out = out.slice(0, -1)
  return `${out.trimEnd()}…`
}
