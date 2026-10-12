/**
 * The map's screen-space marks: POI badges with a small glyph per station kind, and old-map lettering
 * (district names spaced out in small caps, water in italic) that never overlaps itself.
 */
import type { Vec2 } from "@guildhall/world"
import type { Label } from "./derive.ts"
import type { Theme } from "./theme.ts"

/** A glyph in a 12 px box centred on 0,0, stroked in the badge's ink. */
const GLYPHS: Record<string, (c: CanvasRenderingContext2D) => void> = {
  market: (c) => {
    // An awning over a counter.
    c.moveTo(-5, -1)
    c.lineTo(-3.5, -5)
    c.lineTo(3.5, -5)
    c.lineTo(5, -1)
    c.closePath()
    c.moveTo(-4, -1)
    c.lineTo(-4, 4)
    c.moveTo(4, -1)
    c.lineTo(4, 4)
    c.moveTo(-5, 4)
    c.lineTo(5, 4)
  },
  forge: (c) => {
    // An anvil.
    c.moveTo(-5, -2)
    c.lineTo(4, -2)
    c.lineTo(2, 1)
    c.lineTo(-2, 1)
    c.closePath()
    c.moveTo(-1, 1)
    c.lineTo(-2, 4)
    c.lineTo(3, 4)
    c.lineTo(2, 1)
  },
  tavern: (c) => {
    // A tankard.
    c.rect(-4, -4, 6, 8)
    c.moveTo(2, -2)
    c.quadraticCurveTo(5.5, -2, 5.5, 0.5)
    c.quadraticCurveTo(5.5, 3, 2, 3)
  },
  dock: (c) => {
    // An anchor.
    c.moveTo(0, -5)
    c.lineTo(0, 4.5)
    c.moveTo(-3, -2.5)
    c.lineTo(3, -2.5)
    c.moveTo(-4.5, 1.5)
    c.quadraticCurveTo(-4, 4.8, 0, 4.8)
    c.quadraticCurveTo(4, 4.8, 4.5, 1.5)
  },
  field: (c) => {
    // A sheaf.
    c.moveTo(0, 5)
    c.lineTo(0, -4)
    c.moveTo(0, 1)
    c.lineTo(-3.5, -3)
    c.moveTo(0, 1)
    c.lineTo(3.5, -3)
    c.moveTo(-3, 5)
    c.lineTo(3, 5)
  },
  hall: (c) => {
    // A pennant on a pole.
    c.moveTo(-3, 5)
    c.lineTo(-3, -5)
    c.lineTo(4, -2.5)
    c.lineTo(-3, 0)
  },
  well: (c) => {
    // A well's ring and roof.
    c.moveTo(-5, -1)
    c.lineTo(0, -5)
    c.lineTo(5, -1)
    c.rect(-3.5, 1, 7, 3.5)
  },
  gate: (c) => {
    // An arch.
    c.moveTo(-4.5, 5)
    c.lineTo(-4.5, -1)
    c.arc(0, -1, 4.5, Math.PI, 0)
    c.lineTo(4.5, 5)
  },
}

/** A round badge with the station's glyph. Unknown kinds get a dot. */
export function poiGlyph(ctx: CanvasRenderingContext2D, theme: Theme, at: Vec2, kind: string): void {
  const [x, y] = at
  ctx.save()
  ctx.translate(Math.round(x), Math.round(y))
  ctx.beginPath()
  ctx.arc(0, 0, 9.5, 0, Math.PI * 2)
  ctx.fillStyle = theme.poi.bg
  ctx.shadowColor = "rgba(0,0,0,0.35)"
  ctx.shadowBlur = 3
  ctx.shadowOffsetY = 1
  ctx.fill()
  ctx.shadowColor = "transparent"
  ctx.lineWidth = 1.2
  ctx.strokeStyle = theme.poi.ring
  ctx.stroke()
  ctx.beginPath()
  const glyph = GLYPHS[kind]
  if (glyph) glyph(ctx)
  else ctx.arc(0, 0, 2.5, 0, Math.PI * 2)
  ctx.lineWidth = 1.4
  ctx.lineCap = "round"
  ctx.lineJoin = "round"
  ctx.strokeStyle = theme.poi.fg
  ctx.stroke()
  ctx.restore()
}

const FONTS: Record<Label["kind"], { font: string; spacing: number; upper: boolean }> = {
  district: { font: '400 13px "Marcellus SC", Georgia, serif', spacing: 2.6, upper: true },
  castle: { font: '400 12px "Marcellus SC", Georgia, serif', spacing: 2, upper: true },
  square: { font: 'italic 500 12.5px "Alegreya Sans", Georgia, serif', spacing: 0.6, upper: false },
  water: { font: 'italic 500 16px "Alegreya Sans", Georgia, serif', spacing: 4, upper: false },
}

/** Lettering with a paper halo; a label that would overlap one already set is left out. */
export function overlayLabels(
  ctx: CanvasRenderingContext2D,
  theme: Theme,
  labels: readonly Label[],
  toScreen: (p: Vec2) => Vec2,
  scale: number,
): void {
  const placed: [number, number, number, number][] = []
  // Squares and the castle need the room more than a district does; water goes first, it is biggest.
  const order: Label["kind"][] = ["water", "castle", "square", "district"]
  ctx.save()
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.lineJoin = "round"
  for (const kind of order)
    for (const label of labels) {
      if (label.kind !== kind) continue
      if (kind === "square" && scale < 1.4) continue
      const f = FONTS[kind]
      const text = f.upper ? label.text.toUpperCase() : label.text
      ctx.font = f.font
      ctx.letterSpacing = `${f.spacing}px`
      const w = ctx.measureText(text).width
      const [x, y0] = toScreen(label.at)
      const y = kind === "castle" ? y0 + 22 : y0
      const rect: [number, number, number, number] = [x - w / 2 - 4, y - 10, x + w / 2 + 4, y + 10]
      if (placed.some((r) => r[0] < rect[2] && rect[0] < r[2] && r[1] < rect[3] && rect[1] < r[3])) continue
      placed.push(rect)
      ctx.lineWidth = 3.5
      ctx.strokeStyle = kind === "water" ? "rgba(20, 50, 80, 0.35)" : theme.halo
      ctx.strokeText(text, x, y)
      ctx.fillStyle = kind === "water" ? theme.water.ink : theme.ink
      ctx.fillText(text, x, y)
    }
  ctx.restore()
}
