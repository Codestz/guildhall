/**
 * Stroke paths for the verb glyphs, on the 16-unit grid of hud/icons.tsx (1.5 strokes, round caps).
 * One source for two renderers: the HUD draws them as SVG (`Icon`), the scene paints them into the
 * deed-sigil atlas (scene/Sigils.tsx) with canvas `Path2D`. So the chips and the world share one
 * vocabulary by construction. Circles are written as two arcs, which both renderers accept.
 */
export const GLYPH_PATHS = {
  /** An open book. */
  read: [
    "M8 4.5C6.5 3.3 4.3 3 2 3.2v9.3c2.3-.2 4.5.1 6 1.3 1.5-1.2 3.7-1.5 6-1.3V3.2c-2.3-.2-4.5.1-6 1.3zM8 4.5v9.3",
  ],
  /** A quill. */
  edit: ["M10.8 2.7a1.6 1.6 0 0 1 2.3 2.3L5.5 12.6l-3 .9.9-3z", "M9.6 3.9 12 6.3"],
  /** A magnifier. */
  search: [circle(7, 7, 4.2), "m10.2 10.2 3.6 3.6"],
  /** A flask. */
  test: ["M6 2.5h4M6.8 2.5v4L3 12.6a.9.9 0 0 0 .8 1.4h8.4a.9.9 0 0 0 .8-1.4L9.2 6.5v-4M4.6 10h6.8"],
  /** A terminal prompt. */
  run: ["m3 4.5 3.5 3.5L3 11.5M8.5 12h4.5"],
  /** A thought cloud. */
  thought: ["M4.5 10.5a3.5 3.5 0 0 1 .4-7 4 4 0 0 1 7 1.4 2.8 2.8 0 0 1-.4 5.6z", circle(4, 13.2, 0.9)],
  /** A hammer: work of a kind the hall has no word for. */
  work: ["m9.5 2.5 4 4-1.5 1.5-4-4zM8 6 2.5 11.5l2 2L10 8"],
  /** A globe: consulting the web or an outside tool (MCP). */
  globe: [
    circle(8, 8, 5.6),
    "M8 2.4c-1.9 1.6-2.7 3.5-2.7 5.6s.8 4 2.7 5.6M8 2.4c1.9 1.6 2.7 3.5 2.7 5.6s-.8 4-2.7 5.6M2.4 8h11.2",
  ],
  /** A summoning star: the guildmaster sending a quest. */
  star: ["M8 2 9.4 6.6 14 8 9.4 9.4 8 14 6.6 9.4 2 8 6.6 6.6z", "M12.9 1.6v2.6M11.6 2.9h2.6"],
} as const satisfies Record<string, readonly string[]>

export type GlyphPath = keyof typeof GLYPH_PATHS

/** A circle as a path: two half arcs. */
function circle(cx: number, cy: number, r: number): string {
  return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`
}
