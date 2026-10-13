/**
 * A hero's chip: the label over an agent's head (V1's `.chip`, legacy hall.css and scene/Adventurer),
 * built as plain DOM for a vanilla screen that writes it directly (no React per frame). The look is
 * `.ui-hero` (theme/components.ts): a dark plate edged in the hero's colour with its name in the display
 * face and its rank's pips, a verb line under it (a glyph, a word, the file or term in mono) toned for a
 * plea, a fall or loot, a deed sigil under the plate while a deed runs, a speech bubble over it, a "+N"
 * when the declutter folds a pile into it, and a hopping plea mark that is a button.
 *
 * `heroChip` builds one and hands back its parts; the screen sets their text and attributes when they
 * change. Decorative except the plea mark: the HUD's roster is the accessible list of who does what.
 */

/** The verb line's glyphs and the sigils' (V1 hud/glyphs.ts): 1.5 px strokes on a 16-unit grid. */
export const CHIP_GLYPHS = {
  read: [
    "M8 4.5C6.5 3.3 4.3 3 2 3.2v9.3c2.3-.2 4.5.1 6 1.3 1.5-1.2 3.7-1.5 6-1.3V3.2c-2.3-.2-4.5.1-6 1.3zM8 4.5v9.3",
  ],
  edit: ["M10.8 2.7a1.6 1.6 0 0 1 2.3 2.3L5.5 12.6l-3 .9.9-3z", "M9.6 3.9 12 6.3"],
  search: ["M2.8 7a4.2 4.2 0 1 0 8.4 0 4.2 4.2 0 1 0-8.4 0", "m10.2 10.2 3.6 3.6"],
  test: ["M6 2.5h4M6.8 2.5v4L3 12.6a.9.9 0 0 0 .8 1.4h8.4a.9.9 0 0 0 .8-1.4L9.2 6.5v-4M4.6 10h6.8"],
  run: ["m3 4.5 3.5 3.5L3 11.5M8.5 12h4.5"],
  thought: [
    "M4.5 10.5a3.5 3.5 0 0 1 .4-7 4 4 0 0 1 7 1.4 2.8 2.8 0 0 1-.4 5.6z",
    "M3.1 13.2a.9.9 0 1 0 1.8 0 .9.9 0 1 0-1.8 0",
  ],
  work: ["m9.5 2.5 4 4-1.5 1.5-4-4zM8 6 2.5 11.5l2 2L10 8"],
  globe: [
    "M2.4 8a5.6 5.6 0 1 0 11.2 0 5.6 5.6 0 1 0-11.2 0",
    "M8 2.4c-1.9 1.6-2.7 3.5-2.7 5.6s.8 4 2.7 5.6M8 2.4c1.9 1.6 2.7 3.5 2.7 5.6s-.8 4-2.7 5.6M2.4 8h11.2",
  ],
  summon: ["M8 2 9.4 6.6 14 8 9.4 9.4 8 14 6.6 9.4 2 8 6.6 6.6z", "M12.9 1.6v2.6M11.6 2.9h2.6"],
  plea: ["M8 1.8 14.2 8 8 14.2 1.8 8z", "M8 5v3.6M8 10.8v.1"],
  loot: ["M2.5 6.5h11v6.5h-11zM2.5 6.5 4 3.5h8l1.5 3M6.5 9h3"],
  idle: ["M12.5 9.5A5 5 0 0 1 6.5 3.5a5 5 0 1 0 6 6z"],
  fail: ["M2 8a6 6 0 1 0 12 0 6 6 0 1 0-12 0", "m5.8 5.8 4.4 4.4M10.2 5.8l-4.4 4.4"],
  join: ["M9.5 2.5h3v11h-3M2.5 8h7M7 5.5 9.5 8 7 10.5"],
  walk: ["M2.5 13.5c2-1 2.5-4 5.5-4s3.5-3 5.5-6"],
} as const satisfies Record<string, readonly string[]>

export type ChipGlyph = keyof typeof CHIP_GLYPHS

/** What a chip's verb line reads as: its colour (always with a glyph and a word, never colour alone). */
export type ChipTone = "plea" | "fail" | "loot" | "idle" | "work"

const SVG = "http://www.w3.org/2000/svg"

/** An SVG glyph element (`currentColor` strokes); `setGlyph` redraws it. */
export function glyphSvg(name: ChipGlyph, cls = "ui-hero-glyph"): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg")
  svg.setAttribute("class", cls)
  svg.setAttribute("viewBox", "0 0 16 16")
  svg.setAttribute("aria-hidden", "true")
  svg.setAttribute("focusable", "false")
  setGlyph(svg, name)
  return svg
}

export function setGlyph(svg: SVGSVGElement, name: ChipGlyph): void {
  if (svg.dataset.glyph === name) return
  svg.dataset.glyph = name
  svg.replaceChildren(
    ...CHIP_GLYPHS[name].map((d) => {
      const path = document.createElementNS(SVG, "path")
      path.setAttribute("d", d)
      return path
    }),
  )
}

/** A chip's parts, for the screen to write. */
export interface HeroChipParts {
  /** The box pinned to the point over the head (the screen moves it: `translate`). */
  at: HTMLDivElement
  /** The chip itself (its attributes: `data-tone`, `data-folded`, `data-speak`…; `--lift`, `--room`). */
  chip: HTMLDivElement
  plea: HTMLButtonElement
  bubble: HTMLDivElement
  plate: HTMLDivElement
  pennant: SVGSVGElement
  name: HTMLSpanElement
  pips: HTMLSpanElement
  more: HTMLElement
  verb: HTMLElement
  glyph: SVGSVGElement
  word: HTMLSpanElement
  target: HTMLSpanElement
  sigil: HTMLDivElement
  sigilGlyph: SVGSVGElement
}

/** Builds one hero's chip, empty: the screen fills it in. `onPlea` answers a click on its plea mark. */
export function heroChip(onPlea?: () => void): HeroChipParts {
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string) => {
    const e = document.createElement(tag)
    e.className = cls
    return e
  }
  const at = el("div", "ui-hero-at")
  const chip = el("div", "ui-hero")
  const plea = el("button", "ui-hero-plea")
  plea.type = "button"
  plea.textContent = "!"
  plea.setAttribute("aria-label", "Waiting on you: open")
  if (onPlea)
    plea.addEventListener("click", (e) => {
      e.stopPropagation()
      onPlea()
    })
  const bubble = el("div", "ui-hero-bubble")
  const plate = el("div", "ui-hero-plate")
  plate.setAttribute("aria-hidden", "true")
  const pennant = document.createElementNS(SVG, "svg")
  pennant.setAttribute("class", "ui-hero-pennant")
  pennant.setAttribute("viewBox", "0 0 9 14")
  const flag = document.createElementNS(SVG, "path")
  flag.setAttribute("d", "M0.5 0.5h8v12.6l-4-3.2-4 3.2z")
  pennant.append(flag)
  const title = el("b", "ui-hero-name")
  const name = el("span", "")
  const pips = el("span", "ui-hero-pips")
  const more = el("i", "ui-hero-more")
  title.append(name, pips, more)
  const verb = el("em", "ui-hero-verb")
  const glyph = glyphSvg("thought")
  const word = el("span", "ui-hero-word")
  const target = el("span", "ui-hero-target")
  verb.append(glyph, word, target)
  plate.append(pennant, title, verb)
  const sigil = el("div", "ui-hero-sigil")
  sigil.setAttribute("aria-hidden", "true")
  const sigilGlyph = glyphSvg("work", "ui-hero-sigil-glyph")
  sigil.append(sigilGlyph)
  chip.append(plea, bubble, plate, sigil)
  at.append(chip)
  return {
    at,
    chip,
    plea,
    bubble,
    plate,
    pennant,
    name,
    pips,
    more,
    verb,
    glyph,
    word,
    target,
    sigil,
    sigilGlyph,
  }
}

/** Sets a chip's rank pips: one for a journeyman, two (gilded) for a master. */
export function setPips(pips: HTMLElement, n: number): void {
  if (pips.childElementCount === n) return
  pips.dataset.n = String(n)
  pips.replaceChildren(...Array.from({ length: n }, () => document.createElement("i")))
}
