/**
 * The townsfolk's words (life between people): a short line over someone near the camera, in the heroes'
 * bubble ("Cheers!", "Good morrow!", "Too dear!"), from what their routine says now (world routines.ts
 * `LifeSample.say`). Rare and quiet by design:
 *
 *   near     only townsfolk within FOLK_SAY_M of the eye speak, nearest first;
 *   the cap  the heroes' bubbles first: townsfolk fill what MAX_SPEAKERS leaves, never a box over a
 *            hero's bubble or another's;
 *   modes    none in the HUD's Hidden mode and none on a phone (chips there are names alone).
 *
 * Plain DOM, as the chips: a few pooled bubbles moved by a transform, texts written only when they
 * change, nothing measured.
 */
import { MAX_SPEAKERS } from "./chips.ts"

/** Townsfolk speak within this many metres of the camera. */
export const FOLK_SAY_M = 24
/** A bubble's box for keeping clear of others, px (`.ui-hero-bubble`'s short lines). */
const BOX_W = 140
const BOX_H = 34

/** One townsfolk saying something this frame: who, the line, where on screen. */
export interface Saying {
  id: number
  text: string
  /** Screen px of the point over the head, and the eye's distance, metres. */
  x: number
  y: number
  depth: number
}

/**
 * Which sayings show (pure, for tests): nearest first within FOLK_SAY_M, at most `MAX_SPEAKERS − heroes`,
 * none whose box would cover a hero's bubble (`taken`, screen px) or another shown saying.
 */
export function chooseSayings(
  said: readonly Saying[],
  taken: readonly { x: number; y: number }[],
  heroes: number,
): Saying[] {
  const room = Math.max(0, MAX_SPEAKERS - heroes)
  if (!room) return []
  const out: Saying[] = []
  const near = said.filter((s) => s.depth <= FOLK_SAY_M).sort((a, b) => a.depth - b.depth || a.id - b.id)
  for (const s of near) {
    if (out.length >= room) break
    const clash = [...taken, ...out].some(
      (o) => Math.abs(o.x - s.x) < BOX_W && Math.abs(o.y - s.y) < BOX_H * 1.6,
    )
    if (!clash) out.push(s)
  }
  return out
}

export interface FolkTalk {
  /** Clears this frame's sayings (before the crowd samples). */
  begin(): void
  /** Someone says `text` this frame, at screen (x, y), `depth` metres from the eye. */
  say(id: number, text: string, x: number, y: number, depth: number): void
  /** Shows this frame's chosen few, clear of the heroes' bubbles (`taken`) and under the cap. */
  end(taken: readonly { x: number; y: number }[], heroes: number, quiet: boolean): void
  dispose(): void
}

export function createFolkTalk(host: HTMLElement): FolkTalk {
  const layer = document.createElement("div")
  layer.className = "ui-heroes ui-folk-talk"
  layer.setAttribute("aria-hidden", "true")
  host.append(layer)
  const pool = Array.from({ length: MAX_SPEAKERS }, () => {
    const at = document.createElement("div")
    at.className = "ui-hero-at"
    const chip = document.createElement("div")
    chip.className = "ui-hero"
    chip.dataset.speak = ""
    const bubble = document.createElement("div")
    bubble.className = "ui-hero-bubble"
    chip.append(bubble)
    at.append(chip)
    at.style.display = "none"
    layer.append(at)
    return { at, bubble, text: "", shown: false, x: Number.NaN, y: Number.NaN }
  })
  const said: Saying[] = []
  return {
    begin() {
      said.length = 0
    },
    say(id, text, x, y, depth) {
      said.push({ id, text, x, y, depth })
    },
    end(taken, heroes, quiet) {
      const shown = quiet ? [] : chooseSayings(said, taken, heroes)
      for (const [k, b] of pool.entries()) {
        const s = shown[k]
        if (!s) {
          if (b.shown) {
            b.at.style.display = "none"
            b.shown = false
          }
          continue
        }
        if (!b.shown) {
          b.at.style.display = ""
          b.shown = true
        }
        if (b.text !== s.text) {
          b.bubble.textContent = s.text
          b.text = s.text
        }
        const x = Math.round(s.x)
        const y = Math.round(s.y)
        if (x !== b.x || y !== b.y) {
          b.at.style.transform = `translate(${x}px, ${y}px)`
          b.x = x
          b.y = y
        }
      }
    },
    dispose() {
      layer.remove()
    },
  }
}
