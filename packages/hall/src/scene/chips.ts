import { type Camera, type Object3D, Vector3 } from "three"
import type { HudMode } from "../hud/prefs.ts"
import { pxPerUnit, sigilRoom, sizeFor } from "./sigilSize.ts"

/**
 * Screen-space declutter for the name chips over adventurers' heads (drei `<Html>`).
 *
 * About ten times a second it projects every chip's anchor, sorts nearest first, and:
 *  - folds a pile of three or more overlapping chips into one that reads "+N";
 *  - nudges any other overlapping chip upward until it clears the ones placed before it.
 * The chip you follow and a pleading chip always stay visible (they are placed first).
 *
 * A chip whose adventurer shows a deed sigil (scene/Sigils.tsx) keeps a band under itself for it
 * (`--room`, sigilSize.ts), and that band counts as part of the chip: no other chip is placed over a
 * sigil, and in the Hidden HUD (no name plate) the sigils alone still declutter.
 *
 * Speech bubbles are the declutter's too (`speaks`, below): with no HUD the world speaks only through
 * the story captions; in Minimal a bubble shows for whoever you follow, or once the camera is close
 * enough that speech belongs to a figure you can see; never two bubbles over one another and at most
 * MAX_SPEAKERS on screen, nearest first, so they never stack into a wall of text.
 *
 * Nothing here goes through React: it writes a CSS variable (`--lift`), two attributes and a text,
 * and only when they change. CSS eases the lift and fades a folded chip, so nothing jumps.
 * No allocations per run: slots, scratch vectors and the sort are all reused.
 */

/** Height of the chip's anchor above the adventurer's feet (the `<Html position>`). */
export const CHIP_HEIGHT = 3.2
const EVERY_MS = 100
/** Space kept between two chips, px. */
const GAP = 3
/** A chip never climbs further than this above its head, px: past it, it sits where it can. */
const MAX_LIFT = 96
/** A pile this large folds into one chip. */
const FOLD_AT = 3
/** Runs a chip must want to fold (or unfold) before it does: chips walking past don't flicker. */
const FOLD_AFTER = 3
const UNFOLD_AFTER = 2
/** Speech bubbles on screen at once, at most (the followed one counts among them). */
export const MAX_SPEAKERS = 3
/**
 * CSS px a world unit must span before Minimal shows speech unasked: a figure ~45 px tall, close
 * enough to read as a person. The diorama overview is ~6; Explore close-ups are 25 and up.
 */
export const READ_AT_PX = 18
/** A bubble's widest box, px (hall.css `.chip .bubble`: 220 wide, two lines and the name). */
const BUBBLE_W = 220
const BUBBLE_H = 64

/**
 * May this chip's bubble show, by the HUD mode, who you follow and how close the camera is?
 * Hidden: never (the captions carry the story). Detailed: always. Minimal: the followed one, or
 * when close enough to read. (The declutter then caps it: no overlapping bubbles, MAX_SPEAKERS in all.)
 */
export function speaks(mode: HudMode, selected: boolean, perUnit: number): boolean {
  if (mode === "hidden") return false
  if (mode === "detailed" || selected) return true
  return perUnit >= READ_AT_PX
}

let hud: HudMode = "minimal"
/** The HUD mode, for the bubble rule (hud/Hud.tsx keeps it current). */
export function setChipMode(mode: HudMode): void {
  hud = mode
}

export interface ChipSlot {
  /** The adventurer's session id ("" for chips that are not an adventurer's): sigils find their chip by it. */
  id: string
  /** The adventurer's root: the anchor is CHIP_HEIGHT above it, in its own space. */
  anchor: Object3D | null
  /** The `.chip` element. */
  el: HTMLElement | null
  /** Where "+N" is written. */
  more: HTMLElement | null
  /** The selected or pleading chip: never folded, placed before anyone else. */
  pinned: boolean
  /** A deed sigil shows under this chip: keep room for it (set by scene/Sigils.tsx). */
  sigil: boolean
  /** This adventurer has something to say (a `.bubble` is in the chip). */
  bubble: boolean
  /** The one you follow (its bubble may show in Minimal at any distance). */
  selected: boolean
  // ── per run ──
  on: boolean
  x: number
  y: number
  w: number
  h: number
  z: number
  parent: number
  index: number
  /** Chips in the pile this one roots (meaningful on roots only). */
  count: number
  lift: number
  /** Px kept under the chip for its sigil, this run. */
  room: number
  /** CSS px a world unit spans at the anchor, this run. */
  perUnit: number
  /** Its bubble shows, this run. */
  speak: boolean
  // ── written state ──
  shownLift: number
  shownRoom: number
  shownSpeak: boolean
  folded: boolean
  votes: number
  shownMore: number
  moreN: number
}

export function chipSlot(): ChipSlot {
  return {
    id: "",
    anchor: null,
    el: null,
    more: null,
    pinned: false,
    sigil: false,
    bubble: false,
    selected: false,
    on: false,
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    z: 0,
    parent: 0,
    index: 0,
    count: 0,
    lift: 0,
    room: 0,
    perUnit: 0,
    speak: false,
    shownLift: 0,
    shownRoom: 0,
    shownSpeak: false,
    folded: false,
    votes: 0,
    shownMore: 0,
    moreN: 0,
  }
}

const slots: ChipSlot[] = []
/** On-screen slots, priority order: reused every run. */
const order: ChipSlot[] = []
const scratch = new Vector3()
let last = -Infinity

export function addChip(slot: ChipSlot): void {
  if (!slots.includes(slot)) slots.push(slot)
}

/** The chip of the adventurer with session `id`, if it is on stage. */
export function chipOf(id: string): ChipSlot | undefined {
  for (const slot of slots) if (slot.id === id) return slot
  return undefined
}

export function removeChip(slot: ChipSlot): void {
  const at = slots.indexOf(slot)
  if (at >= 0) slots.splice(at, 1)
}

/**
 * Called from every adventurer's frame; does the work at most every EVERY_MS. `width`/`height` are
 * the canvas size in CSS px (R3F `size`), the space drei places the chips in.
 */
export function declutter(camera: Camera, width: number, height: number, now = performance.now()): void {
  if (now - last < EVERY_MS) return
  last = now
  layout(camera, width, height)
}

/** One run, exported for tests. */
export function layout(camera: Camera, width: number, height: number): void {
  // ── read: every measurement first, then every write, so the browser lays out once ──
  order.length = 0
  for (const slot of slots) {
    slot.on = false
    const { el, anchor } = slot
    if (!el || !anchor) continue
    scratch.set(0, CHIP_HEIGHT, 0)
    anchor.localToWorld(scratch)
    const perUnit = pxPerUnit(camera, scratch, height)
    slot.perUnit = perUnit
    const size = slot.sigil ? sizeFor(perUnit) : 0
    slot.room = size ? sigilRoom(size, perUnit, CHIP_HEIGHT) : 0
    // The band counts as part of the chip, so a sigil alone (Hidden HUD: no plate) declutters too.
    const w = Math.max(el.offsetWidth, size)
    const h = el.offsetHeight + slot.room || size
    if (w === 0 || h === 0) continue
    scratch.project(camera)
    if (scratch.z > 1 || scratch.z < -1) continue
    slot.x = (scratch.x * 0.5 + 0.5) * width
    // The chip's bottom edge sits on the anchor (drei centres it; `.chip` lifts itself by half).
    slot.y = (-scratch.y * 0.5 + 0.5) * height
    slot.z = scratch.z
    slot.w = w
    slot.h = h
    slot.on = true
    insert(slot)
  }

  // ── piles: chips whose resting boxes overlap, joined transitively ──
  for (let i = 0; i < order.length; i++) {
    const slot = order[i] as ChipSlot
    slot.index = i
    slot.parent = i
    slot.count = 0
    slot.moreN = 0
  }
  for (let i = 0; i < order.length; i++) {
    const a = order[i] as ChipSlot
    for (let j = i + 1; j < order.length; j++) {
      const b = order[j] as ChipSlot
      if (overlaps(a, 0, b, 0)) union(i, j)
    }
  }
  for (const slot of order) (order[find(slot.index)] as ChipSlot).count++
  for (const slot of order) {
    const root = order[find(slot.index)] as ChipSlot
    if (slot.pinned) {
      slot.folded = false
      slot.votes = 0
      continue
    }
    // The first of a pile in priority order is its root (union keeps the lower index): it stays.
    vote(slot, root.count >= FOLD_AT && slot !== root)
  }
  // "+N" goes on the first chip of the pile still shown; a pile always keeps one chip.
  for (const slot of order) {
    if (!slot.folded) continue
    const host = hostOf(slot)
    if (host) host.moreN++
    else slot.folded = false
  }

  // ── speech: pinned and nearest first, never two bubbles in one place, MAX_SPEAKERS in all ──
  let speakers = 0
  for (const slot of order) slot.speak = false
  for (const slot of order) {
    if (speakers >= MAX_SPEAKERS) break
    if (slot.folded || !slot.bubble || !speaks(hud, slot.selected, slot.perUnit)) continue
    if (crowded(slot)) continue
    slot.speak = true
    speakers++
  }

  // ── nudge: place shown chips in priority order, each above whatever it would cover ──
  for (const slot of order) slot.lift = 0
  for (let i = 0; i < order.length; i++) {
    const slot = order[i] as ChipSlot
    if (slot.folded) continue
    let moved = true
    let guard = 0
    while (moved && guard++ < 8) {
      moved = false
      for (let j = 0; j < i; j++) {
        const other = order[j] as ChipSlot
        if (other.folded || !overlaps(slot, slot.lift, other, other.lift)) continue
        // Bottom of this chip goes GAP above the top of the other.
        const need = slot.y - (other.y - other.lift - other.h) + GAP
        if (need > slot.lift) {
          slot.lift = Math.min(MAX_LIFT, need)
          moved = slot.lift < MAX_LIFT
        }
      }
    }
  }

  // ── write: only what changed ──
  for (const slot of slots) {
    const el = slot.el
    if (!el) continue
    if (!slot.on) {
      // Off screen: let it rest, so it comes back where it belongs.
      slot.lift = 0
      slot.moreN = 0
      slot.folded = false
      slot.votes = 0
      slot.room = slot.sigil ? slot.shownRoom : 0
    }
    if (slot.room !== slot.shownRoom) {
      slot.shownRoom = slot.room
      el.style.setProperty("--room", `${slot.room}px`)
    }
    const lift = slot.folded ? slot.shownLift : Math.round(slot.lift)
    if (lift !== slot.shownLift) {
      slot.shownLift = lift
      el.style.setProperty("--lift", `${lift}px`)
    }
    // Attributes React never sets on the chip, so its re-renders can't undo them.
    if (el.hasAttribute("data-folded") !== slot.folded) el.toggleAttribute("data-folded", slot.folded)
    if (!slot.on) slot.speak = false
    if (slot.speak !== slot.shownSpeak) {
      slot.shownSpeak = slot.speak
      el.toggleAttribute("data-speak", slot.speak)
    }
    if (slot.moreN !== slot.shownMore) {
      slot.shownMore = slot.moreN
      if (slot.more) slot.more.textContent = slot.moreN > 0 ? `+${slot.moreN}` : ""
      el.toggleAttribute("data-more", slot.moreN > 0)
    }
  }
}

/** Into `order`: pinned first, then nearest the camera first. Insertion sort: tiny n, no garbage. */
function insert(slot: ChipSlot): void {
  let i = order.length
  order.push(slot)
  while (i > 0 && before(slot, order[i - 1] as ChipSlot)) {
    order[i] = order[i - 1] as ChipSlot
    i--
  }
  order[i] = slot
}

function before(a: ChipSlot, b: ChipSlot): boolean {
  if (a.pinned !== b.pinned) return a.pinned
  return a.z < b.z
}

function overlaps(a: ChipSlot, liftA: number, b: ChipSlot, liftB: number): boolean {
  const ab = a.y - liftA
  const bb = b.y - liftB
  return Math.abs(a.x - b.x) * 2 < a.w + b.w + GAP * 2 && ab - a.h < bb + GAP && bb - b.h < ab + GAP
}

function find(i: number): number {
  let at = i
  while ((order[at] as ChipSlot).parent !== at) at = (order[at] as ChipSlot).parent
  // Compress.
  let walk = i
  while ((order[walk] as ChipSlot).parent !== at) {
    const next = (order[walk] as ChipSlot).parent
    ;(order[walk] as ChipSlot).parent = at
    walk = next
  }
  return at
}

/** The lower index (higher priority) becomes the root. */
function union(i: number, j: number): void {
  const a = find(i)
  const b = find(j)
  if (a === b) return
  if (a < b) (order[b] as ChipSlot).parent = a
  else (order[a] as ChipSlot).parent = b
}

function vote(slot: ChipSlot, fold: boolean): void {
  if (fold === slot.folded) {
    slot.votes = 0
    return
  }
  slot.votes++
  if (slot.votes >= (fold ? FOLD_AFTER : UNFOLD_AFTER)) {
    slot.folded = fold
    slot.votes = 0
  }
}

/**
 * Would `slot`'s bubble crowd one already speaking? Judged on a bubble's full box (BUBBLE_W ×
 * BUBBLE_H) at the chips' resting places, never on measured chips: whether a bubble shows changes
 * a chip's size, and that must not turn speech on and off from one run to the next.
 */
function crowded(slot: ChipSlot): boolean {
  for (const other of order) {
    if (!other.speak || other === slot) continue
    if (Math.abs(slot.x - other.x) < BUBBLE_W + GAP && Math.abs(slot.y - other.y) < BUBBLE_H + GAP)
      return true
  }
  return false
}

/** The first shown chip of `slot`'s pile, in priority order. */
function hostOf(slot: ChipSlot): ChipSlot | undefined {
  const root = find(slot.index)
  for (const other of order) if (!other.folded && find(other.index) === root) return other
  return undefined
}

/** Test hook: forget every chip and the clock. */
export function resetChips(): void {
  slots.length = 0
  order.length = 0
  last = -Infinity
  hud = "minimal"
}
